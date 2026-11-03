#!/usr/bin/env node
/*
 * simulate.js — CPU同士を大量に対戦させて、ルールの動作とバランスを確かめる
 *
 *   node tools/simulate.js              # 200戦（毎回ランダムなデッキ）
 *   node tools/simulate.js --games 1000
 *
 * 表示：試合の長さ、決着の内訳、先攻の勝率、素質ごとのカードの「使った側の勝率」など
 */
'use strict';
const path = require('path');
const js = (f) => require(path.join(__dirname, '..', 'js', f));
const Parts = js('parts.js');
const { Game, validateDeck } = js('engine.js');
const { AI, buildDeck, forgeRandom } = js('ai.js');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const GAMES = Number(opt('games', 200));
const CFG = process.env.CFG ? JSON.parse(process.env.CFG) : {};

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

let maxMana = 0, attackDmg = 0, otherDmg = 0, turns = 0, firstWins = 0, decided = 0, reasons = {}, errors = 0;
const forgeCheck = { made: 0, invalid: 0 };
for (let i = 0; i < 300; i++) { const s = forgeRandom(mulberry32(i + 7)); s.id = 'x'; forgeCheck.made++; if (Parts.validate(s).length) forgeCheck.invalid++; }

for (let i = 0; i < GAMES; i++) {
  const rand = mulberry32(1000 + i);
  const decks = [buildDeck(rand), buildDeck(rand)];
  for (const d of decks) { const e = validateDeck(d); if (e.length) { console.log('デッキ不正', e); process.exit(1); } }
  const g = new Game({ decks, seed: i + 1, config: CFG });
  const ais = [new AI(g, 0, 'hard'), new AI(g, 1, 'hard')];
  try {
    g.start();
    let guard = 0;
    while (!g.over && guard++ < 400) ais[g.active].playTurn();
    if (!g.over) { reasons['200ターン超え'] = (reasons['200ターン超え'] || 0) + 1; continue; }
  } catch (e) {
    errors++;
    if (errors <= 3) console.error(e);
    continue;
  }
  turns += g.turn; decided++;
  maxMana += Math.max(g.players[0].maxMana, g.players[1].maxMana);
  if (g.winner === g.first) firstWins++;
  reasons[g.endReason.replace(/^.*の山札/, '山札')] = (reasons[g.endReason.replace(/^.*の山札/, '山札')] || 0) + 1;
}
console.log(`試合 ${GAMES} / エラー ${errors} / 平均 ${(turns / decided).toFixed(1)}ターン（1人あたり約${(turns / decided / 2).toFixed(1)}） / 先攻の勝率 ${(firstWins / decided * 100).toFixed(1)}%`);
console.log('決着の内訳：', reasons, `/ 決着時の最大マナ（多い方） 平均 ${(maxMana / decided).toFixed(1)}`);
console.log(`ランダム生成カード：${forgeCheck.made}枚中、規則違反 ${forgeCheck.invalid}枚`);
