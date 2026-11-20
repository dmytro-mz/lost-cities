#!/usr/bin/env node
// Online multiplayer server for Lost Cities. Zero dependencies.
// Serves the static client and runs rooms in memory. The game state is authoritative here and uses the very same
// rules module (js/game.js) as the browser. Clients long-poll for changes and send moves as POSTs. (Plain long
// polling because Cloudflare quick tunnels do not support Server-Sent Events.)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { newRound, playCard, drawCard, roundScore } from '../js/game.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_ROOMS = 300;
const GRACE_MS = 8000; // a seat counts as connected this long after its last poll
const POLL_MS = 25000;
const ROOM_TTL = 3 * 3600 * 1000; // idle time (nobody connected) before a table is dropped
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

class RoomError extends Error {}

class Room {
  constructor(code, rounds) {
    this.code = code;
    this.rounds = rounds === 1 ? 1 : 3;
    this.seats = [null, null]; // { token, name }
    this.waiters = new Set(); // pending long-polls: { seat, res, timer }
    this.lastSeen = [0, 0];
    this.lastConn = [false, false];
    this.rev = 0; // bumps on every visible change (move, join, presence)
    this.ticker = setInterval(() => this.presence(), 2000); // notices players that silently vanished
    this.ticker.unref();
    this.round = 0;
    this.totals = [0, 0];
    this.starter = 0;
    this.state = null;
    this.ready = [false, false];
    this.seq = 0;
    this.events = [];
    this.lastActive = Date.now();
  }

  seatOf(token) { return this.seats.findIndex((s) => s && s.token === token); }
  connected(seat) { return [...this.waiters].some((w) => w.seat === seat) || Date.now() - this.lastSeen[seat] < GRACE_MS; }
  get idleMs() { return this.waiters.size ? 0 : Date.now() - this.lastActive; }

  /** Wake everyone if somebody's connection status changed. */
  presence() {
    const now = [this.connected(0), this.connected(1)];
    if (now[0] !== this.lastConn[0] || now[1] !== this.lastConn[1]) { this.lastConn = now; this.broadcast(); }
  }

  /** Hold a poll until something changes (or ~25s pass). */
  poll(seat, res, rev) {
    this.lastSeen[seat] = Date.now(); this.lastActive = Date.now();
    this.maybeStart();
    this.presence();
    if (rev !== this.rev) return send(res, this.payload(seat));
    const w = { seat, res };
    w.timer = setTimeout(() => { this.waiters.delete(w); this.lastSeen[seat] = Date.now(); send(res, this.payload(seat)); }, POLL_MS);
    res.on('close', () => {
      clearTimeout(w.timer);
      if (this.waiters.delete(w)) {
        this.lastSeen[seat] = Date.now(); this.lastActive = Date.now();
      }
    });
    this.waiters.add(w);
  }

  join(token, name) {
    let seat = this.seatOf(token);
    if (seat < 0) {
      seat = this.seats.findIndex((s) => !s);
      if (seat < 0) throw new RoomError('This table is full');
      let n = cleanName(name) || `Player ${seat + 1}`;
      const other = this.seats[1 - seat];
      if (other && other.name === n) n = `${n} (2)`;
      this.seats[seat] = { token, name: n };
    }
    return seat;
  }

  maybeStart() {
    if (this.state || !this.seats[0] || !this.seats[1]) return;
    this.round = 1; this.totals = [0, 0]; this.starter = 0;
    this.state = newRound({ starter: 0 });
    this.events = []; this.seq++;
  }

  act(seat, msg) {
    this.lastActive = Date.now();
    const st = this.state;
    if (msg.type === 'leave') {
      if (!st) { this.seats[seat] = null; }
      return this.broadcast();
    }
    if (!st) throw new RoomError('Waiting for an opponent');
    if (msg.type === 'ready') {
      if (!st.over) throw new RoomError('Round is still running');
      this.ready[seat] = true;
      if (this.ready[0] && this.ready[1]) this.nextRound();
      return this.broadcast();
    }
    let ev;
    try {
      if (msg.type === 'play') {
        if (typeof msg.card !== 'string') throw new RoomError('Bad card');
        ev = playCard(st, seat, msg.card, msg.kind);
      } else if (msg.type === 'draw') {
        if (typeof msg.from !== 'string') throw new RoomError('Bad source');
        ev = drawCard(st, seat, msg.from);
      } else throw new RoomError('Unknown action');
    } catch (e) {
      throw e instanceof RoomError ? e : new RoomError(e.message);
    }
    this.events = [ev]; this.seq++;
    if (st.over) {
      const scores = [roundScore(st, 0), roundScore(st, 1)];
      this.totals = [this.totals[0] + scores[0], this.totals[1] + scores[1]];
      this.ready = [false, false];
    }
    this.broadcast();
  }

  nextRound() {
    const last = this.round >= this.rounds;
    if (last) { this.round = 1; this.totals = [0, 0]; this.starter = 0; }
    else { this.round++; this.starter = 1 - this.starter; }
    this.state = newRound({ starter: this.starter });
    this.ready = [false, false];
    this.events = []; this.seq++;
  }

  /** What a given seat may see: never the deck order or the other hand (until the round is over). */
  payload(seat) {
    const st = this.state;
    const o = 1 - seat;
    return {
      type: 'update',
      room: this.code, seat, seq: this.seq, rev: this.rev,
      names: this.seats.map((s, i) => (s ? s.name : null)),
      connected: [this.connected(0), this.connected(1)],
      rounds: this.rounds, round: this.round, totals: this.totals, ready: this.ready,
      started: !!st,
      view: st && {
        deck: st.deck.length,
        hand: st.hands[seat],
        oppHand: st.over ? st.hands[o] : st.hands[o].length,
        exp: st.exp, discard: st.discard, turn: st.turn, phase: st.phase, lastDiscard: st.lastDiscard, over: st.over,
      },
      events: this.events.map((e) => ({
        type: e.type, p: e.p, from: e.from,
        card: e.type === 'draw' && e.from === 'deck' && e.p !== seat ? null : e.card, // a card drawn blind stays private
      })),
    };
  }

  broadcast() {
    this.rev++;
    const ws = [...this.waiters]; this.waiters.clear();
    for (const w of ws) { clearTimeout(w.timer); this.lastSeen[w.seat] = Date.now(); send(w.res, this.payload(w.seat)); }
  }
}

const cleanName = (n) => (typeof n === 'string' ? n.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) : '');
const send = (res, obj) => { try { json(res, 200, obj); } catch { /* connection gone */ } };
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const validToken = (t) => typeof t === 'string' && t.length >= 16 && t.length <= 64;

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new RoomError('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new RoomError('Bad JSON')); } });
    req.on('error', reject);
  });
}

export function createServer({ log = () => {} } = {}) {
  const rooms = new Map();

  const sweep = setInterval(() => {
    for (const [code, room] of rooms) if (room.idleMs > ROOM_TTL) { clearInterval(room.ticker); rooms.delete(code); log(`table ${code} dropped`); }
  }, 60000);
  sweep.unref();

  function createRoom(rounds) {
    if (rooms.size >= MAX_ROOMS) throw new RoomError('Too many tables open, try again later');
    let code;
    do code = Array.from(crypto.randomBytes(5), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(''); while (rooms.has(code));
    const room = new Room(code, rounds);
    rooms.set(code, room);
    return room;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      let m;
      if (req.method === 'GET' && p === '/api/ping') return json(res, 200, { ok: true, rooms: rooms.size });
      if (req.method === 'POST' && p === '/api/rooms') {
        const body = await readBody(req);
        const room = createRoom(body.rounds);
        log(`table ${room.code} created`);
        return json(res, 200, { room: room.code });
      }
      if ((m = p.match(/^\/api\/rooms\/([A-Za-z0-9]{3,8})$/)) && req.method === 'GET') {
        const room = rooms.get(m[1].toUpperCase());
        if (!room) return json(res, 404, { error: 'No table with that code' });
        const token = url.searchParams.get('token');
        const seated = validToken(token) && room.seatOf(token) >= 0;
        return json(res, 200, { room: room.code, full: !room.seats.includes(null), seated, started: !!room.state });
      }
      if ((m = p.match(/^\/api\/rooms\/([A-Za-z0-9]{3,8})\/poll$/)) && req.method === 'GET') {
        const room = rooms.get(m[1].toUpperCase());
        const token = url.searchParams.get('token');
        if (!room) return json(res, 404, { error: 'No table with that code' });
        if (!validToken(token)) return json(res, 400, { error: 'Bad token' });
        let seat;
        try { seat = room.join(token, url.searchParams.get('name')); } catch (e) { return json(res, 409, { error: e.message }); }
        return room.poll(seat, res, Number(url.searchParams.get('rev')));
      }
      if ((m = p.match(/^\/api\/rooms\/([A-Za-z0-9]{3,8})\/act$/)) && req.method === 'POST') {
        const room = rooms.get(m[1].toUpperCase());
        if (!room) return json(res, 404, { error: 'No table with that code' });
        const body = await readBody(req);
        const seat = validToken(body.token) ? room.seatOf(body.token) : -1;
        if (seat < 0) return json(res, 403, { error: 'You are not seated at this table' });
        room.act(seat, body);
        return json(res, 200, { ok: true });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed' });
      return serveStatic(p, res);
    } catch (e) {
      if (e instanceof RoomError) return json(res, 400, { error: e.message });
      log(`error: ${e.stack || e}`);
      return json(res, 500, { error: 'Server error' });
    }
  });
  server.rooms = rooms;
  server.on('close', () => { clearInterval(sweep); for (const r of rooms.values()) clearInterval(r.ticker); });
  return server;
}

function serveStatic(p, res) {
  let rel;
  try { rel = decodeURIComponent(p); } catch { rel = ''; }
  const invite = /^\/r\/[A-Za-z0-9]{3,8}$/.test(rel);
  if (rel === '/' || invite) rel = '/index.html';
  const ok = rel === '/index.html' || /^\/(css|js|docs)\/[\w.-]+$/.test(rel);
  const file = path.join(ROOT, rel);
  if (!ok || !file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  if (invite) { // invite links live under /r/, so make the page's relative URLs resolve from the root
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(file, 'utf8').replace('<head>', '<head>\n<base href="/">'));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// ---------- CLI ----------
function startTunnel(port) {
  return new Promise((resolve, reject) => {
    const proc = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('cloudflared did not report a public URL in time')); }, 30000);
    const onData = (buf) => {
      const m = buf.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) { clearTimeout(timer); resolve({ proc, url: m[0] }); }
    };
    proc.stdout.on('data', onData); proc.stderr.on('data', onData);
    proc.on('error', (e) => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? '--tunnel needs cloudflared: `brew install cloudflared`' : e.message)); });
    proc.on('exit', (c) => { clearTimeout(timer); reject(new Error(`cloudflared exited (${c})`)); });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node server/server.js [--port 8000] [--tunnel] [--lan]\n  --tunnel  open a public cloudflared tunnel (trycloudflare.com) and print the link\n  --lan     listen on all interfaces so people on your Wi-Fi can join');
    return;
  }
  const port = Number(opt('--port', 8000));
  const lan = args.includes('--lan');
  const server = createServer({ log: (m) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`) });
  await new Promise((r, j) => { server.once('error', j); server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', r); });
  console.log(`\n  Lost Cities server running\n  local:   http://localhost:${port}`);
  if (lan) {
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  network: http://${a.address}:${port}`);
  }
  if (args.includes('--tunnel')) {
    try {
      const { proc, url } = await startTunnel(port);
      const stop = () => { proc.kill(); process.exit(0); };
      process.on('SIGINT', stop); process.on('SIGTERM', stop); process.on('exit', () => proc.kill());
      console.log(`  public:  ${url}   <- open this one, create a table and send the invite link\n`);
    } catch (e) { console.error(`\n  ${e.message}`); process.exit(1); }
  } else console.log('\n  Add --tunnel to invite friends over the internet.\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
