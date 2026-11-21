from __future__ import annotations

from lostcities.bots import Bot
from lostcities.game.engine import Game, Phase


def play_game(bots: list[Bot], rounds: int = 3, seed: int | None = None, starter: int = 0) -> Game:
    """A bot-only match, start to finish."""
    game = Game(rounds=rounds, seed=seed, starter=starter)
    while game.phase != Phase.GAME_OVER:
        if game.phase == Phase.ROUND_OVER:
            game.next_round()
            continue
        seat = game.current
        game.step(seat, bots[seat].act(game.view(seat)))
    return game
