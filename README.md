# Lost Cities: in the browser

A browser version of the two-player card game *Lost Cities*. Play against a computer opponent, or play a friend over the internet through a small server on your own PC
(with a Cloudflare tunnel). No build step and no dependencies: plain HTML, CSS and JavaScript.

![A game in progress](docs/screenshot.png)

## Play

**Against the computer**: no server needed. Open the GitHub Pages site (https://dmytro-mz.github.io/lost-cities/) or serve the
folder with any static server.

**Online with a friend**: run the small Node server on your PC (Node 20+, no dependencies to install):

```bash
node server/server.js --tunnel     # or: npm run tunnel
```

It prints a public `trycloudflare.com` link (needs [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/),
`brew install cloudflared`). Open that link, choose **Online with a friend → Create a table**, and send the invite
link to your opponent. The game starts as soon as they open it.

| Command | Who can join |
| --- | --- |
| `node server/server.js` | Only you (`http://localhost:8000`), good for trying it out |
| `node server/server.js --lan` | People on the same Wi-Fi, through the network link printed at startup |
| `node server/server.js --tunnel` | Anyone, through a temporary public `trycloudflare.com` link |

Add `--port 9000` to change the port. Tables live in memory and disappear after 3 hours without players.

## Features

- **The full two-player rules**: 60 cards (5 sites × 3 wagers + numbers 2–10), 8-card hands, play-then-draw turns,
  ascending expeditions, wagers before numbers, no taking back the card you just discarded, the round ends when the
  last card is drawn, scoring with −20 per expedition, wager multipliers and the +20 bonus for 8+ cards.
- **Vs the computer** at three levels (Easy / Medium / Hard).
- **Online play** over the internet: create a table, share the link, play. Players can reconnect to their seat
  (refresh, lost Wi-Fi), the tab title shows when it's your turn, and the server checks every move, so the
  opponent's hand and the deck order never leave the server.
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
npm test     # rules, scoring, bot self-play and full online-round tests (Node 20+)
```

- `js/game.js`: pure rules and scoring, shared by the browser and the server
- `js/bot.js`: heuristic opponent (it only uses information a human player could see)
- `js/art.js`: SVG card art
- `js/app.js`: UI, game flow and the online client
- `server/server.js`: static files + rooms. Clients long-poll `/api/rooms/:code/poll` and send moves with `POST
  /api/rooms/:code/act`. Long polling is used on purpose: Cloudflare quick tunnels don't support Server-Sent Events.

Lost Cities is a game by Reiner Knizia. This is an unofficial fan implementation for personal use, with no
affiliation to the publisher; all artwork here is original.

## License

MIT
