"""A tuned, endgame-aware player built on the same card-counting valuation as the heuristic bots."""

from __future__ import annotations

from dataclasses import dataclass

from lostcities.bots.base import Bot
from lostcities.game.actions import DECK_SOURCE, Action, Discard, Draw, Play
from lostcities.game.cards import COLORS, DECK, Card, can_extend
from lostcities.game.engine import Phase, View
from lostcities.game.scoring import score_expedition


@dataclass(frozen=True)
class VeteranConfig:
    noise: float = 0.0
    draw_noise: float = 0.0
    hf_base: float = 0.2
    hf_slope: float = 0.07
    hf_min: float = 0.15
    hf_max: float = 1.0
    pget_coef: float = 0.45
    pget_cap: float = 0.6
    unseen_num: float = 0.6
    unseen_wager: float = 0.5
    bonus_lo: float = 5.5
    bonus_span: float = 3.0
    play_bonus: float = 1.5
    start_bonus: float = -1.0
    draw_pile_bonus: float = -0.2
    draw_opp_w: float = 0.55
    deck_value: float = 3.0
    tempo_div: float = 10.0
    tempo_cap: float = 3.0
    tempo_deck: float = 14.0
    opp_wager: float = 2.4
    opp_num: float = 0.75
    opp_unstarted: float = 0.15
    opp_mult_k: float = 0.3


class _Ctx:
    __slots__ = ("cfg", "hand_factor", "p_get", "unseen", "view")

    def __init__(self, cfg: VeteranConfig, view: View) -> None:
        self.cfg = cfg
        self.view = view
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
        self.unseen = unseen
        deck = view.deck_left
        hidden = deck + view.opponent_hand
        self.p_get = min(cfg.pget_cap, cfg.pget_coef * deck / max(hidden, 1))
        turns_left = -(-deck // 2)
        self.hand_factor = max(cfg.hf_min, min(cfg.hf_max, cfg.hf_base + cfg.hf_slope * turns_left))


def color_value(ctx: _Ctx, color: str, expedition: tuple[Card, ...], hand: list[Card]) -> float:
    cfg = ctx.cfg
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
    pg = ctx.p_get
    for c in ctx.unseen[color]:
        if c.is_wager:
            if not has_number:
                mult += pg * cfg.unseen_wager
                count += pg * cfg.unseen_wager
        elif c.value > last:
            total += pg * cfg.unseen_num * c.value
            count += pg * cfg.unseen_num
    bonus = 20 * min(1.0, max(0.0, (count - cfg.bonus_lo) / cfg.bonus_span))
    raw = (total - 20) * mult + bonus
    return raw if started else max(0.0, raw)


def opponent_benefit(ctx: _Ctx, card: Card) -> float:
    cfg = ctx.cfg
    theirs = ctx.view.expeditions[ctx.view.opponent][card.color]
    if theirs:
        if not can_extend(theirs, card):
            return 0.0
        mult = 1.0 + cfg.opp_mult_k * sum(1 for c in theirs if c.is_wager)
        return mult * (cfg.opp_wager if card.is_wager else cfg.opp_num * card.value)
    return cfg.opp_unstarted * card.value


class VeteranBot(Bot):
    def __init__(self, seed: int | None = None, config: VeteranConfig | None = None) -> None:
        super().__init__(seed)
        self.config = config or VeteranConfig()

    def _gauss(self) -> float:
        r = self.rng.random
        return (r() + r() + r() - 1.5) * 1.6

    def act(self, view: View) -> Action:
        if view.phase == Phase.DRAW:
            return self._draw(view)
        return self._play(view)

    def _play(self, view: View) -> Action:
        cfg = self.config
        ctx = _Ctx(cfg, view)
        mine = view.expeditions[view.seat]
        best: Action | None = None
        best_score = -1e9
        for card in view.hand:
            same = [c for c in view.hand if c.color == card.color]
            rest = [c for c in same if c is not card]
            before = color_value(ctx, card.color, mine[card.color], same)
            if can_extend(mine[card.color], card):
                after = color_value(ctx, card.color, (*mine[card.color], card), rest)
                s = after - before + cfg.play_bonus + self._gauss() * cfg.noise
                if not mine[card.color]:
                    s += cfg.start_bonus
                if s > best_score:
                    best_score, best = s, Play(card.id)
            keep_loss = max(0.0, before - color_value(ctx, card.color, mine[card.color], rest))
            s = -(keep_loss + opponent_benefit(ctx, card)) + self._gauss() * cfg.noise
            if s > best_score:
                best_score, best = s, Discard(card.id)
        assert best is not None
        return best

    def _draw(self, view: View) -> Action:
        cfg = self.config
        ctx = _Ctx(cfg, view)
        mine = view.expeditions[view.seat]
        deck_value = cfg.deck_value
        if view.deck_left < cfg.tempo_deck:
            lead = self._lead(view)
            deck_value += max(-cfg.tempo_cap, min(cfg.tempo_cap, lead / cfg.tempo_div))
        best_value = deck_value + self._gauss() * cfg.draw_noise
        best: Action = Draw(DECK_SOURCE)
        for color in COLORS:
            pile = view.discards[color]
            if not pile or color == view.last_discard:
                continue
            top = pile[-1]
            same = [c for c in view.hand if c.color == color]
            gain = color_value(ctx, color, mine[color], [*same, top]) - color_value(ctx, color, mine[color], same)
            value = (
                gain
                + cfg.draw_opp_w * opponent_benefit(ctx, top)
                + cfg.draw_pile_bonus
                + self._gauss() * cfg.draw_noise
            )
            if value > best_value:
                best_value, best = value, Draw(color)
        return best

    @staticmethod
    def _lead(view: View) -> float:
        def table(seat: int) -> int:
            return sum(score_expedition(c, view.expeditions[seat][c]).score for c in COLORS)

        return table(view.seat) - table(view.opponent)
