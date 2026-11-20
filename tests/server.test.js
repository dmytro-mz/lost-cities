import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server/server.js';
import { chooseMove, chooseDraw } from '../js/bot.js';

async function start() {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/** Minimal long-poll client: keeps the latest payload. */
async function connect(base, code, token, name) {
  const ctrl = new AbortController();
  const c = { latest: null, waiters: [], ctrl, rev: -1 };
  const first = await fetch(`${base}/api/rooms/${code}/poll?token=${token}&name=${name}&rev=-1`);
  if (first.status !== 200) { c.status = first.status; return c; }
  c.latest = await first.json(); c.rev = c.latest.rev; c.status = 200;
  (async () => {
    while (!ctrl.signal.aborted) {
      try {
        const m = await (await fetch(`${base}/api/rooms/${code}/poll?token=${token}&name=${name}&rev=${c.rev}`, { signal: ctrl.signal })).json();
        if (m.rev !== c.rev) { c.rev = m.rev; c.latest = m; c.waiters.splice(0).forEach((w) => w()); }
      } catch { /* aborted */ }
    }
  })();
  c.until = async (pred) => { for (let n = 0; n < 400; n++) { if (c.latest && pred(c.latest)) return c.latest; await new Promise((r) => { c.waiters.push(r); setTimeout(r, 50); }); } throw new Error('timeout'); };
  return c;
}
const post = (base, path, body) => fetch(base + path, { method: 'POST', body: JSON.stringify(body) });
const tok = (c) => c.repeat(16);

test('two players play a full round online; hidden info stays hidden', async () => {
  const { server, base } = await start();
  const { room } = await (await post(base, '/api/rooms', { rounds: 1 })).json();
  const A = await connect(base, room, tok('a'), 'Ann');
  await A.until((m) => m.seat === 0 && !m.started);
  const B = await connect(base, room, tok('b'), 'Bob');
  const [ma, mb] = await Promise.all([A.until((m) => m.started), B.until((m) => m.started)]);
  assert.equal(mb.seat, 1);
  assert.deepEqual(ma.names, ['Ann', 'Bob']);
  assert.equal(ma.view.hand.length, 8);
  assert.equal(typeof ma.view.oppHand, 'number');
  assert.equal(typeof ma.view.deck, 'number');

  // third player is refused
  const C = await connect(base, room, tok('c'), 'Cy');
  assert.equal(C.status, 409);
  // not your turn / bad action
  const wrong = await post(base, `/api/rooms/${room}/act`, { token: tok('b'), type: 'play', card: mb.view.hand[0].id, kind: 'discard' });
  assert.equal(wrong.status, 400);
  const stranger = await post(base, `/api/rooms/${room}/act`, { token: tok('z'), type: 'draw', from: 'deck' });
  assert.equal(stranger.status, 403);

  // play the round out with the bot brains, each side acting on its own view only
  const clients = [A, B], tokens = [tok('a'), tok('b')];
  let guard = 0, seq = ma.seq;
  const both = (pred) => Promise.all(clients.map((c) => c.until(pred)));
  while (true) {
    const [m0] = await both((x) => x.seq >= seq);
    if (m0.view.over) break;
    const seat = m0.view.turn, c = clients[seat];
    const m = await c.until((x) => x.seq >= seq);
    const st = { hands: [[], []], exp: m.view.exp, discard: m.view.discard, deck: Array(m.view.deck), turn: seat, lastDiscard: m.view.lastDiscard };
    st.hands[seat] = m.view.hand; st.hands[1 - seat] = Array(m.view.oppHand).fill({ id: 'x', color: 'red', value: 0 });
    const mv = chooseMove(st, seat, 'medium');
    let rs = await post(base, `/api/rooms/${room}/act`, { token: tokens[seat], type: 'play', card: mv.card.id, kind: mv.kind });
    assert.equal(rs.status, 200, await rs.clone().text());
    seq++;
    await both((x) => x.seq >= seq);
    const after = await c.until((x) => x.seq >= seq);
    st.discard = after.view.discard; st.lastDiscard = after.view.lastDiscard; st.hands[seat] = after.view.hand; st.exp = after.view.exp;
    const src = chooseDraw(st, seat, 'medium');
    rs = await post(base, `/api/rooms/${room}/act`, { token: tokens[seat], type: 'draw', from: src });
    assert.equal(rs.status, 200, await rs.clone().text());
    seq++;
    assert.ok(++guard < 200);
  }
  const fin = await A.until((m) => m.view.over);
  assert.ok(Array.isArray(fin.view.oppHand), 'opponent hand revealed after the round');
  assert.equal(fin.totals.length, 2);
  assert.equal(fin.events.at(-1).type, 'draw');

  // rematch needs both
  await post(base, `/api/rooms/${room}/act`, { token: tok('a'), type: 'ready' });
  const waiting = await B.until((m) => m.ready[0]);
  assert.ok(waiting.view.over);
  await post(base, `/api/rooms/${room}/act`, { token: tok('b'), type: 'ready' });
  const fresh = await A.until((m) => !m.view.over);
  assert.equal(fresh.view.deck, 44);
  A.ctrl.abort(); B.ctrl.abort(); server.closeAllConnections(); server.close();
});

test('reconnect keeps the seat; static files are safe', async () => {
  const { server, base } = await start();
  const { room } = await (await post(base, '/api/rooms', {})).json();
  const A = await connect(base, room, tok('a'), 'Ann');
  const B = await connect(base, room, tok('b'), 'Bob');
  await B.until((m) => m.started);
  A.ctrl.abort();
  const gone = await B.until((m) => m.connected[0] === false);
  assert.equal(gone.connected[1], true);
  const A2 = await connect(base, room, tok('a'), 'Other');
  const back = await A2.until((m) => m.started);
  assert.equal(back.seat, 0);
  assert.equal(back.names[0], 'Ann');
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/r/${room}`)).status, 200);
  assert.equal((await fetch(`${base}/js/game.js`)).status, 200);
  assert.equal((await fetch(`${base}/server/server.js`)).status, 404);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
  assert.equal((await fetch(`${base}/css/..%2Fserver%2Fserver.js`)).status, 404);
  assert.equal((await fetch(`${base}/api/rooms/NOPE1`)).status, 404);
  A2.ctrl.abort(); B.ctrl.abort(); server.closeAllConnections(); server.close();
});
