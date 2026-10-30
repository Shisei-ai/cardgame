#!/usr/bin/env node
/*
 * simulate.js — AI同士を大量に対戦させてバランスを検証するツール
 *
 * 使い方:
 *   node tools/simulate.js                 # 全プリセットの総当たり（各100戦, つよいAI同士）
 *   node tools/simulate.js --games 300     # 試合数を変更
 *   node tools/simulate.js --level normal  # AIの強さを変更
 *   node tools/simulate.js --cards         # カードごとの使用回数と「使った側の勝率」も表示
 *
 * 画面は使わず 0.1 秒刻みで時間を進めるので、数千試合でも数秒〜数十秒で終わります。
 */
'use strict';
const { Cards, Presets, validateDeck, runGame, opt, has, label, pad } = require('./lib.js');

const GAMES = Number(opt('games', 100));
const LEVEL = opt('level', 'hard');

const decks = Presets.DECKS.map((d) => ({ ...d, list: Presets.toList(d.cards) }));
for (const d of decks) {
  const errs = validateDeck(d.list);
  if (errs.length) { console.error(`デッキ「${d.name}」が不正:`, errs); process.exit(1); }
}

const n = decks.length;
const win = [...Array(n)].map(() => new Array(n).fill(0)); // win[a][b] = a が b に勝った数
const cardStats = {};
let seed = 1, totalTime = 0, timeUps = 0, draws = 0, games = 0;

for (let a = 0; a < n; a++) {
  for (let b = a; b < n; b++) {
    for (let i = 0; i < GAMES; i++) {
      // 先後の偏りをなくすため、半分は席を入れ替える
      const swap = i % 2 === 1;
      const g = runGame(swap ? decks[b].list : decks[a].list, swap ? decks[a].list : decks[b].list, seed++, LEVEL);
      const ia = swap ? 1 : 0;
      if (g.winner === ia) win[a][b]++;
      else if (g.winner === 1 - ia) win[b][a]++;
      else draws++;
      totalTime += g.time; games++;
      if (g.endReason === '時間切れ') timeUps++;
      g.players.forEach((p) => {
        for (const id in p.stats.played) {
          const s = (cardStats[id] = cardStats[id] || { plays: 0, wins: 0 });
          s.plays += p.stats.played[id];
          if (g.winner === p.index) s.wins += p.stats.played[id];
        }
      });
    }
  }
}

console.log(`\n=== 対戦表（行のデッキから見た勝率%） 各${GAMES}戦 / AI: ${LEVEL} ===\n`);
const W = 7;
console.log(pad('', 10) + decks.map((d) => pad(label(d), W)).join('') + '  平均');
for (let a = 0; a < n; a++) {
  let sum = 0, cnt = 0;
  const cells = decks.map((_, b) => {
    if (a === b) return pad('  -', W);
    const pct = (win[a][b] / GAMES) * 100;
    sum += pct; cnt++;
    return pad(String(Math.round(pct)).padStart(4), W);
  });
  console.log(pad(label(decks[a]), 10) + cells.join('') + String((sum / cnt).toFixed(1)).padStart(6));
}
console.log(`\n平均試合時間: ${(totalTime / games).toFixed(1)}秒 / 時間切れ決着: ${((timeUps / games) * 100).toFixed(1)}% / 引き分け: ${draws}`);

if (has('cards')) {
  console.log('\n--- カード別（使用回数 / 使用した側の勝率） ---');
  Object.entries(cardStats)
    .filter(([id]) => !Cards.get(id).token)
    .sort((x, y) => y[1].wins / y[1].plays - x[1].wins / x[1].plays)
    .forEach(([id, s]) => {
      const c = Cards.get(id);
      console.log(`${pad(c.name, 18)} [${Cards.TIERS[c.tier]}] ${String(s.plays).padStart(6)}回  ${((s.wins / s.plays) * 100).toFixed(1)}%`);
    });
}
console.log('');
