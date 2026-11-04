/*
 * parts.js — カードを作るための「部品」と「容量」の規則（v2：テキスト効果の文法）
 *
 * このゲームのカードは、基本カードもオリジナルカードも、すべてこのファイルの規則で組み立てます。
 *
 * ■ 容量（キャパシティ）
 *   容量 ＝ (BASE + PER_COST × コスト) × 素質の倍率（小数切り捨て）
 *   パワー・キーワード効果・テキスト効果が、それぞれ容量を使う（＝ポイント）。合計が容量以下なら作れる。
 *   目安：1ポイント ≒ パワー40 ≒ カード1/8枚。
 *
 * ■ テキスト効果の形（v2）
 *   {
 *     trig : 発動の場面（TRIGGERS）        lim  : 回数の制限（LIMITS。何度も起きる場面だけ）
 *     conds: [{ k, n }]（CONDS。2つまで）  pay  : { k, n }（COSTS。「〜してもよい」／起動効果のコスト）
 *     tapToo: 起動効果で、コストに加えてタップも必要か
 *     act  : 効果（ACTIONS）              n    : 量
 *     tgt  : { who, count, how, f, fn }（対象。誰を・何体・どう選ぶ・絞り込みとその値）
 *     dur  : 期間（DURATIONS）            per  : 「〜につき」の倍化（PERS）
 *     kw   : キーワード（キーワードを与える効果・トークン）  tp : トークンのパワー
 *   }
 *   容量 ＝ 効果の基本値 × 対象の倍率 × 発動の場面 × 回数 × 条件 × 代償 × 倍化（効果の種類ごとに必要なものだけ）
 *
 * ■ 歯止め（容量とは別の上限）
 *   ・メタ効果（相手のカードの使用を制限する効果：呪文封じ・召喚封じ・攻撃封じ・打ち消し・相手のコスト増）は
 *     容量を多く使ううえ、カードのコストに下限がある（minCost）。素質が高くても、軽いカードには付けられない
 *   ・テキスト効果は3つ、キーワード効果は3つまで。条件は1つの効果に2つまで
 *   ・デメリット（容量が戻る効果やキーワード）で戻る容量は、容量の1/4まで
 *   ・「何度でも」は自分を強くし続ける効果（アンタップ・追加攻撃）には付けられない
 *   ・「〜につき」の倍化は最大6倍まで
 *   ・効果が効果を呼ぶ連鎖は12段まで、1つの効果は1ターンに10回まで（エンジン側）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Parts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────────── 容量 ─────────────
  const CAP = { BASE: 10, PER_COST: 10, POWER_PER_POINT: 40, REFUND_MAX: 0.25, PER_MAX: 6 };
  const COST_MIN = 1, COST_MAX = 20;
  const POWER_MIN = 500, POWER_MAX = 12000, POWER_STEP = 500;
  const MAX_KEYWORDS = 3, MAX_EFFECTS = 3, MAX_CONDS = 2;

  const GRADES = {
    iron:     { label: '鉄',   mult: 0.75, weight: 30, color: '#9aa1ab' },
    copper:   { label: '銅',   mult: 0.9,  weight: 28, color: '#d08a55' },
    silver:   { label: '銀',   mult: 1.0,  weight: 22, color: '#dfe6ee' },
    gold:     { label: '金',   mult: 1.15, weight: 12, color: '#f0c14b' },
    platinum: { label: '白金', mult: 1.3,  weight: 6,  color: '#a8ecff' },
    star:     { label: '星輝', mult: 1.6,  weight: 2,  color: '#ff9be6' },
  };
  function rollGrade(rand = Math.random) {
    let r = rand() * Object.values(GRADES).reduce((s, g) => s + g.weight, 0);
    for (const [id, g] of Object.entries(GRADES)) { r -= g.weight; if (r < 0) return id; }
    return 'iron';
  }
  function capacity(cost, grade) {
    const g = GRADES[grade] || GRADES.silver;
    return Math.floor((CAP.BASE + CAP.PER_COST * cost) * g.mult);
  }
  function powerPoints(p) {
    const k = CAP.POWER_PER_POINT;
    return p <= 5000 ? p / k : 5000 / k + ((p - 5000) / k) * 1.5;
  }

  // ───────────── キーワード効果 ─────────────
  const KEYWORDS = {
    guard:    { label: '守護', pts: 8,   desc: '相手のクリーチャーが攻撃した時、アンタップしているこのクリーチャーが代わりに攻撃を受ける（受けるとタップする）' },
    assassin: { label: '刺客', pts: 14,  desc: 'クリーチャーとのバトルの後、勝敗に関わらず、バトルした相手のクリーチャーを破壊する' },
    haste:    { label: '速攻', pts: 10,  desc: '召喚したターンから攻撃できる' },
    double:   { label: '連撃', pts: 16,  desc: '1ターンに2回攻撃できる' },
    pierce:   { label: '貫通', pts: 8,   desc: '攻撃してバトルに勝った時、パワーの差の分だけ相手にダメージを与える' },
    stealth:  { label: '隠密', pts: 10,  desc: 'このクリーチャーの攻撃は、守護に引き受けられず、ブロックもされない' },
    undying:  { label: '不屈', pts: 10,  desc: '最初に破壊される時、1度だけ破壊されない' },
    sniper:   { label: '狙撃', pts: 12,  desc: 'アンタップしている相手のクリーチャーにも攻撃できる' },
    drain:    { label: '吸収', pts: 8,   desc: '相手にダメージを与えた時、同じだけ自分の体力を回復する' },
    ward:     { label: '加護', pts: 8,   desc: '相手のカードの効果で選ばれない' },
    slow:     { label: '鈍重', pts: -12, desc: '【デメリット】攻撃できない' },
    fleeting: { label: '自壊', pts: -18, desc: '【デメリット】自分のターンの終わりに破壊される' },
  };

  // ───────────── 発動の場面 ─────────────
  // grp: 選択欄での分類 / rep: 何度も起きる（回数の制限を選べる） / kind: 使えるカードの種類
  const TRIGGERS = {
    // このクリーチャーの出来事
    summon:       { grp: 'このクリーチャー', label: '召喚した時',                 mult: 1.0 },
    attack:       { grp: 'このクリーチャー', label: '攻撃した時',                 mult: 1.3, rep: true },
    attacked:     { grp: 'このクリーチャー', label: '攻撃された時',               mult: 0.9, rep: true, phrase: 'このクリーチャーが攻撃された時' },
    block:        { grp: 'このクリーチャー', label: '攻撃を受け止めた時（ブロック・守護）', mult: 0.9, rep: true, phrase: 'このクリーチャーが攻撃を受け止めた時' },
    battle:       { grp: 'このクリーチャー', label: 'バトルした時',               mult: 1.0, rep: true },
    win:          { grp: 'このクリーチャー', label: 'バトルに勝った時',           mult: 0.8, rep: true },
    hitPlayer:    { grp: 'このクリーチャー', label: '相手にダメージを与えた時',   mult: 1.1, rep: true, phrase: 'このクリーチャーが相手にダメージを与えた時' },
    destroyed:    { grp: 'このクリーチャー', label: '破壊された時',               mult: 0.8 },
    leave:        { grp: 'このクリーチャー', label: '場を離れた時（破壊・手札に戻る等）', mult: 0.85, phrase: '場を離れた時' },
    // ターン
    turnStart:    { grp: 'ターン', label: '自分のターンの始め',   mult: 1.6, phrase: '自分のターンの始めに' },
    turnEnd:      { grp: 'ターン', label: '自分のターンの終わり', mult: 1.5, phrase: '自分のターンの終わりに' },
    oppTurnStart: { grp: 'ターン', label: '相手のターンの始め',   mult: 1.3, phrase: '相手のターンの始めに' },
    oppTurnEnd:   { grp: 'ターン', label: '相手のターンの終わり', mult: 1.2, phrase: '相手のターンの終わりに' },
    // 場の出来事
    allySummon:     { grp: '場の出来事', label: '他の味方を召喚した時',           mult: 1.4, rep: true },
    enemySummon:    { grp: '場の出来事', label: '相手がクリーチャーを召喚した時', mult: 1.2, rep: true },
    allyDestroyed:  { grp: '場の出来事', label: '他の味方が破壊された時',         mult: 1.2, rep: true },
    enemyDestroyed: { grp: '場の出来事', label: '相手のクリーチャーが破壊された時', mult: 1.2, rep: true },
    spellCast:      { grp: '場の出来事', label: '自分が呪文を唱えた時',           mult: 1.3, rep: true },
    oppSpellCast:   { grp: '場の出来事', label: '相手が呪文を唱えた時',           mult: 1.1, rep: true },
    oppAttack:      { grp: '場の出来事', label: '相手のクリーチャーが攻撃した時', mult: 1.3, rep: true },
    discard:        { grp: '場の出来事', label: '自分の手札からカードが捨てられた時', mult: 0.7, rep: true },
    damaged:        { grp: '場の出来事', label: '自分がダメージを受けた時',       mult: 1.2, rep: true },
    healed:         { grp: '場の出来事', label: '自分の体力が回復した時',         mult: 1.0, rep: true },
    emberGained:    { grp: '場の出来事', label: '自分が火種を得た時',             mult: 1.1, rep: true },
    // 起動・常在
    activate: { grp: '起動・常在', label: '【起動】自分のメインステップに、コストを払って使う', mult: 1.2, rep: true, activated: true },
    static:   { grp: '起動・常在', label: '【常在】場にいる限り',                             mult: 1.0, static: true },
    // 呪文
    cast:    { grp: '呪文', label: '唱えた時（自分のメインステップ）',         mult: 1.0,  kind: 'spell' },
    react:   { grp: '呪文', label: '〔迎撃〕相手のクリーチャーが攻撃した時に唱える', mult: 1.15, kind: 'spell' },
    counter: { grp: '呪文', label: '〔対抗〕相手が呪文を唱えた時に唱える',     mult: 1.2,  kind: 'spell' },
  };
  const trigKind = (t) => (TRIGGERS[t] && TRIGGERS[t].kind) || 'creature';

  const LIMITS = {
    turn1: { label: '各ターン1回',     mult: 1.0, text: '（各ターン1回）', max: 1 },
    turn2: { label: '各ターン2回まで', mult: 1.5, text: '（各ターン2回まで）', max: 2 },
    free:  { label: '何度でも',         mult: 2.0, text: '', max: 10 },
    game1: { label: '1試合に1回',       mult: 0.5, text: '（1試合に1回）', max: 1, game: true },
  };

  // ───────────── 条件 ─────────────
  // ns: 選べる値 / mult(n): 容量の倍率 / text(n): 文章 / test(g, p, src, n)
  const C = (label, ns, mult, text, test, kind) => ({ label, ns, mult, text, test, kind });
  const CONDS = {
    handLE:    C('手札が◯枚以下',             [0, 1, 2, 3], (n) => [0.5, 0.6, 0.7, 0.8][n], (n) => (n ? `手札が${n}枚以下なら、` : '手札がなければ、'), (g, p, s, n) => p.hand.length <= n),
    handGE:    C('手札が◯枚以上',             [4, 6, 8],    (n) => ({ 4: 0.9, 6: 0.75, 8: 0.6 })[n], (n) => `手札が${n}枚以上なら、`, (g, p, s, n) => p.hand.length >= n),
    lifeLE:    C('自分の体力が◯以下',         [2000, 4000, 6000], (n) => ({ 2000: 0.6, 4000: 0.75, 6000: 0.9 })[n], (n) => `自分の体力が${n}以下なら、`, (g, p, s, n) => p.hp <= n),
    lifeGE:    C('自分の体力が◯以上',         [6000, 9000], (n) => ({ 6000: 0.85, 9000: 0.7 })[n], (n) => `自分の体力が${n}以上なら、`, (g, p, s, n) => p.hp >= n),
    lifeBehind: C('自分の体力が相手より少ない', [0], () => 0.8, () => '自分の体力が相手より少なければ、', (g, p) => p.hp < g.opp(p).hp),
    alliesGE:  C('自分のクリーチャーが◯体以上', [2, 3, 4, 5], (n) => ({ 2: 0.9, 3: 0.8, 4: 0.65, 5: 0.5 })[n], (n) => `自分の場にクリーチャーが${n}体以上いれば、`, (g, p, s, n) => p.field.length >= n),
    alliesLE:  C('自分のクリーチャーが◯体以下', [1, 2], (n) => ({ 1: 0.75, 2: 0.85 })[n], (n) => `自分の場のクリーチャーが${n}体以下なら、`, (g, p, s, n) => p.field.length <= n),
    enemiesGE: C('相手のクリーチャーが◯体以上', [2, 3, 4], (n) => ({ 2: 0.85, 3: 0.75, 4: 0.6 })[n], (n) => `相手の場にクリーチャーが${n}体以上いれば、`, (g, p, s, n) => g.opp(p).field.length >= n),
    enemyMore: C('相手のクリーチャーの方が多い', [0], () => 0.75, () => '相手の場のクリーチャーの方が多ければ、', (g, p) => g.opp(p).field.length > p.field.length),
    enemyNone: C('相手の場にクリーチャーがいない', [0], () => 0.7, () => '相手の場にクリーチャーがいなければ、', (g, p) => g.opp(p).field.length === 0),
    graveGE:   C('自分の墓地が◯枚以上',       [5, 10, 15], (n) => ({ 5: 0.85, 10: 0.7, 15: 0.55 })[n], (n) => `自分の墓地が${n}枚以上あれば、`, (g, p, s, n) => p.grave.length >= n),
    deckLE:    C('自分の山札が◯枚以下',       [10, 20], (n) => ({ 10: 0.5, 20: 0.75 })[n], (n) => `自分の山札が${n}枚以下なら、`, (g, p, s, n) => p.deck.length <= n),
    maxManaGE: C('自分の最大マナが◯以上',     [6, 10, 15], (n) => ({ 6: 0.85, 10: 0.7, 15: 0.5 })[n], (n) => `自分の最大マナが${n}以上なら、`, (g, p, s, n) => p.maxMana >= n),
    emberGE:   C('自分の火種が◯つ以上',       [1, 2, 4], (n) => ({ 1: 0.9, 2: 0.8, 4: 0.6 })[n], (n) => `自分の火種が${n}つ以上あれば、`, (g, p, s, n) => p.ember >= n),
    spelled:   C('このターンに呪文を唱えた',   [0], () => 0.75, () => 'このターンに自分が呪文を唱えていれば、', (g, p) => p.spellsThisTurn > 0),
    oppHandLE: C('相手の手札が◯枚以下',       [1, 2, 3], (n) => ({ 1: 0.6, 2: 0.7, 3: 0.8 })[n], (n) => `相手の手札が${n}枚以下なら、`, (g, p, s, n) => g.opp(p).hand.length <= n),
    turnGE:    C('自分の第◯ターン以降',       [4, 7, 10], (n) => ({ 4: 0.9, 7: 0.75, 10: 0.6 })[n], (n) => `自分の第${n}ターン以降なら、`, (g, p, s, n) => p.turns >= n),
    hasGuard:  C('自分の場に守護がいる',       [0], () => 0.85, () => '自分の場に【守護】を持つクリーチャーがいれば、', (g, p) => p.field.some((u) => g.hasKw(u, 'guard'))),
    selfTapped: C('このクリーチャーがタップしている', [0], () => 0.85, () => 'このクリーチャーがタップしていれば、', (g, p, s) => !!(s && s.tapped), 'creature'),
  };

  // ───────────── 代償（「〜してもよい。そうしたら」／起動効果のコスト） ─────────────
  // te: 「〜して」の形 / dict: 「〜する」の形
  const COSTS = {
    none:       { label: 'なし', ns: [0], mult: () => 1 },
    tapSelf:    { label: 'このクリーチャーをタップする', ns: [0], mult: () => 0.7, te: () => 'このクリーチャーをタップして', dict: () => 'このクリーチャーをタップする', kind: 'creature' },
    discard:    { label: '手札を◯枚捨てる',   ns: [1, 2], mult: (n) => ({ 1: 0.7, 2: 0.55 })[n], te: (n) => `手札を${n}枚捨てて`, dict: (n) => `手札を${n}枚捨てる` },
    life:       { label: '体力を◯支払う',     ns: [500, 1000, 2000], mult: (n) => ({ 500: 0.85, 1000: 0.72, 2000: 0.58 })[n], te: (n) => `体力を${n}支払って`, dict: (n) => `体力を${n}支払う` },
    mana:       { label: 'マナを◯払う',       ns: [1, 2, 3, 4, 5], mult: (n) => Math.max(0.5, 1 - 0.09 * n), te: (n) => `マナを${n}払って`, dict: (n) => `マナを${n}払う` },
    ember:      { label: '火種を◯つ払う',     ns: [1, 2, 3], mult: (n) => 1 - 0.12 * n, te: (n) => `火種を${n}つ払って`, dict: (n) => `火種を${n}つ払う` },
    sacSelf:    { label: 'このクリーチャーを破壊する', ns: [0], mult: () => 0.45, te: () => 'このクリーチャーを破壊して', dict: () => 'このクリーチャーを破壊する', kind: 'creature' },
    sacAlly:    { label: '他の味方を1体破壊する', ns: [0], mult: () => 0.6, te: () => '他の自分のクリーチャーを1体破壊して', dict: () => '他の自分のクリーチャーを1体破壊する' },
    exileGrave: { label: '墓地のカードを◯枚除外する', ns: [3, 5], mult: (n) => ({ 3: 0.85, 5: 0.75 })[n], te: (n) => `自分の墓地のカードを${n}枚除外して`, dict: (n) => `自分の墓地のカードを${n}枚除外する` },
  };

  // ───────────── 対象 ─────────────
  const WHO = {
    enemy:      { label: '相手のクリーチャー',       noun: '相手のクリーチャー', side: 'enemy' },
    any:        { label: 'クリーチャー（敵味方問わず）', noun: 'クリーチャー', side: 'any' },
    self:       { label: 'このクリーチャー',         noun: 'このクリーチャー', side: 'ally', self: true, kind: 'creature' },
    ally:       { label: '自分のクリーチャー',       noun: '自分のクリーチャー', side: 'ally' },
    allyOther:  { label: '他の自分のクリーチャー',   noun: '他の自分のクリーチャー', side: 'ally', kind: 'creature' },
    attacker:   { label: '攻撃してきたクリーチャー', noun: '攻撃してきたクリーチャー', side: 'enemy', self: true, single: true },
  };
  // 「攻撃してきたクリーチャー」を対象にできる発動の場面
  const ATTACKER_TRIGS = ['react', 'oppAttack', 'attacked', 'block'];
  const COUNTS = { 1: { label: '1体', mult: 1.0 }, 2: { label: '2体', mult: 1.7 }, 3: { label: '3体', mult: 2.3 }, all: { label: '全て', mult: 2.5 } };
  const HOWS = {
    choose:   { label: '選ぶ',             mult: 1.0 },
    random:   { label: 'ランダム',         mult: 0.75 },
    strongest:{ label: 'パワーが最も大きい', mult: 0.95 },
    weakest:  { label: 'パワーが最も小さい', mult: 0.7 },
  };
  const FILTERS = {
    none:    { label: 'しぼらない', ns: [0], mult: () => 1, text: () => '' },
    powerLE: { label: 'パワー◯以下', ns: [1000, 2000, 3000, 4000, 6000], mult: (n) => ({ 1000: 0.45, 2000: 0.6, 3000: 0.72, 4000: 0.82, 6000: 0.92 })[n], text: (n) => `パワー${n}以下の`, test: (g, u, n) => g.powerOf(u) <= n },
    powerGE: { label: 'パワー◯以上', ns: [3000, 5000], mult: (n) => ({ 3000: 0.85, 5000: 0.7 })[n], text: (n) => `パワー${n}以上の`, test: (g, u, n) => g.powerOf(u) >= n },
    costLE:  { label: 'コスト◯以下', ns: [2, 4, 6], mult: (n) => ({ 2: 0.5, 4: 0.7, 6: 0.85 })[n], text: (n) => `コスト${n}以下の`, test: (g, u, n) => u.spec.cost <= n },
    costGE:  { label: 'コスト◯以上', ns: [5, 8], mult: (n) => ({ 5: 0.75, 8: 0.6 })[n], text: (n) => `コスト${n}以上の`, test: (g, u, n) => u.spec.cost >= n },
    tapped:  { label: 'タップしている', ns: [0], mult: () => 0.7, text: () => 'タップしている', test: (g, u) => u.tapped },
    untapped:{ label: 'アンタップの',   ns: [0], mult: () => 0.85, text: () => 'アンタップの', test: (g, u) => !u.tapped },
    hasKw:   { label: 'キーワードを持つ', ns: Object.keys(KEYWORDS).filter((k) => KEYWORDS[k].pts > 0), mult: () => 0.55, text: (k) => `【${KEYWORDS[k].label}】を持つ`, test: (g, u, k) => g.hasKw(u, k) },
    token:   { label: 'トークン', ns: [0], mult: () => 0.5, text: () => 'トークンの', test: (g, u) => !!u.spec.token },
  };

  const DURATIONS = {
    turn:      { label: 'このターン',               text: 'このターン',               mult: 1.0 },
    untilNext: { label: '次の自分のターンの始めまで', text: '次の自分のターンの始めまで', mult: 1.25 },
    perm:      { label: 'ずっと',                   text: '',                         mult: 2.5 },
  };

  const PERS = {
    none:       { label: 'なし', mult: 1 },
    ally:       { label: '自分のクリーチャー1体につき',     mult: 2.2, text: '自分の場のクリーチャー1体につき' },
    allyOther:  { label: '他の自分のクリーチャー1体につき', mult: 1.8, text: '他の自分のクリーチャー1体につき', kind: 'creature' },
    enemy:      { label: '相手のクリーチャー1体につき',     mult: 2.0, text: '相手の場のクリーチャー1体につき' },
    hand:       { label: '自分の手札1枚につき',             mult: 2.6, text: '自分の手札1枚につき' },
    grave3:     { label: '自分の墓地3枚につき',             mult: 2.2, text: '自分の墓地のカード3枚につき' },
    ember:      { label: '自分の火種1つにつき',             mult: 2.0, text: '自分の火種1つにつき' },
    spells:     { label: 'このターンに唱えた呪文1枚につき', mult: 1.4, text: 'このターンに自分が唱えた呪文1枚につき' },
  };

  // ───────────── 効果 ─────────────
  // cat: 分類 / side: 'none'（対象なし）・'enemy'/'ally'/'both'（クリーチャーが対象。whos で選べる側） / ns: 量
  // pts(e): 基本の容量 / style: 対象の言い回し（obj:〜を◯◯する / poss:〜の◯◯を / grant:〜に◯◯を）
  // dur/per/kw/token: その要素を選べるか / trig: この発動の場面でだけ使える / statik: 常在で使える
  const A = (o) => o;
  const AMT_P = [500, 1000, 2000, 3000, 5000];
  const COST_LIM = [3, 5, 8, 99];
  const costLimText = (n) => (n >= 99 ? '' : `コスト${n}以下の`);
  const ACTIONS = {
    // ── カード・手札 ──
    draw:        A({ cat: 'カード・手札', label: 'カードを引く', side: 'none', ns: [1, 2, 3, 4, 5], pts: (e) => 8 * e.n, per: true, text: (e) => `カードを${e.n}枚引く` }),
    loot:        A({ cat: 'カード・手札', label: 'カードを引いて、1枚捨てる', side: 'none', ns: [1, 2, 3], pts: (e) => Math.max(3, 8 * e.n - 5), text: (e) => `カードを${e.n}枚引き、その後、手札を1枚選んで捨てる` }),
    discardSelf: A({ cat: 'カード・手札', label: '自分の手札を捨てる（デメリット）', side: 'none', ns: [1, 2], pts: (e) => -5 * e.n, text: (e) => `自分の手札を${e.n}枚選んで捨てる` }),
    oppDiscard:  A({ cat: 'カード・手札', label: '相手の手札をランダムに捨てさせる', side: 'none', ns: [1, 2, 3], pts: (e) => 11 * e.n, text: (e) => `相手の手札をランダムに${e.n}枚捨てさせる` }),
    oppDiscardPick: A({ cat: 'カード・手札', label: '相手の手札を見て選んで捨てさせる', side: 'none', ns: [1, 2], pts: (e) => 14 * e.n, text: (e) => `相手の手札を見て、${e.n}枚選んで捨てさせる` }),
    searchCreature: A({ cat: 'カード・手札', label: '山札からクリーチャーを手札に（サーチ）', side: 'none', ns: COST_LIM, pts: (e) => ({ 3: 10, 5: 12, 8: 14, 99: 16 })[e.n], text: (e) => `自分の山札から${costLimText(e.n)}クリーチャーを1枚選んで手札に加え、山札を切り直す` }),
    searchSpell: A({ cat: 'カード・手札', label: '山札から呪文を手札に（サーチ）', side: 'none', ns: COST_LIM, pts: (e) => ({ 3: 10, 5: 12, 8: 14, 99: 16 })[e.n], text: (e) => `自分の山札から${costLimText(e.n)}呪文を1枚選んで手札に加え、山札を切り直す` }),
    lookTop:     A({ cat: 'カード・手札', label: '山札の上を見て1枚を手札に', side: 'none', ns: [3, 4, 5], pts: (e) => 6 + 2 * e.n, text: (e) => `自分の山札の上から${e.n}枚を見て、1枚を手札に加え、残りを墓地に置く` }),
    regrow:      A({ cat: 'カード・手札', label: '墓地のクリーチャーを手札に戻す', side: 'none', ns: [1, 2], pts: (e) => 9 * e.n, text: (e) => `自分の墓地からクリーチャーを${e.n}枚選んで手札に戻す` }),
    regrowAny:   A({ cat: 'カード・手札', label: '墓地のカードを手札に戻す', side: 'none', ns: [1, 2], pts: (e) => 11 * e.n, text: (e) => `自分の墓地からカードを${e.n}枚選んで手札に戻す` }),
    millSelf:    A({ cat: 'カード・手札', label: '自分の山札の上を墓地に置く', side: 'none', ns: [2, 3, 5], pts: (e) => e.n, text: (e) => `自分の山札の上から${e.n}枚を墓地に置く` }),
    millOpp:     A({ cat: 'カード・手札', label: '相手の山札の上を墓地に置く', side: 'none', ns: [2, 3, 5], pts: (e) => 2 * e.n, per: true, text: (e) => `相手の山札の上から${e.n}枚を墓地に置く` }),
    // ── マナ・火種 ──
    manaGain:  A({ cat: 'マナ・火種', label: 'マナを回復する', side: 'none', ns: [1, 2, 3, 5], pts: (e) => 4 * e.n, per: true, text: (e) => `マナを${e.n}回復する` }),
    rampMax:   A({ cat: 'マナ・火種', label: '最大マナを増やす', side: 'none', ns: [1, 2, 3], pts: (e) => 12 * e.n, text: (e) => `自分の最大マナを${e.n}増やす` }),
    manaBurn:  A({ cat: 'マナ・火種', label: '相手の最大マナを減らす', side: 'none', ns: [1, 2], pts: (e) => 16 * e.n, text: (e) => `相手の最大マナを${e.n}減らす` }),
    emberGain: A({ cat: 'マナ・火種', label: '火種を得る', side: 'none', ns: [1, 2, 3], pts: (e) => 5 * e.n, per: true, text: (e) => `火種を${e.n}つ得る` }),
    emberBurn: A({ cat: 'マナ・火種', label: '相手の火種をなくす', side: 'none', ns: [1, 2, 3], pts: (e) => 4 * e.n, text: (e) => `相手の火種を${e.n}つ取り除く` }),
    costDown:  A({ cat: 'マナ・火種', label: '次に使うカードのコストを下げる', side: 'none', ns: [1, 2, 3], pts: (e) => 5 * e.n, text: (e) => `このターン、次に使うカードのコストを${e.n}少なくする` }),
    // ── 体力 ──
    burn:       A({ cat: '体力', label: '相手にダメージ', side: 'none', ns: [500, 1000, 1500, 2000, 3000, 5000], pts: (e) => e.n / 50, per: true, text: (e) => `相手に${e.n}ダメージを与える` }),
    drainLife:  A({ cat: '体力', label: '相手にダメージを与え、同じだけ回復', side: 'none', ns: [500, 1000, 2000], pts: (e) => e.n / 50 + e.n / 100, per: true, text: (e) => `相手に${e.n}ダメージを与え、自分の体力を${e.n}回復する` }),
    burnBoth:   A({ cat: '体力', label: 'お互いにダメージ', side: 'none', ns: [500, 1000, 2000, 3000], pts: (e) => e.n / 150, text: (e) => `自分と相手に、それぞれ${e.n}ダメージを与える` }),
    heal:       A({ cat: '体力', label: '体力を回復する', side: 'none', ns: [500, 1000, 2000, 3000, 5000], pts: (e) => e.n / 100, per: true, text: (e) => `自分の体力を${e.n}回復する` }),
    selfDamage: A({ cat: '体力', label: '自分にダメージ（デメリット）', side: 'none', ns: [500, 1000, 2000], pts: (e) => -e.n / 120, text: (e) => `自分に${e.n}ダメージを与える` }),
    // ── 除去 ──
    destroy:    A({ cat: '除去', label: '破壊する', side: 'enemy', whos: ['enemy', 'any', 'attacker'], pts: () => 38, style: 'obj', verb: () => '破壊する' }),
    exile:      A({ cat: '除去', label: '除外する（墓地に行かない）', side: 'enemy', whos: ['enemy', 'any', 'attacker'], pts: () => 44, style: 'obj', verb: () => '除外する' }),
    bounce:     A({ cat: '除去', label: '手札に戻す', side: 'both', whos: ['enemy', 'any', 'ally', 'self', 'attacker'], pts: () => 18, style: 'obj', verb: () => '持ち主の手札に戻す' }),
    deckBottom: A({ cat: '除去', label: '山札の一番下に置く', side: 'enemy', whos: ['enemy', 'any', 'attacker'], pts: () => 30, style: 'obj', verb: () => '持ち主の山札の一番下に置く' }),
    weaken:     A({ cat: '除去', label: 'パワーを下げる', side: 'enemy', whos: ['enemy', 'any', 'attacker'], ns: AMT_P, dur: true, per: true, statik: true, pts: (e) => e.n / 125 * DURATIONS[e.dur || 'turn'].mult, style: 'poss', attr: 'パワー', verb: (e) => `${durText(e)}-${e.n}する` }),
    fight:      A({ cat: '除去', label: 'バトルさせる', side: 'enemy', whos: ['enemy'], pts: () => 22, style: 'obj', verb: (e, spec) => (spec && spec.kind === 'creature' ? 'このクリーチャーとバトルさせる' : '自分のパワーが最も大きいクリーチャーとバトルさせる') }),
    // ── 妨害・封じ ──
    tap:        A({ cat: '妨害・封じ', label: 'タップする', side: 'enemy', whos: ['enemy', 'attacker'], pts: () => 6, style: 'obj', verb: () => 'タップする' }),
    freeze:     A({ cat: '妨害・封じ', label: '凍結する（次のターンにアンタップしない）', side: 'enemy', whos: ['enemy', 'attacker'], pts: () => 14, style: 'obj', verb: () => 'タップし、次の持ち主のターンの始めにアンタップさせない' }),
    silence:    A({ cat: '妨害・封じ', label: '能力を消す', side: 'enemy', whos: ['enemy', 'any', 'attacker'], pts: () => 16, style: 'poss', attr: '能力', verb: () => '全て消す' }),
    steal:      A({ cat: '妨害・封じ', label: 'コントロールを奪う', side: 'enemy', whos: ['enemy'], dur: true, durs: ['turn', 'perm'], counts: ['1'], pts: (e) => (e.dur === 'perm' ? 55 : 24), style: 'obj', verb: (e) => (e.dur === 'perm' ? '自分のものにする' : 'このターンの間、自分のものにする（アンタップし、攻撃もできる）') }),
    spellLock:  A({ cat: '妨害・封じ', label: '相手の呪文を封じる', side: 'none', ns: [0], meta: true, minCost: 6, pts: () => 40, text: () => '相手は、次の自分のターンの始めまで呪文を唱えられない' }),
    summonLock: A({ cat: '妨害・封じ', label: '相手の召喚を封じる', side: 'none', ns: [0], meta: true, minCost: 6, pts: () => 45, text: () => '相手は、次の自分のターンの始めまでクリーチャーを召喚できない' }),
    attackLock: A({ cat: '妨害・封じ', label: '相手の攻撃を封じる', side: 'none', ns: [0], meta: true, minCost: 7, pts: () => 55, text: () => '相手のクリーチャーは、次の自分のターンの始めまで攻撃できない' }),
    negate:     A({ cat: '妨害・封じ', label: '呪文を打ち消す（〔対抗〕専用）', side: 'none', ns: [0], trig: 'counter', meta: true, minCost: 5, pts: () => 45, text: () => 'その呪文を打ち消す' }),
    // ── 強化 ──
    buff:       A({ cat: '強化', label: 'パワーを上げる', side: 'ally', whos: ['self', 'ally', 'allyOther'], ns: AMT_P, dur: true, per: true, statik: true, pts: (e) => e.n / 150 * DURATIONS[e.dur || 'turn'].mult, style: 'poss', attr: 'パワー', verb: (e) => `${durText(e)}+${e.n}する` }),
    grantKw:    A({ cat: '強化', label: 'キーワード効果を与える', side: 'ally', whos: ['self', 'ally', 'allyOther'], kw: true, dur: true, statik: true, pts: (e) => (KEYWORDS[e.kw] ? Math.max(0, KEYWORDS[e.kw].pts) : 8) * ({ turn: 0.4, untilNext: 0.55, perm: 1.0 })[e.dur || 'turn'] + 2, style: 'grant', verb: (e) => `${durText(e, true)}【${KEYWORDS[e.kw] ? KEYWORDS[e.kw].label : '？'}】を与える` }),
    untap:      A({ cat: '強化', label: 'アンタップする', side: 'ally', whos: ['self', 'ally', 'allyOther'], pts: () => 12, style: 'obj', verb: () => 'アンタップする' }),
    extraAttack: A({ cat: '強化', label: 'もう1回攻撃できるようにする', side: 'ally', whos: ['self', 'ally'], counts: ['1'], pts: () => 16, style: 'obj', verb: () => 'アンタップし、このターンもう1回攻撃できるようにする' }),
    protect:    A({ cat: '強化', label: '破壊されないようにする', side: 'ally', whos: ['self', 'ally', 'allyOther'], pts: () => 12, style: 'obj', verb: () => '次の自分のターンの始めまで、破壊されないようにする' }),
    // ── 召喚 ──
    token:      A({ cat: '召喚', label: 'トークンを出す', side: 'none', ns: [1, 2, 3], token: true, kw: true, pts: (e) => e.n * ((e.tp || 1000) / 40 * 0.85 + (KEYWORDS[e.kw] ? Math.max(0, KEYWORDS[e.kw].pts) * 0.8 : 0)), text: (e) => `パワー${e.tp || 1000}${KEYWORDS[e.kw] ? `で【${KEYWORDS[e.kw].label}】を持つ` : 'の'}トークンを${e.n}体出す` }),
    reanimate:  A({ cat: '召喚', label: '墓地からクリーチャーを出す（蘇生）', side: 'none', ns: COST_LIM, pts: (e) => ({ 3: 18, 5: 26, 8: 34, 99: 44 })[e.n], text: (e) => `自分の墓地から${costLimText(e.n)}クリーチャーを1体選んで、場に出す` }),
    cheatHand:  A({ cat: '召喚', label: '手札からクリーチャーをコストなしで出す', side: 'none', ns: COST_LIM, pts: (e) => ({ 3: 12, 5: 20, 8: 28, 99: 36 })[e.n], text: (e) => `自分の手札から${costLimText(e.n)}クリーチャーを1体選んで、コストを払わずに出す` }),
    topSummon:  A({ cat: '召喚', label: '山札の一番上がクリーチャーなら出す', side: 'none', ns: [0], pts: () => 12, text: () => '自分の山札の一番上を見せ、それがクリーチャーなら場に出す（違えば手札に加える）' }),
    returnSelf: A({ cat: '召喚', label: 'このクリーチャーを手札に戻す', side: 'none', ns: [0], kind: 'creature', pts: () => 14, text: () => 'このカードを自分の手札に戻す' }),
    // ── 常在専用 ──
    auraCost:   A({ cat: '常在（場にいる限り）', label: '自分のカードのコストを下げる', side: 'none', ns: [1, 2], statikOnly: true, pts: (e) => 20 * e.n, text: (e) => `自分のカードのコストを${e.n}少なくする（最低1）` }),
    auraOppCost: A({ cat: '常在（場にいる限り）', label: '相手のカードのコストを上げる', side: 'none', ns: [1], statikOnly: true, meta: true, minCost: 6, pts: () => 50, text: () => '相手のカードのコストを1多くする' }),
  };
  function durText(e, grant) {
    const d = DURATIONS[e.dur || 'turn'];
    if (e.trig === 'static') return grant ? '' : '';
    if (!d.text) return '';
    return grant ? `${d.text}、` : `${d.text}`;
  }

  // ───────────── 容量の計算 ─────────────
  const unitAction = (a) => a.side !== 'none';

  /** テキスト効果1つが使う容量（デメリットの効果は負の値） */
  function effectPoints(e) {
    const a = ACTIONS[e.act];
    if (!a) return 0;
    let v = a.pts(e);
    if (unitAction(a)) {
      const t = e.tgt || {};
      const who = WHO[t.who];
      if (who && !who.self) {
        v *= COUNTS[t.count || 1] ? COUNTS[t.count || 1].mult : 1;
        if (t.count !== 'all') v *= (HOWS[t.how || 'choose'] || HOWS.choose).mult;
        const f = FILTERS[t.f || 'none'];
        if (f) v *= f.mult(t.fn);
        if (t.who === 'any') v *= 0.85;
        if (t.who === 'allyOther') v *= 0.95;
      } else if (who && who.single) v *= 0.9;
      else if (who && who.self) v *= 0.8;
    }
    if (a.per && e.per && e.per !== 'none') v *= PERS[e.per].mult;
    const tr = TRIGGERS[e.trig];
    v *= tr ? tr.mult : 1;
    if (tr && tr.rep && !tr.static) v *= (LIMITS[e.lim || 'turn1'] || LIMITS.turn1).mult;
    for (const c of e.conds || []) { const cd = CONDS[c.k]; if (cd) v *= cd.mult(c.n); }
    const pay = e.pay && COSTS[e.pay.k];
    if (pay && e.pay.k !== 'none') v *= pay.mult(e.pay.n);
    if (tr && tr.activated && e.tapToo && (!e.pay || e.pay.k !== 'tapSelf')) v *= 0.8;
    if (v < 0) return Math.round(v); // デメリット
    return Math.max(1, Math.round(v));
  }

  /** カードが使う容量の内訳 { power, keywords, effects: [..], refund, total } */
  function usage(spec) {
    const cap = capacity(spec.cost, spec.grade);
    const power = spec.kind === 'creature' ? powerPoints(spec.power || 0) : 0;
    let keywords = 0, refund = 0;
    for (const k of spec.keywords || []) { const kw = KEYWORDS[k]; if (!kw) continue; if (kw.pts >= 0) keywords += kw.pts; else refund += -kw.pts; }
    const effects = (spec.effects || []).map(effectPoints);
    for (const v of effects) if (v < 0) refund += -v;
    const pos = effects.filter((v) => v > 0).reduce((s, x) => s + x, 0);
    const refundUsed = Math.min(refund, Math.floor(cap * CAP.REFUND_MAX));
    const total = Math.round(power + keywords + pos - refundUsed);
    return { power, keywords, effects, refund, refundUsed, total };
  }

  // ───────────── 規則のチェック ─────────────
  function validate(spec) {
    const err = [];
    if (!['creature', 'spell'].includes(spec.kind)) err.push('種類が正しくない');
    if (!(spec.cost >= COST_MIN && spec.cost <= COST_MAX)) err.push(`コストは${COST_MIN}〜${COST_MAX}`);
    if (!GRADES[spec.grade]) err.push('素質が正しくない');
    if (!spec.name || !String(spec.name).trim()) err.push('名前を入力してください');
    const kws = spec.keywords || [];
    if (spec.kind === 'creature') {
      if (!(spec.power >= POWER_MIN && spec.power <= POWER_MAX && spec.power % POWER_STEP === 0)) err.push(`パワーは${POWER_MIN}〜${POWER_MAX}（${POWER_STEP}刻み）`);
      if (kws.length > MAX_KEYWORDS) err.push(`キーワード効果は${MAX_KEYWORDS}つまで`);
      if (new Set(kws).size !== kws.length) err.push('同じキーワード効果は1つまで');
      if (kws.some((k) => !KEYWORDS[k])) err.push('不明なキーワード効果');
      if (kws.includes('slow') && kws.includes('double')) err.push('鈍重と連撃は同時に付けられない');
    } else {
      if (kws.length) err.push('呪文にはキーワード効果を付けられない');
      if (!(spec.effects || []).length) err.push('呪文にはテキスト効果が必要');
    }
    const effs = spec.effects || [];
    if (effs.length > MAX_EFFECTS) err.push(`テキスト効果は${MAX_EFFECTS}つまで`);
    effs.forEach((e, i) => { for (const m of effectErrors(spec, e)) err.push(`効果${i + 1}：${m}`); });
    if (spec.kind === 'spell' && new Set(effs.map((e) => e.trig)).size > 1) err.push('呪文のテキスト効果は、発動の場面をそろえてください');
    if (spec.kind === 'spell' && effs.length && effs.every((e) => (ACTIONS[e.act] ? ACTIONS[e.act].pts(e) : 0) < 0)) err.push('デメリットだけの呪文は作れない');
    const u = usage(spec);
    const cap = capacity(spec.cost, spec.grade);
    if (u.total > cap) err.push(`容量オーバー（${u.total} / ${cap}）`);
    return err;
  }

  function effectErrors(spec, e) {
    const err = [];
    const t = TRIGGERS[e.trig], a = ACTIONS[e.act];
    if (!t) return ['発動の場面を選んでください'];
    if (trigKind(e.trig) !== spec.kind) err.push(`「${t.label}」は${spec.kind === 'spell' ? 'クリーチャー' : '呪文'}専用`);
    if (!a) return err.concat('効果を選んでください');
    if (a.kind && a.kind !== spec.kind) err.push(`「${a.label}」はクリーチャー専用`);
    if (a.trig && a.trig !== e.trig) err.push(`「${a.label}」は〔対抗〕の呪文専用`);
    if (t.static && !(a.statik || a.statikOnly)) err.push(`「${a.label}」は常在効果にできない`);
    if (a.statikOnly && !t.static) err.push(`「${a.label}」は常在効果専用`);
    if (a.ns && !a.ns.includes(e.n)) err.push('量が正しくない');
    if (a.minCost && spec.cost < a.minCost) err.push(`「${a.label}」はメタ効果なので、コスト${a.minCost}以上のカードにしか付けられない`);
    // 回数
    if (t.rep && !t.static) {
      if (!LIMITS[e.lim || 'turn1']) err.push('回数の制限が正しくない');
      if (e.lim === 'free' && (['untap', 'extraAttack'].includes(e.act) || (t.activated && (e.tapToo || (e.pay && e.pay.k === 'tapSelf'))))) err.push('この効果に「何度でも」は付けられない');
    }
    // 条件
    const conds = e.conds || [];
    if (conds.length > MAX_CONDS) err.push(`条件は${MAX_CONDS}つまで`);
    for (const c of conds) {
      const cd = CONDS[c.k];
      if (!cd) { err.push('条件が正しくない'); continue; }
      if (!cd.ns.includes(c.n)) err.push(`条件「${cd.label}」の値が正しくない`);
      if (cd.kind && cd.kind !== spec.kind) err.push(`条件「${cd.label}」はクリーチャー専用`);
    }
    if (new Set(conds.map((c) => c.k)).size !== conds.length) err.push('同じ条件は1つまで');
    if (t.static && conds.length) err.push('常在効果には条件を付けられない');
    // 代償
    const pay = e.pay || { k: 'none', n: 0 };
    const pc = COSTS[pay.k];
    if (!pc) err.push('代償が正しくない');
    else {
      if (!pc.ns.includes(pay.n)) err.push('代償の値が正しくない');
      if (pc.kind && pc.kind !== spec.kind) err.push(`代償「${pc.label}」はクリーチャー専用`);
      if (t.static && pay.k !== 'none') err.push('常在効果には代償を付けられない');
      if (t.activated && pay.k === 'none' && !e.tapToo) err.push('起動効果にはコスト（またはタップ）が必要');
    }
    if (e.tapToo && !t.activated) err.push('「タップも必要」は起動効果専用');
    // 対象
    if (unitAction(a)) {
      const tg = e.tgt || {};
      const whos = a.whos || ['enemy'];
      if (!whos.includes(tg.who)) err.push('対象（誰を）を選んでください');
      else {
        const w = WHO[tg.who];
        if (w.kind && w.kind !== spec.kind) err.push(`対象「${w.label}」はクリーチャー専用`);
        if (tg.who === 'attacker' && !ATTACKER_TRIGS.includes(e.trig)) err.push('「攻撃してきたクリーチャー」は、迎撃・相手のクリーチャーが攻撃した時・攻撃された時・受け止めた時だけ');
        if (!w.self) {
          if (!COUNTS[tg.count || 1]) err.push('対象の数が正しくない');
          if (a.counts && !a.counts.includes(String(tg.count || 1))) err.push(`「${a.label}」の対象は1体だけ`);
          if (tg.count !== 'all' && !HOWS[tg.how || 'choose']) err.push('対象の選び方が正しくない');
          const f = FILTERS[tg.f || 'none'];
          if (!f) err.push('絞り込みが正しくない');
          else if (!f.ns.includes(tg.fn == null ? 0 : tg.fn)) err.push('絞り込みの値が正しくない');
          if (t.static && tg.count !== 'all') err.push('常在効果の対象は「全て」か「このクリーチャー」');
          if (t.static && ['powerLE', 'powerGE'].includes(tg.f)) err.push('常在効果ではパワーで絞り込めない');
        }
      }
    }
    if (a.dur && !DURATIONS[e.dur || 'turn']) err.push('期間が正しくない');
    if (a.durs && !a.durs.includes(e.dur || 'turn')) err.push('期間が正しくない');
    if (a.kw && e.act === 'grantKw' && !(KEYWORDS[e.kw] && KEYWORDS[e.kw].pts > 0)) err.push('与えるキーワード効果を選んでください');
    if (a.kw && e.act === 'token' && e.kw && !(KEYWORDS[e.kw] && KEYWORDS[e.kw].pts > 0)) err.push('トークンのキーワード効果が正しくない');
    if (a.token && !AMT_P.concat([1500]).includes(e.tp || 1000)) err.push('トークンのパワーが正しくない');
    if (e.per && e.per !== 'none') {
      if (!a.per) err.push(`「${a.label}」は「〜につき」にできない`);
      else if (!PERS[e.per]) err.push('「〜につき」が正しくない');
      else if (PERS[e.per].kind && PERS[e.per].kind !== spec.kind) err.push(`「${PERS[e.per].label}」はクリーチャー専用`);
    }
    // 暴走を防ぐ組み合わせ
    if (e.act === 'returnSelf' && !['destroyed', 'leave', 'turnEnd', 'win'].includes(e.trig)) err.push('「このクリーチャーを手札に戻す」は、破壊された時・場を離れた時・ターンの終わり・バトルに勝った時だけ');
    if (e.act === 'extraAttack' && e.tgt && e.tgt.who === 'self' && e.trig === 'attack' && e.lim && e.lim !== 'turn1' && e.lim !== 'game1') err.push('攻撃した時の追加攻撃は各ターン1回まで');
    if (e.act === 'bounce' && e.tgt && e.tgt.who === 'self' && e.trig === 'summon') err.push('召喚した時に自分を手札に戻すことはできない');
    return err;
  }

  // ───────────── 文章の自動生成 ─────────────
  function targetHead(e, a, spec) {
    const t = e.tgt || {};
    const w = WHO[t.who] || WHO.enemy;
    const f = FILTERS[t.f || 'none'];
    const fil = f && t.f !== 'none' ? f.text(t.fn) : '';
    const noun = `${fil}${w.noun}`;
    const st = a.style;
    const attr = a.attr || 'パワー';
    if (w.self) return st === 'poss' ? `${w.noun}の${attr}を` : st === 'grant' ? `${w.noun}に` : `${w.noun}を`;
    const n = t.count || 1;
    if (n === 'all') return st === 'poss' ? `${noun}全ての${attr}を` : st === 'grant' ? `${noun}全てに` : `${noun}を全て`;
    const how = t.how || 'choose';
    const cnt = `${n}体`;
    if (how === 'choose') {
      const head = `${noun}を${n > 1 ? cnt + 'まで' : cnt}選び、`;
      return st === 'poss' ? `${head}${n > 1 ? 'それら' : 'その'}${attr}を` : st === 'grant' ? `${head}${n > 1 ? 'それら' : 'それ'}に` : head;
    }
    const pre = how === 'random' ? `ランダムな${noun}${cnt}` : `パワーが最も${how === 'strongest' ? '大きい' : '小さい'}${noun}${n > 1 ? cnt : ''}`;
    return st === 'poss' ? `${pre}の${attr}を` : st === 'grant' ? `${pre}に` : `${pre}を`;
  }

  function triggerHead(e) {
    const t = TRIGGERS[e.trig];
    if (!t) return '';
    if (e.trig === 'cast' || e.trig === 'react' || e.trig === 'counter') return '';
    if (t.static) return '場にいる限り、';
    const lim = t.rep ? (LIMITS[e.lim || 'turn1'] || LIMITS.turn1).text : '';
    if (t.activated) {
      const parts = [];
      if (e.tapToo || (e.pay && e.pay.k === 'tapSelf')) parts.push('このクリーチャーをタップする');
      if (e.pay && e.pay.k !== 'none' && e.pay.k !== 'tapSelf') parts.push(COSTS[e.pay.k].dict(e.pay.n));
      return `【起動${lim ? lim.replace(/[（）]/g, '・').replace(/・$/, '') : ''}】${parts.join('、') || 'コストなし'}：`;
    }
    const ph = t.phrase || t.label;
    return /に$/.test(ph) ? `${ph}${lim}、` : `${ph}${lim}、`;
  }

  /** テキスト効果1つを文章にする */
  function effectText(spec, e) {
    const a = ACTIONS[e.act];
    if (!TRIGGERS[e.trig] || !a) return '（未設定）';
    const head = triggerHead(e);
    const conds = (e.conds || []).map((c) => (CONDS[c.k] ? CONDS[c.k].text(c.n) : '')).join('');
    const t = TRIGGERS[e.trig];
    const pay = !t.activated && e.pay && e.pay.k !== 'none' && COSTS[e.pay.k] ? `${COSTS[e.pay.k].te(e.pay.n)}もよい。そうしたら、` : '';
    const per = a.per && e.per && e.per !== 'none' ? `${PERS[e.per].text}、` : '';
    const body = unitAction(a) ? targetHead(e, a, spec) + a.verb(e, spec) : a.text(e);
    const capNote = per ? `（最大${CAP.PER_MAX}倍）` : '';
    return `${head}${conds}${pay}${per}${body}${capNote}。`;
  }

  /** カードの文章（キーワード行とテキスト効果の行）を配列で返す */
  function cardLines(spec) {
    const lines = [];
    const effs = spec.effects || [];
    if (spec.kind === 'spell' && effs.some((e) => e.trig === 'react')) lines.push('〔迎撃〕相手のクリーチャーが攻撃した時に唱えられる。');
    if (spec.kind === 'spell' && effs.some((e) => e.trig === 'counter')) lines.push('〔対抗〕相手が呪文を唱えた時に唱えられる。');
    if ((spec.keywords || []).length) lines.push('【' + spec.keywords.map((k) => KEYWORDS[k].label).join('・') + '】');
    for (const e of effs) lines.push(effectText(spec, e));
    return lines;
  }

  // ───────────── 作成画面用：選べるもの ─────────────
  function optionsFor(kind) {
    const pick = (obj, f) => Object.entries(obj).filter(([, v]) => f(v)).map(([k, v]) => ({ id: k, ...v }));
    return {
      triggers: pick(TRIGGERS, (t) => (t.kind || 'creature') === kind),
      keywords: kind === 'creature' ? pick(KEYWORDS, () => true) : [],
      conds: pick(CONDS, (c) => !c.kind || c.kind === kind),
      costs: pick(COSTS, (c) => !c.kind || c.kind === kind),
      actions: pick(ACTIONS, (a) => !a.kind || a.kind === kind),
    };
  }
  /** その効果で選べる「誰を」 */
  function whosFor(spec, e) {
    const a = ACTIONS[e.act];
    if (!a || !unitAction(a)) return [];
    return (a.whos || ['enemy']).filter((w) => (!WHO[w].kind || WHO[w].kind === spec.kind) && (w !== 'attacker' || ATTACKER_TRIGS.includes(e.trig))).map((w) => ({ id: w, ...WHO[w] }));
  }

  /** その発動の場面で選べる効果のID */
  function actionsFor(spec, trig) {
    const t = TRIGGERS[trig] || {};
    return Object.entries(ACTIONS).filter(([, a]) => (!a.kind || a.kind === spec.kind) && (!a.trig || a.trig === trig)
      && (t.static ? (a.statik || a.statikOnly) : !a.statikOnly)).map(([k]) => k);
  }

  /**
   * テキスト効果を、今の選択と矛盾しない形に整える（選択欄を変えた時に呼ぶ）。
   * 選べなくなった値は、選べる最初の値に置き換える。
   */
  function normalizeEffect(spec, e) {
    if (!TRIGGERS[e.trig] || trigKind(e.trig) !== spec.kind) e.trig = spec.kind === 'spell' ? 'cast' : 'summon';
    const t = TRIGGERS[e.trig];
    const acts = actionsFor(spec, e.trig);
    if (!acts.includes(e.act)) e.act = acts[0];
    const a = ACTIONS[e.act];
    if (a.ns) { if (!a.ns.includes(e.n)) e.n = a.ns[0]; } else e.n = 0;
    if (t.rep && !t.static) { if (!LIMITS[e.lim]) e.lim = 'turn1'; } else delete e.lim;
    if ((e.act === 'untap' || e.act === 'extraAttack') && e.lim === 'free') e.lim = 'turn1';
    e.conds = t.static ? [] : (e.conds || []).filter((c) => CONDS[c.k] && (!CONDS[c.k].kind || CONDS[c.k].kind === spec.kind)).slice(0, MAX_CONDS);
    for (const c of e.conds) if (!CONDS[c.k].ns.includes(c.n)) c.n = CONDS[c.k].ns[0];
    if (!e.pay || !COSTS[e.pay.k] || (COSTS[e.pay.k].kind && COSTS[e.pay.k].kind !== spec.kind)) e.pay = { k: 'none', n: 0 };
    if (!COSTS[e.pay.k].ns.includes(e.pay.n)) e.pay.n = COSTS[e.pay.k].ns[0];
    if (t.static) e.pay = { k: 'none', n: 0 };
    if (t.activated) { if (e.pay.k === 'none' && !e.tapToo) e.tapToo = spec.kind === 'creature'; if (e.pay.k === 'tapSelf') delete e.tapToo; }
    else delete e.tapToo;
    if (a.dur) {
      if (t.static) e.dur = 'perm';
      else if (a.durs) { if (!a.durs.includes(e.dur)) e.dur = a.durs[0]; }
      else if (!DURATIONS[e.dur]) e.dur = 'turn';
    } else delete e.dur;
    if (!a.per || !PERS[e.per] || (PERS[e.per].kind && PERS[e.per].kind !== spec.kind)) e.per = 'none';
    if (e.act === 'grantKw') { if (!(KEYWORDS[e.kw] && KEYWORDS[e.kw].pts > 0)) e.kw = 'haste'; }
    else if (e.act === 'token') { if (e.kw && !(KEYWORDS[e.kw] && KEYWORDS[e.kw].pts > 0)) delete e.kw; if (![500, 1000, 1500, 2000, 3000].includes(e.tp)) e.tp = 1000; }
    else { delete e.kw; delete e.tp; }
    if (unitAction(a)) {
      const whos = whosFor(spec, e).map((w) => w.id);
      const tg = e.tgt || {};
      if (!whos.includes(tg.who)) tg.who = whos[0];
      const w = WHO[tg.who];
      if (w.self) { tg.count = 1; tg.how = 'choose'; tg.f = 'none'; tg.fn = 0; }
      else {
        if (t.static) tg.count = 'all';
        if (!COUNTS[tg.count]) tg.count = 1;
        if (a.counts && !a.counts.includes(String(tg.count))) tg.count = Number(a.counts[0]);
        if (!HOWS[tg.how]) tg.how = 'choose';
        if (!FILTERS[tg.f] || (t.static && ['powerLE', 'powerGE'].includes(tg.f))) tg.f = 'none';
        if (!FILTERS[tg.f].ns.includes(tg.fn)) tg.fn = FILTERS[tg.f].ns[0];
      }
      e.tgt = tg;
    } else delete e.tgt;
    return e;
  }

  /** v0.2 までの形式（{ trig, cond, pay, act, amt, tgt }）のテキスト効果を、今の形式に直す */
  function migrate(spec) {
    if (!spec || !Array.isArray(spec.effects) || !spec.effects.some((e) => 'amt' in e || typeof e.pay === 'string' || typeof e.tgt === 'string' || 'cond' in e)) return spec;
    const TG = { one: ['enemy', 1, 'choose'], random: ['enemy', 1, 'random'], two: ['enemy', 2, 'choose'], allEnemy: ['enemy', 'all', 'choose'], attacker: ['attacker', 1, 'choose'], self: ['self', 1, 'choose'], ally: ['ally', 1, 'choose'], allAlly: ['ally', 'all', 'choose'] };
    const CD = { hand1: ['handLE', 1], hand3: ['handLE', 3], life1500: ['lifeLE', 2000], life2500: ['lifeLE', 4000], allies2: ['alliesGE', 2], allies4: ['alliesGE', 4], grave5: ['graveGE', 5], grave10: ['graveGE', 10], behind: ['enemyMore', 0] };
    const PY = { tapSelf: ['tapSelf', 0], discard1: ['discard', 1], life500: ['life', 500], life1000: ['life', 1000] };
    const ACT = { buffTurn: ['buff', 'turn'], buffPerm: ['buff', 'perm'], tapEnemy: ['tap'], discardOpp: ['oppDiscard'] };
    const out = { ...spec, effects: spec.effects.map((o) => {
      const e = { trig: o.trig === 'tap' ? 'activate' : o.trig, act: o.act, n: o.amt || 0, conds: [], pay: { k: 'none', n: 0 }, per: 'none' };
      if (ACT[o.act]) { e.act = ACT[o.act][0]; if (ACT[o.act][1]) e.dur = ACT[o.act][1]; }
      if (o.trig === 'tap') e.tapToo = true;
      if (o.cond && CD[o.cond]) e.conds.push({ k: CD[o.cond][0], n: CD[o.cond][1] });
      if (o.pay && PY[o.pay]) e.pay = { k: PY[o.pay][0], n: PY[o.pay][1] };
      if (o.tgt && TG[o.tgt]) { const [who, count, how] = TG[o.tgt]; e.tgt = { who, count, how, f: 'none', fn: 0 }; }
      if (o.act === 'destroy' && o.amt) { e.tgt = { ...(e.tgt || { who: 'enemy', count: 1, how: 'choose' }), f: 'powerLE', fn: o.amt }; e.n = 0; }
      if (e.act === 'weaken' || e.act === 'buff') e.dur = e.dur || 'turn';
      return normalizeEffect(spec, e);
    }) };
    return out;
  }

  // ───────────── カードコード ─────────────
  const CODE_PREFIX = 'AF2.';
  function toCode(spec) {
    const data = { n: spec.name, i: spec.icon, c: spec.color, k: spec.kind, o: spec.cost, g: spec.grade, p: spec.power, w: spec.keywords, e: spec.effects };
    const json = JSON.stringify(data);
    const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, 'utf8').toString('base64');
    return CODE_PREFIX + b64;
  }
  function fromCode(code) {
    try {
      const s = String(code).trim();
      const old = s.startsWith('AF1.');
      if (!s.startsWith(CODE_PREFIX) && !old) return { error: 'カードコードの形式が違います' };
      const b64 = s.slice(4);
      const json = typeof atob === 'function' ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, 'base64').toString('utf8');
      const d = JSON.parse(json);
      let spec = { name: String(d.n || '').slice(0, 16), icon: String(d.i || '❔').slice(0, 4), color: d.c, kind: d.k, cost: d.o, grade: d.g, power: d.p, keywords: d.w || [], effects: d.e || [] };
      if (old) spec = migrate(spec);
      const err = validate(spec);
      return err.length ? { error: err.join(' / ') } : { spec };
    } catch (e) {
      return { error: 'カードコードを読み取れませんでした' };
    }
  }

  return {
    CAP, COST_MIN, COST_MAX, POWER_MIN, POWER_MAX, POWER_STEP, MAX_KEYWORDS, MAX_EFFECTS, MAX_CONDS, AMT_P,
    GRADES, KEYWORDS, TRIGGERS, LIMITS, CONDS, COSTS, WHO, COUNTS, HOWS, FILTERS, DURATIONS, PERS, ACTIONS,
    rollGrade, capacity, powerPoints, effectPoints, usage, validate, effectErrors, effectText, cardLines,
    optionsFor, whosFor, trigKind, unitAction, toCode, fromCode, ATTACKER_TRIGS, actionsFor, normalizeEffect, migrate,
  };
});
