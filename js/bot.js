// Heuristic computer opponent. It only uses information a human could see:
// its own hand, both expeditions, the discard piles and the deck size.
import { COLORS, buildDeck, canPlayOn } from './game.js';

const LEVELS = {
  easy: { noise: 6, blunder: 0.3, drawNoise: 3 },
  medium: { noise: 2, blunder: 0.05, drawNoise: 1.5 },
  hard: { noise: 0.3, blunder: 0, drawNoise: 0.3 },
};
const DECK_VALUE = 3; // rough value of an unknown card from the deck

function gauss(rng) {
  return (rng() + rng() + rng() - 1.5) * 1.6;
}

function makeCtx(state, p) {
  const seen = new Set();
  state.hands[p].forEach((c) => seen.add(c.id));
  for (const q of [0, 1]) for (const col of COLORS) state.exp[q][col].forEach((c) => seen.add(c.id));
  for (const col of COLORS) state.discard[col].forEach((c) => seen.add(c.id));
  const unseen = Object.fromEntries(COLORS.map((c) => [c, []]));
  for (const c of buildDeck()) if (!seen.has(c.id)) unseen[c.color].push(c);
  const deckN = state.deck.length;
  const U = deckN + state.hands[1 - p].length;
  const pGet = Math.min(0.6, (0.45 * deckN) / Math.max(U, 1)); // chance a given unseen card ends up with me
  const turnsLeft = Math.ceil(deckN / 2);
  const hf = Math.max(0.15, Math.min(0.92, 0.3 + 0.07 * turnsLeft)); // how much a card in hand is worth vs one on the table
  return { state, p, unseen, pGet, hf };
}

/** Expected final score of one colour for me, given what's on the table and in hand. */
function colorValue(ctx, color, exp, hand) {
  const { pGet, hf, unseen } = ctx;
  const started = exp.length > 0;
  const hasNum = exp.some((c) => c.value > 0);
  const last = started ? exp[exp.length - 1].value : 0;
  let sum = 0, count = 0, mult = 1, handN = 0;
  for (const c of exp) {
    sum += c.value; count++;
    if (c.value === 0) mult++;
  }
  for (const c of hand) {
    if (c.value === 0) {
      if (!hasNum) { mult += hf; count += hf; handN++; }
    } else if (c.value > last) { sum += hf * c.value; count += hf; handN++; }
  }
  if (!started && handN === 0) return 0;
  for (const c of unseen[color]) {
    if (c.value === 0) {
      if (!hasNum) { mult += pGet * 0.5; count += pGet * 0.5; }
    } else if (c.value > last) { sum += pGet * 0.6 * c.value; count += pGet * 0.6; }
  }
  const bonus = 20 * Math.min(1, Math.max(0, (count - 5.5) / 3));
  const raw = (sum - 20) * mult + bonus;
  return started ? raw : Math.max(0, raw);
}

function oppBenefit(ctx, card) {
  const oe = ctx.state.exp[1 - ctx.p][card.color];
  if (oe.length) return canPlayOn(oe, card) ? (card.value === 0 ? 1 : 0.75 * card.value) : 0;
  return 0.15 * card.value;
}

const handOf = (state, p, color) => state.hands[p].filter((c) => c.color === color);

export function chooseMove(state, p, level = 'medium', rng = Math.random) {
  const L = LEVELS[level] || LEVELS.medium;
  const ctx = makeCtx(state, p);
  const options = [];
  for (const card of state.hands[p]) {
    const col = card.color;
    const exp = state.exp[p][col];
    const hc = handOf(state, p, col);
    const rest = hc.filter((c) => c !== card);
    const before = colorValue(ctx, col, exp, hc);
    if (canPlayOn(exp, card)) {
      const after = colorValue(ctx, col, [...exp, card], rest);
      options.push({ card, kind: 'expedition', score: after - before + 1.5 });
    }
    const keepLoss = Math.max(0, before - colorValue(ctx, col, exp, rest));
    options.push({ card, kind: 'discard', score: -(keepLoss + oppBenefit(ctx, card)) });
  }
  options.sort((a, b) => b.score - a.score);
  if (L.blunder && rng() < L.blunder) {
    const pool = options.filter((o) => o.score > options[0].score - 15);
    const o = pool[Math.floor(rng() * pool.length)];
    return { card: o.card, kind: o.kind };
  }
  let best = null;
  for (const o of options) {
    const s = o.score + gauss(rng) * L.noise;
    if (!best || s > best.s) best = { o, s };
  }
  return { card: best.o.card, kind: best.o.kind };
}

export function chooseDraw(state, p, level = 'medium', rng = Math.random) {
  const L = LEVELS[level] || LEVELS.medium;
  const ctx = makeCtx(state, p);
  let best = { src: 'deck', val: DECK_VALUE + gauss(rng) * L.drawNoise };
  if (L.blunder && rng() < L.blunder) return 'deck';
  for (const col of COLORS) {
    const pile = state.discard[col];
    if (!pile.length || col === state.lastDiscard) continue;
    const top = pile[pile.length - 1];
    const exp = state.exp[p][col];
    const hc = handOf(state, p, col);
    const gain = colorValue(ctx, col, exp, [...hc, top]) - colorValue(ctx, col, exp, hc);
    const val = gain + 0.35 * oppBenefit(ctx, top) + 0.5 + gauss(rng) * L.drawNoise;
    if (val > best.val) best = { src: col, val };
  }
  return best.src;
}
