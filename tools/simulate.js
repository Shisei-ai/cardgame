#!/usr/bin/env node
/*
 * simulate.js — AI同士を大量に対戦させてバランスを検証するツール
 *
 * 使い方:
 *   node tools/simulate.js                 # 全プリセットの総当たり（各200戦, つよいAI同士）
 *   node tools/simulate.js --games 500     # 試合数を変更
 *   node tools/simulate.js --level normal  # AIの強さを変更
 *   node tools/simulate.js --cards         # カードごとの使用回数と「使った側の勝率」も表示
 *
 * 画面は使わず 0.1 秒刻みで時間を進めるので、数百試合でも数秒で終わります。
 */
'use strict';
const path = require('path');
const js = (f) => require(path.join(__dirname, '..', 'js', f));
const Cards = js('cards.js');
const { Game, validateDeck } = js('engine.js');
const { AI } = js('ai.js');
const Presets = js('presets.js');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const GAMES = Number(opt('games', 200));
const LEVEL = opt('level', 'hard');
const SHOW_CARDS = args.includes('--cards');
const DT = 0.1;

function runGame(deckA, deckB, seed) {
  const g = new Game({ decks: [deckA, deckB], seed });
  const ais = [new AI(g, 0, LEVEL), new AI(g, 1, LEVEL)];
  while (!g.over) {
    g.update(DT);
    ais.forEach((a) => a.update(DT));
  }
  return g;
}

const decks = Presets.DECKS.map((d) => ({ ...d, list: Presets.toList(d.cards) }));
for (const d of decks) {
  const errs = validateDeck(d.list);
  if (errs.length) { console.error(`デッキ「${d.name}」が不正:`, errs); process.exit(1); }
}

const cardStats = {}; // id -> { plays, wins }
const deckTotals = Object.fromEntries(decks.map((d) => [d.key, { w: 0, n: 0 }]));
let seed = 1;
let totalTime = 0, timeUps = 0, games = 0;

console.log(`\n=== 総当たり ${GAMES}戦ずつ / AI: ${LEVEL} ===\n`);
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length * 2));
for (let a = 0; a < decks.length; a++) {
  for (let b = a; b < decks.length; b++) {
    let wa = 0, wb = 0, dr = 0;
    for (let i = 0; i < GAMES; i++) {
      // 先後の偏りをなくすため、半分は席を入れ替える
      const swap = i % 2 === 1;
      const g = swap ? runGame(decks[b].list, decks[a].list, seed++) : runGame(decks[a].list, decks[b].list, seed++);
      const winA = swap ? g.winner === 1 : g.winner === 0;
      const winB = swap ? g.winner === 0 : g.winner === 1;
      if (g.winner === -1) dr++; else if (winA) wa++; else if (winB) wb++;
      totalTime += g.time; games++;
      if (g.endReason === '時間切れ') timeUps++;
      if (a !== b) {
        deckTotals[decks[a].key].n++; deckTotals[decks[b].key].n++;
        if (winA) deckTotals[decks[a].key].w++;
        if (winB) deckTotals[decks[b].key].w++;
      }
      g.players.forEach((p) => {
        for (const id in p.stats.played) {
          const s = (cardStats[id] = cardStats[id] || { plays: 0, wins: 0 });
          s.plays += p.stats.played[id];
          if (g.winner === p.index) s.wins += p.stats.played[id];
        }
      });
    }
    const pct = (x) => ((x / GAMES) * 100).toFixed(1).padStart(5) + '%';
    console.log(`${pad(decks[a].name, 30)} vs ${pad(decks[b].name, 30)}  ${pct(wa)} - ${pct(wb)}  (引分 ${dr})`);
  }
}

console.log('\n--- デッキ別 勝率（ミラー戦を除く） ---');
for (const d of decks) {
  const t = deckTotals[d.key];
  console.log(`${pad(d.name, 30)} ${((t.w / t.n) * 100).toFixed(1)}%`);
}
console.log(`\n平均試合時間: ${(totalTime / games).toFixed(1)}秒 / 時間切れ決着: ${((timeUps / games) * 100).toFixed(1)}%`);

if (SHOW_CARDS) {
  console.log('\n--- カード別（使用回数 / 使用した側の勝率） ---');
  Object.entries(cardStats)
    .sort((x, y) => y[1].wins / y[1].plays - x[1].wins / x[1].plays)
    .forEach(([id, s]) => {
      console.log(`${pad(Cards.get(id).name, 16)} ${String(s.plays).padStart(6)}回  ${((s.wins / s.plays) * 100).toFixed(1)}%`);
    });
}
console.log('');
