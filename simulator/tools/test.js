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
const Engine = require('../js/engine.js');
const { Game, validateDeck } = Engine;
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
      case 'option': return Math.floor(r() * req.options.length);
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
const total = (g) => g.players.reduce((n, P) => n + P.deck.length + P.hand.length + P.mana.length + P.shields.length + P.grave.length + P.hyperZone.length + P.grZone.length + P.battle.reduce((m, c) => m + 1 + c.under.length, 0), 0);

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
  const all = [...P.deck, ...P.hand, ...P.shields, ...P.grave, ...P.mana, ...P.hyperZone, ...P.grZone];
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


  console.log('\n[3b] 新しい仕組み（選択・山札を見る・タマシード・ハイパー化・ヨビニオン・ツインパクト・ターンをとばす）');
  const ans = (o) => new ScriptAgent(o);
  const fresh = (a0, a1, first = 0) => freshGame([a0 || new CpuAgent(), a1 || new CpuAgent()], null, null, first);
  const castNow = async (g, pi, id) => { const c = put(g, pi, id, 'hand'); await g.castSpell(pi, c, { fromHand: true }); return c; };
  await check('言い回し：「〜してもよい」は使うか選べる（任意）、言い切りは必ず使う（強制）', async () => {
    const opt = TextParser.parse('■このクリーチャーが出た時、相手のクリーチャーを1体選び、破壊してもよい。', 'creature').triggers[0].effects[0];
    const must = TextParser.parse('■このクリーチャーが出た時、相手のクリーチャーを1体選び、破壊する。', 'creature').triggers[0].effects[0];
    assert.strictEqual(opt.optional, true); assert.ok(!must.optional);
    // 強制のターン飛ばしは質問せずに実行、任意のものは使うかどうか聞かれる
    let asked = 0;
    const g = fresh(ans({ yesno: () => { asked++; return false; } }));
    const watcher = put(g, 0, 'vigil', 'battle');
    await assert.rejects(g.resolveEffects(0, TextParser.parse(byId.s_observer.text, 'creature').triggers[0].effects, watcher), (e) => e instanceof Engine.SkipTurn);
    assert.strictEqual(asked, 0, '強制なので聞かれない');
    await g.resolveEffects(0, TextParser.parse(byId.s_vigil.text, 'creature').triggers.find((t) => t.when === 'oppCastSpell').effects, watcher);
    assert.strictEqual(asked, 1, '任意なので聞かれ、「いいえ」ならとばさない');
  });
  await check('選択（次のうちいずれか1つ）：手札を1枚捨ててから、選んだ方だけ実行する', async () => {
    const g = fresh(ans({ option: () => 1 }));
    const t = put(g, 1, 'golm', 'battle'); // 5000
    const h = g.players[0].hand.length;
    await castNow(g, 0, 'shatter');
    assert.strictEqual(t.zone, 'grave', '2番目（破壊）を選んだ');
    assert.strictEqual(g.players[0].hand.length, h - 1, '1枚捨てて、引いていない');
  });
  await check('山札を見て振り分ける：手札・マナ・墓地に1枚ずつ、残りは山札の下', async () => {
    const g = fresh();
    const P = g.players[0];
    const [h, m, gr, d] = [P.hand.length, P.mana.length, P.grave.length, P.deck.length];
    const bottomBefore = P.deck[0];
    await castNow(g, 0, 'tune');
    assert.strictEqual(P.hand.length, h + 1); assert.strictEqual(P.mana.length, m + 1); assert.strictEqual(P.grave.length, gr + 2, '振り分けた1枚＋唱えた呪文');
    assert.strictEqual(P.deck.length, d - 3);
    assert.notStrictEqual(P.deck[0], bottomBefore, '残りの1枚が山札の一番下に入った');
  });
  await check('山札を見て、条件に合うカードを手札に（なければ取らない）', async () => {
    const g = fresh(ans({ target: (game, req) => req.purpose.op === 'look' ? req.candidates.slice(0, req.max) : undefined }));
    const P = g.players[0];
    const top = P.deck.slice(-5);
    const creatures = top.filter((c) => c.def.type === 'creature').length;
    const h = P.hand.length;
    await castNow(g, 0, 'blueprint');
    assert.strictEqual(P.hand.length, h + Math.min(1, creatures));
  });
  await check('墓地をシャッフルして山札の下へ → 2枚引く', async () => {
    const g = fresh(ans({ option: () => 1 }));
    const O = g.players[1];
    put(g, 1, 'golm', 'grave'); put(g, 1, 'pipi', 'grave');
    const od = O.deck.length;
    await castNow(g, 0, 'farewell');
    assert.strictEqual(O.grave.length, 0);
    assert.strictEqual(O.deck.length, od + 2);
  });
  await check('手札を山札の下に置き、その枚数より1枚多く引く', async () => {
    const g = fresh(ans({ option: () => 0, target: (game, req) => req.purpose.op === 'cycleHand' ? req.candidates.slice(0, 2) : undefined }));
    const P = g.players[0];
    const h = P.hand.length;
    await castNow(g, 0, 'pact');
    assert.strictEqual(P.hand.length, h - 2 + 3);
  });
  await check('条件付き：マナが5枚以下ならドロー（6枚以上なら引かない）', async () => {
    const g = fresh();
    const P = g.players[0];
    while (P.mana.length > 2) g.move(P.mana[0], 'grave');
    let h = P.hand.length;
    await castNow(g, 0, 'harvest');
    assert.strictEqual(P.hand.length, h + 1, 'マナ3枚なので引く');
    while (P.mana.length < 7) put(g, 0, 'golm', 'mana');
    h = P.hand.length;
    await castNow(g, 0, 'harvest');
    assert.strictEqual(P.hand.length, h, 'マナ8枚なので引かない');
  });
  await check('タマシード：クリーチャーではない（攻撃されない・クリーチャー除去で選ばれない）が、エレメント除去では選ばれる', async () => {
    const g = fresh();
    const t = put(g, 1, 'sigil', 'battle', { tapped: true });
    const a = put(g, 0, 'golm', 'battle');
    assert.ok(!g.attackTargets(a).includes(t.uid), 'タップしていても攻撃できない');
    await castNow(g, 0, 'whisper'); // 相手のクリーチャーを1体破壊
    assert.strictEqual(t.zone, 'battle');
    await g.doEffect(0, TextParser.parseSentence('相手のコスト5以下のエレメントを1つ選び、破壊する'), a);
    assert.strictEqual(t.zone, 'grave');
  });
  await check('タマシード：出た時の能力・手札からマナに置くとアンタップ・シンカライズで進化元になる', async () => {
    const g = fresh(ans({ number: (game, req) => req.max }));
    const P = g.players[0];
    const h = P.hand.length;
    const t = put(g, 0, 'sigil', 'hand');
    await g.putCreature(0, t, null, '使った', { summoned: true });
    assert.strictEqual(P.hand.length, h - 1 + 3 - 1, '1枚捨てて3枚引いて1枚捨てた');
    const m = put(g, 0, 'sigil', 'hand');
    g.move(m, 'mana');
    assert.strictEqual(m.tapped, false, '多色でもアンタップで置ける');
    const evo = Object.assign({}, byId.s_zelga, { id: 's_test_evo', text: '■進化－自分の《魔導紋》1体の上に置く。' });
    assert.ok(g.evolutionBases(0, evo).includes(t));
  });
  await check('ハイパー化：他のクリーチャーをタップするとパワーが上がり、ハイパーモードの能力が加わる（W・ブレイカーは元から）', async () => {
    const g = fresh();
    const L = put(g, 0, 'lunaris', 'battle');
    const other = put(g, 0, 'golm', 'battle');
    assert.ok(g.mainActions(0).some((a) => a.kind === 'hyper' && a.uid === L.uid));
    assert.strictEqual(g.power(L), 5000);
    assert.strictEqual(g.kw(L, 'breaker'), 2, 'ハイパーモードでなくてもW・ブレイカー');
    assert.ok(!g.ab(L).triggers.some((t) => t.when === 'selfCastFromHand'), '再詠唱はハイパーモード中だけ');
    await g.activateHyper(0, L);
    assert.ok(other.tapped);
    assert.strictEqual(g.power(L), 10000);
    assert.strictEqual(g.kw(L, 'breaker'), 2);
    assert.ok(g.ab(L).triggers.some((t) => t.when === 'selfCastFromHand'));
    g.turnNo++; g.active = 1; // 相手のターン（まだ続く）
    assert.ok(L.hyper);
    g.active = 0; L.hyper = L.hyper; // 自分のターンのはじめは playTurn が戻す
  });
  await check('ハイパーモード中：手札から呪文を唱えると、墓地からもう一度唱えられる（墓地からの分では誘発しない）', async () => {
    const g = fresh(ans({ yesno: () => true }));
    const L = put(g, 0, 'lunaris', 'battle'); put(g, 0, 'golm', 'battle');
    await g.activateHyper(0, L);
    const h = g.players[0].hand.length;
    await castNow(g, 0, 'wisdom'); // 2枚引く
    assert.strictEqual(g.players[0].hand.length, h + 4, '2回唱えて4枚引いた（3回目はない）');
  });
  await check('攻撃する時：手札の水のコスト5以下の呪文をタダで唱えられる', async () => {
    let sp = null;
    const g = fresh(ans({ target: (game, req) => req.purpose.op === 'castFree' ? [sp.uid] : undefined, yesno: () => false }));
    const L = put(g, 0, 'lunaris', 'battle');
    sp = put(g, 0, 'whirl', 'hand');
    const t = put(g, 1, 'golm', 'battle');
    for (const s of [...g.players[1].shields]) g.move(s, 'grave'); put(g, 1, 'golm', 'shield');
    await g.attack(L, 'player');
    assert.strictEqual(sp.zone, 'grave', '呪文を唱えた');
    assert.strictEqual(t.zone, 'hand', '相手のクリーチャーが手札に戻った');
  });
  await check('ヨビニオン：召喚した時、コストが小さいクリーチャーが出るまでめくって出す', async () => {
    const g = fresh();
    const P = g.players[0];
    const before = P.battle.length;
    const deckBefore = P.deck.length;
    put(g, 0, 'golm', 'deck'); // 山札の上（コスト4 < 5）
    g.move(P.deck[0], 'deck'); // 一番下のカードを上へ（golm は山札の一番下に入るので、上に置き直す）
    const G = put(g, 0, 'garmund', 'hand');
    await g.putCreature(0, G, null, '召喚した', { summoned: true });
    assert.ok(P.battle.length >= before + 2, 'ガルムンドと、めくったクリーチャーが出た');
    assert.strictEqual(P.deck.length + P.battle.length + P.grave.length + P.hand.length + P.mana.length + P.shields.length, deckBefore + 5 + 5 + 2 + (before) , 'カードの数は変わらない');
  });
  await check('キーワードを与える：出たばかりのクリーチャーもスピードアタッカーで攻撃できる', async () => {
    const g = fresh();
    put(g, 0, 'garmund', 'battle');
    const n = put(g, 0, 'golm', 'battle', { sick: true });
    assert.ok(g.attackTargets(n).includes('player'));
    assert.ok(g.kw(n, 'guardman'));
  });
  await check('ガードマン：自分の他のクリーチャーへの攻撃を、かわりに受ける', async () => {
    const g = fresh(ans({ target: (game, req) => (req.purpose.op === 'guardman' ? [req.candidates[0]] : undefined) }), null, 1);
    g.active = 1;
    put(g, 0, 'garmund', 'battle', { tapped: true }); // ガードマンを与える（自分自身はタップ中）
    const victim = put(g, 0, 'pipi', 'battle', { tapped: true });
    const guard = put(g, 0, 'gardion', 'battle'); // 9000
    const att = put(g, 1, 'golm', 'battle'); // 5000
    g.agents[1] = new CpuAgent();
    await g.attack(att, victim.uid);
    assert.strictEqual(victim.zone, 'battle', '狙われたクリーチャーは無事');
    assert.ok(guard.tapped);
    assert.strictEqual(att.zone, 'grave', 'ガードマンとのバトルに負けた');
  });
  await check('アタック・チャンス：条件に合うクリーチャーの攻撃で、手札の呪文をタダで唱える（マナ1枚につき-1000）', async () => {
    const g = fresh(ans({ yesno: (game, req) => req.purpose.op === 'attackChance' ? true : undefined }));
    const P = g.players[0];
    while (P.mana.length > 4) g.move(P.mana[0], 'grave');
    while (P.mana.length < 4) put(g, 0, 'golm', 'mana');
    const att = put(g, 0, 'chimera', 'battle');
    const sp = put(g, 0, 'finale', 'hand');
    const t = put(g, 1, 'gardion', 'battle', { tapped: false }); // 9000、ブロッカー
    const tgt = put(g, 1, 'garo', 'battle', { tapped: true });
    await g.attack(att, tgt.uid);
    assert.strictEqual(sp.zone, 'grave');
    assert.strictEqual(P.mana.length, 6, '2枚マナに置いた');
  });
  await check('アタック・チャンス：条件に合わないクリーチャーでは使えない', async () => {
    const g = fresh(ans({ yesno: () => true }));
    const att = put(g, 0, 'golm', 'battle');
    const sp = put(g, 0, 'finale', 'hand');
    for (const s of [...g.players[1].shields]) g.move(s, 'grave'); put(g, 1, 'golm', 'shield');
    await g.attack(att, 'player');
    assert.strictEqual(sp.zone, 'hand');
  });
  await check('2回選ぶ：同じものを2回選べる／すべての文明がそろっていれば全部を1回ずつ', async () => {
    const g = fresh(ans({ option: () => 1 }));
    const P = g.players[0];
    let h = P.hand.length;
    await castNow(g, 0, 'oath');
    assert.strictEqual(P.hand.length, h + 4, '「2枚引く」を2回');
    for (const id of ['alba', 'poppo', 'imp', 'garo', 'pipi']) put(g, 0, id, 'battle');
    const sh = P.shields.length, m = P.mana.length;
    h = P.hand.length;
    await castNow(g, 0, 'oath');
    assert.strictEqual(P.shields.length, sh + 1, 'シールド化');
    assert.ok(P.hand.length >= h + 2, '2枚引いた');
    assert.ok(P.mana.length >= m, 'マナに置いた');
  });
  await check('ツインパクト：手札から呪文側を唱えると、カードは墓地へ', async () => {
    const g = fresh();
    const P = g.players[0];
    while (P.mana.length < 6) put(g, 0, 'whirl', 'mana');
    for (const c of P.mana) c.tapped = false;
    const c = put(g, 0, 'neptus', 'hand');
    assert.ok(g.mainActions(0).some((a) => a.kind === 'cast' && a.uid === c.uid), '呪文側（コスト6）を唱えられる');
    assert.ok(!g.mainActions(0).some((a) => a.kind === 'summon' && a.uid === c.uid), 'クリーチャー側（コスト9）は払えない');
    put(g, 1, 'golm', 'battle');
    await g.playCard(0, c, 'spell');
    assert.strictEqual(c.zone, 'grave');
  });
  await check('ツインパクト：呪文側のS・トリガー／スマッシュ・バーストでクリーチャーを残したまま呪文側を唱える', async () => {
    const g = fresh(ans({ yesno: () => true, option: () => 1 }), ans({ yesno: () => true }));
    for (const s of [...g.players[1].shields]) g.move(s, 'grave');
    put(g, 1, 'neptus', 'shield');
    const a = put(g, 0, 'golm', 'battle');
    await g.attack(a, 'player');
    assert.strictEqual(a.zone, 'hand', 'S・トリガーの呪文側で手札に戻された');
    const N = put(g, 0, 'neptus', 'battle');
    const t1 = put(g, 1, 'pipi', 'battle');
    put(g, 1, 'golm', 'shield'); // ダイレクトアタックにならないように
    await g.attack(N, 'player');
    assert.strictEqual(N.zone, 'battle', 'スマッシュ・バーストで唱えてもクリーチャーは残る');
    assert.strictEqual(t1.zone, 'hand');
  });
  await check('手札から：相手のターンの終わりに、相手のクリーチャーが3体以上多ければタダで召喚できる', async () => {
    const g = fresh(ans({ yesno: () => true }));
    const n = put(g, 0, 'neptus', 'hand');
    g.active = 1;
    for (const id of ['golm', 'pipi', 'garo']) put(g, 1, id, 'battle');
    await g.handTriggersAtTurnEnd(1);
    assert.strictEqual(n.zone, 'battle');
  });
  await check('ターンをとばす：相手がクリーチャーを出したらターンの残りをとばせる（そのターンの攻撃はできない）', async () => {
    const g = new Game({ decks: [deckOf(DECKS[1]), deckOf(DECKS[1])], agents: [new CpuAgent(), ans({ yesno: () => true })], seed: 4, first: 0 });
    g.setup();
    put(g, 1, 'vigil', 'battle');
    const P = g.players[0];
    for (let i = 0; i < 4; i++) put(g, 0, 'golm', 'mana');
    put(g, 0, 'golm', 'hand');
    let attacked = false, skipped = false;
    g.on((ev) => { if (ev.kind === 'attack' && g.active === 0) attacked = true; if (ev.kind === 'skip') skipped = true; });
    await g.playTurn();
    assert.ok(skipped, 'ターンの残りがとばされた');
    assert.ok(!attacked);
    assert.strictEqual(g.phase, 'end');
  });
  await check('ターンをとばす：相手のターン中にマナを置いたら、すぐにターンの残りがとばされる', async () => {
    const g = new Game({ decks: [deckOf(DECKS[1]), deckOf(DECKS[1])], agents: [new CpuAgent(), new CpuAgent()], seed: 5, first: 0 });
    g.setup();
    put(g, 1, 'observer', 'battle');
    let summoned = false;
    g.on((ev) => { if (ev.kind === 'summon' && g.active === 0) summoned = true; });
    await g.playTurn();
    assert.strictEqual(g.players[0].mana.length, 1, 'マナを置いた');
    assert.ok(!summoned, 'その後は何もできない');
  });
  await check('ターンをとばす：相手のクリーチャーが攻撃したら、その攻撃の後にとばす（攻撃自体は通る）', async () => {
    const g = new Game({ decks: [deckOf(DECKS[1]), deckOf(DECKS[1])], agents: [ans({ charge: () => null }), new CpuAgent()], seed: 6, first: 0 });
    g.setup();
    put(g, 1, 'observer', 'battle');
    put(g, 0, 'golm', 'battle'); put(g, 0, 'garo', 'battle');
    let attacks = 0;
    g.on((ev) => { if (ev.kind === 'attack') attacks++; });
    await g.playTurn();
    assert.strictEqual(attacks, 1, '1回だけ攻撃できた');
  });


  console.log('\n[3c] 超次元・GR・コストの増減・置換効果・革命チェンジ・侵略・ニンジャ・ストライクなど');
  const sdeck = deckOf(DECKS.find((d) => d.name === '見本：超次元とGR'));
  const freshS = (a0, a1, first = 0) => { const g = new Game({ decks: [sdeck, sdeck], agents: [a0 || new CpuAgent(), a1 || new CpuAgent()], seed: 11, first }); g.setup(); g.turnNo = 3; g.active = first; return g; };
  await check('デッキの規則：メイン40枚＋超次元ゾーン8枚まで＋GRゾーン0枚か12枚（同名2枚まで）', () => {
    assert.deepStrictEqual(validateDeck(sdeck), []);
    assert.ok(validateDeck([...sdeck, byId.s_psy_sol]).some((e) => /超次元/.test(e)));
    assert.ok(validateDeck(sdeck.filter((d) => d.id !== 's_gr_mini')).some((e) => /GRゾーン/.test(e)));
    assert.ok(validateDeck([...sdeck.filter((d) => d.id !== 's_gr_mini'), byId.s_gr_wb, byId.s_gr_wb]).some((e) => /2枚まで/.test(e)));
  });
  await check('対戦の準備：超次元ゾーン・GRゾーンのカードは山札に入らない', () => {
    const g = freshS();
    for (const P of g.players) { assert.strictEqual(P.hyperZone.length, 8); assert.strictEqual(P.grZone.length, 12); assert.strictEqual(P.deck.length + P.hand.length + P.shields.length + P.mana.length, 40); }
  });
  await check('サイキック・クリーチャー：超次元ゾーンから出て、離れる時は超次元ゾーンへ戻る', async () => {
    const g = freshS(ans({ target: (game, req) => [req.candidates[0]] }));
    const P = g.players[0];
    await castNow(g, 0, 'psycall');
    const psy = P.battle.find((c) => c.def.type === 'psychic');
    assert.ok(psy && psy.def.cost <= 5);
    await g.doEffect(1, TextParser.parseSentence('相手のクリーチャーを1体選び、持ち主の手札に戻す'), put(g, 1, 'lili', 'battle'));
    assert.strictEqual(psy.zone, 'hyper', '手札ではなく超次元ゾーンへ');
    assert.strictEqual(P.hyperZone.length, 8);
  });
  await check('コストの合計が決まった数以下になるように好きな数出す', async () => {
    const g = freshS();
    await castNow(g, 0, 'psygate');
    const out = g.players[0].battle.filter((c) => c.def.type === 'psychic');
    assert.ok(out.length >= 1);
    assert.ok(out.reduce((n, c) => n + c.def.cost, 0) <= 9);
  });
  await check('ドラグハート・ウエポン：出したクリーチャーに装備し、パワーとW・ブレイカーを与える／装備先が離れると超次元ゾーンへ', async () => {
    const g = freshS(ans({ yesno: () => true, target: (game, req) => req.purpose.op === 'putToBattle' ? [req.candidates.find((u) => game.card(u).def.id === 's_blade') || req.candidates[0]] : undefined }));
    const d = put(g, 0, 'doran', 'hand');
    await g.putCreature(0, d, null, '召喚した', { summoned: true });
    const blade = g.players[0].battle.find((c) => c.def.id === 's_blade');
    assert.ok(blade && blade.equippedTo === d.uid);
    assert.strictEqual(g.power(d), 8000);
    assert.strictEqual(g.kw(d, 'breaker'), 2);
    await g.destroyCards([d]);
    assert.strictEqual(blade.zone, 'hyper');
  });
  await check('GR召喚：GRゾーンの上から出る（召喚扱い）／離れるとGRゾーンの一番下へ', async () => {
    const g = freshS();
    const P = g.players[0];
    const top = P.grZone[P.grZone.length - 1];
    await castNow(g, 0, 'bell');
    assert.strictEqual(top.zone, 'battle');
    assert.strictEqual(P.grZone.length, 10);
    await g.destroyCards([top]);
    assert.strictEqual(top.zone, 'gr'); assert.strictEqual(P.grZone[0], top, '一番下');
  });
  await check('コスト軽減：火のクリーチャーが1少なく（1より少なくはならない）／シンパシー／相手の呪文のコスト増加', async () => {
    const g = freshS();
    const h = put(g, 0, 'baldio', 'hand');
    assert.strictEqual(g.costOf(0, h), 7);
    put(g, 0, 'pico', 'battle');
    assert.strictEqual(g.costOf(0, h), 6);
    const p2 = put(g, 0, 'phene', 'hand');
    put(g, 0, 'pico', 'battle'); put(g, 0, 'pico', 'battle');
    assert.strictEqual(g.costOf(0, p2), 1, '3-3=0 だが1より少なくならない');
    const w = put(g, 0, 'wingdragon', 'hand'); // シンパシー：竜騎兵（ピコ3体）＋ピコの軽減3
    assert.strictEqual(g.costOf(0, w), 2);
    put(g, 1, 'warden2', 'battle');
    assert.strictEqual(g.costOf(0, put(g, 0, 'psycall', 'hand')), 6, '相手の封呪の番人で呪文のコスト+1');
  });
  await check('G・ゼロ：条件を満たすとコストを支払わずに召喚できる', async () => {
    const g = freshS();
    for (const m of [...g.players[0].mana]) g.move(m, 'grave');
    const z = put(g, 0, 'zepha', 'hand');
    assert.ok(!g.mainActions(0).some((a) => a.uid === z.uid));
    put(g, 0, 'lili', 'battle');
    const a = g.mainActions(0).find((x) => x.uid === z.uid);
    assert.ok(a && a.free);
    await g.playCard(0, z, 'main', { free: true });
    assert.strictEqual(z.zone, 'battle');
  });
  await check('置換効果：破壊される時、墓地のかわりに手札へ（破壊された時の能力は働く）', async () => {
    const g = freshS();
    const c = put(g, 0, 'phene', 'battle');
    await g.destroyCards([c]);
    assert.strictEqual(c.zone, 'hand');
  });
  await check('セイバー：自分の《天使》が破壊される時、かわりにセイバーを持つクリーチャーを破壊できる', async () => {
    const g = freshS(ans({ target: (game, req) => req.purpose.op === 'saver' ? [req.candidates[0]] : undefined }));
    const angel = put(g, 0, 'zepha', 'battle');
    const sv = put(g, 0, 'garan', 'battle');
    await g.destroyCards([angel]);
    assert.strictEqual(angel.zone, 'battle'); assert.strictEqual(sv.zone, 'grave');
  });
  await check('エスケープ：離れるかわりにシールドを1つ手札に加えられる／離れた時の能力', async () => {
    const g = freshS(ans({ yesno: () => true }));
    const P = g.players[0];
    const e = put(g, 0, 'hermit', 'battle');
    const sh = P.shields.length, h = P.hand.length;
    await g.destroyCards([e]);
    assert.strictEqual(e.zone, 'battle'); assert.strictEqual(P.shields.length, sh - 1); assert.strictEqual(P.hand.length, h + 1);
    const f = put(g, 0, 'farewell2', 'battle');
    const m = P.mana.length;
    await g.destroyCards([f]); await g.settle();
    assert.strictEqual(P.mana.length, m + 1);
  });
  await check('同時に発動した能力：持ち主が解決の順番を選べる', async () => {
    let asked = null;
    const g = freshS(ans({ option: (game, req) => { if (req.purpose.op === 'triggerOrder') { asked = req.options.length; return req.options.length - 1; } } }));
    const a = put(g, 0, 'farewell2', 'battle'), b = put(g, 0, 'phene', 'battle');
    g.fireSelf(put(g, 0, 'colon', 'battle'), 'cip');
    g.fireSelf(put(g, 0, 'gr_draw', 'battle'), 'cip');
    await g.flushTriggers();
    assert.strictEqual(asked, 2);
  });
  await check('マナ武装：自然のマナが5枚以上ある時だけ効果が働く', async () => {
    const g = freshS();
    const P = g.players[0];
    for (const m of [...P.mana]) g.move(m, 'grave');
    const t = put(g, 1, 'lili', 'battle');
    await g.putCreature(0, put(g, 0, 'grim', 'hand'), null, '召喚した', { summoned: true });
    assert.strictEqual(t.zone, 'battle');
    for (let i = 0; i < 5; i++) put(g, 0, 'hermit', 'mana');
    await g.putCreature(0, put(g, 0, 'grim', 'hand'), null, '召喚した', { summoned: true });
    assert.strictEqual(t.zone, 'mana');
  });
  await check('革命チェンジ：攻撃したクリーチャーを手札に戻し、手札のクリーチャーが出て攻撃を続ける', async () => {
    const g = freshS(ans({ option: (game, req) => (req.purpose.op === 'attackSwap' ? 0 : undefined) }));
    const a = put(g, 0, 'phene', 'battle'); // 火・コスト3
    const r = put(g, 0, 'baldio', 'hand');
    const sh = g.players[1].shields.length;
    await g.attack(a, 'player');
    assert.strictEqual(a.zone, 'hand'); assert.strictEqual(r.zone, 'battle');
    assert.ok(r.tapped);
    assert.strictEqual(g.players[1].shields.length, sh - 3, 'バルディオ（T・ブレイカー）でブレイク');
  });
  await check('侵略：攻撃したクリーチャーの上に手札の進化クリーチャーを重ねて攻撃を続ける', async () => {
    const g = freshS(ans({ option: (game, req) => (req.purpose.op === 'attackSwap' ? 0 : undefined) }));
    const a = put(g, 0, 'pico', 'battle');
    const v = put(g, 0, 'blaze', 'hand');
    const sh = g.players[1].shields.length;
    await g.attack(a, 'player');
    assert.strictEqual(v.zone, 'battle'); assert.deepStrictEqual(v.under, [a]);
    assert.strictEqual(g.players[1].shields.length, sh - 2);
  });
  await check('ニンジャ・ストライク：攻撃された時にマナが足りれば手札からタダで召喚、ターンの終わりに山札の下へ', async () => {
    const g = new Game({ decks: [sdeck, sdeck], agents: [ans({ charge: () => null }), ans({ yesno: (game, req) => (req.purpose.op === 'ninjaStrike' ? true : undefined) })], seed: 21, first: 0 });
    g.setup();
    const N = put(g, 1, 'hayate', 'hand');
    while (g.players[1].mana.length < 4) put(g, 1, 'hermit', 'mana');
    put(g, 0, 'phene', 'battle').enteredTurn = 0;
    await g.playTurn();
    assert.strictEqual(N.zone, 'deck', 'ターンの終わりに山札の下へ');
    assert.strictEqual(g.players[1].deck[0], N);
  });
  await check('革命0トリガー：シールドが0の時に攻撃されると、手札からタダで使える', async () => {
    const g = freshS(null, ans({ yesno: (game, req) => (req.purpose.op === 'rev0' ? true : undefined) }));
    for (const s of [...g.players[1].shields]) g.move(s, 'grave');
    const A = put(g, 1, 'amate', 'hand');
    const att = put(g, 0, 'pico', 'battle');
    await g.attack(att, 'player');
    assert.strictEqual(A.zone, 'battle', '出てきてブロックできた');
    assert.strictEqual(g.winner, null);
  });


  console.log('\n[3d] NEO進化・超魂・コストの変化・相手の行動の禁止など（テスト用の架空カード）');
  const T = (id, name, type, civs, cost, power, races, text, extra) => { const d = Object.assign({ id: 's_t_' + id, name, type, civs, cost, power, races, text }, extra || {}); byId[d.id] = d; return d; };
  T('neo', '試験のNEO天使', 'creature', ['light'], 7, 10000, ['エンジェル・コマンド'], '■NEO進化：光のクリーチャー1体の上に置いてもよい。\n■超魂レイド\n■W・ブレイカー\n■相手は光ではない呪文を唱えられない。\n■このクリーチャーが攻撃する時、このクリーチャーに含まれるカード1枚につき、カードを1枚引いてもよい。');
  T('double', '試験の二重共鳴', 'creature', ['light'], 11, 15000, ['エンジェル・コマンド'], '■ダブル・シンパシー：エンジェル・コマンド\n■自分のマナゾーンにエンジェル・コマンド・カードが3枚以上あれば、このクリーチャーを9支払って召喚してもよい。');
  T('seed', '試験の天宝', 'tamaseed', ['light'], 2, null, ['エンジェル・コマンド・ドラゴン'], '■シンカライズ\n■各ターンに一度、自分のコマンド・カードを実行するコストを1少なくしてもよい。ただし、コストは0以下にはならない。');
  T('soul', '試験の魂', 'creature', ['nature'], 5, 5000, ['妖精'], '■超魂X\n■自分のターンに一度、クリーチャーを1体、自分のマナゾーンから召喚してもよい。');
  T('mana', '試験のマナ竜', 'evolution', ['light', 'nature'], 6, 12000, ['エンジェル・コマンド・ドラゴン'], '■このクリーチャーを、自分のマナゾーンから召喚してもよい。\n■進化：光または自然のクリーチャー1体の上に置く。\n■このクリーチャーが出た時、エレメントを1つ選び、シールド化してもよい。\n■自分の他のクリーチャーすべてのパワーを+6000し、「パワード・ブレイカー」を与える。');
  T('lord', '試験の支配者', 'creature', ['light'], 7, 9000, ['エンジェル・コマンド'], '■相手は各ターン合計2回までしか、クリーチャーを召喚したり呪文を唱えたりできない。\n■このクリーチャーが離れる時、そのパワーが0より大きければ、離れるかわりにとどまる。',
    { spellSide: { name: '試験の充填', civs: ['light'], cost: 3, text: '■自分の山札の上から3枚を表向きにする。その中から、エンジェル・コマンドをすべて手札に加え、残りを好きな順序で山札の下に置く。\n■チャージャー' } });
  T('thunder', '試験の雷王', 'creature', ['light'], 7, 8000, ['エンジェル・コマンド'], '■クリーチャーがバトルゾーンに出た時、バトルゾーンにある自分のクリーチャーを好きな数アンタップしてもよい。こうしてアンタップしたクリーチャーはそのターン、「ブロッカー」を得る。');
  T('stella', '試験の騎令嬢', 'creature', ['water'], 6, 8000, ['エンジェル・コマンド'], '■相手がカードを実行した時、自分はカードを1枚引いてもよい。このターン、相手のクリーチャーは攻撃できない。');
  T('ban', '試験の封印竜', 'creature', ['light', 'water'], 7, 7000, ['エンジェル・コマンド・ドラゴン'], '■このクリーチャーが出た時、次の相手のターンの終わりまで、相手は呪文を唱えられない。');
  T('uniq', '試験の唯一', 'creature', ['light'], 3, 3000, ['天使'], '■自分の同名のDMRは2つ以上出せない。');
  T('peek', '試験のおつかい', 'spell', ['water'], 3, null, [], '■自分の山札の上から3枚を、すべてのプレイヤーに見せる。その中から光と闇のカードをすべて自分の手札に加え、残りを墓地に置く。');
  T('fairy', '試験の妖精', 'creature', ['light'], 2, 3000, ['妖精'], '■各ターンに一度、自分の光、水、または自然のクリーチャーの召喚コストを1少なくしてもよい。ただし、コストは0以下にはならない。');
  await check('テスト用カードの文章がすべて読める', () => {
    for (const d of Object.values(byId).filter((x) => x.id.startsWith('s_t_'))) {
      for (const side of [d, d.spellSide && Object.assign({ type: 'spell' }, d.spellSide)].filter(Boolean)) assert.deepStrictEqual(TextParser.parse(side.text, side.type).unparsed, [], side.name);
    }
  });
  await check('NEO進化：普通に出すと召喚酔い／光のクリーチャーの上に重ねるとすぐ攻撃できる', async () => {
    const g = fresh(ans({ yesno: (game, req) => (req.purpose.op === 'neo' ? false : undefined), target: (game, req) => (req.purpose.op === 'soulRaid' ? [] : undefined) }));
    const a = put(g, 0, 't_neo', 'hand');
    await g.putCreature(0, a, await g.askNeoBase(0, a), '召喚した', { summoned: true });
    assert.deepStrictEqual(g.attackTargets(a), [], '重ねなければ召喚酔い');
    const g2 = fresh(ans({ yesno: () => true, target: (game, req) => (req.purpose.op === 'soulRaid' ? [] : [req.candidates[0]]) }));
    const base = put(g2, 0, 'alba', 'battle');
    const b = put(g2, 0, 't_neo', 'hand');
    await g2.putCreature(0, b, await g2.askNeoBase(0, b), '召喚した', { summoned: true });
    assert.deepStrictEqual(b.under, [base]);
    assert.ok(g2.attackTargets(b).includes('player'));
  });
  await check('超魂レイド：山札の上3枚から進化元になれるカードを下に置き、すぐ攻撃できる／含まれるカードの数だけ引ける', async () => {
    const g = fresh(ans({ yesno: () => true, target: (game, req) => (req.purpose.op === 'soulRaid' ? req.candidates.slice(0, 1) : undefined) }));
    const P = g.players[0];
    for (let i = 0; i < 3; i++) put(g, 0, 'alba', 'deck'); // 山札の上に置く
    const a = put(g, 0, 't_neo', 'hand');
    await g.putCreature(0, a, null, '出した');
    assert.strictEqual(a.under.length, 1);
    assert.ok(g.attackTargets(a).includes('player'));
    for (const s of [...g.players[1].shields]) g.move(s, 'grave'); put(g, 1, 'golm', 'shield'); put(g, 1, 'golm', 'shield'); put(g, 1, 'golm', 'shield');
    const h = P.hand.length;
    await g.attack(a, 'player');
    assert.strictEqual(P.hand.length, h + 2, '自分＋下の1枚＝2枚引いた');
  });
  await check('超魂X：下にあるカードの能力を上のクリーチャーが得る（マナゾーンから召喚、自分のターンに一度）', async () => {
    const g = fresh();
    const P = g.players[0];
    const top = put(g, 0, 'alba', 'battle');
    assert.ok(!g.mainActions(0).some((x) => x.fromMana));
    const soul = put(g, 0, 't_soul', 'grave'); g.move(soul, 'grave');
    const arr = P.grave; arr.splice(arr.indexOf(soul), 1); soul.zone = 'under'; top.under.push(soul);
    while (P.mana.length < 6) put(g, 0, 'pipi', 'mana');
    for (const m of P.mana) m.tapped = false;
    const golm = put(g, 0, 'golm', 'mana'); golm.tapped = false;
    const acts = g.mainActions(0).filter((x) => x.fromMana);
    assert.ok(acts.some((x) => x.uid === golm.uid));
    await g.playCard(0, golm, 'main', acts.find((x) => x.uid === golm.uid));
    assert.strictEqual(golm.zone, 'battle');
    assert.ok(!g.mainActions(0).some((x) => x.fromMana && x.via !== 'self'), 'このターンはもう使えない');
  });
  await check('自分の能力でマナゾーンから召喚（進化）／出た時にエレメントをシールド化／他のクリーチャーのパワー+6000とパワード・ブレイカー', async () => {
    const g = fresh(ans({ yesno: () => true, target: (game, req) => [req.candidates.find((u) => game.card(u).owner === 1) || req.candidates[0]] }));
    const P = g.players[0];
    const base = put(g, 0, 'golm', 'battle'); // 自然のクリーチャー
    const ally = put(g, 0, 'alba', 'battle');
    const m = put(g, 0, 't_mana', 'mana'); m.tapped = false;
    for (const x of [...P.mana]) if (x !== m) g.move(x, 'grave');
    for (let i = 0; i < 6; i++) { const x = put(g, 0, i % 2 ? 'pipi' : 'alba', 'mana'); x.tapped = false; }
    const act = g.mainActions(0).find((x) => x.uid === m.uid && x.fromMana);
    assert.ok(act);
    const t = put(g, 1, 'garo', 'battle');
    await g.playCard(0, m, 'main', act);
    assert.strictEqual(m.zone, 'battle'); assert.deepStrictEqual(m.under, [base]);
    assert.strictEqual(t.zone, 'shield', '相手のクリーチャーをシールド化');
    assert.strictEqual(g.power(ally), 9000);
    for (const s of [...g.players[1].shields]) g.move(s, 'grave'); for (let i = 0; i < 4; i++) put(g, 1, 'golm', 'shield');
    ally.enteredTurn = 0;
    await g.attack(ally, 'player');
    assert.strictEqual(g.players[1].shields.length, 2, 'パワー9000：パワード・ブレイカーで2枚');
  });
  await check('ダブル・シンパシー（エレメント1つにつき2少なく、タマシードも数える）と、条件つきの別のコスト', async () => {
    const g = fresh();
    const P = g.players[0];
    for (const m of [...P.mana]) g.move(m, 'grave');
    const d = put(g, 0, 't_double', 'hand');
    assert.strictEqual(g.costOf(0, d), 11);
    put(g, 0, 't_seed', 'battle'); put(g, 0, 't_neo', 'battle');
    assert.strictEqual(g.costOf(0, d), 6, '11 - 2×2 - 1（天宝の軽減）');
    for (let i = 0; i < 3; i++) put(g, 0, 't_neo', 'mana');
    assert.strictEqual(g.costOf(0, d), 4, '別のコスト9 - 4 - 1');
  });
  await check('各ターンに一度のコスト軽減：使ったら、そのターンの2枚目には掛からない', async () => {
    const g = fresh();
    const P = g.players[0];
    put(g, 0, 't_fairy', 'battle');
    while (P.mana.length < 10) put(g, 0, 'alba', 'mana');
    for (const m of P.mana) m.tapped = false;
    const a = put(g, 0, 'serafina', 'hand'), b = put(g, 0, 'serafina', 'hand');
    assert.strictEqual(g.costOf(0, a), 3);
    await g.playCard(0, a);
    assert.strictEqual(g.costOf(0, b), 4);
    g.turnNo++;
    assert.strictEqual(g.costOf(0, b), 3, '次のターンはまた使える');
  });
  await check('相手は光ではない呪文を唱えられない／出た時から次の相手のターンの終わりまで呪文を唱えられない', async () => {
    const g = fresh();
    put(g, 0, 't_neo', 'battle');
    assert.ok(!g.canCast(1, byId.s_whirl), '水の呪文は唱えられない');
    assert.ok(g.canCast(1, byId.s_flashpray), '光の呪文は唱えられる');
    const g2 = fresh();
    await g2.putCreature(0, put(g2, 0, 't_ban', 'hand'), null, '召喚した', { summoned: true });
    assert.ok(!g2.canCast(1, byId.s_flashpray));
    g2.turnNo += 1; assert.ok(!g2.canCast(1, byId.s_flashpray), '次の相手のターンも');
    g2.turnNo += 1; assert.ok(g2.canCast(1, byId.s_flashpray), 'その次からは唱えられる');
  });
  await check('相手は各ターン合計N回までしか召喚・呪文を使えない', async () => {
    const g = fresh(null, null, 1);
    g.active = 1;
    put(g, 0, 't_lord', 'battle');
    const O = g.players[1];
    while (O.mana.length < 12) put(g, 1, 'pipi', 'mana');
    for (const m of O.mana) m.tapped = false;
    O.usesThisTurn = 0;
    await g.playCard(1, put(g, 1, 'pipi', 'hand'));
    await g.playCard(1, put(g, 1, 'pipi', 'hand'));
    assert.ok(!g.mainActions(1).some((a) => a.kind === 'summon' || a.kind === 'cast'), '3回目はできない');
  });
  await check('離れるかわりにとどまる（パワーが0より大きい間）／パワーが0以下なら破壊される', async () => {
    const g = fresh();
    const L = put(g, 0, 't_lord', 'battle');
    await g.destroyCards([L]); assert.strictEqual(L.zone, 'battle');
    await g.doEffect(1, TextParser.parseSentence('相手のクリーチャーを1体選び、持ち主の手札に戻す'), put(g, 1, 'golm', 'battle'));
    assert.strictEqual(L.zone, 'battle');
    L.tempPower = -9000; await g.checkState();
    assert.strictEqual(L.zone, 'grave');
  });
  await check('表向きにして条件に合うカードをすべて手札に（種族・文明）／チャージャーで唱えた後マナへ', async () => {
    const g = fresh();
    const P = g.players[0];
    const c = put(g, 0, 't_lord', 'hand');
    for (const id of ['t_neo', 'golm', 't_neo']) put(g, 0, id, 'deck');
    const h = P.hand.length, m = P.mana.length;
    await g.castSpell(0, c, { fromHand: true });
    assert.strictEqual(P.hand.length, h - 1 + 2, '唱えた1枚が出て、エンジェル・コマンド2枚が入る');
    assert.strictEqual(c.zone, 'mana'); assert.strictEqual(P.mana.length, m + 1);
    const g2 = fresh();
    const P2 = g2.players[0];
    for (const id of ['alba', 'imp', 'golm']) put(g2, 0, id, 'deck');
    const h2 = P2.hand.length, gr = P2.grave.length;
    await castNow(g2, 0, 't_peek');
    assert.strictEqual(P2.hand.length, h2 + 2, '光と闇の2枚'); assert.strictEqual(P2.grave.length, gr + 2, '残り1枚と呪文');
  });
  await check('クリーチャーが出た時（自分も含む・相手のでも）：好きな数アンタップし、そのターン「ブロッカー」を得る', async () => {
    const g = fresh();
    const a = put(g, 0, 'golm', 'battle', { tapped: true });
    assert.ok(!g.kw(a, 'blocker'));
    await g.putCreature(0, put(g, 0, 't_thunder', 'hand'), null, '召喚した', { summoned: true });
    assert.ok(!a.tapped); assert.ok(g.kw(a, 'blocker'));
    g.turnNo++; assert.ok(!g.kw(a, 'blocker'), '次のターンには消える');
  });
  await check('相手がカードを使った時：カードを引け、そのターン相手のクリーチャーは攻撃できない', async () => {
    const g = fresh(null, ans({ yesno: () => true }), 0);
    put(g, 1, 't_stella', 'battle');
    const a = put(g, 0, 'golm', 'battle');
    assert.ok(g.attackTargets(a).length);
    const h = g.players[1].hand.length;
    await g.putCreature(0, put(g, 0, 'pipi', 'hand'), null, '召喚した', { summoned: true });
    assert.strictEqual(g.players[1].hand.length, h + 1);
    assert.deepStrictEqual(g.attackTargets(a), []);
  });
  await check('同名は2つ以上出せない', async () => {
    const g = fresh();
    await g.putCreature(0, put(g, 0, 't_uniq', 'hand'), null, '召喚した', { summoned: true });
    const b = put(g, 0, 't_uniq', 'hand');
    assert.ok(!g.canEnter(0, b));
    await g.putCreature(0, b, null, '召喚した', { summoned: true });
    assert.strictEqual(b.zone, 'hand');
  });

  console.log(`\n[4] 大量の対戦（${GAMES}戦ずつ）`);
  for (const [label, mk] of [['CPU 対 CPU', () => new CpuAgent()], ['ランダム 対 ランダム', () => new RandomAgent()]]) {
    await check(label + '：エラー・無限ループ・カードの消失なし', async () => {
      const wins = [0, 0, 0]; let turns = 0;
      for (let i = 0; i < GAMES; i++) {
        const da = DECKS[i % DECKS.length], db = DECKS[(i + 1) % DECKS.length];
        const g = new Game({ decks: [deckOf(da), deckOf(db)], agents: [mk(), mk()], seed: 1000 + i });
        const before = da.cards.length + db.cards.length;
        const res = await g.run();
        assert.strictEqual(total(g), before, `カードの合計が${before}枚でない（${total(g)}枚, seed ${1000 + i}）`);
        wins[res.winner < 0 ? 2 : res.winner === g.first ? 0 : 1]++;
        turns += res.turns;
      }
      console.log(`    先攻の勝ち ${wins[0]} / 後攻の勝ち ${wins[1]} / 引き分け ${wins[2]}　平均 ${(turns / GAMES).toFixed(1)} ターン`);
    });
  }
  await check('デッキ同士の勝率（CPU 対 CPU）', async () => {
    for (let a = 0; a < DECKS.length; a++) for (let b = a + 1; b < DECKS.length; b++) {
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
