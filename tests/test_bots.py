from __future__ import annotations

import pytest

from lostcities.bots import REGISTRY, Bot, make_bot
from lostcities.game.actions import to_json
from lostcities.game.engine import Game, Phase
from lostcities.runner import play_game

KEYS = sorted(REGISTRY)


def play_checked(bots: list[Bot], seed: int, starter: int = 0, rounds: int = 3) -> tuple[Game, list]:
    """Full match where every bot action is asserted to be legal; returns the game and the action log."""
    game = Game(rounds=rounds, seed=seed, starter=starter)
    log = []
    while game.phase != Phase.GAME_OVER:
        if game.phase == Phase.ROUND_OVER:
            game.next_round()
            continue
        seat = game.current
        action = bots[seat].act(game.view(seat))
        assert action in game.legal_actions(seat), f"{bots[seat]!r} played illegal {action}"
        game.step(seat, action)
        game.check()
        log.append((seat, to_json(action)))
    return game, log


def test_registry_has_bots():
    assert {"novice", "scout", "pathfinder"} <= set(REGISTRY)
    for key, bot_type in REGISTRY.items():
        assert bot_type.key == key
        assert isinstance(make_bot(key, 0), Bot)


@pytest.mark.parametrize("key", KEYS)
def test_bot_only_plays_legal_actions(key):
    for seed in range(4):
        game, _ = play_checked([make_bot(key, seed), make_bot(key, seed + 100)], seed=seed, starter=seed % 2)
        assert game.result is not None and len(game.history) == 3


@pytest.mark.parametrize("key", KEYS)
@pytest.mark.parametrize("other", KEYS)
def test_bot_legal_against_every_other_bot(key, other):
    game, _ = play_checked([make_bot(key, 1), make_bot(other, 2)], seed=11, rounds=2)
    assert game.phase == Phase.GAME_OVER


@pytest.mark.parametrize("key", KEYS)
def test_bot_deterministic_for_fixed_seed(key):
    runs = [play_checked([make_bot(key, 5), make_bot(key, 6)], seed=42)[1] for _ in range(2)]
    assert runs[0] == runs[1]
    assert len(runs[0]) > 0


@pytest.mark.parametrize("key", KEYS)
def test_bot_act_does_not_mutate_game(key):
    game = Game(seed=3)
    bot = make_bot(key, 3)
    view = game.view(0)
    before = (list(game.hands[0]), list(game.deck), {c: list(p) for c, p in game.discards.items()})
    bot.act(view)
    assert before == (game.hands[0], game.deck, {c: list(p) for c, p in game.discards.items()})


def test_pathfinder_beats_novice():
    wins = 0
    matches = 60
    for i in range(matches):
        # alternate which seat the pathfinder takes (and hence who starts)
        pf_seat = i % 2
        bots = [make_bot("novice", 1000 + i), make_bot("novice", 2000 + i)]
        bots[pf_seat] = make_bot("pathfinder", i)
        game = play_game(bots, rounds=3, seed=i, starter=i % 2)
        assert game.result is not None
        if game.result.winners == [pf_seat]:
            wins += 1
    assert wins >= 0.8 * matches, f"pathfinder won only {wins}/{matches}"
