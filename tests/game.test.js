import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDeck, newRound, canPlayOn, expeditionScore, playCard, drawCard, mulberry32, roundScore, legalDraws } from '../js/game.js';
import { chooseMove, chooseDraw } from '../js/bot.js';

const c = (color, value, n = 0) => ({ id: `${color}-${value}-${n}`, color, value });

test('deck has 60 cards: 5 colours x (3 wagers + 2..10)', () => {
  const d = buildDeck();
  assert.equal(d.length, 60);
  assert.equal(new Set(d.map((x) => x.id)).size, 60);
  assert.equal(d.filter((x) => x.value === 0).length, 15);
});

test('deal: 8 cards each, 44 in deck', () => {
  const s = newRound({ rng: mulberry32(1) });
  assert.equal(s.hands[0].length, 8);
  assert.equal(s.hands[1].length, 8);
  assert.equal(s.deck.length, 44);
});

test('expedition ordering', () => {
  assert.ok(canPlayOn([], c('red', 5)));
  assert.ok(canPlayOn([c('red', 5)], c('red', 6)));
  assert.ok(!canPlayOn([c('red', 5)], c('red', 5)));
  assert.ok(!canPlayOn([c('red', 5)], c('red', 3)));
  assert.ok(canPlayOn([c('red', 0)], c('red', 0)));
  assert.ok(canPlayOn([c('red', 0)], c('red', 2)));
  assert.ok(!canPlayOn([c('red', 2)], c('red', 0)));
});

test('scoring', () => {
  assert.equal(expeditionScore([]), 0);
  assert.equal(expeditionScore([c('red', 2)]), -18);
  assert.equal(expeditionScore([c('red', 5), c('red', 6), c('red', 9)]), 0); // 20-20
  assert.equal(expeditionScore([c('red', 0), c('red', 10), c('red', 9), c('red', 8)]), (27 - 20) * 2);
  // 8+ cards bonus (wagers count as cards), after multiplier
  const big = [c('red', 0), c('red', 0), c('red', 0), c('red', 2), c('red', 3), c('red', 4), c('red', 5), c('red', 6)];
  assert.equal(expeditionScore(big), (20 - 20) * 4 + 20);
});

test('turn flow, discard restriction, round end on last card', () => {
  const s = newRound({ rng: mulberry32(7) });
  const card = s.hands[0][0];
  playCard(s, 0, card.id, 'discard');
  assert.ok(!legalDraws(s).includes(card.color));
  assert.throws(() => drawCard(s, 0, card.color));
  assert.throws(() => playCard(s, 0, s.hands[0][0].id, 'discard')); // must draw first
  drawCard(s, 0, 'deck');
  assert.equal(s.turn, 1);
  assert.equal(s.hands[0].length, 8);
  s.deck.length = 1;
  playCard(s, 1, s.hands[1][0].id, 'discard');
  const ev = drawCard(s, 1, 'deck');
  assert.equal(ev.type, 'draw');
  assert.ok(s.over);
  assert.throws(() => playCard(s, 0, s.hands[0][0].id, 'discard'));
});

test('bots play full rounds legally, no state corruption; hard beats easy', () => {
  let hardWins = 0, games = 120;
  for (let g = 0; g < games; g++) {
    const rng = mulberry32(1000 + g);
    const s = newRound({ rng, starter: g % 2 });
    const levels = g % 2 === 0 ? ['hard', 'easy'] : ['easy', 'hard'];
    let guard = 0;
    while (!s.over) {
      const p = s.turn, lv = levels[p];
      const mv = chooseMove(s, p, lv, rng);
      playCard(s, p, mv.card.id, mv.kind);
      drawCard(s, p, chooseDraw(s, p, lv, rng));
      assert.ok(++guard < 200);
    }
    const hp = levels.indexOf('hard');
    if (roundScore(s, hp) > roundScore(s, 1 - hp)) hardWins++;
    const total = s.deck.length + s.hands.flat().length + Object.values(s.discard).flat().length + s.exp.flatMap((e) => Object.values(e).flat()).length;
    assert.equal(total, 60);
  }
  console.log(`hard won ${hardWins}/${games} vs easy`);
  assert.ok(hardWins > games * 0.6);
});
