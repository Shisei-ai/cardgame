#!/usr/bin/env node
/*
 * review.js — カードの見直し表（Markdown）を作る
 *
 * cardpower.js の測定結果（--json で保存したもの）と、review-notes.js の変更メモを合わせて、
 * 全カードを「格付け・測定値・判定・今回の変更」で一覧にします。
 *
 * 使い方:
 *   node tools/cardpower.js --json power.json
 *   node tools/review.js power.json > docs/CARD_REVIEW.md
 *
 * 判定の基準（測定の誤差はおよそ ±4%）:
 *   強   … 汎用力 +2% 以上、またはテーマ内貢献 +6% 以上なら「狙いどおり」。汎用力 +22% 超は「強め」
 *   局所 … テーマ内貢献が汎用力を上回るか +4% 以上なら「狙いどおり」（合うデッキで光る）。
 *          汎用力 +13% 超は「強め」、汎用力 -3% 未満かつテーマ内 +2% 未満は「弱め」
 *   弱   … 汎用力 +5% 以下なら「狙いどおり」、+8% 超は「強め」
 */
'use strict';
const { Cards, Presets } = require('./lib.js');
const NOTES = require('./review-notes.js');

const file = process.argv[2];
if (!file) { console.error('使い方: node tools/review.js power.json'); process.exit(1); }
const data = require(require('path').resolve(file));
const byId = Object.fromEntries(data.cards.map((r) => [r.id, r]));
const pct = (x) => (x == null ? '―' : ((x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%'));

function judge(c, r) {
  if (!r) return '未測定';
  const g = r.generic, t = r.theme;
  if (c.tier === 'strong') {
    if (g > 0.22) return '△ 強め';
    return g >= 0.02 || (t != null && t >= 0.06) ? '○' : '△ 弱め';
  }
  if (c.tier === 'niche') {
    if (g > 0.13) return '△ 強め';
    if (t == null) return g < -0.04 ? '△ 弱め' : g > 0.1 ? '△ 強め' : '○';
    if (g < -0.03 && t < 0.02) return '△ 弱め';
    return t > g || t >= 0.04 ? '○' : '○（汎用寄り）';
  }
  if (g > 0.08) return '△ 強め';
  return g <= 0.05 ? '○' : '○（やや強め）';
}

const out = [];
const counts = { '○': 0, '△ 強め': 0, '△ 弱め': 0 };
const rowsByArch = {};
for (const c of Cards.LIST) {
  const r = byId[c.id];
  const j = judge(c, r);
  if (j.startsWith('○')) counts['○']++; else if (counts[j] != null) counts[j]++;
  (rowsByArch[c.arch[0]] = rowsByArch[c.arch[0]] || []).push({ c, r, j });
}

out.push('# カードの見直し表');
out.push('');
out.push('> `node tools/review.js <cardpower の json>` で自動生成しています。変更メモは `tools/review-notes.js` にあります。');
out.push('');
out.push(`全${Cards.LIST.length}種。測定：1指標あたり ${data.games * Presets.DECKS.length}試合（誤差はおよそ ±4%）、基準デッキの勝率 ${(data.baseWR * 100).toFixed(1)}%。`);
out.push('');
out.push(`判定：○ 狙いどおり ${counts['○']}枚 ／ △ 強め ${counts['△ 強め']}枚 ／ △ 弱め ${counts['△ 弱め']}枚`);
out.push('');
out.push('- **汎用力**：テーマを持たない平凡なデッキに4枚入れたら勝率が何%上がるか');
out.push('- **テーマ内**：そのカードを使うプリセットから抜いたら勝率が何%下がるか（プリセットに入っていないカードは ―）');
out.push('- **判定**：格付け（強／局所／弱）に対して、測定値が狙いどおりか。基準は `tools/review.js` の冒頭を参照');
out.push('');
for (const [key, arch] of Object.entries(Cards.ARCHES)) {
  const rows = rowsByArch[key];
  if (!rows) continue;
  out.push(`## ${arch.label}`);
  out.push('');
  out.push('| 名前 | 格付 | コスト | 汎用力 | テーマ内 | 判定 | 今回の変更 |');
  out.push('|---|---|---|---|---|---|---|');
  rows.sort((a, b) => a.c.cost - b.c.cost).forEach(({ c, r, j }) => {
    out.push(`| ${c.icon} ${c.name} | ${Cards.TIERS[c.tier]} | ${c.cost}${c.hpCost ? '+♥' + c.hpCost : ''}${c.sacCost ? '+🔪' + c.sacCost : ''} | ${pct(r && r.generic)} | ${pct(r && r.theme)} | ${j} | ${NOTES[c.id] || ''} |`);
  });
  out.push('');
}
console.log(out.join('\n'));
