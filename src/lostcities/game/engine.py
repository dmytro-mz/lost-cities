"""The game state machine: a match of one or more rounds between two players.

A turn is two steps: PLAY (lay a card on your expedition or discard it) then DRAW (from the deck or the top of a
discard pile, but not the card you just discarded). Until the draw, the first step can be taken back (`undo`).
A round ends the moment the last deck card is drawn; then
ROUND_OVER until `next_round()`, or GAME_OVER after the last round.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from lostcities.game.actions import DECK_SOURCE, Action, Discard, Draw, Play
from lostcities.game.cards import CARDS, COLORS, DECK, HAND_SIZE, Card, can_extend, sort_key
from lostcities.game.scoring import ExpeditionScore, score_player

PLAYERS = 2
Event = dict[str, Any]


class Phase(StrEnum):
    PLAY = "play"
    DRAW = "draw"
    ROUND_OVER = "round_over"
    GAME_OVER = "game_over"


class IllegalMove(Exception):
    """The action is not in `legal_actions`; the game state is unchanged."""


@dataclass
class RoundResult:
    scores: list[int]
    breakdown: list[list[ExpeditionScore]]
    starter: int
    turns: int

    def to_json(self) -> dict[str, Any]:
        return {
            "scores": self.scores,
            "breakdown": [[e.to_json() for e in player] for player in self.breakdown],
            "starter": self.starter,
            "turns": self.turns,
        }


@dataclass
class Result:
    totals: list[int]
    winners: list[int]


@dataclass(frozen=True)
class View:
    """Everything one player may know. Discard piles are public (anyone could remember them)."""

    seat: int
    phase: Phase
    current: int
    hand: tuple[Card, ...]
    expeditions: tuple[dict[str, tuple[Card, ...]], ...]  # [seat][color], in play order
    discards: dict[str, tuple[Card, ...]]  # bottom first, top last
    deck_left: int
    opponent_hand: int
    last_discard: str | None  # colour you may not draw from this turn
    round_no: int
    rounds: int
    totals: tuple[int, ...]  # finished rounds only

    @property
    def opponent(self) -> int:
        return 1 - self.seat


@dataclass
class Game:
    rounds: int = 3
    seed: int | None = None
    starter: int = 0
    rng: random.Random = field(init=False)
    deck: list[Card] = field(init=False, default_factory=list)  # top = last
    hands: list[list[Card]] = field(init=False, default_factory=list)
    expeditions: list[dict[str, list[Card]]] = field(init=False, default_factory=list)
    discards: dict[str, list[Card]] = field(init=False, default_factory=dict)
    current: int = field(init=False, default=0)
    phase: Phase = field(init=False, default=Phase.PLAY)
    last_discard: str | None = field(init=False, default=None)
    turn: int = field(init=False, default=0)  # completed turns this round
    history: list[RoundResult] = field(init=False, default_factory=list)
    result: Result | None = field(init=False, default=None)
    round_starter: int = field(init=False, default=0)
    pending: tuple[str, Card] | None = field(init=False, default=None)  # this turn's play/discard, until the draw

    def __post_init__(self) -> None:
        if self.rounds < 1:
            raise ValueError("a match has at least one round")
        self.rng = random.Random(self.seed)
        self._deal(self.starter)

    # ------------------------------------------------------------------ setup
    def _deal(self, starter: int) -> None:
        deck = list(DECK)
        self.rng.shuffle(deck)
        self.deck = deck
        self.hands = [[], []]
        for _ in range(HAND_SIZE):
            for seat in range(PLAYERS):
                self.hands[seat].append(self.deck.pop())
        self.expeditions = [{c: [] for c in COLORS} for _ in range(PLAYERS)]
        self.discards = {c: [] for c in COLORS}
        self.current = starter
        self.round_starter = starter
        self.phase = Phase.PLAY
        self.last_discard = None
        self.turn = 0
        self.pending = None

    @property
    def round_no(self) -> int:
        """1-based number of the round being played (or just finished)."""
        return len(self.history) + (0 if self.phase in (Phase.ROUND_OVER, Phase.GAME_OVER) else 1)

    @property
    def totals(self) -> list[int]:
        return [sum(r.scores[seat] for r in self.history) for seat in range(PLAYERS)]

    def live_scores(self, seat: int) -> list[ExpeditionScore]:
        return score_player(self.expeditions[seat])

    # ------------------------------------------------------------------ rules
    def legal_actions(self, seat: int | None) -> list[Action]:
        if seat != self.current:
            return []
        if self.phase == Phase.PLAY:
            out: list[Action] = []
            for card in sorted(self.hands[seat], key=sort_key):
                if can_extend(self.expeditions[seat][card.color], card):
                    out.append(Play(card.id))
                out.append(Discard(card.id))
            return out
        if self.phase == Phase.DRAW:
            draws: list[Action] = [Draw(DECK_SOURCE)]
            draws += [Draw(c) for c in COLORS if self.discards[c] and c != self.last_discard]
            return draws
        return []

    def _card_in_hand(self, seat: int, card_id: str) -> Card:
        card = CARDS.get(card_id)
        if card is None or card not in self.hands[seat]:
            raise IllegalMove("That card is not in your hand")
        return card

    def step(self, seat: int, action: Action) -> list[Event]:
        if self.phase in (Phase.ROUND_OVER, Phase.GAME_OVER):
            raise IllegalMove("The round is over")
        if seat != self.current:
            raise IllegalMove("It's not your turn")
        match action:
            case Play(card_id) if self.phase == Phase.PLAY:
                card = self._card_in_hand(seat, card_id)
                expedition = self.expeditions[seat][card.color]
                if not can_extend(expedition, card):
                    if card.is_wager:
                        raise IllegalMove("Wagers can only start an expedition, before any number card")
                    raise IllegalMove(f"Your expedition needs a card higher than {expedition[-1].value}")
                self.hands[seat].remove(card)
                expedition.append(card)
                self.last_discard = None
                self.phase = Phase.DRAW
                self.pending = ("play", card)
                return [{"kind": "play", "seat": seat, "card": card.id, "color": card.color}]
            case Discard(card_id) if self.phase == Phase.PLAY:
                card = self._card_in_hand(seat, card_id)
                self.hands[seat].remove(card)
                self.discards[card.color].append(card)
                self.last_discard = card.color
                self.phase = Phase.DRAW
                self.pending = ("discard", card)
                return [{"kind": "discard", "seat": seat, "card": card.id, "color": card.color}]
            case Draw(source) if self.phase == Phase.DRAW:
                return self._draw(seat, source)
        raise IllegalMove("First play or discard a card, then draw one" if self.phase == Phase.PLAY else "Draw a card")

    def can_undo(self, seat: int | None) -> bool:
        return seat == self.current and self.phase == Phase.DRAW and self.pending is not None

    def undo(self, seat: int) -> list[Event]:
        """Take back this turn's play or discard (only before drawing): the card returns to the hand."""
        if not self.can_undo(seat):
            raise IllegalMove("There is nothing to take back")
        assert self.pending is not None
        kind, card = self.pending
        pile = self.expeditions[seat][card.color] if kind == "play" else self.discards[card.color]
        assert pile and pile[-1] == card
        pile.pop()
        self.hands[seat].append(card)
        self.last_discard = None
        self.pending = None
        self.phase = Phase.PLAY
        return [{"kind": "undo", "seat": seat, "card": card.id, "color": card.color, "from": kind}]

    def _draw(self, seat: int, source: str) -> list[Event]:
        if source == DECK_SOURCE:
            card = self.deck.pop()
        else:
            pile = self.discards.get(source)
            if pile is None:
                raise IllegalMove("No such pile")
            if not pile:
                raise IllegalMove("That discard pile is empty")
            if source == self.last_discard:
                raise IllegalMove("You can't take back the card you just discarded")
            card = pile.pop()
        self.hands[seat].append(card)
        self.last_discard = None
        self.pending = None
        self.turn += 1
        events: list[Event] = [
            {"kind": "draw", "seat": seat, "source": source, "card": card.id, "deck_left": len(self.deck)}
        ]
        if not self.deck:
            events += self._end_round()
        else:
            self.current = 1 - seat
            self.phase = Phase.PLAY
        return events

    def _end_round(self) -> list[Event]:
        breakdown = [self.live_scores(seat) for seat in range(PLAYERS)]
        scores = [sum(e.score for e in b) for b in breakdown]
        self.history.append(RoundResult(scores, breakdown, self.round_starter, self.turn))
        events: list[Event] = [
            {"kind": "round_over", "round": len(self.history), "scores": scores, "totals": self.totals}
        ]
        if len(self.history) >= self.rounds:
            totals = self.totals
            best = max(totals)
            self.result = Result(totals, [i for i, t in enumerate(totals) if t == best])
            self.phase = Phase.GAME_OVER
            events.append({"kind": "game_over", "totals": totals, "winners": self.result.winners})
        else:
            self.phase = Phase.ROUND_OVER
        return events

    def next_starter(self) -> int:
        """The player with more points in the round just played begins; on a tie, the other player."""
        last = self.history[-1]
        a, b = last.scores
        if a == b:
            return 1 - last.starter
        return 0 if a > b else 1

    def next_round(self) -> list[Event]:
        if self.phase != Phase.ROUND_OVER:
            raise IllegalMove("The round is not over")
        starter = self.next_starter()
        self._deal(starter)
        return [{"kind": "round_start", "round": self.round_no, "starter": starter}]

    # ------------------------------------------------------------------ views
    def view(self, seat: int) -> View:
        return View(
            seat=seat,
            phase=self.phase,
            current=self.current,
            hand=tuple(sorted(self.hands[seat], key=sort_key)),
            expeditions=tuple({c: tuple(e[c]) for c in COLORS} for e in self.expeditions),
            discards={c: tuple(p) for c, p in self.discards.items()},
            deck_left=len(self.deck),
            opponent_hand=len(self.hands[1 - seat]),
            last_discard=self.last_discard,
            round_no=self.round_no,
            rounds=self.rounds,
            totals=tuple(self.totals),
        )

    def check(self) -> None:
        """Invariants (tests call this after every step)."""
        cards = list(self.deck) + [c for h in self.hands for c in h]
        cards += [c for e in self.expeditions for pile in e.values() for c in pile]
        cards += [c for pile in self.discards.values() for c in pile]
        assert sorted(c.id for c in cards) == sorted(CARDS), "cards lost or duplicated"
        for e in self.expeditions:
            for color, pile in e.items():
                assert all(c.color == color for c in pile)
                numbers = [c.value for c in pile if not c.is_wager]
                assert numbers == sorted(set(numbers)), "expedition must ascend"
                assert all(c.is_wager for c in pile[: len(pile) - len(numbers)]), "wagers come first"
        if self.phase in (Phase.PLAY, Phase.DRAW):
            expected = HAND_SIZE - (1 if self.phase == Phase.DRAW else 0)
            assert len(self.hands[self.current]) == expected
            assert len(self.hands[1 - self.current]) == HAND_SIZE
