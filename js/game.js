// Pure game logic for Lost Cities (2 players). No DOM in here.

export const COLORS = ['yellow', 'blue', 'white', 'green', 'red'];
export const SITES = { yellow: 'Desert', blue: 'Sea', white: 'Himalaya', green: 'Jungle', red: 'Volcano' };
export const HAND_SIZE = 8;
export const EXPEDITION_COST = 20;
export const BONUS_CARDS = 8;
export const BONUS = 20;

export function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    for (let i = 0; i < 3; i++) deck.push({ id: `${color}-w${i}`, color, value: 0 }); // wager / handshake
    for (let v = 2; v <= 10; v++) deck.push({ id: `${color}-${v}`, color, value: v });
  }
  return deck;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const colorMap = () => Object.fromEntries(COLORS.map((c) => [c, []]));

export function newRound({ starter = 0, rng = Math.random } = {}) {
  const deck = shuffle(buildDeck(), rng);
  const hands = [[], []];
  for (let i = 0; i < HAND_SIZE; i++) for (const p of [0, 1]) hands[p].push(deck.pop());
  return {
    deck,
    hands,
    exp: [colorMap(), colorMap()], // exp[player][color] -> cards in play order
    discard: colorMap(), // discard[color] -> pile, top = last
    turn: starter,
    phase: 'play', // 'play' then 'draw'
    lastDiscard: null, // colour discarded this turn (cannot be drawn back)
    over: false,
  };
}

export function cardName(card) {
  return card.value === 0 ? `${card.color} wager` : `${card.color} ${card.value}`;
}

/** Can `card` be added to this expedition (ascending order, wagers only before numbers)? */
export function canPlayOn(expedition, card) {
  if (card.value === 0) return expedition.every((c) => c.value === 0);
  if (expedition.length === 0) return true;
  return card.value > expedition[expedition.length - 1].value;
}

export function expeditionScore(cards) {
  if (cards.length === 0) return 0;
  const wagers = cards.filter((c) => c.value === 0).length;
  const sum = cards.reduce((s, c) => s + c.value, 0);
  let score = (sum - EXPEDITION_COST) * (1 + wagers);
  if (cards.length >= BONUS_CARDS) score += BONUS;
  return score;
}

export function breakdown(state, p) {
  return COLORS.map((color) => {
    const cards = state.exp[p][color];
    const wagers = cards.filter((c) => c.value === 0).length;
    const sum = cards.reduce((s, c) => s + c.value, 0);
    return {
      color,
      started: cards.length > 0,
      count: cards.length,
      wagers,
      sum,
      bonus: cards.length >= BONUS_CARDS,
      score: expeditionScore(cards),
    };
  });
}

export const roundScore = (state, p) => breakdown(state, p).reduce((s, b) => s + b.score, 0);

export function findInHand(state, p, id) {
  return state.hands[p].find((c) => c.id === id);
}

export function legalPlays(state, p = state.turn) {
  const out = [];
  for (const card of state.hands[p]) {
    if (canPlayOn(state.exp[p][card.color], card)) out.push({ card, kind: 'expedition' });
    out.push({ card, kind: 'discard' });
  }
  return out;
}

export function legalDraws(state) {
  const out = ['deck'];
  for (const c of COLORS) if (state.discard[c].length && c !== state.lastDiscard) out.push(c);
  return out;
}

export function playCard(state, p, cardId, kind) {
  if (state.over) throw new Error('Round is over');
  if (state.turn !== p || state.phase !== 'play') throw new Error('Not your play phase');
  const idx = state.hands[p].findIndex((c) => c.id === cardId);
  if (idx < 0) throw new Error('Card not in hand');
  const card = state.hands[p][idx];
  if (kind === 'expedition') {
    if (!canPlayOn(state.exp[p][card.color], card)) throw new Error('Expedition must ascend');
    state.hands[p].splice(idx, 1);
    state.exp[p][card.color].push(card);
    state.lastDiscard = null;
  } else if (kind === 'discard') {
    state.hands[p].splice(idx, 1);
    state.discard[card.color].push(card);
    state.lastDiscard = card.color;
  } else throw new Error('Bad kind');
  state.phase = 'draw';
  return { type: kind === 'discard' ? 'discard' : 'play', p, card };
}

export function drawCard(state, p, source) {
  if (state.over) throw new Error('Round is over');
  if (state.turn !== p || state.phase !== 'draw') throw new Error('Not your draw phase');
  let card;
  if (source === 'deck') {
    card = state.deck.pop();
  } else {
    if (!state.discard[source]) throw new Error('Bad pile');
    if (source === state.lastDiscard) throw new Error('Cannot take back the card you just discarded');
    if (!state.discard[source].length) throw new Error('Pile is empty');
    card = state.discard[source].pop();
  }
  state.hands[p].push(card);
  state.phase = 'play';
  state.lastDiscard = null;
  if (state.deck.length === 0) state.over = true; // round ends when the last card is drawn
  else state.turn = 1 - p;
  return { type: 'draw', p, card, from: source };
}

/** Sort for display: colour order, wagers first, then ascending. */
export function sortHand(cards) {
  return cards.slice().sort((a, b) => COLORS.indexOf(a.color) - COLORS.indexOf(b.color) || a.value - b.value || a.id.localeCompare(b.id));
}
