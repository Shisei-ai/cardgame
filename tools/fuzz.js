#!/usr/bin/env node
/*
 * fuzz.js — ランダムに作ったオリジナルカードだけのデッキで大量に対戦させ、
 *           全ての効果・発動の場面がエラーなく動くか、無限ループにならないかを確かめる
 *   node tools/fuzz.js --games 300
 */
'use strict';
const path = require('path');
const js = (f) => require(path.join(__dirname, '..', 'js', f));
const Parts = js('parts.js');
const { Game } = js('engine.js');
const { AI, forgeRandom } = js('ai.js');
const args = process.argv.slice(2);
const GAMES = Number((args[args.indexOf('--games') + 1]) || 300);
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const fired = {}, trigs = {};
let errors = 0, stuck = 0, invalid = 0;
for (let i = 0; i < GAMES; i++) {
  const rand = mulberry32(777 + i);
  const decks = [0, 1].map((pi) => {
    const d = [];
    for (let k = 0; k < 10; k++) {
      const s = forgeRandom(rand); s.id = `z${pi}_${k}`;
      if (Parts.validate({ ...s, name: s.name || 'x' }).length) invalid++;
      for (let j = 0; j < 4; j++) d.push(s);
    }
    return d;
  });
  const g = new Game({ decks, seed: i + 1 });
  const ais = [new AI(g, 0, 'hard'), new AI(g, 1, 'hard')];
  g.onEvent = (e) => { if (e.type === 'effect') { fired[e.effect.act] = (fired[e.effect.act] || 0) + 1; trigs[e.effect.trig] = (trigs[e.effect.trig] || 0) + 1; } };
  try {
    g.start();
    let n = 0;
    while (!g.over && n++ < 300) ais[g.active].playTurn();
    if (!g.over) stuck++;
  } catch (e) { errors++; if (errors <= 3) console.error(e); }
}
console.log(`試合 ${GAMES} / エラー ${errors} / 終わらなかった試合 ${stuck} / 規則違反のカード ${invalid}`);
const miss = (all, got) => Object.keys(all).filter((k) => !got[k]);
console.log('一度も発動しなかった効果：', miss(Parts.ACTIONS, fired).filter((k) => !Parts.ACTIONS[k].statikOnly).join(', ') || 'なし（常在専用を除く）');
console.log('一度も発動しなかった場面：', miss(Parts.TRIGGERS, trigs).filter((k) => k !== 'static').join(', ') || 'なし（常在を除く）');
