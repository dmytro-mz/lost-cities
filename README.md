# Lost Cities: in the browser

A browser version of the two-player card game *Lost Cities*. Play against a computer opponent, or share one device
with a friend. No build step, no dependencies: plain HTML, CSS and JavaScript modules.

![A game in progress](docs/screenshot.png)

## Play

Live: https://dmytro-mz.github.io/lost-cities/ (once GitHub Pages has finished deploying)

Or run it locally. ES modules need an HTTP server, so double-clicking `index.html` won't work:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Features

- **The full two-player rules**: 60 cards (5 sites × 3 wagers + numbers 2–10), 8-card hands, play-then-draw turns,
  ascending expeditions, wagers before numbers, no taking back the card you just discarded, the round ends when the
  last card is drawn, scoring with −20 per expedition, wager multipliers and the +20 bonus for 8+ cards.
- **Vs the computer** at three levels (Easy / Medium / Hard), or **two players on one device** with a "pass the
  device" screen that hides hands between turns.
- **Single round or best of 3** with a per-expedition score breakdown at the end of each round.
- **Original card art**: hand-drawn SVG landscapes for the five sites (desert, sea, Himalaya, jungle, volcano),
  styled after the classic look without copying it.
- Live score tags per expedition, glowing drop targets, click / double-click / drag-and-drop controls.

## How to play (short)

On your turn, **play** a card (onto your expedition of that colour, or onto that colour's discard pile in the middle),
then **draw** one (from the deck or the top of a discard pile). Expeditions must ascend. Each expedition you start
costs 20 points, so only start ones you can finish.

## Development

```bash
node --test tests/     # rules, scoring, and bot self-play tests (Node 18+)
```

- `js/game.js`: pure rules and scoring
- `js/bot.js`: heuristic opponent (it only uses information a human player could see)
- `js/art.js`: SVG card art
- `js/app.js`: UI and game flow

Lost Cities is a game by Reiner Knizia. This is an unofficial fan implementation for personal use, with no
affiliation to the publisher; all artwork here is original.

## License

MIT
