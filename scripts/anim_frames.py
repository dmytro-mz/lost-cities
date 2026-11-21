"""Film the card animations in slow motion: we play, discard and draw, the bot answers; frames go to shots/anim/.

uv run python scripts/anim_frames.py [--size 1440x900] [--rate 0.1] [--every 150] [--turns 20] [--discard]
"""

from __future__ import annotations

import argparse
import asyncio
import shutil
from pathlib import Path

from demo import TOKEN, prepare, serving
from playwright.async_api import Page, async_playwright

from lostcities.web.server import create_app

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT = Path("shots/anim")


class Film:
    def __init__(self, page: Page, every: int) -> None:
        self.page, self.every, self.n = page, every, 0

    async def roll(self, label: str, ms: int) -> None:
        for _ in range(max(1, ms // self.every)):
            self.n += 1
            await self.page.screenshot(path=str(OUT / f"{self.n:03d}_{label}.png"))
            await self.page.wait_for_timeout(self.every)


async def run(args: argparse.Namespace) -> None:
    room = prepare("play", args.turns, args.seed)
    room.delay_scale = 1.0
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)
    async with serving(create_app(), room, args.port) as url, async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=CHROME)
        w, h = (int(x) for x in args.size.split("x"))
        page = await browser.new_page(viewport={"width": w, "height": h})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        await page.goto(url)
        await page.wait_for_selector("#hand.active .card")
        await page.wait_for_timeout(800)
        cdp = await page.context.new_cdp_session(page)
        await cdp.send("Animation.enable")
        await cdp.send("Animation.setPlaybackRate", {"playbackRate": args.rate})
        film = Film(page, args.every)
        slow = int(600 / args.rate)
        # Our play: the first card that can go on an expedition, else a discard.
        cards = page.locator("#hand.active .card")
        played = False
        for i in range(0 if args.discard else await cards.count()):
            await cards.nth(i).click()
            if await page.locator(".lane.target").count():
                await page.locator(".lane.target").first.click()
                played = True
                break
        if not played:
            await cards.first.click()
            await page.locator(".slot.target").first.click()
        await film.roll("me-play", slow)
        await page.locator("#deck").click()
        await film.roll("me-draw", slow)
        # The bot: wait for its play and its draw, filming throughout.
        seq = room.seq
        for _ in range(400):
            if room.seq >= seq + 1:
                break
            await page.wait_for_timeout(25)
        await film.roll("bot-play", slow)
        for _ in range(400):
            if room.seq >= seq + 2:
                break
            await page.wait_for_timeout(25)
        await film.roll("bot-draw", slow)
        await browser.close()
        for e in errors:
            print("pageerror:", e)
    print(f"{film.n} frames in {OUT}/  (token {TOKEN[:4]}…)")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", default="1440x900")
    ap.add_argument("--rate", type=float, default=0.1)
    ap.add_argument("--every", type=int, default=150)
    ap.add_argument("--turns", type=int, default=20)
    ap.add_argument("--seed", type=int, default=3)
    ap.add_argument("--port", type=int, default=8981)
    ap.add_argument("--discard", action="store_true", help="discard instead of playing")
    asyncio.run(run(ap.parse_args()))


if __name__ == "__main__":
    main()
