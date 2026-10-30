/*
 * lib.js — 検証ツール共通の部品
 */
'use strict';
const path = require('path');
const js = (f) => require(path.join(__dirname, '..', 'js', f));
const Cards = js('cards.js');
const { Game, validateDeck } = js('engine.js');
const { AI } = js('ai.js');
const Presets = js('presets.js');

const DT = 0.1;

/** AI同士で1試合を最後まで行い、終了した Game を返す */
// 環境変数 CFG='{"guardRetaliate":false}' で CONFIG を一時的に上書きして比較できる
const CFG_OVERRIDE = process.env.CFG ? JSON.parse(process.env.CFG) : {};

function runGame(deckA, deckB, seed, level = 'hard') {
  const g = new Game({ decks: [deckA, deckB], seed, config: CFG_OVERRIDE });
  const ais = [new AI(g, 0, level), new AI(g, 1, level)];
  while (!g.over) {
    g.update(DT);
    ais[0].update(DT);
    ais[1].update(DT);
  }
  return g;
}

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const has = (name) => args.includes('--' + name);

/** 「烈火の突撃（速攻）」→「速攻」 */
const label = (d) => (d.name.match(/（(.+)）/) || [, d.key])[1];

/** 全角文字を幅2として右側を空白で埋める */
function pad(s, n) {
  const w = [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);
  return s + ' '.repeat(Math.max(0, n - w));
}

module.exports = { Cards, Game, AI, Presets, validateDeck, runGame, opt, has, label, pad };
