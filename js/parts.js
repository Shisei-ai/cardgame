/*
 * parts.js — カードを作るための「部品」と「容量」の規則
 *
 * このゲームのカードは、基本カードもオリジナルカードも、すべてこのファイルの規則で組み立てます。
 *
 * ■ 容量（キャパシティ）
 *   カードの強さの上限。容量 ＝ (BASE + PER_COST × コスト) × 素質の倍率（小数切り捨て）
 *   パワー・キーワード効果・テキスト効果は、それぞれ決まった量の容量を使う（＝ポイント）。
 *   使った容量の合計が容量以下なら、そのカードは作れる。
 *   目安：1ポイント ≒ パワー40（＝相手の体力40）。
 *
 * ■ 素質（グレード）
 *   オリジナルカードを作るとき、最初にランダムで引く。倍率が高いほど出にくい。
 *
 * ■ カードの形（spec）… 保存やカードコードにもこの形をそのまま使う
 *   {
 *     id, name, icon, kind: 'creature' | 'spell', cost, grade,
 *     power,            // クリーチャーのみ
 *     keywords: [...],  // キーワード効果のID（クリーチャーのみ）
 *     effects: [ { trig, cond, pay, act, amt, tgt } ],  // テキスト効果
 *   }
 *   テキスト効果の各項目は、下の TRIGGERS / CONDS / PAYS / ACTIONS / TARGETS のキー。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Parts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────────── 容量 ─────────────
  const CAP = { BASE: 10, PER_COST: 10, POWER_PER_POINT: 40 };
  if (typeof process !== 'undefined' && process.env && process.env.PPP) CAP.POWER_PER_POINT = Number(process.env.PPP); // 検証用
  const COST_MIN = 1, COST_MAX = 20;
  const POWER_MIN = 500, POWER_MAX = 12000, POWER_STEP = 500;
  const MAX_KEYWORDS = 3, MAX_EFFECTS = 2;

  // 素質。weight は出やすさ（合計100）
  const GRADES = {
    iron:     { label: '鉄',   mult: 0.75, weight: 30, color: '#9aa1ab' },
    copper:   { label: '銅',   mult: 0.9,  weight: 28, color: '#d08a55' },
    silver:   { label: '銀',   mult: 1.0,  weight: 22, color: '#dfe6ee' },
    gold:     { label: '金',   mult: 1.15, weight: 12, color: '#f0c14b' },
    platinum: { label: '白金', mult: 1.3,  weight: 6,  color: '#a8ecff' },
    star:     { label: '星輝', mult: 1.6,  weight: 2,  color: '#ff9be6' },
  };

  /** 素質をランダムに引く（rand は 0〜1 を返す関数） */
  function rollGrade(rand = Math.random) {
    let r = rand() * Object.values(GRADES).reduce((s, g) => s + g.weight, 0);
    for (const [id, g] of Object.entries(GRADES)) { r -= g.weight; if (r < 0) return id; }
    return 'iron';
  }

  function capacity(cost, grade) {
    const g = GRADES[grade] || GRADES.silver;
    return Math.floor((CAP.BASE + CAP.PER_COST * cost) * g.mult);
  }

  /** パワーが使う容量（パワー40につき1）。5000を超える分は1.5倍（体力5000を一撃で削れる大型は割高に） */
  function powerPoints(p) {
    const k = CAP.POWER_PER_POINT;
    return p <= 5000 ? p / k : 5000 / k + ((p - 5000) / k) * 1.5;
  }

  // ───────────── キーワード効果（クリーチャーのみ） ─────────────
  // pts が負のものは「デメリット」。付けると容量が戻ってくる
  const KEYWORDS = {
    guard:    { label: '守護', pts: 8,   desc: '相手のクリーチャーが攻撃した時、アンタップしているこのクリーチャーが代わりに攻撃を受ける（受けるとタップする）' },
    assassin: { label: '刺客', pts: 14,  desc: 'クリーチャーとのバトルの後、勝敗に関わらず、バトルした相手のクリーチャーを破壊する' },
    haste:    { label: '速攻', pts: 10,  desc: '召喚したターンから攻撃できる' },
    double:   { label: '連撃', pts: 16,  desc: '1ターンに2回攻撃できる' },
    pierce:   { label: '貫通', pts: 8,   desc: '攻撃してバトルに勝った時、パワーの差の分だけ相手にダメージを与える' },
    stealth:  { label: '隠密', pts: 10,  desc: 'このクリーチャーの攻撃は、守護に引き受けられない' },
    undying:  { label: '不屈', pts: 10,  desc: '最初に破壊される時、1度だけ破壊されない' },
    sniper:   { label: '狙撃', pts: 12,  desc: 'アンタップしている相手のクリーチャーにも攻撃できる' },
    drain:    { label: '吸収', pts: 8,   desc: '相手にダメージを与えた時、同じだけ自分の体力を回復する' },
    ward:     { label: '加護', pts: 8,   desc: '相手のカードの効果で選ばれない' },
    slow:     { label: '鈍重', pts: -12, desc: '【デメリット】攻撃できない' },
    fleeting: { label: '自壊', pts: -18, desc: '【デメリット】自分のターンの終わりに破壊される' },
  };

  // ───────────── テキスト効果の部品 ─────────────
  // 発動の場面。mult が容量の倍率。kind は使えるカードの種類。once は「各ターン1回」
  const TRIGGERS = {
    summon:     { label: '召喚した時',                     mult: 1.0,  kind: 'creature' },
    attack:     { label: '攻撃した時',                     mult: 1.3,  kind: 'creature', once: true },
    win:        { label: 'バトルに勝った時',               mult: 0.8,  kind: 'creature', once: true },
    destroyed:  { label: '破壊された時',                   mult: 0.8,  kind: 'creature' },
    turnStart:  { label: '自分のターンの始め',             mult: 1.6,  kind: 'creature' },
    turnEnd:    { label: '自分のターンの終わり',           mult: 1.5,  kind: 'creature' },
    allySummon: { label: '他の味方を召喚した時',           mult: 1.4,  kind: 'creature', once: true },
    spellCast:  { label: '自分が呪文を唱えた時',           mult: 1.3,  kind: 'creature', once: true },
    discard:    { label: '自分の手札からカードが捨てられた時', mult: 0.7, kind: 'creature', once: true },
    tap:        { label: 'メインステップに、このクリーチャーをタップする', mult: 1.2, kind: 'creature', once: true, activated: true },
    cast:       { label: '唱えた時',                       mult: 1.0,  kind: 'spell' },
    react:      { label: '相手のクリーチャーが攻撃した時に唱えられる', mult: 1.15, kind: 'spell' },
  };

  // 発動の条件
  const CONDS = {
    none:     { label: 'なし',                       mult: 1.0 },
    hand1:    { label: '手札が1枚以下',              mult: 0.6,  test: (g, p) => p.hand.length <= 1 },
    hand3:    { label: '手札が3枚以下',              mult: 0.8,  test: (g, p) => p.hand.length <= 3 },
    life1500: { label: '自分の体力が1500以下',       mult: 0.6,  test: (g, p) => p.hp <= 1500 },
    life2500: { label: '自分の体力が2500以下',       mult: 0.75, test: (g, p) => p.hp <= 2500 },
    allies2:  { label: '自分の場にクリーチャーが2体以上', mult: 0.85, test: (g, p) => p.field.length >= 2 },
    allies4:  { label: '自分の場にクリーチャーが4体以上', mult: 0.6,  test: (g, p) => p.field.length >= 4 },
    grave5:   { label: '自分の墓地が5枚以上',        mult: 0.8,  test: (g, p) => p.grave.length >= 5 },
    grave10:  { label: '自分の墓地が10枚以上',       mult: 0.65, test: (g, p) => p.grave.length >= 10 },
    behind:   { label: '相手の場のクリーチャーの方が多い', mult: 0.75, test: (g, p) => g.opp(p).field.length > p.field.length },
  };

  // 「〜してもよい。そうしたら、」の代償
  const PAYS = {
    none:     { label: 'なし',                     mult: 1.0 },
    tapSelf:  { label: 'このクリーチャーをタップする', mult: 0.7, kind: 'creature' },
    discard1: { label: '手札を1枚捨てる',          mult: 0.7 },
    life500:  { label: '体力を500支払う',          mult: 0.8 },
    life1000: { label: '体力を1000支払う',         mult: 0.65 },
  };

  // 効果。side は対象の側（enemy / ally / none）。amounts は選べる量、pts(量) が基本の容量
  // style: 'obj' は「〜を破壊する」型、'power' は「〜のパワーを…」型（対象の言い回しが変わる）
  const ACTIONS = {
    draw:       { label: 'カードを引く',           side: 'none',  amounts: [1, 2, 3, 4],             pts: (n) => 8 * n,  text: (n) => `カードを${n}枚引く` },
    rampMax:    { label: '最大マナを増やす',       side: 'none',  amounts: [1, 2, 3],                pts: (n) => 12 * n, text: (n) => `自分の最大マナを${n}増やす` },
    manaGain:   { label: 'マナを回復する',         side: 'none',  amounts: [1, 2, 3, 5],             pts: (n) => 4 * n,  text: (n) => `マナを${n}回復する` },
    heal:       { label: '体力を回復する',         side: 'none',  amounts: [500, 1000, 2000, 3000],  pts: (n) => n / 100, text: (n) => `自分の体力を${n}回復する` },
    burn:       { label: '相手にダメージ',         side: 'none',  amounts: [500, 1000, 1500, 2000, 3000], pts: (n) => n / 50, text: (n) => `相手に${n}ダメージを与える` },
    discardOpp: { label: '相手の手札を捨てさせる', side: 'none',  amounts: [1, 2],                   pts: (n) => 11 * n, text: (n) => `相手の手札をランダムに${n}枚捨てさせる` },
    manaBurn:   { label: '相手の最大マナを減らす', side: 'none',  amounts: [1, 2],                   pts: (n) => 16 * n, text: (n) => `相手の最大マナを${n}減らす` },
    spellLock:  { label: '相手の呪文を封じる',     side: 'none',  amounts: [0],                      pts: () => 14,      text: () => '相手は、次の自分のターンの始めまで呪文を唱えられない' },
    regrow:     { label: '墓地から回収',           side: 'none',  amounts: [1, 2],                   pts: (n) => 9 * n,  text: (n) => `自分の墓地からクリーチャーをランダムに${n}枚手札に戻す` },
    destroy:    { label: '破壊する',               side: 'enemy', amounts: [1000, 2000, 3000, 0],    pts: (n) => ({ 1000: 14, 2000: 22, 3000: 30, 0: 38 })[n], filter: true, style: 'obj', verb: () => '破壊する' },
    tapEnemy:   { label: 'タップする',             side: 'enemy', amounts: [0],                      pts: () => 6,       style: 'obj', verb: () => 'タップする' },
    weaken:     { label: 'パワーを下げる',         side: 'enemy', amounts: [500, 1000, 2000, 3000],  pts: (n) => n / 125, style: 'power', verb: (n) => `このターン-${n}する` },
    bounce:     { label: '手札に戻す',             side: 'enemy', amounts: [0],                      pts: () => 18,      style: 'obj', verb: () => '持ち主の手札に戻す' },
    buffTurn:   { label: 'パワーを上げる（このターン）', side: 'ally', amounts: [500, 1000, 2000, 3000], pts: (n) => n / 150, style: 'power', verb: (n) => `このターン+${n}する` },
    buffPerm:   { label: 'パワーを上げる（ずっと）',     side: 'ally', amounts: [500, 1000, 1500, 2000], pts: (n) => n / 50, style: 'power', verb: (n) => `+${n}する` },
    untap:      { label: 'アンタップする',         side: 'ally',  amounts: [0],                      pts: () => 12,       style: 'obj', verb: () => 'アンタップする' },
  };

  // 対象の選び方。side ごとに使えるものが違う
  const TARGETS = {
    // 相手側
    one:      { side: 'enemy', label: '1体を選ぶ',       mult: 1.0,  n: 1, how: 'choose' },
    random:   { side: 'enemy', label: 'ランダムに1体',   mult: 0.75, n: 1, how: 'random' },
    two:      { side: 'enemy', label: '2体まで選ぶ',     mult: 1.7,  n: 2, how: 'choose' },
    allEnemy: { side: 'enemy', label: '全て',            mult: 2.5,  n: 99, how: 'all' },
    attacker: { side: 'enemy', label: '攻撃しているクリーチャー', mult: 0.9, n: 1, how: 'attacker', trig: 'react' },
    // 味方側
    self:     { side: 'ally',  label: 'このクリーチャー', mult: 0.8,  n: 1, how: 'self', kind: 'creature' },
    ally:     { side: 'ally',  label: '1体を選ぶ',       mult: 1.0,  n: 1, how: 'choose' },
    allAlly:  { side: 'ally',  label: '全て',            mult: 2.2,  n: 99, how: 'all' },
  };

  // ───────────── 容量の計算 ─────────────
  /** テキスト効果1つが使う容量 */
  function effectPoints(e) {
    const a = ACTIONS[e.act];
    if (!a) return 0;
    let v = a.pts(e.amt);
    if (a.side !== 'none' && TARGETS[e.tgt]) v *= TARGETS[e.tgt].mult;
    v *= (TRIGGERS[e.trig] || { mult: 1 }).mult;
    v *= (CONDS[e.cond] || CONDS.none).mult;
    v *= (PAYS[e.pay] || PAYS.none).mult;
    return Math.max(1, Math.round(v));
  }

  /** カードが使う容量の内訳 { power, keywords, effects: [..], total } */
  function usage(spec) {
    const power = spec.kind === 'creature' ? powerPoints(spec.power || 0) : 0;
    const keywords = (spec.keywords || []).reduce((s, k) => s + (KEYWORDS[k] ? KEYWORDS[k].pts : 0), 0);
    const effects = (spec.effects || []).map(effectPoints);
    const total = Math.round(power + keywords + effects.reduce((s, x) => s + x, 0));
    return { power, keywords, effects, total };
  }

  /**
   * カードが規則を満たしているか。問題があればエラーメッセージの配列を返す（空なら作れる）
   */
  function validate(spec) {
    const err = [];
    if (!['creature', 'spell'].includes(spec.kind)) err.push('種類が正しくない');
    if (!(spec.cost >= COST_MIN && spec.cost <= COST_MAX)) err.push(`コストは${COST_MIN}〜${COST_MAX}`);
    if (!GRADES[spec.grade]) err.push('素質が正しくない');
    if (!spec.name || !String(spec.name).trim()) err.push('名前を入力してください');
    if (spec.kind === 'creature') {
      if (!(spec.power >= POWER_MIN && spec.power <= POWER_MAX && spec.power % POWER_STEP === 0)) err.push(`パワーは${POWER_MIN}〜${POWER_MAX}（${POWER_STEP}刻み）`);
      const kws = spec.keywords || [];
      if (kws.length > MAX_KEYWORDS) err.push(`キーワード効果は${MAX_KEYWORDS}つまで`);
      if (new Set(kws).size !== kws.length) err.push('同じキーワード効果は1つまで');
      if (kws.some((k) => !KEYWORDS[k])) err.push('不明なキーワード効果');
      if (kws.includes('slow') && kws.includes('double')) err.push('鈍重と連撃は同時に付けられない');
    } else {
      if ((spec.keywords || []).length) err.push('呪文にはキーワード効果を付けられない');
      if (!(spec.effects || []).length) err.push('呪文にはテキスト効果が必要');
    }
    const effs = spec.effects || [];
    if (effs.length > MAX_EFFECTS) err.push(`テキスト効果は${MAX_EFFECTS}つまで`);
    effs.forEach((e, i) => { for (const m of effectErrors(spec, e)) err.push(`テキスト効果${i + 1}：${m}`); });
    // 呪文の効果は、全て「唱えた時」か、全て「相手の攻撃時」のどちらか
    if (spec.kind === 'spell' && new Set(effs.map((e) => e.trig)).size > 1) err.push('呪文のテキスト効果は、発動の場面をそろえてください');
    const u = usage(spec);
    const cap = capacity(spec.cost, spec.grade);
    if (u.total > cap) err.push(`容量オーバー（${u.total} / ${cap}）`);
    return err;
  }

  function effectErrors(spec, e) {
    const err = [];
    const t = TRIGGERS[e.trig], a = ACTIONS[e.act];
    if (!t) return ['発動の場面を選んでください'];
    if (t.kind !== spec.kind) err.push(`「${t.label}」は${spec.kind === 'spell' ? 'クリーチャー' : '呪文'}専用`);
    if (!a) return err.concat('効果を選んでください');
    if (!a.amounts.includes(e.amt)) err.push('量が正しくない');
    if (!CONDS[e.cond || 'none']) err.push('条件が正しくない');
    const pay = PAYS[e.pay || 'none'];
    if (!pay) err.push('代償が正しくない');
    else if (pay.kind && pay.kind !== spec.kind) err.push(`代償「${pay.label}」はクリーチャー専用`);
    if (e.pay === 'tapSelf' && e.trig === 'tap') err.push('タップして発動する効果に「タップする」代償は付けられない');
    if (a.side !== 'none') {
      const tg = TARGETS[e.tgt];
      if (!tg || tg.side !== a.side) err.push('対象を選んでください');
      else {
        if (tg.kind && tg.kind !== spec.kind) err.push(`対象「${tg.label}」はクリーチャー専用`);
        if (tg.trig && tg.trig !== e.trig) err.push('「攻撃しているクリーチャー」は、相手の攻撃時に唱える呪文専用');
      }
    }
    // 自分を手札に戻す・自分を自分の効果で破壊するなどの無限ループにつながる組み合わせを防ぐ
    if (e.act === 'untap' && e.tgt === 'self' && !['attack', 'win'].includes(e.trig)) err.push('このクリーチャーをアンタップする効果は「攻撃した時」「バトルに勝った時」だけ');
    return err;
  }

  // ───────────── 文章の自動生成 ─────────────
  const fmt = (n) => String(n);

  /** 対象の言い回し。style: 'obj'（〜を◯◯する）/ 'power'（〜のパワーを◯◯する） */
  function targetPhrase(e, a) {
    const filter = a.filter && e.amt ? `パワー${fmt(e.amt)}以下の` : '';
    const tg = e.tgt;
    const power = a.style === 'power';
    const enemy = `${filter}相手のクリーチャー`;
    switch (tg) {
      case 'one':      return power ? `${enemy}を1体選び、そのパワーを` : `${enemy}を1体選び、`;
      case 'two':      return power ? `${enemy}を2体まで選び、それらのパワーを` : `${enemy}を2体まで選び、`;
      case 'random':   return power ? `ランダムな${enemy}1体のパワーを` : `ランダムな${enemy}1体を`;
      case 'allEnemy': return power ? `${enemy}全てのパワーを` : `${enemy}を全て`;
      case 'attacker': return power ? '攻撃しているクリーチャーのパワーを' : '攻撃しているクリーチャーを';
      case 'self':     return power ? 'このクリーチャーのパワーを' : 'このクリーチャーを';
      case 'ally':     return power ? '自分のクリーチャーを1体選び、そのパワーを' : '自分のクリーチャーを1体選び、';
      case 'allAlly':  return power ? '自分のクリーチャー全てのパワーを' : '自分のクリーチャーを全て';
      default: return '';
    }
  }

  /** テキスト効果1つを文章にする */
  function effectText(spec, e) {
    const t = TRIGGERS[e.trig], a = ACTIONS[e.act];
    if (!t || !a) return '（未設定）';
    let head = '';
    if (e.trig === 'cast') head = '';
    else if (e.trig === 'react') head = '';
    else if (e.trig === 'tap') head = 'メインステップ：このクリーチャーをタップして、';
    else if (e.trig === 'turnStart' || e.trig === 'turnEnd') head = `${t.label}に、`;
    else head = `${t.label}${t.once ? '（各ターン1回）' : ''}、`;
    const cond = e.cond && e.cond !== 'none' ? condPhrase(e.cond) : '';
    const pay = e.pay && e.pay !== 'none' ? `${PAYS[e.pay].label.replace(/する$/, 'して').replace(/捨てる$/, '捨てて').replace(/支払う$/, '支払って')}もよい。そうしたら、` : '';
    const body = a.side === 'none' ? a.text(e.amt) : targetPhrase(e, a) + a.verb(e.amt);
    return `${head}${cond}${pay}${body}。`;
  }

  function condPhrase(c) {
    return ({
      hand1: '手札が1枚以下なら、', hand3: '手札が3枚以下なら、',
      life1500: '自分の体力が1500以下なら、', life2500: '自分の体力が2500以下なら、',
      allies2: '自分の場にクリーチャーが2体以上いれば、', allies4: '自分の場にクリーチャーが4体以上いれば、',
      grave5: '自分の墓地が5枚以上あれば、', grave10: '自分の墓地が10枚以上あれば、',
      behind: '相手の場のクリーチャーの方が多ければ、',
    })[c] || '';
  }

  /** カードの文章（キーワード行とテキスト効果の行）を配列で返す */
  function cardLines(spec) {
    const lines = [];
    if (spec.kind === 'spell' && (spec.effects || []).some((e) => e.trig === 'react')) lines.push('〔迎撃〕相手のクリーチャーが攻撃した時に唱えられる。');
    if ((spec.keywords || []).length) lines.push('【' + spec.keywords.map((k) => KEYWORDS[k].label).join('・') + '】');
    for (const e of spec.effects || []) lines.push(effectText(spec, e));
    return lines;
  }

  /** そのカードが選べる部品の一覧（作成画面用） */
  function optionsFor(kind) {
    const pick = (obj, f) => Object.entries(obj).filter(([, v]) => f(v)).map(([k, v]) => ({ id: k, ...v }));
    return {
      triggers: pick(TRIGGERS, (t) => t.kind === kind),
      conds: pick(CONDS, () => true),
      pays: pick(PAYS, (p) => !p.kind || p.kind === kind),
      actions: pick(ACTIONS, () => true),
      keywords: kind === 'creature' ? pick(KEYWORDS, () => true) : [],
    };
  }

  /** 効果の対象として選べるもの */
  function targetsFor(spec, e) {
    const a = ACTIONS[e.act];
    if (!a || a.side === 'none') return [];
    return Object.entries(TARGETS)
      .filter(([, t]) => t.side === a.side && (!t.kind || t.kind === spec.kind) && (!t.trig || t.trig === e.trig))
      .map(([k, v]) => ({ id: k, ...v }));
  }

  // ───────────── カードコード（友達とカードを交換するための文字列） ─────────────
  const CODE_PREFIX = 'AF1.';
  function toCode(spec) {
    const data = { n: spec.name, i: spec.icon, c: spec.color, k: spec.kind, o: spec.cost, g: spec.grade, p: spec.power, w: spec.keywords, e: spec.effects };
    const json = JSON.stringify(data);
    const b64 = typeof btoa === 'function'
      ? btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, 'utf8').toString('base64');
    return CODE_PREFIX + b64;
  }
  /** カードコードを読み込む。規則を満たさないカードは { error } を返す */
  function fromCode(code) {
    try {
      const s = String(code).trim();
      if (!s.startsWith(CODE_PREFIX)) return { error: 'カードコードの形式が違います' };
      const b64 = s.slice(CODE_PREFIX.length);
      const json = typeof atob === 'function' ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, 'base64').toString('utf8');
      const d = JSON.parse(json);
      const spec = { name: String(d.n || '').slice(0, 16), icon: String(d.i || '❔').slice(0, 4), color: d.c, kind: d.k, cost: d.o, grade: d.g, power: d.p, keywords: d.w || [], effects: d.e || [] };
      const err = validate(spec);
      return err.length ? { error: err.join(' / ') } : { spec };
    } catch (e) {
      return { error: 'カードコードを読み取れませんでした' };
    }
  }

  return {
    CAP, COST_MIN, COST_MAX, POWER_MIN, POWER_MAX, POWER_STEP, MAX_KEYWORDS, MAX_EFFECTS,
    GRADES, KEYWORDS, TRIGGERS, CONDS, PAYS, ACTIONS, TARGETS,
    rollGrade, capacity, powerPoints, effectPoints, usage, validate, effectErrors,
    effectText, cardLines, optionsFor, targetsFor, toCode, fromCode,
  };
});
