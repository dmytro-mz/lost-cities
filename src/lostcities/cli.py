from __future__ import annotations

import logging
import subprocess
import time
from concurrent.futures import ProcessPoolExecutor
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(add_completion=False, help="Lost Cities: web game and bots")
console = Console()


def _match(args: tuple[str, str, int, int]) -> tuple[list[int], list[int]]:
    from lostcities.bots import make_bot
    from lostcities.runner import play_game

    a, b, rounds, seed = args
    game = play_game([make_bot(a, seed * 2), make_bot(b, seed * 2 + 1)], rounds=rounds, seed=seed, starter=seed % 2)
    assert game.result is not None
    return game.result.totals, game.result.winners


@app.command("eval")
def eval_cmd(
    bots: Annotated[str, typer.Option("-a", help="Two bot keys, e.g. pathfinder,scout")] = "pathfinder,scout",
    games: Annotated[int, typer.Option("-n", help="Number of matches")] = 1000,
    rounds: Annotated[int, typer.Option(help="Rounds per match")] = 3,
    workers: int = 8,
) -> None:
    """Head-to-head matches (the starting player alternates): win rate and mean score per bot."""
    keys = [k.strip() for k in bots.split(",") if k.strip()]
    if len(keys) != 2:
        raise typer.BadParameter("give exactly two bots")
    wins = [0.0, 0.0]
    totals = [0, 0]
    started = time.time()
    with ProcessPoolExecutor(workers) as ex:
        for score, winners in ex.map(_match, [(keys[0], keys[1], rounds, s) for s in range(games)], chunksize=16):
            for w in winners:
                wins[w] += 1 / len(winners)
            totals[0] += score[0]
            totals[1] += score[1]
    table = Table(title=f"{games} matches of {rounds} rounds · {time.time() - started:.1f}s")
    for col in ("bot", "win rate", "± 95%", "mean score"):
        table.add_column(col)
    for i, key in enumerate(keys):
        p = wins[i] / games
        table.add_row(key, f"{p:.3f}", f"{1.96 * (p * (1 - p) / games) ** 0.5:.3f}", f"{totals[i] / games:.1f}")
    console.print(table)


def _lan_ip() -> str | None:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("10.255.255.255", 1))  # no packet is sent; picks the outbound interface
            ip = s.getsockname()[0]
        except OSError:
            return None
    return None if ip.startswith("127.") else ip


def _start_tunnel(port: int) -> tuple[subprocess.Popen[str], str]:
    import re
    import shutil

    exe = shutil.which("cloudflared")
    if exe is None:
        raise typer.BadParameter("--tunnel needs cloudflared: `brew install cloudflared`")
    proc = subprocess.Popen(
        [exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert proc.stderr is not None
    pattern = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
    deadline = time.time() + 30
    for line in proc.stderr:
        if match := pattern.search(line):
            return proc, match.group(0)
        if time.time() > deadline:
            break
    proc.terminate()
    raise typer.BadParameter("cloudflared did not report a public URL")


@app.command()
def serve(
    host: Annotated[str, typer.Option(help="Interface to bind; 0.0.0.0 lets your LAN join")] = "0.0.0.0",
    port: int = 8000,
    public_url: Annotated[str | None, typer.Option(help="Base URL used in invite links")] = None,
    tunnel: Annotated[bool, typer.Option(help="Open a public cloudflared tunnel and invite through it")] = False,
) -> None:
    """Host the multiplayer web game. Share the table link; your opponent joins from their browser."""
    import uvicorn

    from lostcities.bots import REGISTRY
    from lostcities.web.server import create_app

    ip = _lan_ip() if host == "0.0.0.0" else None
    lan_url = f"http://{ip}:{port}" if ip else None
    proc = None
    if tunnel:
        proc, public_url = _start_tunnel(port)
    console.print("[bold yellow]Lost Cities server[/]")
    console.print(f"  local:   http://localhost:{port}")
    if lan_url:
        console.print(f"  network: {lan_url}   (same Wi-Fi / LAN)")
    if public_url:
        console.print(f"  public:  {public_url}")
    elif not lan_url:
        console.print("[dim]  bind --host 0.0.0.0 or use --tunnel to invite people from other machines")
    console.print(f"  bots:    {', '.join(b.label for b in REGISTRY.values())}")
    console.print("[dim]  table activity is logged below (Ctrl+C to stop)\n")
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s  %(message)s", datefmt="%H:%M:%S"))
    web_log = logging.getLogger("lostcities.web")
    web_log.addHandler(handler)
    web_log.setLevel(logging.INFO)
    web_log.propagate = False
    try:
        uvicorn.run(create_app(public_url=public_url, lan_url=lan_url), host=host, port=port, log_level="warning")
    finally:
        if proc is not None:
            proc.terminate()


def main() -> None:
    app()
