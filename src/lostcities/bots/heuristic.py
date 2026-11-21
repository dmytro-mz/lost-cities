"""A hand-written player that values each expedition by what it holds, what is in hand and what may still come.

It only uses what a human could see: its hand, both players' expeditions, the discard piles and the deck size.
"""

from __future__ import annotations

from dataclasses import dataclass

from lostcities.bots.base import Bot
from lostcities.game.actions import DECK_SOURCE, Action, Discard, Draw, Play
from lostcities.game.cards import COLORS, DECK, Card, can_extend
from lostcities.game.engine import Phase, View

DECK_VALUE = 3.0  # rough worth of an unknown card from the deck


@dataclass(frozen=True)
class HeuristicConfig:
    noise: float = 0.3  # gaussian noise on move scores
    blunder: float = 0.0  # chance of a random reasonable move
    draw_noise: float = 0.3
    tempo: bool = True  # draw from the deck to hurry the end when ahead, take discards to stall when behind


@dataclass
class _Ctx:
    view: View
    unseen: dict[str, list[Card]]
    p_get: float  # chance a given unseen card ends up in my expeditions
    hand_factor: float  # how much a card in hand is worth compared with one on the table


def _context(view: View) -> _Ctx:
    seen = set(view.hand)
    for side in view.expeditions:
        for pile in side.values():
            seen.update(pile)
    for pile in view.discards.values():
        seen.update(pile)
    unseen: dict[str, list[Card]] = {c: [] for c in COLORS}
    for card in DECK:
        if card not in seen:
            unseen[card.color].append(card)
    deck = view.deck_left
    hidden = deck + view.opponent_hand
    p_get = min(0.6, 0.45 * deck / max(hidden, 1))
    turns_left = -(-deck // 2)
    hand_factor = max(0.15, min(0.92, 0.3 + 0.07 * turns_left))
    return _Ctx(view, unseen, p_get, hand_factor)


def color_value(ctx: _Ctx, color: str, expedition: tuple[Card, ...], hand: list[Card]) -> float:
    """Expected final score of one colour, from what is on the table, in hand and still unseen."""
    started = bool(expedition)
    has_number = any(not c.is_wager for c in expedition)
    last = expedition[-1].value if started else 0
    total = 0.0
    count = 0.0
    mult = 1.0
    in_hand = 0
    for c in expedition:
        total += c.value
        count += 1
        if c.is_wager:
            mult += 1
    hf = ctx.hand_factor
    for c in hand:
        if c.is_wager:
            if not has_number:
                mult += hf
                count += hf
                in_hand += 1
        elif c.value > last:
            total += hf * c.value
            count += hf
            in_hand += 1
    if not started and in_hand == 0:
        return 0.0
    for c in ctx.unseen[color]:
        if c.is_wager:
            if not has_number:
                mult += ctx.p_get * 0.5
                count += ctx.p_get * 0.5
        elif c.value > last:
            total += ctx.p_get * 0.6 * c.value
            count += ctx.p_get * 0.6
    bonus = 20 * min(1.0, max(0.0, (count - 5.5) / 3))
    raw = (total - 20) * mult + bonus
    return raw if started else max(0.0, raw)


def opponent_benefit(ctx: _Ctx, card: Card) -> float:
    """How much handing this card to the opponent (via a discard pile) could help them."""
    theirs = ctx.view.expeditions[ctx.view.opponent][card.color]
    if theirs:
        if not can_extend(theirs, card):
            return 0.0
        return 1.0 if card.is_wager else 0.75 * card.value
    return 0.15 * card.value


class HeuristicBot(Bot):
    def __init__(self, seed: int | None = None, config: HeuristicConfig | None = None) -> None:
        super().__init__(seed)
        self.config = config or HeuristicConfig()

    def _gauss(self) -> float:
        r = self.rng.random
        return (r() + r() + r() - 1.5) * 1.6

    def act(self, view: View) -> Action:
        if view.phase == Phase.DRAW:
            return self._draw(view)
        return self._play(view)

    def _play(self, view: View) -> Action:
        cfg = self.config
        ctx = _context(view)
        mine = view.expeditions[view.seat]
        options: list[tuple[float, Action]] = []
        for card in view.hand:
            same = [c for c in view.hand if c.color == card.color]
            rest = [c for c in same if c is not card]
            before = color_value(ctx, card.color, mine[card.color], same)
            if can_extend(mine[card.color], card):
                after = color_value(ctx, card.color, (*mine[card.color], card), rest)
                options.append((after - before + 1.5, Play(card.id)))
            keep_loss = max(0.0, before - color_value(ctx, card.color, mine[card.color], rest))
            options.append((-(keep_loss + opponent_benefit(ctx, card)), Discard(card.id)))
        options.sort(key=lambda o: -o[0])
        if cfg.blunder and self.rng.random() < cfg.blunder:
            pool = [o for o in options if o[0] > options[0][0] - 15]
            return self.rng.choice(pool)[1]
        return max(options, key=lambda o: o[0] + self._gauss() * cfg.noise)[1]

    def _draw(self, view: View) -> Action:
        cfg = self.config
        ctx = _context(view)
        mine = view.expeditions[view.seat]
        deck_value = DECK_VALUE
        if cfg.tempo:
            lead = self._lead(ctx)
            # Ahead late in the round: run the deck down. Behind: every discard taken is one more turn.
            if view.deck_left < 14:
                deck_value += max(-3.0, min(3.0, lead / 10))
        best_value = deck_value + self._gauss() * cfg.draw_noise
        best: Action = Draw(DECK_SOURCE)
        if cfg.blunder and self.rng.random() < cfg.blunder:
            return best
        for color in COLORS:
            pile = view.discards[color]
            if not pile or color == view.last_discard:
                continue
            top = pile[-1]
            same = [c for c in view.hand if c.color == color]
            gain = color_value(ctx, color, mine[color], [*same, top]) - color_value(ctx, color, mine[color], same)
            value = gain + 0.35 * opponent_benefit(ctx, top) + 0.5 + self._gauss() * cfg.draw_noise
            if value > best_value:
                best_value, best = value, Draw(color)
        return best

    @staticmethod
    def _lead(ctx: _Ctx) -> float:
        """My table score minus the opponent's, this round (what would count if it ended now)."""
        from lostcities.game.scoring import score_expedition

        view = ctx.view

        def table(seat: int) -> int:
            return sum(score_expedition(c, view.expeditions[seat][c]).score for c in COLORS)

        return table(view.seat) - table(view.opponent)
