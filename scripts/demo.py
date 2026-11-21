"""Serve a pre-played table and screenshot it (visual checks during development).

uv run python scripts/demo.py [--stage home|lobby|play|draw|round|over] [--turns 14] [--size 1440x900]
                              [--out shots/game.png] [--serve] [--spectator]
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import sys
from collections.abc import AsyncIterator
from pathlib import Path

import uvicorn
from fastapi import FastAPI

from lostcities.game.engine import Phase
from lostcities.web.room import Room
from lostcities.web.server import create_app

TOKEN = "d" * 32
PORT = 8765


def prepare(stage: str = "play", turns: int = 14, seed: int = 3, bot: str = "pathfinder") -> Room:
    """A room with one human ("Dima", token TOKEN) and a bot, fast-forwarded to `stage`."""
    room = Room("DEMO", delay_scale=0.0, seed=seed)
    me = room.join(TOKEN, "Dima")
    room.handle(me.id, {"type": "add_bot", "bot": bot})
    if stage == "lobby":
        return room
    room.handle(me.id, {"type": "start"})
    seat = room.seat_of(me.id)
    game = room.game
    assert seat is not None and game is not None
    room.seats[seat].autoplay = True
    if stage in ("round", "over"):
        rounds_left = 1 if stage == "round" else game.rounds
        while room.status != "game_over" and len(game.history) < rounds_left:
            plan = room.plan()
            assert plan is not None
            plan[1]()
        room.seats[seat].autoplay = False
        room.seats[seat].ready = False
        room.delay_scale = 1.0  # don't let the driver skip the round summary
        return room
    while room.status == "playing" and game.turn < turns:
        room.plan()[1]()  # type: ignore[index]
    room.seats[seat].autoplay = False
    want = Phase.DRAW if stage == "draw" else Phase.PLAY
    while room.status == "playing" and (game.current != seat or game.phase != want):
        if game.current == seat:  # our play step, done by the autopilot to reach the draw step
            room._auto_move(seat)
        else:
            room.plan()[1]()  # type: ignore[index]
    return room


@contextlib.asynccontextmanager
async def serving(app: FastAPI, room: Room, port: int = PORT) -> AsyncIterator[str]:
    """Run the app in this event loop with `room` adopted; yields the player's personal URL."""
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.05)
    app.state.manager.adopt(room)
    try:
        yield f"http://127.0.0.1:{port}/r/{room.id}?me={TOKEN}"
    finally:
        server.should_exit = True
        await task


async def run(args: argparse.Namespace) -> None:
    room = prepare(args.stage, args.turns, args.seed)
    app = create_app()
    async with serving(app, room, args.port) as url:
        w, h = args.size.split("x")
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        shot = Path(__file__).with_name("shot.py")
        target = url
        if args.stage == "home":
            target = url.split("/r/")[0] + "/"
        elif args.spectator:
            target = url.split("?")[0]
        proc = await asyncio.create_subprocess_exec(sys.executable, str(shot), target, args.out, w, h)
        await proc.wait()
        if args.serve:
            print(f"serving {url}  (Ctrl+C to stop)")
            await asyncio.Event().wait()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--turns", type=int, default=14)
    ap.add_argument("--stage", default="play", choices=["play", "draw", "round", "over", "lobby", "home"])
    ap.add_argument("--size", default="1440x900")
    ap.add_argument("--out", default="shots/game.png")
    ap.add_argument("--serve", action="store_true", help="keep serving after the screenshot")
    ap.add_argument("--spectator", action="store_true", help="open the table as a fresh visitor")
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--port", type=int, default=PORT)
    asyncio.run(run(ap.parse_args()))


if __name__ == "__main__":
    main()
