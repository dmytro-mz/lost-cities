import {
  COLORS, SITES, newRound, canPlayOn, playCard, drawCard, findInHand, sortHand,
  roundScore, expeditionScore, breakdown, legalDraws,
} from './game.js';
import { chooseMove, chooseDraw } from './bot.js';
import { defsSVG, cardSVG, backSVG, emblemSVG, PALETTE } from './art.js';

const CH = 118, ZONE_H = 252;
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

$('#defs').innerHTML = defsSVG();

// ---------- settings & match state ----------
const DEFAULTS = { mode: 'bot', level: 'medium', rounds: 3, name: '' };
let cfg = { ...DEFAULTS };
try { cfg = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('lostcities.cfg') || '{}') }; } catch {}
if (cfg.mode === 'hotseat') cfg.mode = 'bot';
const saveCfg = () => { try { localStorage.setItem('lostcities.cfg', JSON.stringify(cfg)); } catch {} };

let match = null;     // { cfg, round, totals, starter, names, seat }
let state = null;     // current round (same shape as game.js; online it is rebuilt from the server's view)
let ui = null;        // { selected, busy, pending, marks, log }
let botRun = 0;
let net = null;       // online connection: { code, token, es, seq, connected, ready, started }

const online = () => match.cfg.mode === 'online';
const view = () => match.seat || 0;

// ---------- local game vs bot ----------
function startMatch() {
  leaveOnline();
  const names = [cfg.name.trim() || 'You', 'Bot'];
  match = { cfg: { ...cfg }, round: 1, totals: [0, 0], starter: 0, names, seat: 0 };
  startRound();
}

function startRound() {
  botRun++;
  state = newRound({ starter: match.starter });
  ui = freshUi();
  closeOverlay();
  log(`Round ${match.round} begins: ${match.names[state.turn]} to start.`);
  render();
  if (state.turn === 1) runBot();
}

const freshUi = () => ({ selected: null, busy: false, pending: false, marks: { cards: new Set(), piles: new Set() }, log: [] });

function afterTurn() {
  if (state.over) return endRound();
  runBot();
}

function endRound() {
  const scores = [roundScore(state, 0), roundScore(state, 1)];
  match.totals[0] += scores[0]; match.totals[1] += scores[1];
  ui.summary = { scores, last: match.round >= match.cfg.rounds };
  render();
  setTimeout(showSummary, 700);
}

async function runBot() {
  const id = ++botRun;
  ui.busy = true; ui.marks = { cards: new Set(), piles: new Set() }; render();
  await sleep(700); if (id !== botRun) return;
  if (state.phase === 'play') {
    const mv = chooseMove(state, 1, match.cfg.level);
    const e1 = playCard(state, 1, mv.card.id, mv.kind);
    ui.marks.cards.add(mv.card.id);
    log(`${match.names[1]} ${e1.type === 'play' ? 'played' : 'discarded'} ${cname(mv.card)}.`);
    render();
    await sleep(850); if (id !== botRun) return;
  }
  const src = chooseDraw(state, 1, match.cfg.level);
  const top = src === 'deck' ? null : state.discard[src][state.discard[src].length - 1];
  drawCard(state, 1, src);
  if (src !== 'deck') ui.marks.piles.add(src);
  log(src === 'deck' ? `${match.names[1]} drew from the deck.` : `${match.names[1]} took ${cname(top)} from the discards.`);
  ui.busy = false;
  if (state.over) return endRound();
  render();
}

// ---------- human actions ----------
const myTurn = () => state && match && !state.over && !ui.busy && !ui.pending && state.turn === view() && (!online() || net?.started);

function onTarget(t) {
  if (!myTurn()) return;
  const p = view();
  if (state.phase === 'play') {
    if (!ui.selected) return toast('Pick a card from your hand first');
    const card = findInHand(state, p, ui.selected);
    if (!card) return;
    if (t === `exp:${card.color}`) {
      if (!canPlayOn(state.exp[p][card.color], card)) return toast(card.value === 0 ? 'Wagers must come before any number in an expedition' : 'Expedition cards must go up: play a higher number');
      commitPlay(card, 'expedition');
    } else if (t === `disc:${card.color}`) commitPlay(card, 'discard');
    else if (t !== 'deck') toast(`That card belongs to the ${card.color} column`);
  } else {
    if (t === 'deck') commitDraw('deck');
    else if (t.startsWith('disc:')) {
      const col = t.slice(5);
      if (col === state.lastDiscard) return toast("You can't pick up the card you just discarded");
      if (!state.discard[col].length) return toast('That discard pile is empty');
      commitDraw(col);
    }
  }
}

function commitPlay(card, kind) {
  ui.selected = null;
  if (online()) return send({ type: 'play', card: card.id, kind });
  ui.marks = { cards: new Set(), piles: new Set() };
  playCard(state, 0, card.id, kind);
  log(`${match.names[0]} ${kind === 'discard' ? 'discarded' : 'played'} ${cname(card)}.`);
  render();
}

function commitDraw(src) {
  ui.selected = null;
  if (online()) return send({ type: 'draw', from: src });
  const top = src === 'deck' ? null : state.discard[src][state.discard[src].length - 1];
  drawCard(state, 0, src);
  log(src === 'deck' ? `${match.names[0]} drew from the deck.` : `${match.names[0]} took ${cname(top)} from the discards.`);
  afterTurn();
}

function select(id) {
  if (!myTurn() || state.phase !== 'play') return;
  ui.selected = ui.selected === id ? null : id;
  syncSelection();
}

// ---------- online ----------
const tokenKey = 'lostcities.token';
function myToken() {
  let t = null;
  try { t = sessionStorage.getItem(tokenKey); } catch {}
  if (!t) {
    t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    try { sessionStorage.setItem(tokenKey, t); } catch {}
  }
  return t;
}

async function api(path, opts) {
  const r = await fetch(path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

function leaveOnline(notify = false) {
  if (!net) return;
  if (notify && !net.started) fetch(`/api/rooms/${net.code}/act`, { method: 'POST', body: JSON.stringify({ token: net.token, type: 'leave' }), keepalive: true }).catch(() => {});
  net.ctl?.abort(); net = null;
  document.title = 'Lost Cities';
  if (location.pathname.startsWith('/r/')) history.replaceState(null, '', '/');
}

async function createTable() {
  try {
    const { room } = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ rounds: cfg.rounds }) });
    await joinTable(room);
  } catch (e) { toast(e.message); }
}

async function joinTable(code) {
  code = code.trim().toUpperCase();
  const token = myToken();
  try {
    const info = await api(`/api/rooms/${code}?token=${token}`);
    if (info.full && !info.seated) throw new Error('That table is already full');
  } catch (e) { return toast(e.message); }
  leaveOnline();
  botRun++;
  net = { code, token, rev: -1, seq: -1, started: false, round: 0, name: cfg.name.trim(), ctl: null };
  match = { cfg: { ...cfg, mode: 'online' }, round: 1, totals: [0, 0], starter: 0, names: [cfg.name.trim() || 'Player', '…'], seat: 0 };
  state = newRound({}); ui = freshUi(); ui.busy = false;
  history.replaceState(null, '', `/r/${code}`);
  pollLoop(net);
  closeOverlay(); render(); showLobby();
}

async function pollLoop(n) {
  while (net === n) {
    try {
      n.ctl = new AbortController();
      const m = await api(`/api/rooms/${n.code}/poll?token=${n.token}&name=${encodeURIComponent(n.name)}&rev=${n.rev}`, { signal: n.ctl.signal });
      if (net !== n) return;
      if (n.lost) { n.lost = false; render(); }
      if (m.rev !== n.rev) { n.rev = m.rev; onUpdate(m); }
    } catch (e) {
      if (net !== n) return;
      if (/No table|full/i.test(e.message)) { leaveOnline(); showMenu(false); return toast(e.message); }
      n.lost = true; ui.pending = false; render();
      await sleep(1500);
    }
  }
}

function fromView(v, seat) {
  const o = 1 - seat;
  const hands = [];
  hands[seat] = v.hand;
  hands[o] = Array.isArray(v.oppHand) ? v.oppHand : Array(v.oppHand).fill(null);
  return { deck: Array(v.deck).fill(null), hands, exp: v.exp, discard: v.discard, turn: v.turn, phase: v.phase, lastDiscard: v.lastDiscard, over: v.over };
}

function onUpdate(m) {
  if (!net) return;
  net.lost = false; net.ready = m.ready; net.connected = m.connected; net.started = m.started;
  const fresh = net.seq < 0; const roundChanged = net.round !== m.round;
  const names = m.names.map((n, i) => n || (i === m.seat ? 'You' : 'Waiting…'));
  match = { cfg: { ...cfg, mode: 'online', rounds: m.rounds }, round: m.round, totals: m.totals, starter: 0, names, seat: m.seat };
  ui.pending = false;
  if (!m.started) { render(); return showLobby(); }
  if (!state || roundChanged || fresh) { ui = freshUi(); }
  state = fromView(m.view, m.seat);
  if (roundChanged) { net.round = m.round; ui.log = []; log(`Round ${m.round} begins: ${names[state.turn]} to start.`); closeOverlay(); }
  if (m.seq !== net.seq && !fresh && !roundChanged) {
    if (m.events.some((e) => e.p === m.seat)) ui.marks = { cards: new Set(), piles: new Set() };
    else if (m.events.some((e) => e.type === 'play' || e.type === 'discard')) ui.marks = { cards: new Set(), piles: new Set() };
    for (const e of m.events) {
      const who = names[e.p];
      if (e.type === 'draw') {
        log(e.from === 'deck' ? `${who} drew from the deck.` : `${who} took ${cname(e.card)} from the discards.`);
        if (e.p !== m.seat && e.from !== 'deck') ui.marks.piles.add(e.from);
      } else {
        log(`${who} ${e.type === 'play' ? 'played' : 'discarded'} ${cname(e.card)}.`);
        if (e.p !== m.seat) ui.marks.cards.add(e.card.id);
      }
    }
  }
  net.seq = m.seq;
  if (state.over) { ui.summary = { last: m.round >= m.rounds }; render(); showSummary(); }
  else { if (!overlay.hidden && overlay.className !== 'menu' && overlay.className !== 'rulesbox') closeOverlay(); render(); }
  const mine = state.turn === m.seat && !state.over;
  document.title = mine && document.hidden ? '● Your turn · Lost Cities' : 'Lost Cities';
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = 'Lost Cities'; });

async function send(msg) {
  ui.pending = true; syncSelection();
  try { await api(`/api/rooms/${net.code}/act`, { method: 'POST', body: JSON.stringify({ token: net.token, ...msg }) }); }
  catch (e) { ui.pending = false; toast(e.message); render(); }
}

// ---------- rendering ----------
function cname(c) {
  const t = c.value === 0 ? 'wager' : c.value;
  return `<b class="tx-${c.color}">${c.color[0].toUpperCase() + c.color.slice(1)} ${t}</b>`;
}
function log(msg) { ui.log.unshift(msg); ui.log.length = Math.min(ui.log.length, 7); }

function cardEl(card, extra = '') {
  const d = el('div', `card c-${card.color} ${extra}`, cardSVG(card));
  d.dataset.id = card.id;
  if (ui.marks.cards.has(card.id)) d.classList.add('mark');
  return d;
}
const backEl = (cls = '') => el('div', `card back ${cls}`, backSVG());

function render() {
  if (!state) return;
  const v = view(), o = 1 - v, names = match.names;
  const reveal = state.over;

  // opponent bar
  const ob = $('#oppBar'); ob.innerHTML = '';
  ob.append(el('div', 'nametag', `<span class="dot ${dotClass(o)}"></span>${esc(names[o])}`));
  const oh = el('div', 'minihand');
  for (const c of reveal ? sortHand(state.hands[o]) : state.hands[o]) oh.append(reveal ? cardEl(c, 'mini') : backEl('mini'));
  ob.append(oh);

  // columns
  const cols = $('#cols'); cols.innerHTML = '';
  for (const color of COLORS) {
    const col = el('div', `col k-${color}`);
    col.append(zone(o, color, 'opp'));
    const mid = el('div', 'mid');
    mid.append(scoreTag(o, color), pile(color), scoreTag(v, color));
    col.append(mid, zone(v, color, 'me'));
    cols.append(col);
  }

  // my bar / hand
  const mb = $('#myBar'); mb.innerHTML = '';
  mb.append(el('div', 'nametag', `<span class="dot ${dotClass(v)}"></span>${esc(names[v])}`));
  const hand = el('div', 'hand');
  const cards = sortHand(state.hands[v]);
  for (const c of cards) {
    const ce = cardEl(c);
    ce.draggable = myTurn() && state.phase === 'play';
    hand.append(ce);
  }
  mb.append(hand);

  side();
  syncSelection();
  fit();
}

function dotClass(p) {
  if (online() && net?.connected && !net.connected[p]) return 'off';
  return state.turn === p && !state.over ? 'on' : '';
}

function zone(p, color, cls) {
  const z = el('div', `zone ${cls}`);
  if (cls === 'me') z.dataset.target = `exp:${color}`;
  const cards = state.exp[p][color];
  if (!cards.length) z.append(el('div', 'slot', emblemSVG(color, 44)));
  const n = cards.length, off = n > 1 ? Math.min(34, (ZONE_H - CH - 4) / (n - 1)) : 0;
  cards.forEach((c, i) => { const ce = cardEl(c, 'stacked'); ce.style.top = `${i * off}px`; ce.style.zIndex = i; z.append(ce); });
  return z;
}

function pile(color) {
  const p = el('div', 'pile disc');
  p.dataset.target = `disc:${color}`; p.dataset.color = color;
  const cards = state.discard[color];
  if (!cards.length) p.append(el('div', 'slot', emblemSVG(color, 44)));
  else {
    if (cards.length > 1) p.append(el('div', 'under'));
    p.append(cardEl(cards[cards.length - 1]));
    p.append(el('span', 'count', cards.length));
  }
  if (ui.marks.piles.has(color)) p.classList.add('flash');
  return p;
}

function scoreTag(p, color) {
  const cards = state.exp[p][color];
  const s = expeditionScore(cards);
  const t = el('div', 'score' + (cards.length ? (s < 0 ? ' neg' : s > 0 ? ' pos' : '') : ' none'), cards.length ? (s > 0 ? `+${s}` : s) : '·');
  return t;
}

function side() {
  const s = $('#side'); s.innerHTML = '';
  const v = view(), o = 1 - v, names = match.names;
  s.append(el('h1', '', 'Lost<br>Cities'));
  s.append(el('div', 'sub', `Round ${match.round} of ${match.cfg.rounds}`));
  const deck = el('div', 'deckbox');
  const d = el('div', 'pile deck'); d.dataset.target = 'deck';
  if (state.deck.length > 1) d.append(el('div', 'under'), el('div', 'under u2'));
  if (state.deck.length) d.append(backEl()); else d.append(el('div', 'slot', ''));
  deck.append(d, el('div', 'deckcount' + (state.deck.length <= 10 ? ' low' : ''), `<b>${state.deck.length}</b><span>cards left</span>`));
  s.append(deck);

  const sc = el('div', 'scores');
  const row = (p) => `<div class="row ${state.turn === p && !state.over ? 'turn' : ''}"><span class="n">${esc(names[p])}</span><span class="r">${fmt(roundScore(state, p))}</span><span class="t">${match.totals[p]}</span></div>`;
  sc.innerHTML = `<div class="row head"><span class="n"></span><span class="r">round</span><span class="t">total</span></div>${row(v)}${row(o)}`;
  s.append(sc);

  s.append(el('div', 'status', statusText()));
  s.append(el('div', 'log', ui.log.map((l, i) => `<div class="${i === 0 ? 'new' : ''}">${l}</div>`).join('')));
  const b = el('div', 'btns');
  b.append(btn('Rules', () => showRules()), btn('Menu', () => { if (!online()) botRun++; showMenu(true); }));
  s.append(b);
}
const btn = (t, f) => { const b = el('button', 'btn small', t); b.onclick = f; return b; };

function statusText() {
  if (state.over) return 'Round over';
  if (online()) {
    if (net?.lost) return 'Connection lost. Reconnecting…';
    if (!net?.started) return 'Waiting for an opponent to join…';
    const o = 1 - view();
    if (state.turn !== view()) return net.connected?.[o] === false
      ? `${esc(match.names[o])} disconnected. The game waits for them to come back.`
      : `<span class="think">${esc(match.names[o])} is playing</span>`;
  } else if (ui.busy) return `<span class="think">${esc(match.names[1])} is thinking</span>`;
  if (state.phase === 'play') {
    const sel = ui.selected && findInHand(state, state.turn, ui.selected);
    return sel
      ? `Play ${cname(sel)} onto your expedition, or discard it on the pile.`
      : '<b>Your turn.</b> Play or discard a card from your hand.';
  }
  return '<b>Now draw.</b> Take the top of the deck or of a discard pile.';
}

function syncSelection() {
  const st = $('.status'); if (st) st.innerHTML = statusText();
  document.querySelectorAll('.hand .card').forEach((c) => c.classList.toggle('sel', c.dataset.id === ui.selected));
  document.querySelectorAll('.can').forEach((e) => e.classList.remove('can'));
  if (!myTurn()) return;
  const p = state.turn;
  if (state.phase === 'play') {
    const card = ui.selected && findInHand(state, p, ui.selected);
    if (!card) return;
    if (canPlayOn(state.exp[p][card.color], card)) document.querySelector(`.zone.me[data-target="exp:${card.color}"]`)?.classList.add('can');
    document.querySelector(`.pile.disc[data-target="disc:${card.color}"]`)?.classList.add('can');
  } else {
    for (const src of legalDraws(state)) {
      document.querySelector(src === 'deck' ? '.pile.deck' : `.pile.disc[data-target="disc:${src}"]`)?.classList.add('can');
    }
  }
}

// ---------- input ----------
const stage = $('#stage');
stage.addEventListener('click', (e) => {
  const c = e.target.closest('.hand .card');
  if (c && !c.classList.contains('back')) return select(c.dataset.id);
  const t = e.target.closest('[data-target]');
  if (t) onTarget(t.dataset.target);
});
stage.addEventListener('dblclick', (e) => {
  const c = e.target.closest('.hand .card');
  if (!c || !myTurn() || state.phase !== 'play') return;
  const card = findInHand(state, state.turn, c.dataset.id);
  if (card && canPlayOn(state.exp[state.turn][card.color], card)) { ui.selected = card.id; onTarget(`exp:${card.color}`); }
});
stage.addEventListener('dragstart', (e) => {
  const c = e.target.closest('.hand .card');
  if (!c || !myTurn() || state.phase !== 'play') return e.preventDefault();
  ui.selected = c.dataset.id; syncSelection();
  e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move';
});
stage.addEventListener('dragover', (e) => { if (e.target.closest?.('.can')) e.preventDefault(); });
stage.addEventListener('drop', (e) => {
  const t = e.target.closest('.can[data-target]');
  if (t) { e.preventDefault(); onTarget(t.dataset.target); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { ui.selected = null; syncSelection(); } });

// ---------- overlays ----------
const overlay = $('#overlay');
function openOverlay(html, cls = '') { overlay.className = cls; overlay.innerHTML = `<div class="panel">${html}</div>`; overlay.hidden = false; return overlay.firstChild; }
function closeOverlay() { overlay.hidden = true; overlay.innerHTML = ''; }

function showSummary() {
  if (!ui.summary || !state.over) return;
  const v = view(), o = 1 - v, names = match.names;
  const bv = breakdown(state, v), bo = breakdown(state, o);
  const cell = (x) => !x.started ? '<td class="none">–</td>' : `<td class="${x.score < 0 ? 'neg' : 'pos'}">${fmt(x.score)}<small>${x.count} cards${x.wagers ? ` · ×${1 + x.wagers}` : ''}${x.bonus ? ' · +20' : ''}</small></td>`;
  const rows = COLORS.map((c, i) => `<tr><th class="k-${c}"><i style="background:${PALETTE[c].main}"></i>${SITES[c]}</th>${cell(bv[i])}${cell(bo[i])}</tr>`).join('');
  const last = ui.summary.last;
  let title = `Round ${match.round} complete`, extra = '';
  if (last) {
    const [tv, to] = [match.totals[v], match.totals[o]];
    title = tv === to ? "It's a tie!" : tv > to ? (online() ? 'You win!' : `${esc(names[v])} wins!`) : `${esc(names[o])} wins!`;
    extra = `<div class="final">Final score: ${tv} – ${to}</div>`;
  }
  let buttons;
  if (online()) {
    const mine = net?.ready?.[v], theirs = net?.ready?.[o];
    buttons = mine
      ? `<div class="wait">Waiting for ${esc(names[o])}…</div>`
      : `<button class="btn big" id="next">${last ? 'Rematch' : 'Next round'}</button>${theirs ? `<div class="wait">${esc(names[o])} is ready</div>` : ''}`;
    if (last) buttons += '<button class="btn" id="menu">Leave</button>';
  } else {
    buttons = last ? '<button class="btn big" id="again">Play again</button><button class="btn" id="menu">Menu</button>' : '<button class="btn big" id="next">Next round</button>';
  }
  const p = openOverlay(`<h2>${title}</h2>${extra}
    <table class="sum"><thead><tr><th></th><th>${esc(names[v])}</th><th>${esc(names[o])}</th></tr></thead><tbody>${rows}
    <tr class="tot"><th>This round</th><td>${fmt(roundScore(state, v))}</td><td>${fmt(roundScore(state, o))}</td></tr>
    <tr class="tot"><th>Match total</th><td>${match.totals[v]}</td><td>${match.totals[o]}</td></tr></tbody></table>
    <div class="row-btns">${buttons}</div>`, 'summary');
  p.querySelector('#next')?.addEventListener('click', () => {
    if (online()) { net.ready = net.ready.map((r, i) => (i === v ? true : r)); showSummary(); send({ type: 'ready' }); }
    else { match.round++; match.starter = 1 - match.starter; startRound(); }
  });
  p.querySelector('#again')?.addEventListener('click', startMatch);
  p.querySelector('#menu')?.addEventListener('click', () => { leaveOnline(); showMenu(false); });
}

function showLobby() {
  if (!net || net.started) return;
  const link = `${location.origin}/r/${net.code}`;
  const p = openOverlay(`<h2>Table ${net.code}</h2>
    <p>Send this link to your opponent. The game starts as soon as they open it.</p>
    <input id="lnk" readonly value="${esc(link)}" style="width:92%">
    <div class="row-btns"><button class="btn big" id="copy">Copy link</button><button class="btn" id="leave">Leave</button></div>
    <p class="hint wait"><span class="think">Waiting for an opponent</span></p>`, 'lobby');
  const inp = p.querySelector('#lnk');
  p.querySelector('#copy').onclick = async () => {
    try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { inp.select(); document.execCommand?.('copy'); toast('Link copied'); }
  };
  inp.onclick = () => inp.select();
  p.querySelector('#leave').onclick = () => { leaveOnline(true); showMenu(false); };
}

function seg(name, opts, cur) {
  return `<div class="seg" data-k="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

function showMenu(canResume, joinCode = '') {
  const p = openOverlay(`
    <h1 class="title">Lost Cities</h1>
    <p class="tag">Mount expeditions to five lost sites. Every journey costs 20 points, so go deep or don't go at all.</p>
    <label>Play</label>${seg('mode', [['bot', 'Against the computer'], ['online', 'Online with a friend']], cfg.mode)}
    <div id="botopts"><label>Bot skill</label>${seg('level', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], cfg.level)}</div>
    <label>Your name</label><input id="nm" maxlength="14" placeholder="${cfg.mode === 'online' ? 'Player' : 'You'}" value="${esc(cfg.name)}">
    <label>Rounds</label>${seg('rounds', [[1, 'Single round'], [3, 'Best of 3 rounds']], cfg.rounds)}
    <div id="onlopts"><div class="joinrow"><input id="code" maxlength="8" placeholder="Table code" value="${esc(joinCode)}"><button class="btn" id="join">Join</button></div>
    <p class="hint" id="onlhint"></p></div>
    <div class="row-btns"><button class="btn big" id="start"></button>${canResume ? '<button class="btn" id="resume">Resume</button>' : ''}<button class="btn" id="rules">Rules</button></div>`, 'menu');
  const sync = () => {
    p.querySelector('#botopts').style.display = cfg.mode === 'bot' ? '' : 'none';
    p.querySelector('#onlopts').style.display = cfg.mode === 'online' ? '' : 'none';
    p.querySelector('#start').textContent = cfg.mode === 'online' ? 'Create a table' : 'New game';
    p.querySelector('#nm').placeholder = cfg.mode === 'online' ? 'Player' : 'You';
  };
  sync();
  p.querySelectorAll('.seg').forEach((sg) => sg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    sg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    const k = sg.dataset.k; cfg[k] = k === 'rounds' ? +b.dataset.v : b.dataset.v; sync();
  }));
  const grab = () => { cfg.name = p.querySelector('#nm').value; saveCfg(); };
  p.querySelector('#start').onclick = () => { grab(); cfg.mode === 'online' ? createTable() : startMatch(); };
  p.querySelector('#join').onclick = () => { grab(); const c = p.querySelector('#code').value.trim(); c ? joinTable(c) : toast('Enter the table code'); };
  p.querySelector('#rules').onclick = () => showRules(() => showMenu(canResume, joinCode));
  p.querySelector('#resume')?.addEventListener('click', () => {
    closeOverlay();
    if (online()) { showSummaryOrLobby(); return; }
    ui.busy = false;
    if (state.turn === 1 && !state.over) runBot(); else { render(); if (state.over) showSummary(); }
  });
  // online play needs the Node server; a static host (GitHub Pages) can't offer it
  fetch('/api/ping').then((r) => r.json()).then(() => {}, () => {
    if (!p.isConnected) return;
    p.querySelector('#onlhint').textContent = 'Online play needs the game server (node server/server.js). It is not available on this site.';
    p.querySelector('#onlhint').dataset.off = '1';
    const seg0 = p.querySelector('.seg[data-k="mode"] button[data-v="online"]'); seg0.classList.add('dim');
  });
}

function showSummaryOrLobby() { if (state?.over) showSummary(); else if (net && !net.started) showLobby(); }

function showRules(back) {
  const p = openOverlay(`<h2>How to play</h2><div class="rules">
    <p><b>Goal:</b> score the most points by sending expeditions to the five sites. Each player lays out their own expedition for each colour.</p>
    <p><b>Your turn:</b> 1) <b>play</b> one card from your hand: either onto one of <i>your</i> expeditions, or onto the matching <i>discard pile</i> in the middle. 2) <b>Draw</b> one card: from the deck or from the top of any discard pile (but not the one you just discarded to).</p>
    <p><b>Expeditions:</b> each colour must go in <b>ascending order</b> (equal numbers are not allowed, but you may skip numbers). <b>Wager cards</b> (the handshake) can only be played <i>before</i> the first number card of that colour.</p>
    <p><b>Scoring (per expedition you started):</b> add the numbers, subtract 20, then multiply by 1 + the number of wagers. An expedition with <b>8 or more cards</b> gets +20 after that. Unstarted colours score 0.</p>
    <p><b>The round ends</b> as soon as the last card is drawn from the deck. A full game is three rounds; the highest total wins.</p>
    <p class="hint">Tip: click a card, then click where it should go. Double-click plays it straight onto your expedition. Drag and drop works too.</p></div>
    <div class="row-btns"><button class="btn big" id="ok">Got it</button></div>`, 'rulesbox');
  p.querySelector('#ok').onclick = () => (typeof back === 'function' ? back() : closeOverlay());
}

// ---------- misc ----------
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200);
}
const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fit() {
  const s = Math.min(innerWidth / 1280, innerHeight / 920);
  stage.style.transform = `scale(${s})`;
  stage.style.left = `${(innerWidth - 1280 * s) / 2}px`;
  stage.style.top = `${(innerHeight - 920 * s) / 2}px`;
}
addEventListener('resize', fit);
fit();

// boot: a decorative idle board behind the menu (or straight to joining an invite link)
match = { cfg, round: 1, totals: [0, 0], starter: 0, names: ['You', 'Bot'], seat: 0 };
state = newRound({});
ui = freshUi();
render();
const invite = location.pathname.match(/^\/r\/([A-Za-z0-9]{3,8})$/);
if (invite) { cfg.mode = 'online'; showMenu(false, invite[1].toUpperCase()); } else showMenu(false);
