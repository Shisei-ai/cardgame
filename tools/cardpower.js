#!/usr/bin/env node
/*
 * cardpower.js — カード1枚ごとの「強さ」を測るツール
 *
 * 2つの指標を出します。
 *
 *  ① 汎用力（どのデッキに入れても強いか）
 *     テーマを持たない平凡な「基準デッキ」の【見張りの弓兵】4枚を、調べたいカード4枚に入れ替え、
 *     全プリセットとの勝率がどれだけ上がるかを測る。
 *
 *  ② テーマ内貢献（相性の良いデッキで光るか）
 *     そのカードが入っているプリセットから、そのカードを全て【見張りの弓兵】に入れ替え、
 *     勝率がどれだけ下がるかを測る（下がるほど、そのデッキに欠かせないカード）。
 *
 * 設計上の狙い:
 *   強カード   … ①も②も高い
 *   局所カード … ①は低めだが、②が高い
 *   弱カード   … ①も②も低い
 *
 * 使い方:
 *   node tools/cardpower.js              # 全カード（1カードにつき 9デッキ×16戦×2指標）
 *   node tools/cardpower.js --games 40   # 精度を上げる（時間がかかる）
 *   node tools/cardpower.js --only bolt,raider   # 一部のカードだけ
 */
'use strict';
const { Cards, Presets, runGame, opt, pad } = require('./lib.js');

const GAMES = Number(opt('games', 16));
const LEVEL = opt('level', 'hard');
const ONLY = opt('only', '');
const FILLER = 'archer';

// 基準デッキ：特定のテーマに寄らない、ごく平凡な構成
const BASE = {
  [FILLER]: 4, squire: 4, wolf: 4, shieldman: 4, imp: 4, librarian: 4, mercenary: 4,
  knight: 2, bolt: 3, charge: 3, insight: 4,
};
const gauntlet = Presets.DECKS.map((d) => Presets.toList(d.cards));

function winRate(cards) {
  const list = Presets.toList(cards);
  let w = 0, total = 0, seed = 1000;
  for (const opp of gauntlet) {
    for (let i = 0; i < GAMES; i++) {
      const swap = i % 2 === 1;
      const g = runGame(swap ? opp : list, swap ? list : opp, seed++, LEVEL);
      if (g.winner === (swap ? 1 : 0)) w++;
      else if (g.winner === -1) w += 0.5;
      total++;
    }
  }
  return w / total;
}

function swapIn(cards, id) {
  const c = { ...cards };
  const n = c[FILLER] || 0;
  delete c[FILLER];
  c[id] = (c[id] || 0) + n;
  return c;
}

const baseWR = winRate(BASE);
const presetWR = {};
Presets.DECKS.forEach((d) => { presetWR[d.key] = winRate(d.cards); });

const targets = Cards.LIST.filter((c) => !ONLY || ONLY.split(',').includes(c.id));
const rows = [];
for (const c of targets) {
  // ① 汎用力
  const generic = c.id === FILLER ? 0 : winRate(swapIn(BASE, c.id)) - baseWR;
  // ② テーマ内貢献：そのカードを最も多く採用しているプリセットで測る
  const home = Presets.DECKS.filter((d) => d.cards[c.id]).sort((a, b) => b.cards[c.id] - a.cards[c.id])[0];
  let theme = null;
  if (home) {
    const without = { ...home.cards };
    without[FILLER] = (without[FILLER] || 0) + without[c.id];
    delete without[c.id];
    theme = presetWR[home.key] - winRate(without);
  }
  rows.push({ c, generic, theme, home });
  process.stderr.write('.');
}
process.stderr.write('\n');

const fmt = (x) => (x == null ? '   ―  ' : ((x >= 0 ? '+' : '') + (x * 100).toFixed(1)).padStart(6) + '%');
console.log(`\n基準デッキ勝率 ${(baseWR * 100).toFixed(1)}% / 1指標あたり ${gauntlet.length * GAMES}戦\n`);
console.log(pad('カード', 20) + '格付 ' + '  汎用力' + '  テーマ内貢献（測定デッキ）');
for (const tier of ['strong', 'niche', 'weak']) {
  const rs = rows.filter((r) => r.c.tier === tier).sort((a, b) => b.generic + (b.theme || 0) - (a.generic + (a.theme || 0)));
  if (!rs.length) continue;
  for (const r of rs) {
    console.log(pad(r.c.name, 20) + pad(Cards.TIERS[tier], 5) + fmt(r.generic) + '  ' + fmt(r.theme) + (r.home ? `（${r.home.name.match(/（(.+)）/)[1]}）` : ''));
  }
  const avg = (k) => rs.filter((r) => r[k] != null).reduce((s, r, _, a) => s + r[k] / a.length, 0);
  console.log(pad(`  ── ${Cards.TIERS[tier]}カード平均`, 25) + fmt(avg('generic')) + '  ' + fmt(avg('theme')) + '\n');
}
