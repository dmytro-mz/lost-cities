from __future__ import annotations

import copy
import random

import pytest

from lostcities.game.actions import (
    BadAction,
    Discard,
    Draw,
    Play,
    from_json,
    to_json,
)
from lostcities.game.cards import CARDS, COLORS, DECK, HAND_SIZE, Card, can_extend
from lostcities.game.engine import Game, IllegalMove, Phase, RoundResult
from lostcities.game.scoring import score_expedition


def W(color: str, i: int = 0) -> Card:
    return Card(color, 0, i)


def N(color: str, v: int) -> Card:
    return Card(color, v)


def snapshot(game: Game) -> dict:
    state = {k: copy.deepcopy(v) for k, v in vars(game).items() if k != "rng"}
    state["rng"] = game.rng.getstate()
    return state


def random_actions_until(game: Game, rng: random.Random, check: bool = True) -> None:
    while game.phase != Phase.GAME_OVER:
        if game.phase == Phase.ROUND_OVER:
            game.next_round()
        else:
            seat = game.current
            game.step(seat, rng.choice(game.legal_actions(seat)))
        if check:
            game.check()


# ---------------------------------------------------------------- deck / deal
def test_deck_composition():
    assert len(DECK) == 60
    assert len({c.id for c in DECK}) == 60
    assert set(CARDS) == {c.id for c in DECK}
    for color in COLORS:
        cards = [c for c in DECK if c.color == color]
        assert len(cards) == 12
        assert sum(c.is_wager for c in cards) == 3
        assert sorted(c.value for c in cards if not c.is_wager) == list(range(2, 11))


@pytest.mark.parametrize("seed", range(5))
def test_deal(seed):
    game = Game(seed=seed)
    assert [len(h) for h in game.hands] == [HAND_SIZE, HAND_SIZE]
    assert len(game.deck) == 44
    assert game.phase == Phase.PLAY
    assert game.current == 0
    game.check()


def test_deal_is_seeded():
    a, b, c = Game(seed=1), Game(seed=1), Game(seed=2)
    assert a.hands == b.hands and a.deck == b.deck
    assert a.deck != c.deck


def test_starter_param():
    game = Game(seed=3, starter=1)
    assert game.current == 1 and game.round_starter == 1


def test_zero_rounds_rejected():
    with pytest.raises(ValueError):
        Game(rounds=0)


# ---------------------------------------------------------------- scoring
def test_score_rulebook_example():
    s = score_expedition("yellow", [N("yellow", 5), N("yellow", 8), N("yellow", 10)])
    assert s.score == 3 and s.sum == 23 and s.multiplier == 1 and s.bonus == 0


def test_score_empty_is_zero():
    s = score_expedition("red", [])
    assert s.score == 0 and s.cost == 0 and s.cards == 0


def test_score_wager_alone():
    assert score_expedition("white", [W("white")]).score == -40


def test_score_wager_and_numbers():
    # sum 15 -> (15 - 20) * 2 = -10
    assert score_expedition("green", [W("green"), N("green", 6), N("green", 9)]).score == -10


def test_score_two_wagers_with_bonus():
    cards = [W("red", 0), W("red", 1), *(N("red", v) for v in (2, 3, 4, 5, 6, 7))]
    # 8 cards, sum 27 -> (27 - 20) * 3 + 20 = 41
    s = score_expedition("red", cards)
    assert (s.cards, s.wagers, s.sum, s.multiplier, s.bonus, s.score) == (8, 2, 27, 3, 20, 41)


def test_score_three_wagers_bonus_formula():
    cards = [W("red", 0), W("red", 1), W("red", 2), *(N("red", v) for v in (5, 6, 7, 8, 9))]
    # 8 cards, sum 35 -> 15 * 4 + 20 = 80
    assert score_expedition("red", cards).score == 80


def test_score_bonus_needs_eight_cards():
    seven = [N("blue", v) for v in (2, 3, 4, 5, 6, 7, 8)]
    assert score_expedition("blue", seven).bonus == 0
    assert score_expedition("blue", seven).score == 35 - 20
    eight = [*seven, N("blue", 9)]
    assert score_expedition("blue", eight).bonus == 20
    assert score_expedition("blue", eight).score == 44 - 20 + 20


def test_score_full_expedition_max():
    cards = [W("blue", 0), W("blue", 1), W("blue", 2), *(N("blue", v) for v in range(2, 11))]
    assert score_expedition("blue", cards).score == (54 - 20) * 4 + 20


def test_live_scores_match_round_result():
    game = Game(seed=0)
    random_actions_until(game, random.Random(0))
    for rr in game.history:
        assert rr.scores == [sum(e.score for e in b) for b in rr.breakdown]


# ---------------------------------------------------------------- can_extend
def test_can_extend():
    assert can_extend([], W("red"))
    assert can_extend([], N("red", 2))
    assert can_extend([W("red")], W("red", 1))
    assert can_extend([W("red")], N("red", 2))
    assert not can_extend([N("red", 2)], W("red"))  # wager after number
    assert not can_extend([W("red"), N("red", 4)], W("red", 1))
    assert can_extend([N("red", 4)], N("red", 5))
    assert not can_extend([N("red", 4)], N("red", 4))  # strictly ascending
    assert not can_extend([N("red", 4)], N("red", 3))  # descending


# ---------------------------------------------------------------- legal actions
def test_legal_actions_play_phase():
    game = Game(seed=0)
    game.hands[0] = [
        W("red"),
        N("red", 5),
        N("blue", 3),
        N("blue", 2),
        W("green"),
        N("white", 4),
        N("white", 9),
        N("yellow", 7),
    ]
    game.expeditions[0]["red"] = [N("red", 7)]
    game.expeditions[0]["blue"] = [N("blue", 3)]
    actions = set(game.legal_actions(0))
    # every card can be discarded
    assert {Discard(c.id) for c in game.hands[0]} <= actions
    assert Play("red-w0") not in actions  # wager after a number
    assert Play("red-5") not in actions  # descending
    assert Play("blue-3") not in actions  # equal
    assert Play("blue-2") not in actions
    assert Play("green-w0") in actions
    assert Play("white-4") in actions and Play("white-9") in actions
    assert Play("yellow-7") in actions
    assert game.legal_actions(1) == []
    assert game.legal_actions(None) == []
    assert not any(isinstance(a, Draw) for a in actions)


def test_wager_legal_before_numbers_only():
    game = Game(seed=0)
    game.hands[0][0] = W("red", 1)
    game.expeditions[0]["red"] = [W("red", 0)]
    assert Play("red-w1") in game.legal_actions(0)
    game.expeditions[0]["red"] = [W("red", 0), N("red", 4)]
    assert Play("red-w1") not in game.legal_actions(0)


def test_legal_actions_draw_phase():
    game = Game(seed=0)
    game.step(0, Discard(game.hands[0][0].id))
    color = game.last_discard
    assert color is not None
    # only the just-discarded pile is non-empty -> deck only
    assert game.legal_actions(0) == [Draw("deck")]
    assert game.legal_actions(1) == []
    game.discards["blue"] = [N("blue", 2)] if color != "blue" else game.discards["blue"]
    acts = game.legal_actions(0)
    assert Draw(color) not in acts
    assert Draw("deck") in acts
    if color != "blue":
        assert Draw("blue") in acts
    # empty piles are not offered
    for c in COLORS:
        if not game.discards[c]:
            assert Draw(c) not in acts


def test_cannot_draw_from_pile_just_discarded_to():
    game = Game(seed=0)
    card = game.hands[0][0]
    other = next(c for c in COLORS if c != card.color)
    game.discards[other].append(N(other, 2))
    game.discards[card.color].append(N(card.color, 2) if card.id != f"{card.color}-2" else N(card.color, 3))
    game.step(0, Discard(card.id))
    before = snapshot(game)
    with pytest.raises(IllegalMove):
        game.step(0, Draw(card.color))
    assert snapshot(game) == before
    game.step(0, Draw(other))
    assert game.phase == Phase.PLAY and game.current == 1


def test_play_does_not_restrict_draws():
    game = Game(seed=0)
    game.discards["red"].append(N("red", 2))
    game.hands[0][0] = W("red")
    game.step(0, Play("red-w0"))
    assert game.last_discard is None
    assert Draw("red") in game.legal_actions(0)


def test_discard_pile_is_stack():
    game = Game(seed=0)
    game.discards["red"] = [N("red", 2), N("red", 9)]
    other = next(c for c in game.hands[0] if c.color != "red")
    game.step(0, Discard(other.id))
    game.step(0, Draw("red"))
    assert N("red", 9) in game.hands[0]
    assert game.discards["red"] == [N("red", 2)]


# ---------------------------------------------------------------- illegal moves
def _bad_moves(game: Game) -> list[tuple[int, object]]:
    seat = game.current
    other = 1 - seat
    foreign = next(c for c in DECK if c not in game.hands[seat])
    moves: list = [
        (other, Draw("deck")),
        (other, Discard(game.hands[other][0].id)),
        (other, Play(game.hands[other][0].id)),
        (seat, Play(foreign.id)),
        (seat, Discard(foreign.id)),
        (seat, Draw("deck")),  # wrong phase
        (seat, Draw("red")),
    ]
    return moves


def test_illegal_moves_leave_state_unchanged_play_phase():
    game = Game(seed=4)
    before = snapshot(game)
    for seat, action in _bad_moves(game):
        with pytest.raises(IllegalMove):
            game.step(seat, action)  # type: ignore[arg-type]
        assert snapshot(game) == before


def test_illegal_moves_leave_state_unchanged_draw_phase():
    game = Game(seed=4)
    game.hands[0][0] = N("red", 6)
    game.hands[0][1] = N("red", 4)
    game.step(0, Play("red-6"))
    before = snapshot(game)
    for action in (
        Play("red-4"),
        Discard("red-4"),
        Draw("red"),  # empty pile
        Draw("nonsense"),
    ):
        with pytest.raises(IllegalMove):
            game.step(0, action)
        assert snapshot(game) == before
    with pytest.raises(IllegalMove):
        game.step(1, Draw("deck"))
    assert snapshot(game) == before


def test_descending_play_rejected_and_unchanged():
    game = Game(seed=4)
    game.hands[0][0] = N("red", 3)
    game.expeditions[0]["red"] = [N("red", 7)]
    before = snapshot(game)
    with pytest.raises(IllegalMove):
        game.step(0, Play("red-3"))
    assert snapshot(game) == before


def test_wager_after_number_rejected_and_unchanged():
    game = Game(seed=4)
    game.hands[0][0] = W("red")
    game.expeditions[0]["red"] = [N("red", 7)]
    before = snapshot(game)
    with pytest.raises(IllegalMove):
        game.step(0, Play("red-w0"))
    assert snapshot(game) == before


def test_draw_from_just_discarded_pile_rejected():
    game = Game(seed=4)
    game.discards["red"] = [N("red", 2)]
    game.hands[0][0] = N("red", 9)
    game.step(0, Discard("red-9"))
    with pytest.raises(IllegalMove):
        game.step(0, Draw("red"))


def test_step_in_round_over_rejected():
    game = Game(seed=0, rounds=2)
    game.deck = game.deck[:1]
    game.step(0, Discard(game.hands[0][0].id))
    game.step(0, Draw("deck"))
    assert game.phase == Phase.ROUND_OVER
    assert game.legal_actions(0) == [] and game.legal_actions(1) == []
    before = snapshot(game)
    with pytest.raises(IllegalMove):
        game.step(0, Draw("deck"))
    with pytest.raises(IllegalMove):
        game.step(1, Discard(game.hands[1][0].id))
    assert snapshot(game) == before


def test_next_round_only_when_round_over():
    game = Game(seed=0)
    with pytest.raises(IllegalMove):
        game.next_round()


# ---------------------------------------------------------------- round / match flow
def _finish_round_quickly(game: Game) -> None:
    """Leave one deck card then take it with whoever is on turn (discarding)."""
    game.deck = game.deck[:1]
    seat = game.current
    game.step(seat, Discard(game.hands[seat][0].id))
    game.step(seat, Draw("deck"))


def test_round_ends_when_deck_empties():
    game = Game(seed=1, rounds=3)
    rng = random.Random(1)
    while len(game.deck) > 1:
        game.step(game.current, rng.choice(game.legal_actions(game.current)))
        game.check()
    assert game.phase in (Phase.PLAY, Phase.DRAW)
    # the round ends exactly when the last deck card is drawn
    while game.phase != Phase.ROUND_OVER:
        seat = game.current
        if game.phase == Phase.PLAY:
            game.step(seat, game.legal_actions(seat)[0])
        else:
            assert game.deck
            game.step(seat, Draw("deck"))
    assert game.deck == []
    assert len(game.history) == 1
    assert game.round_no == 1
    assert game.history[0].starter == 0
    assert game.totals == game.history[0].scores


def test_round_not_ended_while_deck_has_cards():
    game = Game(seed=1)
    game.deck = game.deck[:2]
    game.step(0, Discard(game.hands[0][0].id))
    game.step(0, Draw("deck"))
    assert game.phase == Phase.PLAY and game.current == 1 and len(game.deck) == 1


def test_draw_from_discard_does_not_end_round():
    game = Game(seed=1)
    game.deck = game.deck[:1]
    game.discards["red"] = [N("red", 2)]
    card = next(c for c in game.hands[0] if c.color != "red")
    game.step(0, Discard(card.id))
    game.step(0, Draw("red"))
    assert game.phase == Phase.PLAY and len(game.deck) == 1


@pytest.mark.parametrize("starter", [0, 1])
def test_next_starter_higher_scorer_starts(starter):
    game = Game(seed=2, rounds=3, starter=starter)
    game.expeditions[1]["red"] = [N("red", 9)]  # -11 for seat 1, seat 0 scores 0
    _finish_round_quickly(game)
    assert game.history[0].scores == [0, -11]
    assert game.next_starter() == 0
    game.next_round()
    assert game.current == 0 and game.round_starter == 0
    assert game.phase == Phase.PLAY and len(game.deck) == 44
    assert game.round_no == 2
    game.check()


def test_next_starter_when_seat1_scores_more():
    game = Game(seed=2, rounds=3, starter=0)
    game.expeditions[0]["red"] = [N("red", 2)]  # -18
    game.expeditions[1]["blue"] = [N("blue", 9), N("blue", 10)]  # -1
    _finish_round_quickly(game)
    assert game.history[0].scores == [-18, -1]
    game.next_round()
    assert game.current == 1


@pytest.mark.parametrize("starter", [0, 1])
def test_next_starter_on_tie_is_the_one_who_did_not_start(starter):
    game = Game(seed=2, rounds=3, starter=starter)
    _finish_round_quickly(game)
    assert game.history[0].scores == [0, 0]
    game.next_round()
    assert game.current == 1 - starter
    assert game.round_starter == 1 - starter
    # tie again -> flips back
    _finish_round_quickly(game)
    assert game.history[1].scores == [0, 0]
    game.next_round()
    assert game.current == starter


def test_game_over_result_and_winner():
    game = Game(seed=5, rounds=1)
    game.expeditions[0]["red"] = [N("red", 10)]  # -10
    game.expeditions[1]["red"] = [N("red", 5), N("red", 6), N("red", 7), N("red", 8)]  # 26 -> +6
    _finish_round_quickly(game)
    assert game.phase == Phase.GAME_OVER
    assert game.result is not None
    assert game.result.totals == [-10, 6]
    assert game.result.winners == [1]
    assert game.legal_actions(game.current) == []
    with pytest.raises(IllegalMove):
        game.next_round()
    assert game.round_no == 1


def test_game_over_tie_has_two_winners():
    game = Game(seed=5, rounds=1)
    _finish_round_quickly(game)
    assert game.phase == Phase.GAME_OVER
    assert game.result is not None
    assert game.result.totals == [0, 0]
    assert game.result.winners == [0, 1]


def test_match_totals_accumulate_over_rounds():
    game = Game(seed=6, rounds=2)
    game.expeditions[0]["red"] = [N("red", 10)]
    _finish_round_quickly(game)
    assert game.phase == Phase.ROUND_OVER
    game.next_round()
    game.expeditions[1]["green"] = [N("green", 4)]
    _finish_round_quickly(game)
    assert game.phase == Phase.GAME_OVER
    assert game.result is not None
    assert game.result.totals == [-10, -16]
    assert game.result.winners == [0]
    assert game.totals == [-10, -16]


def test_events():
    game = Game(seed=7, rounds=1)
    card = game.hands[0][0]
    ev = game.step(0, Discard(card.id))
    assert ev == [{"kind": "discard", "seat": 0, "card": card.id, "color": card.color}]
    ev = game.step(0, Draw("deck"))
    assert ev[0]["kind"] == "draw" and ev[0]["deck_left"] == 43


def test_round_result_to_json():
    game = Game(seed=7, rounds=1)
    _finish_round_quickly(game)
    data = game.history[0].to_json()
    assert isinstance(game.history[0], RoundResult)
    assert set(data) == {"scores", "breakdown", "starter", "turns"}
    assert len(data["breakdown"]) == 2 and len(data["breakdown"][0]) == 5


# ---------------------------------------------------------------- JSON
@pytest.mark.parametrize(
    "action",
    [
        Play("red-w0"),
        Play("blue-10"),
        Discard("green-2"),
        Discard("white-w2"),
        Draw("deck"),
        *(Draw(c) for c in COLORS),
    ],
)
def test_action_json_roundtrip(action):
    assert from_json(to_json(action)) == action


def test_all_legal_actions_roundtrip():
    game = Game(seed=8)
    rng = random.Random(8)
    while game.phase != Phase.ROUND_OVER:
        acts = game.legal_actions(game.current)
        for a in acts:
            assert from_json(to_json(a)) == a
        game.step(game.current, rng.choice(acts))


@pytest.mark.parametrize(
    "garbage",
    [
        None,
        42,
        "play",
        [],
        {},
        {"type": "fly"},
        {"type": "play"},
        {"type": "play", "card": "red-1"},
        {"type": "play", "card": 5},
        {"type": "discard", "card": None},
        {"type": "discard", "card": "purple-5"},
        {"type": "draw"},
        {"type": "draw", "source": "purple"},
        {"type": "draw", "source": 3},
        {"type": ["play"], "card": "red-2"},
    ],
)
def test_action_json_garbage(garbage):
    with pytest.raises(BadAction):
        from_json(garbage)


# ---------------------------------------------------------------- invariants / views
@pytest.mark.parametrize("seed", range(12))
def test_random_full_games_keep_invariants(seed):
    game = Game(rounds=3, seed=seed, starter=seed % 2)
    game.check()
    random_actions_until(game, random.Random(seed * 7 + 1))
    assert game.phase == Phase.GAME_OVER
    assert len(game.history) == 3
    assert game.result is not None
    assert game.result.totals == game.totals
    best = max(game.totals)
    assert game.result.winners == [i for i, t in enumerate(game.totals) if t == best]


def test_view_hides_opponent_hand():
    game = Game(seed=9)
    for seat in (0, 1):
        v = game.view(seat)
        assert v.seat == seat and v.opponent == 1 - seat
        assert v.opponent_hand == 8
        assert set(v.hand) == set(game.hands[seat])
        assert not set(v.hand) & set(game.hands[1 - seat])
        assert v.deck_left == 44
        assert v.phase == Phase.PLAY and v.current == 0
        assert v.round_no == 1 and v.rounds == 3 and v.totals == (0, 0)
        # nothing in the view leaks the opponent's cards or the deck
        visible = set(v.hand)
        for side in v.expeditions:
            for pile in side.values():
                visible.update(pile)
        for pile in v.discards.values():
            visible.update(pile)
        assert not visible & set(game.hands[1 - seat])
        assert not visible & set(game.deck)
        assert isinstance(v.opponent_hand, int)


def test_view_opponent_hand_size_in_draw_phase_and_expeditions_visible():
    game = Game(seed=9)
    game.hands[0][0] = N("red", 5)
    game.step(0, Play("red-5"))
    v = game.view(1)
    assert v.opponent_hand == 7
    assert v.expeditions[0]["red"] == (N("red", 5),)
    assert v.phase == Phase.DRAW and v.current == 0
    game.step(0, Draw("deck"))
    assert game.view(1).opponent_hand == 8


def test_view_last_discard_and_hand_sorted():
    game = Game(seed=9)
    card = game.hands[0][0]
    game.step(0, Discard(card.id))
    v = game.view(0)
    assert v.last_discard == card.color
    assert v.discards[card.color][-1] == card
    assert len(v.hand) == 7


# ---------------------------------------------------------------- take-backs
@pytest.mark.parametrize("kind", ["play", "discard"])
def test_undo_restores_the_turn(kind):
    game = Game(seed=11)
    seat = game.current
    before = snapshot(game)
    legal = [a for a in game.legal_actions(seat) if type(a).__name__.lower() == kind]
    action = legal[0]
    game.step(seat, action)
    assert game.can_undo(seat) and not game.can_undo(1 - seat)
    events = game.undo(seat)
    assert events == [
        {"kind": "undo", "seat": seat, "card": action.card, "color": CARDS[action.card].color, "from": kind}
    ]
    game.check()
    assert game.phase == Phase.PLAY and game.current == seat and not game.can_undo(seat)
    after = snapshot(game)
    assert sorted(after.pop("hands")[seat], key=lambda c: c.id) == sorted(before.pop("hands")[seat], key=lambda c: c.id)
    assert after == before


def test_undone_discard_returns_to_hand_and_lifts_the_pile_ban():
    game = Game(seed=4)
    seat = game.current
    card = game.hands[seat][0]
    game.step(seat, Discard(card.id))
    assert game.last_discard == card.color and game.discards[card.color] == [card]
    game.undo(seat)
    assert card in game.hands[seat] and game.discards[card.color] == [] and game.last_discard is None
    assert Discard(card.id) in game.legal_actions(seat)
    game.check()


def test_no_undo_after_the_draw_or_before_playing():
    game = Game(seed=2)
    seat = game.current
    with pytest.raises(IllegalMove):
        game.undo(seat)
    game.step(seat, game.legal_actions(seat)[0])
    with pytest.raises(IllegalMove):
        game.undo(1 - seat)
    game.step(seat, Draw("deck"))
    assert not game.can_undo(seat)
    with pytest.raises(IllegalMove):
        game.undo(seat)


def test_random_games_with_undos_keep_invariants():
    rng = random.Random(9)
    for seed in range(5):
        game = Game(rounds=2, seed=seed)
        while game.phase != Phase.GAME_OVER:
            if game.phase == Phase.ROUND_OVER:
                game.next_round()
                continue
            seat = game.current
            if game.can_undo(seat) and rng.random() < 0.3:
                game.undo(seat)
            else:
                game.step(seat, rng.choice(game.legal_actions(seat)))
            game.check()
