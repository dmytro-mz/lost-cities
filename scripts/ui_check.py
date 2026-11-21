"""Click through a whole match against a bot in Chrome and fail on any JS error or a stuck table.

uv run python scripts/ui_check.py [--rounds 3] [--size 1280x800] [--headed]
"""

from __future__ import annotations

import argparse
import asyncio
import random
import sys
from pathlib import Path

from playwright.async_api import ConsoleMessage, Page, async_playwright

sys.path.insert(0, str(Path(__file__).parent))
from demo import TOKEN, serving

from lostcities.web.room import Room
from lostcities.web.server import create_app

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


async def visible(page: Page, selector: str) -> bool:
    loc = page.locator(selector)
    return await loc.count() > 0 and await loc.first.is_visible()


async def my_move(page: Page, rng: random.Random) -> bool:
    """One click-level step of our turn; False if there was nothing to do."""
    if await visible(page, ".backdrop .btn.primary:not([disabled])"):
        await page.locator(".backdrop .btn.primary:not([disabled])").first.click()
        return True
    status = (
        await page.locator(".status-line").first.get_attribute("class") if await visible(page, ".status-line") else ""
    )
    if "mine" not in (status or ""):
        return False
    drawables = page.locator(".deck.drawable, .slot.drawable")
    if await drawables.count():
        await drawables.nth(rng.randrange(await drawables.count())).click()
        return True
    cards = page.locator("#hand.active .card")
    n = await cards.count()
    if not n:
        return False
    await cards.nth(rng.randrange(n)).click()
    await page.wait_for_timeout(40)
    lane = page.locator(".lane.target")
    if await lane.count() and rng.random() < 0.7:
        await lane.first.click()
    elif await visible(page, ".slot.target"):
        await page.locator(".slot.target").first.click()
    else:
        return False
    return True


async def run(args: argparse.Namespace) -> int:
    room = Room("UICHK", delay_scale=0.05, seed=args.seed)
    me = room.join(TOKEN, "Tester")
    room.handle(me.id, {"type": "add_bot", "bot": "pathfinder"})
    room.handle(me.id, {"type": "settings", "changes": {"rounds": args.rounds, "bot_speed": "fast", "hints": True}})
    errors: list[str] = []
    rng = random.Random(args.seed)
    app = create_app(delay_scale=0.05)
    async with serving(app, room, args.port) as url, async_playwright() as pw:
        browser = await pw.chromium.launch(executable_path=CHROME, headless=not args.headed)
        w, h = (int(x) for x in args.size.split("x"))
        page = await browser.new_page(viewport={"width": w, "height": h}, reduced_motion="reduce")
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        def console(m: ConsoleMessage) -> None:
            if m.type == "error":
                errors.append(f"console: {m.text}")

        page.on("console", console)
        await page.goto(url)
        await page.wait_for_selector(".lobby")
        await page.locator(".lobby-actions .btn.primary").click()
        await page.wait_for_selector("#game")
        await page.keyboard.press("h")  # a hint must not break anything
        idle = 0
        for _ in range(4000):
            if room.status == "game_over":
                break
            acted = await my_move(page, rng)
            idle = 0 if acted else idle + 1
            if idle > 300:
                errors.append(f"stuck: status={room.status} phase={room.game and room.game.phase}")
                break
            await page.wait_for_timeout(60 if acted else 50)
        await page.wait_for_selector(".backdrop .modal", timeout=8000)
        Path("shots").mkdir(exist_ok=True)
        await page.screenshot(path="shots/ui_check_end.png")
        await browser.close()
    if room.status != "game_over":
        errors.append(f"match did not finish (status {room.status})")
    for e in errors:
        print(e)
    totals = room.game.totals if room.game else None
    print("ok" if not errors else "FAILED", f"· final totals {totals}")
    return 1 if errors else 0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--size", default="1280x800")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--port", type=int, default=8771)
    ap.add_argument("--headed", action="store_true")
    sys.exit(asyncio.run(run(ap.parse_args())))


if __name__ == "__main__":
    main()
