/*
 * test.js — ルール処理の確認（Node.js で実行）
 *
 *   node simulator/tools/test.js            … すべての確認
 *   node simulator/tools/test.js --games 500 … CPU同士の対戦数を変える
 *
 * 1. 見本カードのテキストがすべて読めるか
 * 2. 見本デッキが規則（40枚・同名4枚まで）を満たすか
 * 3. 個別のルール（多色マナ・ブロッカー・S・トリガー・ライブラリアウト・進化…）が正しく動くか
 * 4. CPU同士・ランダムな手を打つプレイヤー同士で大量に対戦させ、エラーや無限ループ、カードの消失がないか
 */
'use strict';
const assert = require('assert');
const TextParser = require('../js/textparser.js');
const { Game, validateDeck } = require('../js/engine.js');
const CpuAgent = require('../js/ai.js');
const { CARDS, DECKS } = require('../js/sample-cards.js');

const args = process.argv.slice(2);
const GAMES = Number(args[args.indexOf('--games') + 1]) || 200;
const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]));
let failures = 0;
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => console.log('  ✓ ' + name),
    (e) => { failures++; console.log('  ✗ ' + name + '\n    ' + (e && e.stack || e)); },
  );
}

/** 何でもランダムに答えるプレイヤー（思いがけない手順でも壊れないかを確かめる） */
class RandomAgent {
  async choose(game, pi, req) {
    const r = game.rng;
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    switch (req.type) {
      case 'charge': return r() < 0.8 ? pick(req.candidates) : null;
      case 'main': case 'attack': return pick(req.actions);
      case 'block': return r() < 0.5 ? pick(req.candidates) : null;
      case 'target': {
        const n = req.min + Math.floor(r() * (req.max - req.min + 1));
        return [...req.candidates].sort(() => r() - 0.5).slice(0, n);
      }
      case 'yesno': return r() < 0.5;
      case 'number': return req.min + Math.floor(r() * (req.max - req.min + 1));
      default: return null;
    }
  }
}

/** 決まった答えを順番に返すプレイヤー（個別のルールの確認用）。用意がない質問はCPUが答える */
class ScriptAgent {
  constructor(script = {}) { this.script = script; this.cpu = new CpuAgent(); }
  async choose(game, pi, req) {
    const s = this.script[req.type];
    if (typeof s === 'function') { const v = s(game, req); if (v !== undefined) return v; }
    return this.cpu.choose(game, pi, req);
  }
}

const deckOf = (sd) => sd.cards.map((id) => byId[id]);
const total = (g) => g.players.reduce((n, P) => n + P.deck.length + P.hand.length + P.mana.length + P.shields.length + P.grave.length + P.battle.reduce((m, c) => m + 1 + c.under.length, 0), 0);

/** 対戦の途中の盤面を手で作るための道具 */
function freshGame(agents, deckA, deckB, first = 0) {
  const g = new Game({ decks: [deckA || deckOf(DECKS[0]), deckB || deckOf(DECKS[1])], agents, seed: 1, first });
  g.setup();
  g.turnNo = 3; g.active = first;
  return g;
}
/** 指定のカードを指定のゾーンに用意する（山札から探して持ってくる） */
function put(g, pi, id, zone, opts = {}) {
  const P = g.players[pi];
  const all = [...P.deck, ...P.hand, ...P.shields, ...P.grave, ...P.mana];
  let c = all.find((x) => x.def.id === 's_' + id && x.zone !== zone);
  if (!c) { // デッキに無いカードなら作って足す
    c = { uid: g.uidSeq++, def: byId['s_' + id], owner: pi, zone: 'deck', tapped: false, enteredTurn: -1, under: [], tempPower: 0 };
    g.cards.set(c.uid, c); P.deck.unshift(c);
  }
  g.move(c, zone, opts);
  if (zone === 'battle') c.enteredTurn = opts.sick ? g.turnNo : 0;
  return c;
}

(async () => {
  console.log('\n[1] 見本カードのテキスト');
  await check('すべての見本カードが「未対応」なしで読める', () => {
    for (const c of CARDS) {
      const ab = TextParser.parse(c.text, c.type);
      assert.deepStrictEqual(ab.unparsed, [], `${c.name}: ${ab.unparsed}`);
    }
  });
  await check('S・トリガーの注釈文（ ）を取り除いて読める', () => {
    const ab = TextParser.parse('■S・トリガー（この呪文をシールドゾーンから手札に加える時、コストを支払わずにすぐ唱えてもよい）\n■相手のパワー３０００以下のクリーチャーを１体破壊する。', 'spell');
    assert.ok(ab.keywords.shieldTrigger);
    assert.strictEqual(ab.spell[0].op, 'destroy');
    assert.strictEqual(ab.spell[0].target.filter.maxPower, 3000);
  });

  console.log('\n[2] 見本デッキ');
  await check('見本デッキがすべて規則を満たす', () => {
    for (const d of DECKS) assert.deepStrictEqual(validateDeck(deckOf(d)), [], d.name);
  });
  await check('41枚・同名5枚のデッキはエラーになる', () => {
    const bad = [...deckOf(DECKS[0]), byId.s_alba];
    const errs = validateDeck(bad);
    assert.ok(errs.length >= 2, errs.join());
  });

  console.log('\n[3] 個別のルール');
  await check('対戦の準備：シールド5枚・手札5枚・山札30枚', () => {
    const g = new Game({ decks: [deckOf(DECKS[0]), deckOf(DECKS[1])], agents: [new CpuAgent(), new CpuAgent()], seed: 3 });
    g.setup();
    for (const P of g.players) { assert.strictEqual(P.shields.length, 5); assert.strictEqual(P.hand.length, 5); assert.strictEqual(P.deck.length, 30); }
  });
  await check('多色カードはタップした状態でマナゾーンに置かれる', () => {
    const g = freshGame([new CpuAgent(), new CpuAgent()]);
    const c = put(g, 0, 'lume', 'mana');
    assert.strictEqual(c.tapped, true);
    const d = put(g, 0, 'alba', 'mana');
    assert.strictEqual(d.tapped, false);
  });
  await check('コストの支払い：枚数と文明の両方が必要', () => {
    const g = freshGame([new CpuAgent(), new CpuAgent()]);
    for (const c of [...g.players[0].mana]) g.move(c, 'grave');
    put(g, 0, 'alba', 'mana'); put(g, 0, 'alba', 'mana'); put(g, 0, 'alba', 'mana');
    assert.ok(g.canPay(0, byId.s_flashpray), '光2コストは光マナ3枚で払える');
    assert.ok(!g.canPay(0, byId.s_wisdom), '水の呪文は光マナだけでは払えない');
    put(g, 0, 'poppo', 'mana');
    assert.ok(g.canPay(0, byId.s_wisdom), '水マナが1枚あれば払える');
    const pay = g.findPayment(0, byId.s_wisdom);
    assert.strictEqual(pay.length, 3);
    assert.ok(pay.some((c) => c.def.civs.includes('water')));
  });
  await check('召喚酔い：出たターンは攻撃できない／スピードアタッカーはできる', () => {
    const g = freshGame([new CpuAgent(), new CpuAgent()]);
    const a = put(g, 0, 'golm', 'battle', { sick: true });
    const b = put(g, 0, 'raider', 'battle', { sick: true });
    assert.deepStrictEqual(g.attackTargets(a), []);
    assert.ok(g.attackTargets(b).includes('player'));
  });
  await check('攻撃できるのは相手プレイヤーと、相手のタップしているクリーチャー', () => {
    const g = freshGame([new CpuAgent(), new CpuAgent()]);
    const a = put(g, 0, 'golm', 'battle');
    const t1 = put(g, 1, 'garo', 'battle');
    const t2 = put(g, 1, 'pipi', 'battle', { tapped: true });
    const ts = g.attackTargets(a);
    assert.ok(ts.includes('player') && ts.includes(t2.uid) && !ts.includes(t1.uid));
  });
  await check('ブロッカーがブロックしてバトル（パワーが小さい方が破壊）', async () => {
    const g = freshGame([new CpuAgent(), new ScriptAgent({ block: (game, req) => req.candidates[0] })]);
    const a = put(g, 0, 'garo', 'battle'); // 3000（攻撃中は+2000で5000）
    const b = put(g, 1, 'alba', 'battle'); // 3000 ブロッカー
    await g.attack(a, 'player');
    assert.strictEqual(b.zone, 'grave', 'パワーアタッカーで5000になったガロが勝つ');
    assert.strictEqual(a.zone, 'battle');
    assert.strictEqual(g.players[1].shields.length, 5, 'ブロックされたのでシールドは減らない');
  });
  await check('同じパワーなら両方破壊／スレイヤーは負けても相手を破壊', async () => {
    const g = freshGame([new CpuAgent(), new ScriptAgent({ block: (game, req) => req.candidates[0] })]);
    const a = put(g, 0, 'golm', 'battle'); // 5000
    const b = put(g, 1, 'ghoul', 'battle'); // 2000 ブロッカー・スレイヤー
    await g.attack(a, 'player');
    assert.strictEqual(a.zone, 'grave'); assert.strictEqual(b.zone, 'grave');
    const c = put(g, 0, 'garo', 'battle');
    const d = put(g, 1, 'golm', 'battle', { tapped: true });
    d.tempPower = -2000; // 3000 にする（ガロは攻撃中5000）
    await g.attack(c, d.uid);
    assert.strictEqual(d.zone, 'grave'); assert.strictEqual(c.zone, 'battle');
  });
  await check('シールドのブレイク：W・ブレイカーは2枚、手札に加わる', async () => {
    const g = freshGame([new CpuAgent(), new ScriptAgent({ yesno: () => false })]);
    const a = put(g, 0, 'gardion', 'battle');
    const hand = g.players[1].hand.length;
    await g.attack(a, 'player');
    assert.strictEqual(g.players[1].shields.length, 3);
    assert.strictEqual(g.players[1].hand.length, hand + 2);
  });
  await check('S・トリガー：ブレイクされた呪文をタダで唱えられる', async () => {
    const g = freshGame([new CpuAgent(), new ScriptAgent({ yesno: (game, req) => req.purpose.op === 'shieldTrigger' })]);
    for (const s of [...g.players[1].shields]) g.move(s, 'grave');
    put(g, 1, 'whirl', 'shield'); // 相手のクリーチャーを手札に戻す
    const a = put(g, 0, 'golm', 'battle');
    await g.attack(a, 'player');
    assert.strictEqual(a.zone, 'hand', 'S・トリガーで攻撃したクリーチャーが手札に戻った');
    assert.ok(g.players[1].grave.some((c) => c.def.id === 's_whirl'), '唱えた呪文は墓地へ');
  });
  await check('S・トリガーのクリーチャーはタダで出る', async () => {
    const g = freshGame([new CpuAgent(), new CpuAgent()]);
    const def = Object.assign({}, byId.s_alba, { id: 's_test_st', text: '■S・トリガー\n■ブロッカー' });
    byId.s_test_st = def;
    for (const s of [...g.players[1].shields]) g.move(s, 'grave');
    put(g, 1, 'test_st', 'shield');
    const a = put(g, 0, 'golm', 'battle');
    await g.attack(a, 'player');
    assert.strictEqual(g.players[1].battle.length, 1);
  });
  await check('シールド0枚でプレイヤーへの攻撃が通るとダイレクトアタックで勝ち', async () => {
    const g = freshGame([new CpuAgent(), new CpuAgent()]);
    for (const s of [...g.players[1].shields]) g.move(s, 'grave');
    const a = put(g, 0, 'golm', 'battle');
    await assert.rejects(g.attack(a, 'player'), (e) => e.winner === 0);
  });
  await check('山札が0枚になったら負け（ライブラリアウト）', async () => {
    const g = freshGame([new CpuAgent(), new CpuAgent()]);
    const P = g.players[0];
    while (P.deck.length > 1) g.move(P.deck[0], 'grave');
    await assert.rejects(g.draw(0, 1), (e) => e.winner === 1);
  });
  await check('進化：進化元に重ねて出る・召喚酔いしない・離れる時は下のカードも一緒', async () => {
    const g = freshGame([new ScriptAgent({ target: (game, req) => [req.candidates[0]] }), new CpuAgent()]);
    const base = put(g, 0, 'volka', 'battle');
    assert.ok(g.evolutionBases(0, byId.s_zelga).includes(base));
    const z = put(g, 0, 'zelga', 'hand');
    for (const m of g.players[0].mana) m.tapped = false;
    while (g.players[0].mana.length < 5) put(g, 0, 'raider', 'mana');
    await g.playCard(0, z);
    assert.strictEqual(z.zone, 'battle');
    assert.deepStrictEqual(z.under, [base]);
    assert.ok(g.attackTargets(z).includes('player'));
    await g.destroyCards([z]);
    assert.strictEqual(base.zone, 'grave');
    assert.strictEqual(g.players[0].battle.length, 0);
  });
  await check('常在効果：自分の他の火のクリーチャーのパワー+1000', () => {
    const g = freshGame([new CpuAgent(), new CpuAgent()]);
    const flag = put(g, 0, 'banner', 'battle');
    const garo = put(g, 0, 'garo', 'battle');
    const pipi = put(g, 0, 'pipi', 'battle');
    assert.strictEqual(g.power(garo), 4000);
    assert.strictEqual(g.power(flag), 3000, '自分自身には掛からない');
    assert.strictEqual(g.power(pipi), 1000, '火以外には掛からない');
  });
  await check('ジャストダイバー：出たターンは相手に選ばれず、攻撃されない', async () => {
    const g = freshGame([new CpuAgent(), new CpuAgent()], null, null, 1);
    const k = put(g, 0, 'kirigakure', 'battle', { tapped: true });
    assert.ok(k.jdProtected);
    const a = put(g, 1, 'golm', 'battle');
    g.active = 1;
    assert.ok(!g.attackTargets(a).includes(k.uid));
  });
  await check('効果：出た時にカードを引く・相手の手札を捨てさせる・マナ加速', async () => {
    const g = freshGame([new CpuAgent(), new CpuAgent()]);
    const P = g.players[0], O = g.players[1];
    const h = P.hand.length, oh = O.hand.length, m = P.mana.length;
    await g.putCreature(0, put(g, 0, 'poppo', 'hand'), null, '出した');
    assert.strictEqual(P.hand.length, h + 1 - 0);
    await g.putCreature(0, put(g, 0, 'collector', 'hand'), null, '出した');
    assert.strictEqual(O.hand.length, oh - 1);
    await g.putCreature(0, put(g, 0, 'pipi', 'hand'), null, '出した');
    assert.strictEqual(P.mana.length, m + 1);
  });
  await check('パワーが0以下になったクリーチャーは破壊される', async () => {
    const g = freshGame([new CpuAgent(), new CpuAgent()]);
    const c = put(g, 1, 'pipi', 'battle');
    c.tempPower = -1000;
    await g.checkState();
    assert.strictEqual(c.zone, 'grave');
  });

  console.log(`\n[4] 大量の対戦（${GAMES}戦ずつ）`);
  for (const [label, mk] of [['CPU 対 CPU', () => new CpuAgent()], ['ランダム 対 ランダム', () => new RandomAgent()]]) {
    await check(label + '：エラー・無限ループ・カードの消失なし', async () => {
      const wins = [0, 0, 0]; let turns = 0;
      for (let i = 0; i < GAMES; i++) {
        const da = DECKS[i % 3], db = DECKS[(i + 1) % 3];
        const g = new Game({ decks: [deckOf(da), deckOf(db)], agents: [mk(), mk()], seed: 1000 + i });
        const before = 80;
        const res = await g.run();
        assert.strictEqual(total(g), before, `カードの合計が80枚でない（${total(g)}枚, seed ${1000 + i}）`);
        wins[res.winner < 0 ? 2 : res.winner === g.first ? 0 : 1]++;
        turns += res.turns;
      }
      console.log(`    先攻の勝ち ${wins[0]} / 後攻の勝ち ${wins[1]} / 引き分け ${wins[2]}　平均 ${(turns / GAMES).toFixed(1)} ターン`);
    });
  }
  await check('デッキ同士の勝率（CPU 対 CPU）', async () => {
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      let wa = 0; const N = Math.max(20, GAMES / 5);
      for (let i = 0; i < N; i++) {
        const g = new Game({ decks: [deckOf(DECKS[a]), deckOf(DECKS[b])], agents: [new CpuAgent(), new CpuAgent()], seed: 5000 + i });
        const r = await g.run();
        if (r.winner === 0) wa++;
      }
      console.log(`    ${DECKS[a].name} 対 ${DECKS[b].name}：${Math.round((wa / N) * 100)}% 勝ち`);
    }
  });

  console.log(failures ? `\n✗ ${failures}件の失敗` : '\n✓ すべて成功');
  process.exit(failures ? 1 : 0);
})();
