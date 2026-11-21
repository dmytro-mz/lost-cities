"""The 60-card deck: five expeditions, each with three wager cards and the numbers 2–10."""

from __future__ import annotations

from dataclasses import dataclass

COLORS: tuple[str, ...] = ("yellow", "blue", "white", "green", "red")
SITES: dict[str, str] = {
    "yellow": "Sun Canyon",
    "blue": "Sunken Reef",
    "white": "Glacier Pass",
    "green": "Emerald Falls",
    "red": "Ember Caldera",
}
WAGERS_PER_COLOR = 3
VALUES: tuple[int, ...] = tuple(range(2, 11))
HAND_SIZE = 8
EXPEDITION_COST = 20
BONUS_CARDS = 8
BONUS_POINTS = 20


@dataclass(frozen=True, slots=True)
class Card:
    color: str
    value: int  # 0 = wager card
    copy: int = 0  # tells the three wagers of a colour apart

    @property
    def id(self) -> str:
        return f"{self.color}-w{self.copy}" if self.value == 0 else f"{self.color}-{self.value}"

    @property
    def is_wager(self) -> bool:
        return self.value == 0

    def __str__(self) -> str:
        return f"{SITES[self.color]} {'wager' if self.is_wager else self.value}"


DECK: tuple[Card, ...] = tuple(
    card
    for color in COLORS
    for card in (
        *(Card(color, 0, i) for i in range(WAGERS_PER_COLOR)),
        *(Card(color, v) for v in VALUES),
    )
)
CARDS: dict[str, Card] = {c.id: c for c in DECK}


def can_extend(expedition: list[Card] | tuple[Card, ...], card: Card) -> bool:
    """Wagers only before any number; numbers strictly ascending."""
    if card.is_wager:
        return all(c.is_wager for c in expedition)
    return not expedition or card.value > expedition[-1].value


def sort_key(card: Card) -> tuple[int, int, int]:
    return COLORS.index(card.color), card.value, card.copy
