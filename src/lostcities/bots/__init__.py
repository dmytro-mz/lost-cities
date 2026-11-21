"""Bot registry. Every entry shows up in the web lobby and in `lostcities eval`."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from lostcities.bots.base import Bot
from lostcities.bots.heuristic import HeuristicBot, HeuristicConfig
from lostcities.bots.veteran import VeteranBot


@dataclass(frozen=True)
class BotType:
    key: str
    label: str
    stars: int
    description: str
    make: Callable[[int | None], Bot]


REGISTRY: dict[str, BotType] = {
    b.key: b
    for b in (
        BotType(
            "novice",
            "Novice",
            1,
            "Starts expeditions on a whim and often discards the wrong card.",
            lambda seed: HeuristicBot(seed, HeuristicConfig(noise=6.0, blunder=0.3, draw_noise=3.0, tempo=False)),
        ),
        BotType(
            "scout",
            "Scout",
            3,
            "Plans its routes sensibly, but sometimes gambles and doesn't watch the clock.",
            lambda seed: HeuristicBot(seed, HeuristicConfig(noise=2.0, blunder=0.05, draw_noise=1.5, tempo=False)),
        ),
        BotType(
            "pathfinder",
            "Pathfinder",
            4,
            "Counts cards, denies you useful discards and speeds up or stalls the round depending on the score.",
            lambda seed: HeuristicBot(seed, HeuristicConfig()),
        ),
        BotType(
            "veteran",
            "Veteran",
            5,
            "Plays with no slips: commits to a few routes, guards the cards you need and times the end of the round.",
            lambda seed: VeteranBot(seed),
        ),
    )
}


def make_bot(key: str, seed: int | None = None) -> Bot:
    return REGISTRY[key].make(seed)


__all__ = ["REGISTRY", "Bot", "BotType", "HeuristicBot", "HeuristicConfig", "make_bot"]
