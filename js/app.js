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
const DEFAULTS = { mode: 'bot', level: 'medium', rounds: 3, name: 'You' };
let cfg = { ...DEFAULTS };
try { cfg = { ...DEFAULTS, ...JSON.parse(localStorage.getItem('lostcities.cfg') || '{}') }; } catch {}
const saveCfg = () => { try { localStorage.setItem('lostcities.cfg', JSON.stringify(cfg)); } catch {} };

let match = null;     // { round, totals, starter, names }
let state = null;     // current round (game.js)
let ui = null;        // { selected, curtain, busy, marks, log, view, lastView }
let botRun = 0;

const hot = () => match.cfg.mode === 'hotseat';
const view = () => (hot() ? ui.view : 0);

// ---------- flow ----------
function startMatch() {
  const names = cfg.mode === 'bot' ? [cfg.name.trim() || 'You', 'Bot'] : ['Player 1', 'Player 2'];
  match = { cfg: { ...cfg }, round: 1, totals: [0, 0], starter: 0, names };
  startRound();
}

function startRound() {
  botRun++;
  state = newRound({ starter: match.starter });
  ui = { selected: null, curtain: false, busy: false, marks: { cards: new Set(), piles: new Set() }, log: [], view: match.starter, summary: null };
  closeOverlay();
  log(`Round ${match.round} begins: ${match.names[state.turn]} to start.`);
  render();
  if (hot()) { ui.curtain = true; render(); showCurtain(); }
  else if (state.turn === 1) runBot();
}

function afterTurn() {
  if (state.over) return endRound();
  if (!hot()) return runBot();
  ui.curtain = true; ui.view = state.turn;
  render(); showCurtain();
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
const myTurn = () => state && !state.over && !ui.busy && !ui.curtain && (hot() || state.turn === 0);

function onTarget(t) {
  if (!myTurn()) return;
  const p = state.turn;
  if (state.phase === 'play') {
    if (!ui.selected) return toast('Pick a card from your hand first');
    const card = findInHand(state, p, ui.selected);
    if (!card) return;
    if (t === `exp:${card.color}`) {
      if (!canPlayOn(state.exp[p][card.color], card)) return toast(card.value === 0 ? 'Wagers must come before any number in an expedition' : 'Expedition cards must go up: play a higher number');
      act(() => playCard(state, p, card.id, 'expedition'), `${match.names[p]} played ${cname(card)}.`);
    } else if (t === `disc:${card.color}`) {
      act(() => playCard(state, p, card.id, 'discard'), `${match.names[p]} discarded ${cname(card)}.`);
    } else if (t !== 'deck') toast(`That card belongs to the ${card.color} column`);
  } else {
    if (t === 'deck') { drawNow('deck'); }
    else if (t.startsWith('disc:')) {
      const col = t.slice(5);
      if (col === state.lastDiscard) return toast("You can't pick up the card you just discarded");
      if (!state.discard[col].length) return toast('That discard pile is empty');
      drawNow(col);
    }
  }
}

function act(fn, msg) {
  ui.marks = { cards: new Set(), piles: new Set() };
  fn(); ui.selected = null; log(msg); render();
}

function drawNow(src) {
  const p = state.turn;
  const top = src === 'deck' ? null : state.discard[src][state.discard[src].length - 1];
  drawCard(state, p, src);
  log(src === 'deck' ? `${match.names[p]} drew from the deck.` : `${match.names[p]} took ${cname(top)} from the discards.`);
  ui.selected = null;
  afterTurn();
}

function select(id) {
  if (!myTurn() || state.phase !== 'play') return;
  ui.selected = ui.selected === id ? null : id;
  syncSelection();
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
  const hideMine = ui.curtain;

  // opponent bar
  const ob = $('#oppBar'); ob.innerHTML = '';
  ob.append(el('div', 'nametag', `<span class="dot ${state.turn === o && !state.over ? 'on' : ''}"></span>${esc(names[o])}`));
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
  mb.append(el('div', 'nametag', `<span class="dot ${state.turn === v && !state.over ? 'on' : ''}"></span>${esc(names[v])}`));
  const hand = el('div', 'hand');
  const cards = sortHand(state.hands[v]);
  for (const c of cards) {
    if (hideMine) { hand.append(backEl()); continue; }
    const ce = cardEl(c);
    ce.draggable = myTurn() && state.phase === 'play';
    hand.append(ce);
  }
  mb.append(hand);

  side();
  syncSelection();
  fit();
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
  b.append(btn('Rules', showRules), btn('Menu', () => { botRun++; showMenu(true); }));
  s.append(b);
}
const btn = (t, f) => { const b = el('button', 'btn small', t); b.onclick = f; return b; };

function statusText() {
  if (state.over) return 'Round over';
  if (ui.busy) return `<span class="think">${esc(match.names[1])} is thinking</span>`;
  if (ui.curtain) return 'Waiting for the next player…';
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

function showCurtain() {
  const n = match.names[state.turn];
  const p = openOverlay(`<h2>${esc(n)}'s turn</h2><p>Hand the device over. Hands stay hidden until you're ready.</p><button class="btn big" id="go">I'm ${esc(n)}: show my hand</button>`, 'curtain');
  p.querySelector('#go').onclick = () => { ui.curtain = false; ui.view = state.turn; closeOverlay(); render(); };
}

function showSummary() {
  if (!ui.summary) return;
  const names = match.names, [a, b] = [0, 1];
  const ba = breakdown(state, a), bb = breakdown(state, b);
  const cell = (x) => !x.started ? '<td class="none">–</td>' : `<td class="${x.score < 0 ? 'neg' : 'pos'}">${fmt(x.score)}<small>${x.count} cards${x.wagers ? ` · ×${1 + x.wagers}` : ''}${x.bonus ? ' · +20' : ''}</small></td>`;
  const rows = COLORS.map((c, i) => `<tr><th class="k-${c}"><i style="background:${PALETTE[c].main}"></i>${SITES[c]}</th>${cell(ba[i])}${cell(bb[i])}</tr>`).join('');
  const [sa, sb] = ui.summary.scores;
  let title = `Round ${match.round} complete`, extra = '';
  if (ui.summary.last) {
    const [ta, tb] = match.totals;
    title = ta === tb ? "It's a tie!" : `${esc(names[ta > tb ? 0 : 1])} wins!`;
    extra = `<div class="final">Final score: ${ta} – ${tb}</div>`;
  }
  const buttons = ui.summary.last
    ? '<button class="btn big" id="again">Play again</button><button class="btn" id="menu">Menu</button>'
    : '<button class="btn big" id="next">Next round</button>';
  const p = openOverlay(`<h2>${title}</h2>${extra}
    <table class="sum"><thead><tr><th></th><th>${esc(names[0])}</th><th>${esc(names[1])}</th></tr></thead><tbody>${rows}
    <tr class="tot"><th>This round</th><td>${fmt(sa)}</td><td>${fmt(sb)}</td></tr>
    <tr class="tot"><th>Match total</th><td>${match.totals[0]}</td><td>${match.totals[1]}</td></tr></tbody></table>
    <div class="row-btns">${buttons}</div>`, 'summary');
  p.querySelector('#next')?.addEventListener('click', () => { match.round++; match.starter = 1 - match.starter; startRound(); });
  p.querySelector('#again')?.addEventListener('click', startMatch);
  p.querySelector('#menu')?.addEventListener('click', () => showMenu(false));
}

function seg(name, opts, cur) {
  return `<div class="seg" data-k="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

function showMenu(canResume) {
  const p = openOverlay(`
    <h1 class="title">Lost Cities</h1>
    <p class="tag">Mount expeditions to five lost sites. Every journey costs 20 points, so go deep or don't go at all.</p>
    <label>Opponent</label>${seg('mode', [['bot', 'Computer'], ['hotseat', 'Two players, one device']], cfg.mode)}
    <div id="botopts"><label>Bot skill</label>${seg('level', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']], cfg.level)}
    <label>Your name</label><input id="nm" maxlength="14" value="${esc(cfg.name)}"></div>
    <label>Rounds</label>${seg('rounds', [[1, 'Single round'], [3, 'Best of 3 rounds']], cfg.rounds)}
    <div class="row-btns"><button class="btn big" id="start">New game</button>${canResume ? '<button class="btn" id="resume">Resume</button>' : ''}<button class="btn" id="rules">Rules</button></div>`, 'menu');
  const sync = () => { p.querySelector('#botopts').style.display = cfg.mode === 'bot' ? '' : 'none'; };
  sync();
  p.querySelectorAll('.seg').forEach((s) => s.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    const k = s.dataset.k; cfg[k] = k === 'rounds' ? +b.dataset.v : b.dataset.v; sync();
  }));
  p.querySelector('#start').onclick = () => { cfg.name = p.querySelector('#nm').value; saveCfg(); startMatch(); };
  p.querySelector('#rules').onclick = () => showRules(() => showMenu(canResume));
  const r = p.querySelector('#resume');
  if (r) r.onclick = () => { closeOverlay(); ui.busy = false; if (!hot() && state.turn === 1 && !state.over) runBot(); else render(); if (ui.curtain) showCurtain(); };
}

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

// boot: show a decorative idle board behind the menu
match = { cfg, round: 1, totals: [0, 0], starter: 0, names: ['You', 'Bot'] };
state = newRound({});
ui = { selected: null, curtain: true, busy: false, marks: { cards: new Set(), piles: new Set() }, log: [], view: 0 };
render();
showMenu(false);
