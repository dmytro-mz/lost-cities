from __future__ import annotations

from dataclasses import asdict, dataclass

from lostcities.game.cards import BONUS_CARDS, BONUS_POINTS, COLORS, EXPEDITION_COST, Card


@dataclass(frozen=True, slots=True)
class ExpeditionScore:
    color: str
    cards: int
    wagers: int
    sum: int
    cost: int  # 0 if the expedition was never started
    multiplier: int
    bonus: int
    score: int

    def to_json(self) -> dict[str, int | str]:
        return asdict(self)


def score_expedition(color: str, cards: list[Card] | tuple[Card, ...]) -> ExpeditionScore:
    """(sum − 20) × (1 + wagers), plus 20 for eight or more cards. An unstarted expedition scores 0."""
    if not cards:
        return ExpeditionScore(color, 0, 0, 0, 0, 1, 0, 0)
    wagers = sum(1 for c in cards if c.is_wager)
    total = sum(c.value for c in cards)
    bonus = BONUS_POINTS if len(cards) >= BONUS_CARDS else 0
    score = (total - EXPEDITION_COST) * (1 + wagers) + bonus
    return ExpeditionScore(color, len(cards), wagers, total, EXPEDITION_COST, 1 + wagers, bonus, score)


def score_player(expeditions: dict[str, list[Card]]) -> list[ExpeditionScore]:
    return [score_expedition(color, expeditions[color]) for color in COLORS]
