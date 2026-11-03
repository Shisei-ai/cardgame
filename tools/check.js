#!/usr/bin/env node
/*
 * check.js — 基本カードが規則（容量など）を満たしているかを一覧で確認する
 *   node tools/check.js
 */
'use strict';
const path = require('path');
const Parts = require(path.join(__dirname, '..', 'js', 'parts.js'));
const Cards = require(path.join(__dirname, '..', 'js', 'cards.js'));

let bad = 0;
for (const c of Cards.BASE) {
  const u = Parts.usage(c);
  const cap = Parts.capacity(c.cost, c.grade);
  const err = Parts.validate(c);
  if (err.length) bad++;
  const kind = c.kind === 'creature' ? `P${c.power}` : '呪文';
  console.log(`${err.length ? '✗' : '○'} ${String(c.cost).padStart(2)}  ${(c.name + '　　　　　　').slice(0, 7)} ${kind.padEnd(7)} 容量 ${String(u.total).padStart(3)} / ${String(cap).padStart(3)}  ${Parts.cardLines(c).join(' ')}${err.length ? '  ← ' + err.join(' / ') : ''}`);
}
console.log(`\n${Cards.BASE.length}種中、規則違反 ${bad}種`);
process.exit(bad ? 1 : 0);
