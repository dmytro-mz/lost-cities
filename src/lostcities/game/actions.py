"""Actions and their JSON form: {"type": "play" | "discard", "card": id} or {"type": "draw", "source": ...}."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from lostcities.game.cards import CARDS, COLORS

DECK_SOURCE = "deck"


class BadAction(ValueError):
    """Malformed action JSON."""


@dataclass(frozen=True, slots=True)
class Play:
    """Lay a card from your hand on your own expedition of its colour."""

    card: str


@dataclass(frozen=True, slots=True)
class Discard:
    """Put a card from your hand on the discard pile of its colour."""

    card: str


@dataclass(frozen=True, slots=True)
class Draw:
    """Take the top card of the deck (`source="deck"`) or of a colour's discard pile."""

    source: str


Action = Play | Discard | Draw


def to_json(action: Action) -> dict[str, Any]:
    match action:
        case Play(card):
            return {"type": "play", "card": card}
        case Discard(card):
            return {"type": "discard", "card": card}
        case Draw(source):
            return {"type": "draw", "source": source}
    raise BadAction(f"unknown action {action!r}")


def from_json(data: object) -> Action:
    if not isinstance(data, dict):
        raise BadAction("action must be an object")
    kind = data.get("type")
    if kind in ("play", "discard"):
        card = data.get("card")
        if not isinstance(card, str) or card not in CARDS:
            raise BadAction("unknown card")
        return Play(card) if kind == "play" else Discard(card)
    if kind == "draw":
        source = data.get("source")
        if source != DECK_SOURCE and source not in COLORS:
            raise BadAction("unknown draw source")
        return Draw(str(source))
    raise BadAction(f"unknown action type {kind!r}")
