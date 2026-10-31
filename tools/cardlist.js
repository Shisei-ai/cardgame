#!/usr/bin/env node
/*
 * cardlist.js — カード一覧（Markdown）を cards.js から自動生成する
 *
 * 使い方:
 *   node tools/cardlist.js > docs/CARDS.md
 *
 * カードの数値を変えたら、これを実行し直せば一覧も最新になります。
 */
'use strict';
const { Cards, Presets } = require('./lib.js');

const out = [];
const tierCount = {};
Cards.LIST.forEach((c) => { tierCount[c.tier] = (tierCount[c.tier] || 0) + 1; });

out.push('# カード一覧');
out.push('');
out.push('> このファイルは `node tools/cardlist.js > docs/CARDS.md` で自動生成しています。直接編集しないでください。');
out.push('');
out.push(`全${Cards.LIST.length}種（強 ${tierCount.strong} / 局所 ${tierCount.niche} / 弱 ${tierCount.weak}）`);
out.push('');
out.push('格付けは設計上の狙いで、ゲーム内には表示されません。「局所」は特定のテーマや状況で光るカードです。');
out.push('');

for (const [key, arch] of Object.entries(Cards.ARCHES)) {
  // そのテーマを最初に挙げているカードを、そのテーマの節に載せる
  const cards = Cards.LIST.filter((c) => c.arch[0] === key).sort((a, b) => a.cost - b.cost);
  if (!cards.length) continue;
  const others = Cards.LIST.filter((c) => c.arch.slice(1).includes(key)).map((c) => c.name);
  const preset = Presets.DECKS.find((d) => d.key === key);
  out.push(`## ${arch.label}`);
  out.push('');
  out.push(arch.desc + (preset ? `（プリセット：${preset.name}）` : ''));
  out.push('');
  out.push('| 格付 | コスト | 詠唱 | 名前 | 種類 | 能力値 | 効果 |');
  out.push('|---|---|---|---|---|---|---|');
  for (const c of cards) {
    const cost = c.cost + (c.hpCost ? `+♥${c.hpCost}` : '');
    const cast = c.cast > 0 ? `${c.cast}s` : '瞬間';
    const stats = c.type === 'creature' ? `${c.atk}/${c.hp}` : c.type === 'relic' ? `耐久${c.hp}` : '';
    const text = (c.target ? `🎯${c.target.label}を選ぶ。 ` : '') + Cards.fullText(c, true).replace(/\|/g, '｜');
    out.push(`| ${Cards.TIERS[c.tier]} | ${cost} | ${cast} | ${c.icon} ${c.name} | ${Cards.TYPES[c.type].label} | ${stats} | ${text} |`);
  }
  if (others.length) {
    out.push('');
    out.push(`このテーマでも使えるカード：${others.join('、')}`);
  }
  out.push('');
}

out.push('## トークン');
out.push('');
out.push('カードの効果で生成されるクリーチャー。デッキには入れられず、出たときに攻撃せず、倒れても墓地に行きません。');
out.push('');
Cards.TOKENS.forEach((t) => out.push(`- ${t.icon} ${t.name}（${t.atk}/${t.hp}）`));
out.push('');

console.log(out.join('\n'));
