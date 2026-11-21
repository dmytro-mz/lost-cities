"""The multiplayer table (`Room`) driven through its protocol, plus an HTTP/WebSocket smoke test."""

from __future__ import annotations

import random
import time
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from lostcities.bots import REGISTRY
from lostcities.game.cards import COLORS, HAND_SIZE
from lostcities.web import room as room_module
from lostcities.web.room import HOST_GRACE, Room, RoomError
from lostcities.web.server import create_app

TOKENS = ["a" * 32, "b" * 32, "c" * 32, "d" * 32]
BOT = next(iter(REGISTRY))


class Inbox:
    def __init__(self, member_id: str) -> None:
        self.member_id = member_id
        self.messages: list[dict[str, Any]] = []

    def send(self, message: dict[str, Any]) -> None:
        self.messages.append(message)

    @property
    def last_state(self) -> dict[str, Any]:
        return next(m for m in reversed(self.messages) if m["type"] == "state")

    def errors(self) -> list[dict[str, Any]]:
        return [m for m in self.messages if m["type"] == "error"]


def _join(room: Room, i: int) -> Inbox:
    member = room.join(TOKENS[i], f"Human {i}")
    inbox = Inbox(member.id)
    room.connect(inbox)
    return inbox


def _room(humans: int = 2, bots: tuple[str, ...] = (), seed: int = 5, **settings: Any) -> tuple[Room, list[Inbox]]:
    room = Room("TEST", delay_scale=0.0, seed=seed)
    inboxes = [_join(room, i) for i in range(humans)]
    for key in bots:
        room.handle(inboxes[0].member_id, {"type": "add_bot", "bot": key})
    if settings:
        room.handle(inboxes[0].member_id, {"type": "settings", "changes": settings})
    return room, inboxes


def _game(state: dict[str, Any]) -> dict[str, Any]:
    return state["game"]


def _human_move(room: Room, inbox: Inbox, rng: random.Random) -> bool:
    """Play a random legal action for this human through the room protocol, if it's their move."""
    legal = _game(room.state_for(inbox.member_id))["legal"]
    if not legal:
        return False
    room.handle(inbox.member_id, {"type": "action", "action": rng.choice(legal)})
    return True


def _strings(value: Any) -> set[str]:
    """Every string anywhere in a JSON-like structure."""
    if isinstance(value, str):
        return {value}
    if isinstance(value, dict):
        return set().union(*(_strings(v) for v in value.values())) if value else set()
    if isinstance(value, list | tuple):
        return set().union(*(_strings(v) for v in value)) if value else set()
    return set()


def _play(room: Room, inboxes: list[Inbox], *, on_step: Any = None, limit: int = 5000) -> int:
    """Play the whole match: humans act randomly, bots/auto through `plan()`, humans click ready between rounds."""
    rng = random.Random(1)
    rounds_over = 0
    for _ in range(limit):
        if on_step:
            on_step()
        if room.status == "game_over":
            return rounds_over
        if room.status == "round_over":
            rounds_over += 1
            plan = room.plan()
            # Someone online hasn't pressed ready yet: the table waits.
            assert plan is None
            for inbox in inboxes:
                room.handle(inbox.member_id, {"type": "ready"})
            plan = room.plan()
            assert plan is not None
            plan[1]()
            assert room.status == "playing"
            continue
        assert room.status == "playing"
        if any(_human_move(room, inbox, rng) for inbox in inboxes):
            continue
        plan = room.plan()
        assert plan is not None, "nobody can move"
        plan[1]()
    raise AssertionError("game did not finish")


def _to_round_over(room: Room, inboxes: list[Inbox]) -> None:
    rng = random.Random(2)
    for _ in range(5000):
        if room.status == "round_over":
            return
        if not any(_human_move(room, inbox, rng) for inbox in inboxes):
            plan = room.plan()
            assert plan is not None
            plan[1]()
    raise AssertionError("round did not finish")


# ------------------------------------------------------------------ full matches
@pytest.mark.parametrize("rounds", [1, 2, 3])
def test_full_match_two_humans(rounds: int) -> None:
    room, inboxes = _room(rounds=rounds)
    room.handle(inboxes[0].member_id, {"type": "start"})
    assert room.status == "playing"
    over = _play(room, inboxes)
    assert over == rounds - 1  # no ready-up after the final round
    assert room.status == "game_over"
    assert room.game is not None and len(room.game.history) == rounds
    for inbox in inboxes:
        game = _game(inbox.last_state)
        assert game["rounds"] == rounds
        result = game["result"]
        assert result is not None
        assert result["totals"] == game["totals"]
        assert result["winners"] and all(w in (0, 1) for w in result["winners"])
        assert len(game["history"]) == rounds
    # nothing left to do automatically
    assert room.plan() is None


@pytest.mark.parametrize("rounds", [1, 3])
def test_full_match_human_vs_bot(rounds: int) -> None:
    room, inboxes = _room(humans=1, bots=(BOT,), rounds=rounds)
    room.handle(inboxes[0].member_id, {"type": "start"})
    over = _play(room, inboxes)
    assert over == rounds - 1
    assert room.status == "game_over"
    state = inboxes[0].last_state
    assert _game(state)["result"] is not None
    assert [s["bot"] for s in state["seats"]].count(BOT) == 1


def test_round_flow_requires_every_online_human_to_be_ready() -> None:
    room, inboxes = _room(rounds=2)
    host, guest = inboxes[0].member_id, inboxes[1].member_id
    room.handle(host, {"type": "start"})
    _to_round_over(room, inboxes)
    assert _game(inboxes[0].last_state)["round"] == 1
    assert room.plan() is None
    room.handle(host, {"type": "ready"})
    assert room.plan() is None  # the guest is still online and not ready
    room.handle(guest, {"type": "ready"})
    delay, step = room.plan() or (None, None)
    assert delay == 0.0 and step is not None
    step()
    assert room.status == "playing"
    state = inboxes[0].last_state
    assert _game(state)["round"] == 2 and _game(state)["turn"] == 0 and _game(state)["hand_sizes"] == [HAND_SIZE] * 2
    assert state["event"]["kind"] == "round_start"
    assert not any(s["ready"] for s in state["seats"])
    # ready outside a round break is refused
    with pytest.raises(RoomError):
        room.handle(host, {"type": "ready"})


def test_ready_is_refused_for_spectators() -> None:
    room, inboxes = _room()
    spectator = _join(room, 2)
    room.handle(inboxes[0].member_id, {"type": "start"})
    _to_round_over(room, inboxes)
    with pytest.raises(RoomError):
        room.handle(spectator.member_id, {"type": "ready"})


def test_driver_continues_by_itself_when_no_human_is_online_at_round_over() -> None:
    room, inboxes = _room(rounds=2)
    room.handle(inboxes[0].member_id, {"type": "start"})
    _to_round_over(room, inboxes)
    assert room.plan() is None
    for inbox in inboxes:
        room.disconnect(inbox)
    plan = room.plan()
    assert plan is not None
    plan[1]()
    assert room.status == "playing"
    assert room.game is not None and room.game.round_no == 2


def test_driver_continues_human_vs_bot_when_the_human_left() -> None:
    room, inboxes = _room(humans=1, bots=(BOT,), rounds=2)
    room.handle(inboxes[0].member_id, {"type": "start"})
    _to_round_over(room, inboxes)
    assert room.plan() is None  # the human is online and has not pressed ready
    room.disconnect(inboxes[0])
    plan = room.plan()
    assert plan is not None
    plan[1]()
    assert room.status == "playing"


def test_play_again_and_back_to_lobby_after_game_over() -> None:
    room, inboxes = _room(rounds=1)
    host, guest = inboxes[0].member_id, inboxes[1].member_id
    room.handle(host, {"type": "start"})
    _play(room, inboxes)
    assert room.status == "game_over"
    with pytest.raises(RoomError):
        room.handle(guest, {"type": "play_again"})
    room.handle(host, {"type": "play_again"})
    assert room.status == "playing" and room.game_no == 2
    assert _game(room.state_for(host))["result"] is None
    with pytest.raises(RoomError):
        room.handle(host, {"type": "start"})  # a game is already running
    room.handle(host, {"type": "to_lobby"})
    assert room.status == "lobby" and room.state_for(host)["game"] is None


# ------------------------------------------------------------------ hidden information
def test_hand_visibility_per_viewer() -> None:
    room, inboxes = _room()
    spectator = _join(room, 2)
    host, guest = inboxes[0].member_id, inboxes[1].member_id
    room.handle(host, {"type": "start"})
    assert room.game is not None
    hands = [{c.id for c in h} for h in room.game.hands]
    assert all(len(h) == HAND_SIZE for h in hands)
    for member, seat in ((host, 0), (guest, 1)):
        state = room.state_for(member)
        game = _game(state)
        assert state["you"]["seat"] == seat
        assert set(game["hand"]) == hands[seat]
        assert game["hand_sizes"] == [HAND_SIZE, HAND_SIZE]
        assert "hands" not in game
        assert not _strings(state) & hands[1 - seat]
    state = room.state_for(spectator.member_id)
    assert _game(state)["hand"] is None and state["you"]["seat"] is None
    assert "hands" not in _game(state)
    assert not _strings(state) & (hands[0] | hands[1])
    # the lobby has no game at all
    room.handle(host, {"type": "to_lobby"})
    assert room.state_for(spectator.member_id)["game"] is None


def test_hidden_information_throughout_a_match() -> None:
    """Nothing about the opponent's hand or deck draws leaks to the other player or a spectator, ever."""
    room, inboxes = _room(rounds=2)
    spectator = _join(room, 2)
    viewers = [*inboxes, spectator]
    room.handle(inboxes[0].member_id, {"type": "start"})
    deck_draws = 0

    def check() -> None:
        game = room.game
        assert game is not None
        playing = room.status == "playing"
        for seat, inbox in enumerate(inboxes):
            other = {c.id for c in game.hands[1 - seat]}
            state = room.state_for(inbox.member_id)
            g = _game(state)
            assert g["hand"] == [
                c.id for c in sorted(game.hands[seat], key=lambda c: (COLORS.index(c.color), c.value, c.copy))
            ]
            assert g["hand_sizes"] == [len(h) for h in game.hands]
            if playing:
                assert "hands" not in g
                assert not _strings(state) & other
            else:
                assert [set(h) for h in g["hands"]] == [{c.id for c in h} for h in game.hands]
        s = _game(room.state_for(spectator.member_id))
        assert s["hand"] is None
        if playing:
            assert "hands" not in s
        else:
            assert len(s["hands"]) == 2

    _play(room, inboxes, on_step=check)
    check()
    for inbox in viewers:
        seat = room.seat_of(inbox.member_id)
        for msg in inbox.messages:
            if msg["type"] != "state" or not msg["event"] or "events" not in msg["event"]:
                continue
            for ev in msg["event"]["events"]:
                if ev["kind"] == "draw" and ev["source"] == "deck":
                    deck_draws += 1
                    assert (ev["card"] is not None) == (ev["seat"] == seat)
                elif ev["kind"] == "draw":
                    assert ev["card"] is not None  # discard pickups are public
    assert deck_draws > 50


def test_deck_draw_event_hides_the_card_from_everyone_but_the_drawer() -> None:
    room, inboxes = _room()
    spectator = _join(room, 2)
    host = inboxes[0].member_id
    room.handle(host, {"type": "start"})
    game = room.game
    assert game is not None
    mover = game.current
    inbox = inboxes[mover]
    legal = _game(room.state_for(inbox.member_id))["legal"]
    room.handle(inbox.member_id, {"type": "action", "action": legal[0]})
    top = game.deck[-1].id
    room.handle(inbox.member_id, {"type": "action", "action": {"type": "draw", "source": "deck"}})

    def draw_of(box: Inbox) -> dict[str, Any]:
        return next(e for e in box.last_state["event"]["events"] if e["kind"] == "draw")

    assert draw_of(inboxes[mover])["card"] == top
    assert draw_of(inboxes[1 - mover])["card"] is None
    assert draw_of(spectator)["card"] is None
    assert draw_of(spectator)["source"] == "deck" and draw_of(spectator)["seat"] == mover
    # and the secret is not smuggled in through any other part of the viewers' messages
    other_msgs = [m for m in (*inboxes[1 - mover].messages, *spectator.messages) if m["type"] in ("state", "log")]
    assert all(top not in _strings(m) for m in other_msgs[-3:])


@pytest.mark.parametrize("peek", [False, True])
def test_discard_piles_expose_cards_only_with_peek(peek: bool) -> None:
    room, inboxes = _room(peek=peek)
    spectator = _join(room, 2)
    host = inboxes[0].member_id
    room.handle(host, {"type": "start"})
    game = room.game
    assert game is not None
    mover = inboxes[game.current]
    discard = next(a for a in _game(room.state_for(mover.member_id))["legal"] if a["type"] == "discard")
    room.handle(mover.member_id, {"type": "action", "action": discard})
    color = discard["card"].split("-")[0]
    for member in (inboxes[0].member_id, inboxes[1].member_id, spectator.member_id):
        piles = _game(room.state_for(member))["discards"]
        assert piles[color]["top"] == discard["card"] and piles[color]["count"] == 1
        if peek:
            assert piles[color]["cards"] == [discard["card"]]
            assert all(p["cards"] == [] for c, p in piles.items() if c != color)
        else:
            assert all(p["cards"] is None for p in piles.values())
    # between rounds every pile is open even without peek
    room.settings.peek = False
    room.handle(mover.member_id, {"type": "action", "action": {"type": "draw", "source": "deck"}})
    _to_round_over(room, inboxes)
    piles = _game(room.state_for(spectator.member_id))["discards"]
    assert all(isinstance(p["cards"], list) and len(p["cards"]) == p["count"] for p in piles.values())


def test_legal_actions_only_for_the_player_to_move() -> None:
    room, inboxes = _room()
    spectator = _join(room, 2)
    room.handle(inboxes[0].member_id, {"type": "start"})
    game = room.game
    assert game is not None
    mover, idle = inboxes[game.current], inboxes[1 - game.current]
    legal = _game(room.state_for(mover.member_id))["legal"]
    assert len(legal) >= HAND_SIZE and {a["type"] for a in legal} <= {"play", "discard"}
    assert _game(room.state_for(idle.member_id))["legal"] == []
    assert _game(room.state_for(spectator.member_id))["legal"] == []
    room.handle(mover.member_id, {"type": "action", "action": legal[0]})
    draw_legal = _game(room.state_for(mover.member_id))["legal"]
    assert {"type": "draw", "source": "deck"} in draw_legal and all(a["type"] == "draw" for a in draw_legal)
    assert _game(room.state_for(idle.member_id))["legal"] == []
    assert (
        _game(room.state_for(mover.member_id))["current"]
        == game.current
        == _game(room.state_for(idle.member_id))["current"]
    )
    # nobody has legal moves between rounds
    room.handle(mover.member_id, {"type": "action", "action": {"type": "draw", "source": "deck"}})
    _to_round_over(room, inboxes)
    assert all(_game(room.state_for(i.member_id))["legal"] == [] for i in (*inboxes, spectator))
    assert _game(room.state_for(spectator.member_id))["current"] is None


# ------------------------------------------------------------------ lobby rules
def test_only_the_host_can_run_the_lobby() -> None:
    room, inboxes = _room(bots=())
    host, guest = inboxes[0].member_id, inboxes[1].member_id
    assert room.host_id == host
    room.handle(host, {"type": "remove_seat", "seat": 1})  # make room so add_bot wouldn't fail for other reasons
    requests = [
        {"type": "add_bot", "bot": BOT},
        {"type": "settings", "changes": {"rounds": 2}},
        {"type": "start"},
        {"type": "swap"},
        {"type": "remove_seat", "seat": 0},
        {"type": "play_again"},
        {"type": "to_lobby"},
        {"type": "autoplay", "seat": 0, "on": True},
    ]
    before = room.state_for(host)
    for msg in requests:
        with pytest.raises(RoomError, match="host"):
            room.handle(guest, msg)
    assert room.state_for(host) == before
    assert room.settings.rounds == 3 and len(room.seats) == 1


def test_two_seats_at_most_and_the_third_member_spectates() -> None:
    room, inboxes = _room()
    third = _join(room, 2)
    state = room.state_for(third.member_id)
    assert len(state["seats"]) == 2 and state["you"]["seat"] is None
    assert [s["member"] for s in state["spectators"]] == [third.member_id]
    with pytest.raises(RoomError):
        room.handle(inboxes[0].member_id, {"type": "add_bot", "bot": BOT})
    with pytest.raises(RoomError):
        room.handle(third.member_id, {"type": "sit"})
    assert len(room.seats) == 2
    # a spectator can sit as soon as a seat frees up
    room.handle(inboxes[1].member_id, {"type": "stand"})
    room.handle(third.member_id, {"type": "sit"})
    assert room.seat_of(third.member_id) == 1 and room.seat_of(inboxes[1].member_id) is None
    # sitting twice is harmless
    room.handle(third.member_id, {"type": "sit"})
    assert len(room.seats) == 2


def test_add_bot_validation_and_names() -> None:
    room, inboxes = _room(humans=1)
    host = inboxes[0].member_id
    with pytest.raises(RoomError):
        room.handle(host, {"type": "add_bot", "bot": "no-such-bot"})
    with pytest.raises(RoomError):
        room.handle(host, {"type": "add_bot"})
    room.handle(host, {"type": "add_bot", "bot": BOT})
    state = room.state_for(host)
    assert [s["bot"] for s in state["seats"]] == [None, BOT]
    assert state["seats"][1]["name"] == REGISTRY[BOT].label
    assert [s["color"] for s in state["seats"]] == ["amber", "teal"]
    room.handle(host, {"type": "remove_seat", "seat": 1})
    room.handle(host, {"type": "stand"})
    for _ in range(2):
        room.handle(host, {"type": "add_bot", "bot": BOT})
    assert [s.name for s in room.seats] == [REGISTRY[BOT].label, f"{REGISTRY[BOT].label} 2"]


def test_start_needs_two_seats() -> None:
    room, inboxes = _room(humans=1)
    host = inboxes[0].member_id
    with pytest.raises(RoomError):
        room.handle(host, {"type": "start"})
    assert room.status == "lobby"
    room.handle(host, {"type": "add_bot", "bot": BOT})
    room.handle(host, {"type": "stand"})
    with pytest.raises(RoomError):
        room.handle(host, {"type": "start"})
    room.handle(host, {"type": "sit"})
    room.handle(host, {"type": "start"})
    assert room.status == "playing" and room.game is not None


def test_lobby_only_requests_are_refused_during_a_game() -> None:
    room, inboxes = _room()
    host = inboxes[0].member_id
    room.handle(host, {"type": "start"})
    for msg in (
        {"type": "settings", "changes": {"rounds": 1}},
        {"type": "swap"},
        {"type": "remove_seat", "seat": 0},
        {"type": "stand"},
        {"type": "sit"},
        {"type": "add_bot", "bot": BOT},
    ):
        with pytest.raises(RoomError):
            room.handle(host if msg["type"] not in ("stand", "sit") else inboxes[1].member_id, msg)
    assert len(room.seats) == 2 and room.settings.rounds == 3


def test_swap_and_remove_seat() -> None:
    room, inboxes = _room()
    host, guest = inboxes[0].member_id, inboxes[1].member_id
    assert (room.seat_of(host), room.seat_of(guest)) == (0, 1)
    room.handle(host, {"type": "swap"})
    assert (room.seat_of(host), room.seat_of(guest)) == (1, 0)
    assert [s["member"] for s in room.state_for(host)["seats"]] == [guest, host]
    for bad in (5, -1, "0", None, True, 1.0):
        with pytest.raises(RoomError):
            room.handle(host, {"type": "remove_seat", "seat": bad})
    assert len(room.seats) == 2
    room.handle(host, {"type": "remove_seat", "seat": 0})
    assert [s.member_id for s in room.seats] == [host]
    # the removed guest is now a spectator and can sit again
    assert [s["member"] for s in room.state_for(host)["spectators"]] == [guest]
    room.handle(guest, {"type": "sit"})
    assert len(room.seats) == 2


def test_stand_and_sit() -> None:
    room, inboxes = _room()
    guest = inboxes[1].member_id
    room.handle(guest, {"type": "stand"})
    assert room.seat_of(guest) is None and len(room.seats) == 1
    room.handle(guest, {"type": "stand"})  # standing twice is harmless
    room.handle(guest, {"type": "sit"})
    assert room.seat_of(guest) == 1


def test_settings_updates_and_validation() -> None:
    room, inboxes = _room()
    host = inboxes[0].member_id
    room.handle(
        host,
        {
            "type": "settings",
            "changes": {"rounds": 5, "turn_timer": 60, "bot_speed": "fast", "hints": True, "peek": True},
        },
    )
    assert room.state_for(host)["settings"] == {
        "rounds": 5,
        "turn_timer": 60,
        "bot_speed": "fast",
        "hints": True,
        "peek": True,
    }
    for rounds in (1, 2, 3, 4, 5):
        room.handle(host, {"type": "settings", "changes": {"rounds": rounds}})
        assert room.settings.rounds == rounds
    bad_changes: list[Any] = [
        {"rounds": 0},
        {"rounds": 6},
        {"rounds": -1},
        {"rounds": "3"},
        {"rounds": None},
        {"rounds": 2.5},
        {"rounds": True},
        {"rounds": False},
        {"turn_timer": 45},
        {"turn_timer": True},
        {"turn_timer": "30"},
        {"bot_speed": "ludicrous"},
        {"bot_speed": 1},
        {"hints": "yes"},
        {"hints": 1},
        {"peek": None},
        {"colour": "red"},
        None,
        "rounds",
        [("rounds", 2)],
    ]
    for changes in bad_changes:
        with pytest.raises(RoomError):
            room.handle(host, {"type": "settings", "changes": changes})
    assert room.settings.rounds == 5
    with pytest.raises(RoomError):
        room.handle(host, {"type": "settings"})


def test_unknown_request_is_an_error() -> None:
    room, inboxes = _room()
    with pytest.raises(RoomError):
        room.handle(inboxes[0].member_id, {"type": "launch_missiles"})
    with pytest.raises(RoomError):
        room.handle(inboxes[0].member_id, {})


def test_host_handover_after_the_grace_period(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [1000.0]
    monkeypatch.setattr(room_module, "time", SimpleNamespace(monotonic=lambda: clock[0], time=time.time))
    room, inboxes = _room()
    host, guest = inboxes[0], inboxes[1]
    room.check_host()
    assert room.host_id == host.member_id  # the host is connected
    room.disconnect(host)
    room.check_host()
    assert room.host_id == host.member_id  # within the grace period
    clock[0] += HOST_GRACE - 1
    room.check_host()
    assert room.host_id == host.member_id
    clock[0] += 2
    room.check_host()
    assert room.host_id == guest.member_id
    assert guest.last_state["host"] == guest.member_id
    # the new host has the powers, the old one (reconnected) does not
    room.connect(host)
    room.check_host()
    assert room.host_id == guest.member_id
    with pytest.raises(RoomError):
        room.handle(host.member_id, {"type": "start"})
    room.handle(guest.member_id, {"type": "start"})
    assert room.status == "playing"


def test_host_handover_prefers_a_seated_member(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [50.0]
    monkeypatch.setattr(room_module, "time", SimpleNamespace(monotonic=lambda: clock[0], time=time.time))
    room, inboxes = _room()
    third = _join(room, 2)
    host, spectator_like = inboxes[0], inboxes[1]
    room.handle(spectator_like.member_id, {"type": "stand"})
    room.handle(third.member_id, {"type": "sit"})
    room.disconnect(host)
    # ... also with `disconnected_at` simply set far in the past
    room.members[host.member_id].disconnected_at = clock[0] - HOST_GRACE - 5
    room.check_host()
    assert room.host_id == third.member_id


def test_no_host_handover_when_nobody_is_online(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [0.0]
    monkeypatch.setattr(room_module, "time", SimpleNamespace(monotonic=lambda: clock[0], time=time.time))
    room, inboxes = _room()
    for inbox in inboxes:
        room.disconnect(inbox)
    clock[0] += HOST_GRACE * 10
    room.check_host()
    assert room.host_id == inboxes[0].member_id


def test_rejoining_with_the_same_token_keeps_identity_and_seat() -> None:
    room, inboxes = _room()
    again = room.join(TOKENS[1], "Renamed")
    assert again.id == inboxes[1].member_id and len(room.members) == 2
    assert room.seats[1].name == "Renamed" and room.seat_of(again.id) == 1


# ------------------------------------------------------------------ rejected actions
def test_illegal_moves_raise_and_leave_the_state_unchanged() -> None:
    room, inboxes = _room()
    room.handle(inboxes[0].member_id, {"type": "start"})
    game = room.game
    assert game is not None
    rng = random.Random(9)
    unplayable_seen = 0

    def snapshot() -> list[dict[str, Any]]:
        return [_game(room.state_for(i.member_id)) for i in inboxes]

    def refuse(inbox: Inbox, action: Any) -> None:
        before, seq = snapshot(), room.seq
        with pytest.raises(RoomError):
            room.handle(inbox.member_id, {"type": "action", "action": action})
        assert snapshot() == before and room.seq == seq

    for _ in range(80):
        mover, idle = inboxes[game.current], inboxes[1 - game.current]
        legal = _game(room.state_for(mover.member_id))["legal"]
        hand = _game(room.state_for(mover.member_id))["hand"]
        refuse(idle, legal[0])  # not your turn, even though the action itself would be fine
        refuse(idle, {"type": "draw", "source": "deck"})
        if game.phase == "play":
            refuse(mover, {"type": "draw", "source": "deck"})  # draw before playing
            other_hand = [c.id for c in game.hands[1 - game.current]]
            refuse(mover, {"type": "play", "card": other_hand[0]})  # a card you don't hold
            refuse(mover, {"type": "discard", "card": other_hand[0]})
            playable = {a["card"] for a in legal if a["type"] == "play"}
            for card in hand:
                if card not in playable:
                    unplayable_seen += 1
                    refuse(mover, {"type": "play", "card": card})  # wager after numbers / lower number
        else:
            refuse(mover, {"type": "play", "card": hand[0]})  # play twice in a turn
            refuse(mover, {"type": "discard", "card": hand[0]})
            for color in COLORS:
                if {"type": "draw", "source": color} not in legal:
                    refuse(mover, {"type": "draw", "source": color})  # empty pile or the one just discarded
        room.handle(mover.member_id, {"type": "action", "action": rng.choice(legal)})
    assert unplayable_seen > 0
    game.check()


def test_taking_back_the_card_you_just_discarded_is_refused() -> None:
    room, inboxes = _room()
    room.handle(inboxes[0].member_id, {"type": "start"})
    assert room.game is not None
    mover = inboxes[room.game.current]
    discard = next(a for a in _game(room.state_for(mover.member_id))["legal"] if a["type"] == "discard")
    room.handle(mover.member_id, {"type": "action", "action": discard})
    color = discard["card"].split("-")[0]
    legal = _game(room.state_for(mover.member_id))["legal"]
    assert {"type": "draw", "source": color} not in legal
    with pytest.raises(RoomError):
        room.handle(mover.member_id, {"type": "action", "action": {"type": "draw", "source": color}})


@pytest.mark.parametrize(
    "action",
    [
        None,
        "play",
        42,
        [],
        {},
        {"type": "fly"},
        {"type": "play"},
        {"type": "play", "card": 3},
        {"type": "play", "card": "purple-7"},
        {"type": "discard", "card": None},
        {"type": "draw"},
        {"type": "draw", "source": "purple"},
        {"type": "draw", "source": ["deck"]},
        {"type": ["play"], "card": "red-2"},
    ],
)
def test_malformed_actions_are_errors(action: Any) -> None:
    room, inboxes = _room()
    room.handle(inboxes[0].member_id, {"type": "start"})
    before = _game(room.state_for(inboxes[0].member_id))
    for inbox in inboxes:
        with pytest.raises(RoomError):
            room.handle(inbox.member_id, {"type": "action", "action": action})
    with pytest.raises(RoomError):
        room.handle(inboxes[0].member_id, {"type": "action"})
    assert _game(room.state_for(inboxes[0].member_id)) == before


def test_actions_outside_a_running_game_and_by_spectators() -> None:
    room, inboxes = _room()
    spectator = _join(room, 2)
    action = {"type": "action", "action": {"type": "draw", "source": "deck"}}
    with pytest.raises(RoomError):
        room.handle(inboxes[0].member_id, action)  # lobby
    with pytest.raises(RoomError, match="watching"):
        room.handle(spectator.member_id, action)
    room.handle(inboxes[0].member_id, {"type": "start"})
    with pytest.raises(RoomError, match="watching"):
        room.handle(spectator.member_id, action)
    _to_round_over(room, inboxes)
    with pytest.raises(RoomError):
        room.handle(inboxes[0].member_id, action)  # between rounds


# ------------------------------------------------------------------ autoplay
def test_host_can_hand_a_disconnected_seat_to_the_autopilot() -> None:
    room, inboxes = _room()
    host, guest = inboxes
    room.handle(host.member_id, {"type": "start"})
    game = room.game
    assert game is not None
    with pytest.raises(RoomError, match="connected"):
        room.handle(host.member_id, {"type": "autoplay", "seat": 1, "on": True})
    with pytest.raises(RoomError):
        room.handle(guest.member_id, {"type": "autoplay", "seat": 1, "on": True})  # host only
    # make the guest the player to move, then drop them
    if game.current != 1:
        legal = _game(room.state_for(host.member_id))["legal"]
        room.handle(host.member_id, {"type": "action", "action": next(a for a in legal if a["type"] == "discard")})
        room.handle(host.member_id, {"type": "action", "action": {"type": "draw", "source": "deck"}})
    assert game.current == 1
    room.disconnect(guest)
    assert room.plan() is None  # a human who has merely disconnected is waited for
    room.handle(host.member_id, {"type": "autoplay", "seat": 1, "on": True})
    state = room.state_for(host.member_id)
    assert state["seats"][1]["autoplay"] is True and state["seats"][1]["connected"] is False
    assert _game(state)["legal"] == []
    # the autopilot now moves for them, a whole turn, one step at a time
    turn = game.turn
    while game.current == 1 and room.status == "playing":
        plan = room.plan()
        assert plan is not None
        plan[1]()
    assert game.turn == turn + 1 and game.current == 0
    assert room.seats[1].autoplay is True
    # reconnecting hands the seat back
    again = Inbox(guest.member_id)
    room.connect(again)
    assert room.seats[1].autoplay is False
    assert again.last_state["seats"][1]["autoplay"] is False
    # autoplay can be switched off again by the host too
    room.disconnect(again)
    room.handle(host.member_id, {"type": "autoplay", "seat": 1, "on": True})
    room.handle(host.member_id, {"type": "autoplay", "seat": 1, "on": False})
    assert room.seats[1].autoplay is False


def test_autoplay_seat_has_no_legal_actions_even_on_its_turn() -> None:
    room, inboxes = _room()
    host = inboxes[0]
    room.handle(host.member_id, {"type": "start"})
    game = room.game
    assert game is not None
    mover = inboxes[game.current]
    assert _game(room.state_for(mover.member_id))["legal"]
    room.disconnect(mover)
    if mover is host:  # the host is the one gone: pass the role on first
        room.host_id = inboxes[1].member_id
    room.handle(room.host_id or "", {"type": "autoplay", "seat": game.current, "on": True})
    assert _game(room.state_for(mover.member_id))["legal"] == []


def test_autoplay_validation() -> None:
    room, inboxes = _room(humans=1, bots=(BOT,))
    host = inboxes[0].member_id
    with pytest.raises(RoomError):
        room.handle(host, {"type": "autoplay", "seat": 0, "on": True})  # lobby
    room.handle(host, {"type": "start"})
    with pytest.raises(RoomError):
        room.handle(host, {"type": "autoplay", "seat": 1, "on": True})  # that seat is a bot
    for bad in (7, -1, "0", None):
        with pytest.raises(RoomError):
            room.handle(host, {"type": "autoplay", "seat": bad, "on": True})
    with pytest.raises(RoomError):
        room.handle(host, {"type": "autoplay", "seat": 0, "on": True})  # the host is connected


def test_autoplay_seat_does_not_hold_up_the_round_break() -> None:
    room, inboxes = _room(rounds=2)
    host, guest = inboxes
    room.handle(host.member_id, {"type": "start"})
    _to_round_over(room, inboxes)
    room.disconnect(guest)
    room.handle(host.member_id, {"type": "autoplay", "seat": 1, "on": True})
    assert room.plan() is None  # the host still has to click ready
    room.handle(host.member_id, {"type": "ready"})
    plan = room.plan()
    assert plan is not None and plan[0] == 0.0
    plan[1]()
    assert room.status == "playing"


# ------------------------------------------------------------------ turn timer
def test_turn_timeout_has_the_autopilot_finish_the_whole_turn(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [500.0]
    monkeypatch.setattr(room_module, "time", SimpleNamespace(monotonic=lambda: clock[0], time=time.time))
    room, inboxes = _room(turn_timer=30)
    host = inboxes[0].member_id
    room.handle(host, {"type": "start"})
    game = room.game
    assert game is not None
    state = room.state_for(host)
    assert _game(state)["time_left"] == 30 and _game(state)["time_total"] == 30
    mover = game.current
    # before the deadline the table just waits, but knows when to step in
    plan = room.plan()
    assert plan is not None and plan[0] == pytest.approx(30)
    clock[0] += 10
    plan = room.plan()
    assert plan is not None and plan[0] == pytest.approx(20)
    assert _game(room.state_for(host))["time_left"] == pytest.approx(20)
    # partway through the turn (card already played) the deadline for that same turn stands
    legal = _game(room.state_for(inboxes[mover].member_id))["legal"]
    room.handle(inboxes[mover].member_id, {"type": "action", "action": next(a for a in legal if a["type"] == "play")})
    assert _game(room.state_for(host))["time_left"] == pytest.approx(20)
    clock[0] += 25
    delay, step = room.plan() or (None, None)
    assert delay == 0.0 and step is not None
    history = len(room.log)
    step()
    assert game.turn == 1 and game.current == 1 - mover and game.phase == "play"
    assert any("ran out of time" in entry.get("text", "") for entry in list(room.log)[history:])
    # a fresh timer runs for the next player; the previous player still holds a full hand
    assert _game(room.state_for(host))["time_left"] == pytest.approx(30)
    assert len(game.hands[mover]) == HAND_SIZE
    game.check()
    # a timeout when the turn has not even begun plays a full play+draw turn
    clock[0] += 31
    delay, step = room.plan() or (None, None)
    assert delay == 0.0 and step is not None
    seen = len(inboxes[0].messages)
    step()
    kinds = [
        e["kind"]
        for m in inboxes[0].messages[seen:]
        if m["type"] == "state" and m["event"] and "events" in m["event"]
        for e in m["event"]["events"]
    ]
    assert kinds[0] in ("play", "discard") and kinds[-1] == "draw" and len(kinds) == 2
    assert game.turn == 2 and game.current == mover


def test_no_deadline_without_a_timer_or_for_automatic_players() -> None:
    room, inboxes = _room(humans=1, bots=(BOT,))
    host = inboxes[0].member_id
    room.handle(host, {"type": "start"})
    assert "time_total" not in _game(room.state_for(host)) and _game(room.state_for(host))["time_left"] is None
    room.handle(host, {"type": "to_lobby"})
    room.handle(host, {"type": "settings", "changes": {"turn_timer": 30}})
    room.handle(host, {"type": "start"})
    game = room.game
    assert game is not None
    if game.current == 0:  # the human moves first: a timer runs
        assert _game(room.state_for(host))["time_left"] is not None
        legal = _game(room.state_for(host))["legal"]
        room.handle(host, {"type": "action", "action": next(a for a in legal if a["type"] == "discard")})
        room.handle(host, {"type": "action", "action": {"type": "draw", "source": "deck"}})
    # it is the bot's turn: no timer, and the plan is a bot move
    assert game.current == 1
    assert _game(room.state_for(host))["time_left"] is None
    plan = room.plan()
    assert plan is not None
    plan[1]()
    assert game.phase == "draw"


# ------------------------------------------------------------------ hints
def test_hint_is_refused_unless_enabled_and_for_the_player_to_move() -> None:
    room, inboxes = _room(hints=False)
    spectator = _join(room, 2)
    room.handle(inboxes[0].member_id, {"type": "start"})
    game = room.game
    assert game is not None
    mover, idle = inboxes[game.current], inboxes[1 - game.current]
    with pytest.raises(RoomError, match="Hints"):
        room.handle(mover.member_id, {"type": "hint"})
    room.settings.hints = True
    with pytest.raises(RoomError):
        room.handle(idle.member_id, {"type": "hint"})
    with pytest.raises(RoomError):
        room.handle(spectator.member_id, {"type": "hint"})
    reply = room.handle(mover.member_id, {"type": "hint"})
    assert reply is not None and reply["type"] == "hint"


def test_hints_are_legal_for_a_whole_game() -> None:
    room, inboxes = _room(hints=True, rounds=1)
    room.handle(inboxes[0].member_id, {"type": "start"})
    game = room.game
    assert game is not None
    steps = 0
    while room.status == "playing":
        mover = inboxes[game.current]
        legal = _game(room.state_for(mover.member_id))["legal"]
        reply = room.handle(mover.member_id, {"type": "hint"})
        assert reply is not None and reply["type"] == "hint" and reply["action"] in legal
        assert _game(room.state_for(mover.member_id))["legal"] == legal  # asking for a hint changes nothing
        room.handle(mover.member_id, {"type": "action", "action": reply["action"]})
        steps += 1
    assert steps > 80 and room.status == "game_over"


# ------------------------------------------------------------------ misc protocol
def test_listeners_get_the_events_of_each_move_and_chat_and_reactions() -> None:
    room, inboxes = _room()
    host, guest = inboxes
    room.handle(host.member_id, {"type": "start"})
    assert host.last_state["event"]["kind"] == "game_start"
    game = room.game
    assert game is not None
    mover = inboxes[game.current]
    legal = _game(room.state_for(mover.member_id))["legal"]
    room.handle(mover.member_id, {"type": "action", "action": legal[0]})
    event = guest.last_state["event"]
    assert event["kind"] == "move" and event["seat"] == room.seat_of(mover.member_id)
    assert event["events"][0]["kind"] in ("play", "discard")
    assert host.last_state["seq"] == guest.last_state["seq"] == room.seq
    room.handle(guest.member_id, {"type": "chat", "text": "  hello   there "})
    assert host.messages[-1] == {"type": "log", "entry": host.messages[-1]["entry"]}
    assert host.messages[-1]["entry"]["text"] == "hello there"
    with pytest.raises(RoomError):
        room.handle(guest.member_id, {"type": "chat", "text": "again"})  # rate limited
    room.handle(host.member_id, {"type": "react", "emoji": "🔥"})
    assert guest.messages[-1]["type"] == "react" and guest.messages[-1]["emoji"] == "🔥"
    with pytest.raises(RoomError):
        room.handle(host.member_id, {"type": "react", "emoji": "💩"})


# ------------------------------------------------------------------ server
def test_http_endpoints() -> None:
    with TestClient(create_app(delay_scale=0.0)) as client:
        config = client.get("/api/config").json()
        assert {b["key"] for b in config["bots"]} == set(REGISTRY)
        assert all({"key", "label", "stars", "description"} <= set(b) for b in config["bots"])
        assert config["colors"] == list(COLORS) and config["max_seats"] == 2 and config["hand_size"] == HAND_SIZE
        assert config["reactions"] and config["sites"].keys() == set(COLORS)
        created = client.post("/api/rooms")
        assert created.status_code == 200
        code = created.json()["room"]
        assert isinstance(code, str) and len(code) == 5
        info = client.get(f"/api/rooms/{code}")
        assert info.status_code == 200 and info.json() == {"room": code, "status": "lobby", "players": 0}
        assert client.get(f"/api/rooms/{code.lower()}").json()["room"] == code
        assert client.get("/api/rooms/NOPE1").status_code == 404
        assert client.post("/api/rooms").json()["room"] != code


def test_websocket_handshake_and_a_short_game() -> None:
    with TestClient(create_app(delay_scale=0.0)) as client:
        code = client.post("/api/rooms").json()["room"]
        with client.websocket_connect(f"/ws/{code}") as ws:
            ws.send_json({"token": TOKENS[0], "name": "Ada"})
            welcome = ws.receive_json()
            assert welcome["type"] == "welcome" and welcome["you"]
            assert {b["key"] for b in welcome["bots"]} == set(REGISTRY)
            state = ws.receive_json()
            assert state["type"] == "state" and state["status"] == "lobby" and state["room"] == code
            assert state["you"] == {"member": welcome["you"], "seat": 0} and state["seats"][0]["name"] == "Ada"
            assert state["host"] == welcome["you"] and state["game"] is None
            ws.send_json({"type": "start"})
            assert ws.receive_json()["type"] == "error"  # one player is not enough
            ws.send_json({"type": "add_bot", "bot": BOT})
            msg = ws.receive_json()
            while msg["type"] != "state":
                msg = ws.receive_json()
            assert len(msg["seats"]) == 2
            ws.send_json({"type": "settings", "changes": {"rounds": 1}})
            ws.send_json({"type": "start"})
            ws.send_json({"type": "action", "action": {"type": "draw", "source": "deck"}})
            seen: list[dict[str, Any]] = []
            for _ in range(60):
                msg = ws.receive_json()
                seen.append(msg)
                if msg["type"] == "error":
                    break
            errors = [m for m in seen if m["type"] == "error"]
            assert errors, "an illegal draw should be rejected"
            games = [m["game"] for m in seen if m["type"] == "state" and m["game"]]
            assert games and len(games[0]["hand"]) == HAND_SIZE
            assert games[0]["hand_sizes"] == [HAND_SIZE, HAND_SIZE]
            assert any(m["type"] == "state" and m["status"] == "playing" for m in seen)
            # a non-dict message is ignored; the connection keeps working
            ws.send_json([1, 2, 3])
            ws.send_json({"type": "hint"})
            while (msg := ws.receive_json())["type"] not in ("error", "hint"):
                pass
            assert msg["type"] == "error"  # hints are off


def test_websocket_second_player_is_not_the_host() -> None:
    with TestClient(create_app(delay_scale=0.0)) as client:
        code = client.post("/api/rooms").json()["room"]
        with client.websocket_connect(f"/ws/{code}") as host, client.websocket_connect(f"/ws/{code}") as guest:
            host.send_json({"token": TOKENS[0], "name": "Ada"})
            host_welcome = host.receive_json()
            assert host_welcome["type"] == "welcome"
            guest.send_json({"token": TOKENS[1], "name": "Bob"})
            assert guest.receive_json()["type"] == "welcome"
            state = guest.receive_json()
            assert state["host"] == host_welcome["you"] and state["you"]["seat"] == 1
            assert [s["name"] for s in state["seats"]] == ["Ada", "Bob"]
            guest.send_json({"type": "start"})
            err = guest.receive_json()
            assert err["type"] == "error" and "host" in err["message"]
            host.send_json({"type": "start"})
            while (msg := guest.receive_json())["type"] != "state" or msg["status"] != "playing":
                pass
            assert _game(msg)["hand"] and len(_game(msg)["hand"]) == HAND_SIZE
            assert _game(msg)["legal"] == [] or msg["you"]["seat"] == _game(msg)["current"]


@pytest.mark.parametrize(
    "hello", [{"token": "short"}, {"token": "x" * 65}, {"name": "Ada"}, {"token": 12345678901234567}, [1]]
)
def test_websocket_bad_handshake_is_fatal(hello: Any) -> None:
    with TestClient(create_app(delay_scale=0.0)) as client:
        code = client.post("/api/rooms").json()["room"]
        with client.websocket_connect(f"/ws/{code}") as ws:
            ws.send_json(hello)
            msg = ws.receive_json()
            assert msg["type"] == "fatal" and msg["message"]
        assert client.get(f"/api/rooms/{code}").json()["players"] == 0  # nobody joined


def test_websocket_unknown_room_is_fatal() -> None:
    with TestClient(create_app(delay_scale=0.0)) as client, client.websocket_connect("/ws/ZZZZZ") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "fatal" and "exist" in msg["message"]
