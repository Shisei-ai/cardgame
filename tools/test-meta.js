#!/usr/bin/env node
/*
 * test-meta.js — メタ効果（相手のカードの使用を制限する効果）が、正しく掛かって正しく解けるかを確かめる
 *   node tools/test-meta.js
 */
'use strict';
const path = require('path');
const js = (f) => require(path.join(__dirname, '..', 'js', f));
const { Game } = js('engine.js');
const { BASE, get, X, T } = js('cards.js');

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) pass++; else { fail++; console.log('✗', name); } };

const C = (id, kind, cost, extra = {}) => ({ id, name: id, icon: '・', kind, cost, grade: 'silver', power: kind === 'creature' ? 1000 : undefined, keywords: [], effects: kind === 'spell' ? [X('cast', 'heal', { n: 500 })] : [], ...extra });
const filler = Array.from({ length: 40 }, () => get('b_wolf'));

/** プレイヤー0の手番・メインステップで、プレイヤー0に制限 r を掛けた状態を作る */
function setup(restrict, hand) {
  const g = new Game({ decks: [filler.slice(), filler.slice()], seed: 1, first: 0 });
  g.start();
  const p = g.players[0];
  p.hand = hand.map((s) => g._inst(s, 0));
  p.mana = p.maxMana = 10;
  p.restrict = restrict.map((r) => ({ ...r, by: 1 }));
  return { g, p, op: g.players[1] };
}
const can = (g, p, i) => g.canPlay(0, p.hand[i].iid).ok;

// 呪文の制限
{ const { g, p } = setup([{ k: 'spellLockLE', n: 3 }], [C('s2', 'spell', 2), C('s4', 'spell', 4), C('c2', 'creature', 2)]);
  ok(!can(g, p, 0), 'コスト3以下の呪文封じ：コスト2の呪文は使えない'); ok(can(g, p, 1), '…コスト4の呪文は使える'); ok(can(g, p, 2), '…クリーチャーは使える'); }
{ const { g, p } = setup([{ k: 'spellLockGE', n: 4 }], [C('s2', 'spell', 2), C('s4', 'spell', 4)]);
  ok(can(g, p, 0), 'コスト4以上の呪文封じ：コスト2は使える'); ok(!can(g, p, 1), '…コスト4は使えない'); }
{ const { g, p } = setup([{ k: 'spellLock', n: 0 }], [C('s1', 'spell', 1), C('c1', 'creature', 1)]);
  ok(!can(g, p, 0), '呪文封じ：呪文は使えない'); ok(can(g, p, 1), '…クリーチャーは使える'); }
// 召喚の制限
{ const { g, p } = setup([{ k: 'summonLockLE', n: 2 }], [C('c2', 'creature', 2), C('c3', 'creature', 3), C('s1', 'spell', 1)]);
  ok(!can(g, p, 0), 'コスト2以下の召喚封じ：コスト2は出せない'); ok(can(g, p, 1), '…コスト3は出せる'); ok(can(g, p, 2), '…呪文は使える'); }
{ const { g, p } = setup([{ k: 'summonLockGE', n: 6 }], [C('c5', 'creature', 5), C('c6', 'creature', 6)]);
  ok(can(g, p, 0), 'コスト6以上の召喚封じ：コスト5は出せる'); ok(!can(g, p, 1), '…コスト6は出せない'); }
// マナの上限
{ const { g, p } = setup([{ k: 'manaCap', n: 3 }], [C('c4', 'creature', 4), C('c2a', 'creature', 2), C('c2b', 'creature', 2)]);
  ok(!can(g, p, 0), 'マナ3まで：コスト4は使えない（マナは10ある）'); ok(can(g, p, 1), '…コスト2は使える');
  g.play(0, p.hand[1].iid); ok(!can(g, p, 1), '…2を使った後、もう1枚のコスト2は使えない'); }
// 使える枚数
{ const { g, p } = setup([{ k: 'playLimit', n: 1 }], [C('c1a', 'creature', 1), C('c1b', 'creature', 1)]);
  ok(can(g, p, 0), 'カード1枚まで：1枚目は使える'); g.play(0, p.hand[0].iid); ok(!can(g, p, 0), '…2枚目は使えない'); }
// 火種
{ const { g, p } = setup([{ k: 'emberLock', n: 0 }], [C('c2', 'creature', 2)]);
  p.mana = 0; p.ember = 3; ok(!can(g, p, 0), '火種封じ：火種しかない時は使えない'); p.restrict = []; ok(can(g, p, 0), '…封じがなければ火種で使える'); }
// 攻撃の制限
{ const { g, p } = setup([{ k: 'attackLimit', n: 1 }], []);
  for (let i = 0; i < 2; i++) { const u = g._newUnit(p, g._inst(get('b_wolf'), 0)); u.sick = false; p.field.push(u); }
  g.toAttack(0); ok(g.canAttack(0, p.field[0].uid), '攻撃1回まで：1体目は攻撃できる');
  g.attack(0, p.field[0].uid, 'player'); ok(!g.canAttack(0, p.field[1].uid), '…2体目は攻撃できない'); }
{ const { g, p } = setup([{ k: 'attackLock', n: 0 }], []);
  const u = g._newUnit(p, g._inst(get('b_wolf'), 0)); u.sick = false; p.field.push(u); g.toAttack(0);
  ok(!g.canAttack(0, u.uid), '攻撃封じ：攻撃できない'); }
// ドロー・墓地・効果での召喚・回復・起動
{ const { g, p } = setup([{ k: 'drawLock', n: 0 }], [C('d', 'spell', 1, { effects: [X('cast', 'draw', { n: 2 })] })]);
  const before = p.hand.length; g.play(0, p.hand[0].iid); ok(p.hand.length === before - 1, 'ドロー封じ：引く呪文を使っても増えない'); }
{ const { g, p } = setup([{ k: 'graveLock', n: 0 }], [C('r', 'spell', 1, { effects: [X('cast', 'regrow', { n: 1 })] })]);
  p.grave.push(g._inst(get('b_wolf'), 0)); g.play(0, p.hand[0].iid); ok(p.grave.some((c) => c.spec.id === 'b_wolf'), '墓地封じ：墓地から回収できない'); }
{ const { g, p } = setup([{ k: 'noFreeSummon', n: 0 }], [C('t', 'spell', 1, { effects: [X('cast', 'token', { n: 2, tp: 1000 })] })]);
  g.play(0, p.hand[0].iid); ok(p.field.length === 0, '効果で出す封じ：トークンが出ない'); }
{ const { g, p } = setup([{ k: 'healLock', n: 0 }], [C('h', 'spell', 1, { effects: [X('cast', 'heal', { n: 2000 })] })]);
  p.hp = 5000; g.play(0, p.hand[0].iid); ok(p.hp === 5000, '回復封じ：回復しない'); }
{ const { g, p } = setup([{ k: 'activateLock', n: 0 }], []);
  const u = g._newUnit(p, g._inst(get('b_alchemist'), 0)); u.sick = false; p.field.push(u);
  ok(!g.canActivate(0, u.uid, 0), '起動封じ：起動効果を使えない'); p.restrict = []; ok(g.canActivate(0, u.uid, 0), '…封じがなければ使える'); }
// 迎撃・対抗
{ const { g, p } = setup([{ k: 'reactLock', n: 0 }], []);
  ok(!!g.metaBlocks(p, get('b_parry')), '迎撃・対抗封じ：迎撃呪文は使えない'); ok(!!g.metaBlocks(p, get('b_negate')), '…対抗呪文も使えない'); ok(!g.metaBlocks(p, get('b_insight')), '…普通の呪文は使える'); }
// 常在のメタ効果（相手の場にいる限り）
{ const { g, p, op } = setup([], [C('c2', 'creature', 2), C('c3', 'creature', 3)]);
  op.field.push(g._newUnit(op, g._inst(get('b_gatekeeper'), 1)));
  ok(!can(g, p, 0), '常在：相手の門番がいる限り、コスト2以下は出せない'); ok(can(g, p, 1), '…コスト3は出せる');
  op.field = []; ok(can(g, p, 0), '…門番がいなくなれば出せる'); }
// 制限は、掛けた人の次のターンの始めに解ける
{ const { g, p } = setup([{ k: 'spellLock', n: 0 }], [C('s1', 'spell', 1)]);
  g.endTurn(0); // プレイヤー1のターンが始まる → 掛けた人（1）のターンの始めに解ける
  ok(p.restrict.length === 0, '制限は掛けた人の次のターンの始めに解ける'); }
// 打ち消し（コスト◯以下）
{ const g = new Game({ decks: [filler.slice(), filler.slice()], seed: 1, first: 0 });
  g.start();
  const p = g.players[0], op = g.players[1];
  p.mana = p.maxMana = 10; op.mana = op.maxMana = 10;
  const neg = { id: 'n3', name: 'n3', icon: '・', kind: 'spell', cost: 1, grade: 'silver', keywords: [], effects: [X('counter', 'negateLE', { n: 3 })] };
  op.hand = [g._inst(neg, 1), g._inst(neg, 1)];
  op.chooser = (req) => (req.kind === 'counter' ? [req.options[0]] : []);
  p.hand = [g._inst(C('h2', 'spell', 2, { effects: [X('cast', 'heal', { n: 1000 })] }), 0), g._inst(C('h6', 'spell', 6, { effects: [X('cast', 'heal', { n: 1000 })] }), 0)];
  p.hp = 5000;
  g.play(0, p.hand[0].iid); ok(p.hp === 5000, 'コスト3以下の打ち消し：コスト2の呪文は打ち消される');
  g.play(0, p.hand[0].iid); ok(p.hp === 6000, '…コスト6の呪文は打ち消されない'); }

console.log(`メタ効果のテスト：${pass}件成功、${fail}件失敗`);
process.exit(fail ? 1 : 0);
