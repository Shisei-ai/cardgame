/*
 * textparser.js — カードの「テキスト（日本語の文章）」を、プログラムが動かせる「効果データ」に変換する
 *
 * ■ なぜ必要？
 *   画像から読み取れるのは「文章」だけです。対戦で効果を本当に動かすには、
 *   「出た時に・相手の・パワー3000以下の・クリーチャーを1体・破壊する」のように
 *   部品に分けたデータにする必要があります。ここではそれを「決まった言い回し（正規表現）」で行います。
 *
 * ■ 仕組み（3段階）
 *   1. 整える   … 全角数字を半角に、空白や（ ）内の注釈文を取り除く
 *   2. 行に分ける … 「■」や改行で、能力ごとの行に分ける
 *   3. 行を読む   … 各行が「キーワード能力」「進化の条件」「〜した時（誘発）」「常在効果」のどれかを判定し、
 *                   効果の文を「動作（破壊する・手札に戻す…）」と「対象（相手の・パワー3000以下の…）」に分解する
 *
 *   読めなかった行は unparsed（未対応）に入れて画面に表示します。
 *   その場合は、カード編集画面で「対応している言い回し」に書き換えると動くようになります。
 *
 * ■ 結果の形（abilities）
 *   {
 *     keywords: { blocker, speedAttacker, breaker, shieldTrigger, gStrike, powerAttacker, slayer,
 *                 cantAttack, cantAttackPlayers, unblockable, attackUntapped, machFighter, justDiver },
 *     evolution: { civs: [...], races: [...] } または null,
 *     triggers: [ { when: 'cip' | 'attack' | 'destroyed' | 'block' | 'winBattle' | 'turnStart' | 'turnEnd', effects: [...] } ],
 *     spell: [...効果],        … 呪文を唱えた時の効果
 *     statics: [...],          … 常在効果（今はパワーを上げる効果のみ）
 *     unparsed: ['読めなかった行', ...],
 *   }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.TextParser = factory(root.SimData);
})(typeof self !== 'undefined' ? self : this, function (SimData) {
  'use strict';

  const CIV_NAMES = '光|水|闇|火|自然';

  // ───────────── 1. 整える ─────────────
  function normalize(text) {
    let s = String(text || '');
    s = s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)); // 全角英数→半角
    s = s.replace(/＋/g, '+').replace(/[－−‐–]/g, '-'); // プラス・マイナス記号をそろえる（長音「ー」は残す）
    s = s.replace(/[･·]/g, '・');
    s = s.replace(/[ \t　]+/g, ''); // 日本語のカード文には空白は不要
    // （ ）の中は「注釈文」（キーワードの説明）なので取り除く。入れ子にも対応するため繰り返す
    for (let i = 0; i < 3; i++) s = s.replace(/（[^（）]*）|\([^()]*\)/g, '');
    s = s.replace(/<([^<>]+)>/g, '《$1》'); // 種族の囲み記号をそろえる
    return s;
  }

  // ───────────── 2. 行に分ける ─────────────
  function splitLines(s) {
    return s
      .split(/\r?\n|[■▪●◆□]/)
      .map((l) => l.replace(/^[・\-*]+/, '').trim())
      .filter((l) => l && !/^[。、]+$/.test(l));
  }

  // 「〜してもよい」を普通の形に直し、「任意（してもしなくてもよい）」の印を付けるための表
  const OPTIONAL_FORMS = [
    [/引いてもよい/, '引く'], [/破壊してもよい/, '破壊する'], [/戻してもよい/, '戻す'], [/置いてもよい/, '置く'],
    [/出してもよい/, '出す'], [/加えてもよい/, '加える'], [/アンタップしてもよい/, 'アンタップする'],
    [/タップしてもよい/, 'タップする'], [/捨ててもよい/, '捨てる'], [/ブレイクしてもよい/, 'ブレイクする'],
    [/してもよい/, 'する'],
  ];
  function stripOptional(sentence) {
    for (const [re, rep] of OPTIONAL_FORMS) if (re.test(sentence)) return { text: sentence.replace(re, rep), optional: true };
    return { text: sentence, optional: false };
  }

  // ───────────── 対象（どのカードを）を読む ─────────────
  /**
   * 「相手のパワー3000以下のクリーチャーを1体」のような言葉から、対象の条件を取り出す。
   *   side   … 'opp'（相手の）/ 'self'（自分の）/ 'any'（どちらでも）
   *   count  … 数（「すべて」なら 'all'）
   *   upTo   … 「〜まで」なら true（0体を選んでもよい）
   *   filter … 絞り込み（パワー・コスト・タップ状態・文明・種族・ブロッカー・「他の」）
   */
  function parseSelector(phrase) {
    const p = phrase.replace(/、/g, '');
    if (/^(この|その)クリーチャー/.test(p) || p === 'このクリーチャー') return { thisCard: true, count: 1 };
    const sel = { side: 'any', count: 1, upTo: false, filter: {} };
    if (/相手の/.test(p)) sel.side = 'opp';
    else if (/自分の/.test(p)) sel.side = 'self';
    if (/すべて|全て/.test(p)) sel.count = 'all';
    const n = p.match(/(\d+)(体|枚|つ)/);
    if (n) sel.count = Number(n[1]);
    if (/まで/.test(p)) sel.upTo = true;
    const f = sel.filter;
    let m;
    if ((m = p.match(/パワー(\d+)以下/))) f.maxPower = Number(m[1]);
    if ((m = p.match(/パワー(\d+)以上/))) f.minPower = Number(m[1]);
    if ((m = p.match(/コスト(\d+)以下/))) f.maxCost = Number(m[1]);
    if ((m = p.match(/コスト(\d+)以上/))) f.minCost = Number(m[1]);
    if (/アンタップしている/.test(p)) f.tapped = false;
    else if (/タップしている/.test(p)) f.tapped = true;
    if (/ブロッカー/.test(p)) f.blocker = true;
    if (/他の/.test(p)) f.other = true;
    if (/進化クリーチャー/.test(p)) f.evolution = true;
    const civRe = new RegExp(`((?:${CIV_NAMES})(?:または(?:${CIV_NAMES}))*)の(?:進化)?(?:クリーチャー|呪文|カード)`);
    if ((m = p.match(civRe))) f.civs = m[1].split('または').map((nm) => SimData.CIV_BY_NAME[nm]);
    const races = [...p.matchAll(/《([^》]+)》/g)].map((x) => x[1]);
    if (races.length) f.races = races;
    if (/呪文/.test(p)) f.type = 'spell';
    else if (/クリーチャー/.test(p)) f.type = 'creature';
    return sel;
  }

  // ───────────── 効果の文を読む ─────────────
  /**
   * 1つの文（「。」で区切った単位）を効果データにする。読めなければ null。
   * 上から順に試し、最初に当てはまったものを使う（具体的な言い回しほど上に置く）。
   */
  function parseSentence(raw) {
    const { text: s0, optional } = stripOptional(raw);
    const s = s0.replace(/^(このターン、|その後、|次に、)/, '');
    const done = (e) => (optional ? Object.assign(e, { optional: true }) : e);
    let m;

    // ── カードを引く
    if ((m = s.match(/カードを(\d+)枚(まで)?引く/))) return done({ op: 'draw', n: +m[1], upTo: !!m[2] });
    // ── 山札の上をマナへ（マナ加速）
    if ((m = s.match(/山札の上から(\d+)枚(?:目)?(?:まで)?を、?(タップして)?(?:自分の)?マナゾーンに(?:置く|加える)/)))
      return done({ op: 'manaBoost', n: +m[1], tapped: !!m[2] });
    // ── 山札の上をシールドへ
    if ((m = s.match(/山札の上から(\d+)枚(?:目)?を、?(?:自分の)?(?:新しい)?シールド(?:ゾーンに|化|として|に)/)))
      return done({ op: 'addShield', n: +m[1] });
    if ((m = s.match(/シールドを(\d+)つ(?:追加|増や)/))) return done({ op: 'addShield', n: +m[1] });
    // ── 手札を捨てる
    if ((m = s.match(/相手の手札を見ないで(\d+)枚選び、捨てさせる/))) return done({ op: 'discard', side: 'opp', n: +m[1], how: 'random' });
    if ((m = s.match(/相手の手札を見て(\d+)枚選び、捨てさせる/))) return done({ op: 'discard', side: 'opp', n: +m[1], how: 'controller' });
    if ((m = s.match(/相手は(?:自身の|自分の)?手札を(\d+)枚(?:選んで|選び、)?捨てる/))) return done({ op: 'discard', side: 'opp', n: +m[1], how: 'owner' });
    if ((m = s.match(/相手の手札をすべて捨てさせる/))) return done({ op: 'discard', side: 'opp', n: 99, how: 'all' });
    if ((m = s.match(/自分の手札を(\d+)枚(?:選んで|選び、)?捨てる/))) return done({ op: 'discard', side: 'self', n: +m[1], how: 'owner' });
    // ── シールドを直接ブレイク・墓地へ
    if ((m = s.match(/相手のシールドを(\d+)つ(?:選び、)?ブレイクする/))) return done({ op: 'breakShield', n: +m[1] });
    if ((m = s.match(/相手のシールドを(\d+)つ選び、(?:持ち主の)?墓地に置く/))) return done({ op: 'shieldToGrave', n: +m[1] });
    // ── 相手のマナを減らす
    if ((m = s.match(/相手のマナゾーン(?:にある|の|から)(?:カードを)?(\d+)枚(?:選び、)?(?:持ち主の)?墓地に置く/)))
      return done({ op: 'manaToGrave', n: +m[1] });
    if ((m = s.match(/相手のマナゾーン(?:にある|の|から)(?:カードを)?(\d+)枚(?:選び、)?(?:持ち主の)?手札に戻す/)))
      return done({ op: 'manaToHand', n: +m[1] });
    // ── 墓地・マナ・手札からバトルゾーンへ
    if ((m = s.match(/(?:自分の)?(墓地|手札|マナゾーン)から(.*?)を(\d+)体(まで)?、?(?:選び、)?バトルゾーンに出す/))) {
      const from = { 墓地: 'grave', 手札: 'hand', マナゾーン: 'mana' }[m[1]];
      const sel = parseSelector(m[2] + 'を' + m[3] + '体');
      sel.filter.type = 'creature';
      return done({ op: 'putToBattle', from, filter: sel.filter, n: +m[3], upTo: !!m[4] });
    }
    // ── 墓地・マナから手札へ（回収）
    if ((m = s.match(/(?:自分の)?(墓地|マナゾーン)から(.*?)を(\d+)(?:体|枚)(まで)?、?(?:選び、)?(?:自分の)?手札に(?:戻す|加える)/))) {
      const from = { 墓地: 'grave', マナゾーン: 'mana' }[m[1]];
      return done({ op: 'recover', from, filter: parseSelector(m[2]).filter, n: +m[3], upTo: !!m[4] });
    }
    // ── パワーを変える（このターンの間）
    if ((m = s.match(/(.*?)のパワーを([+-]\d+)する/)) || (m = s.match(/(.*?)のパワーは([+-]\d+)される/))) {
      return done({ op: 'power', amount: +m[2], target: parseSelector(m[1]) });
    }
    // ── クリーチャーへの効果（文末の動作で見分ける）
    const verbs = [
      [/、?(?:選び、)?破壊する$/, 'destroy'],
      [/、?(?:選び、)?(?:持ち主の)?墓地に置く$/, 'toGrave'],
      [/、?(?:選び、)?(?:持ち主の)?手札に戻す$/, 'bounce'],
      [/、?(?:選び、)?(?:持ち主の)?マナゾーンに(?:置く|送る)$/, 'toMana'],
      [/、?(?:選び、)?アンタップする$/, 'untap'],
      [/、?(?:選び、)?タップする$/, 'tap'],
    ];
    const body = s.replace(/。$/, '');
    for (const [re, op] of verbs) {
      if (!re.test(body)) continue;
      const phrase = body.replace(re, '').replace(/を$/, '');
      if (!phrase || /山札|墓地から|マナゾーンから|手札から|シールド/.test(phrase)) return null;
      return done({ op, target: parseSelector(phrase) });
    }
    return null;
  }

  /** 文のかたまり（誘発の後ろ・呪文の1行など）を効果の配列にする。読めない文があれば null */
  function parseEffects(text) {
    let s = text;
    const effects = [];
    // 複数の文にまたがる言い回しを先に処理する（山札を見て手札に加える＝サーチ）
    const search = /(?:自分の)?山札を見る。その中から(.+?)を(\d+)(?:体|枚)(まで)?(?:選び、)?(?:相手に見せてから)?(?:自分の)?手札に加え(?:る|てもよい)。?(?:その後、)?山札をシャッフルする。?/;
    let m = s.match(search);
    if (m) {
      effects.push({ op: 'search', filter: parseSelector(m[1]).filter, n: +m[2], upTo: true });
      s = s.replace(search, '');
    }
    // 「相手のクリーチャーを1体選ぶ。このターン、そのクリーチャーは攻撃できない」
    const lock = /相手のクリーチャーを(\d+)体選ぶ。?(?:このターン|次の相手のターン(?:の終わりまで|中))、?そのクリーチャーは攻撃(?:もブロックも)?できない。?/;
    m = s.match(lock);
    if (m) {
      effects.push({ op: 'lockAttack', target: { side: 'opp', count: +m[1], upTo: false, filter: { type: 'creature' } } });
      s = s.replace(lock, '');
    }
    const sentences = s
      .replace(/引き、/g, '引く。')
      .split(/。|、その後、/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (const sen of sentences) {
      const e = parseSentence(sen);
      if (!e) return null;
      effects.push(e);
    }
    return effects.length ? effects : null;
  }

  // ───────────── 3. 行を読む ─────────────
  /** キーワード能力の行か？（当てはまれば keywords に書き込んで true） */
  function parseKeyword(line, kw) {
    const l = line.replace(/。$/, '');
    let m;
    if (/^ブロッカー$/.test(l)) return (kw.blocker = true);
    if (/^スピードアタッカー$/.test(l)) return (kw.speedAttacker = true);
    if (/^(?:W|ダブル)・?ブレイカー$/.test(l)) return (kw.breaker = 2);
    if (/^(?:T|トリプル)・?ブレイカー$/.test(l)) return (kw.breaker = 3);
    if (/^(?:Q|クワトロ)・?ブレイカー$/.test(l)) return (kw.breaker = 4);
    if (/^ワールド・?ブレイカー$/.test(l)) return (kw.breaker = 99);
    if (/^(?:S|シールド)・?トリガー$/.test(l)) return (kw.shieldTrigger = true);
    if (/^G・?ストライク$/.test(l)) return (kw.gStrike = true);
    if ((m = l.match(/^パワーアタッカー\+(\d+)$/))) return (kw.powerAttacker = +m[1]);
    if (/^スレイヤー$/.test(l)) return (kw.slayer = true);
    if (/^マッハファイター$/.test(l)) return (kw.machFighter = true);
    if (/^ジャストダイバー$/.test(l)) return (kw.justDiver = true);
    if (/^このクリーチャーは攻撃できない$/.test(l)) return (kw.cantAttack = true);
    if (/^このクリーチャーは(?:相手)?プレイヤーを攻撃できない$/.test(l)) return (kw.cantAttackPlayers = true);
    if (/^このクリーチャーは(?:相手に)?ブロックされない$/.test(l)) return (kw.unblockable = true);
    if (/^このクリーチャーはアンタップしている(?:相手の)?クリーチャーを攻撃できる$/.test(l)) return (kw.attackUntapped = true);
    return false;
  }

  /** 進化の条件の行か？ 例：「進化－自分の火のクリーチャー1体の上に置く。」「進化－自分の《竜》1体の上に置く。」 */
  function parseEvolution(line) {
    const m = line.match(/^進化(?:[-ー―]|クリーチャー)?(?:[:：])?(.*)$/);
    if (!m) return null;
    const evo = { civs: [], races: [] };
    const rest = m[1];
    const cond = rest.match(/(?:自分の)?(.+?)1体の上に置く/);
    if (cond) {
      const c = cond[1];
      const civM = c.match(new RegExp(`^((?:${CIV_NAMES})(?:または(?:${CIV_NAMES}))*)の(?:クリーチャー)?$`));
      if (civM) evo.civs = civM[1].split('または').map((nm) => SimData.CIV_BY_NAME[nm]);
      else if (!/^クリーチャー$/.test(c)) evo.races = c.replace(/[《》]/g, '').split('または');
    }
    return evo;
  }

  /** 「〜した時、」で始まる行の、発動の場面を判定する */
  const TRIGGERS = [
    [/^このクリーチャーが(?:バトルゾーンに)?出た時(?:または|か)(?:、)?(?:このクリーチャーが)?攻撃する時、/, ['cip', 'attack']],
    [/^このクリーチャー(?:をバトルゾーンに出した|がバトルゾーンに出た|が出た|を召喚した)時、/, ['cip']],
    [/^このクリーチャーが攻撃する時、/, ['attack']],
    [/^このクリーチャーが破壊された時、/, ['destroyed']],
    [/^このクリーチャーがブロックした時、/, ['block']],
    [/^このクリーチャーがバトルに勝った時、/, ['winBattle']],
    [/^自分のターンの(?:はじめ|始め)に、/, ['turnStart']],
    [/^自分のターンの(?:終わり|おわり)に、/, ['turnEnd']],
  ];

  /** 常在効果（今は「自分の他の〜のパワーを+」のみ） */
  function parseStatic(line) {
    const m = line.match(/^(?:バトルゾーンにある)?(自分の.*?)(?:すべて)?のパワー(?:を|は)\+(\d+)(?:する|される)。?$/);
    if (!m) return null;
    const sel = parseSelector(m[1]);
    return { kind: 'powerBuff', amount: +m[2], filter: sel.filter };
  }

  /**
   * カード1枚分のテキストを読む。
   * @param {string} text  カードの文章
   * @param {string} type  'creature' | 'evolution' | 'spell'
   */
  function parse(text, type) {
    const ab = { keywords: {}, evolution: null, triggers: [], spell: [], statics: [], unparsed: [] };
    const lines = splitLines(normalize(text));
    for (const line of lines) {
      if (parseKeyword(line, ab.keywords)) continue;
      const evo = parseEvolution(line);
      if (evo) { ab.evolution = evo; continue; }
      let handled = false;
      for (const [re, whens] of TRIGGERS) {
        const m = line.match(re);
        if (!m) continue;
        const effects = parseEffects(line.slice(m[0].length));
        if (effects) { for (const w of whens) ab.triggers.push({ when: w, effects }); handled = true; }
        break;
      }
      if (handled) continue;
      if (type !== 'spell') {
        const st = parseStatic(line);
        if (st) { ab.statics.push(st); continue; }
      } else {
        const effects = parseEffects(line);
        if (effects) { ab.spell.push(...effects); continue; }
      }
      ab.unparsed.push(line);
    }
    if (type === 'evolution' && !ab.evolution) ab.evolution = { civs: [], races: [] };
    return ab;
  }

  // ───────────── 効果を日本語で説明する（画面の「認識した効果」用） ─────────────
  const civName = (k) => (SimData.CIV_BY_KEY[k] || { name: k }).name;
  function describeFilter(f = {}) {
    const parts = [];
    if (f.other) parts.push('他の');
    if (f.tapped === true) parts.push('タップしている');
    if (f.tapped === false) parts.push('アンタップしている');
    if (f.maxPower != null) parts.push(`パワー${f.maxPower}以下の`);
    if (f.minPower != null) parts.push(`パワー${f.minPower}以上の`);
    if (f.maxCost != null) parts.push(`コスト${f.maxCost}以下の`);
    if (f.minCost != null) parts.push(`コスト${f.minCost}以上の`);
    if (f.blocker) parts.push('ブロッカーを持つ');
    if (f.civs) parts.push(f.civs.map(civName).join('または') + 'の');
    if (f.races) parts.push(f.races.map((r) => `《${r}》`).join('または') + 'の');
    parts.push(f.type === 'spell' ? '呪文' : f.type === 'creature' ? 'クリーチャー' : 'カード');
    return parts.join('');
  }
  function describeTarget(t) {
    if (!t) return '';
    if (t.thisCard) return 'このクリーチャー';
    const side = { opp: '相手の', self: '自分の', any: '' }[t.side] || '';
    const cnt = t.count === 'all' ? 'すべて' : `${t.count}体${t.upTo ? 'まで' : ''}`;
    return `${side}${describeFilter(Object.assign({ type: 'creature' }, t.filter))}を${cnt}`;
  }
  function describeEffect(e) {
    const opt = e.optional ? '（してもよい）' : '';
    const zone = { grave: '墓地', hand: '手札', mana: 'マナゾーン' };
    const d = {
      draw: () => `カードを${e.n}枚${e.upTo ? 'まで' : ''}引く`,
      manaBoost: () => `山札の上から${e.n}枚をマナゾーンに置く${e.tapped ? '（タップして）' : ''}`,
      addShield: () => `山札の上から${e.n}枚をシールドに加える`,
      discard: () => (e.side === 'opp'
        ? `相手の手札を${e.n === 99 ? 'すべて' : e.n + '枚'}捨てさせる（${{ random: '見ないで選ぶ', controller: '見て選ぶ', owner: '相手が選ぶ', all: 'すべて' }[e.how]}）`
        : `自分の手札を${e.n}枚捨てる`),
      breakShield: () => `相手のシールドを${e.n}つブレイクする`,
      shieldToGrave: () => `相手のシールドを${e.n}つ墓地に置く`,
      manaToGrave: () => `相手のマナを${e.n}枚墓地に置く`,
      manaToHand: () => `相手のマナを${e.n}枚手札に戻す`,
      putToBattle: () => `${zone[e.from]}から${describeFilter(e.filter)}を${e.n}体バトルゾーンに出す`,
      recover: () => `${zone[e.from]}から${describeFilter(e.filter)}を${e.n}枚${e.upTo ? 'まで' : ''}手札に戻す`,
      search: () => `山札から${describeFilter(e.filter)}を${e.n}枚まで手札に加え、山札をシャッフル`,
      power: () => `${describeTarget(e.target)}、このターンの間パワー${e.amount > 0 ? '+' : ''}${e.amount}`,
      destroy: () => `${describeTarget(e.target)}破壊する`,
      toGrave: () => `${describeTarget(e.target)}墓地に置く`,
      bounce: () => `${describeTarget(e.target)}手札に戻す`,
      toMana: () => `${describeTarget(e.target)}マナゾーンに置く`,
      tap: () => `${describeTarget(e.target)}タップする`,
      untap: () => `${describeTarget(e.target)}アンタップする`,
      lockAttack: () => `${describeTarget(e.target)}選び、このターン攻撃できなくする`,
    }[e.op];
    return (d ? d() : e.op) + opt;
  }

  const KEYWORD_NAMES = {
    blocker: 'ブロッカー', speedAttacker: 'スピードアタッカー', shieldTrigger: 'S・トリガー', gStrike: 'G・ストライク',
    slayer: 'スレイヤー', machFighter: 'マッハファイター', justDiver: 'ジャストダイバー', cantAttack: '攻撃できない',
    cantAttackPlayers: 'プレイヤーを攻撃できない', unblockable: 'ブロックされない', attackUntapped: 'アンタップしているクリーチャーを攻撃できる',
  };
  const WHEN_NAMES = { cip: '出た時', attack: '攻撃する時', destroyed: '破壊された時', block: 'ブロックした時', winBattle: 'バトルに勝った時', turnStart: '自分のターンのはじめに', turnEnd: '自分のターンの終わりに' };

  /** 読み取った能力を、画面に出す説明文の配列にする */
  function describe(ab) {
    const out = [];
    for (const [k, v] of Object.entries(ab.keywords)) {
      if (!v) continue;
      if (k === 'breaker') out.push({ 2: 'W・ブレイカー', 3: 'T・ブレイカー', 4: 'Q・ブレイカー', 99: 'ワールド・ブレイカー' }[v] || `${v}枚ブレイク`);
      else if (k === 'powerAttacker') out.push(`パワーアタッカー+${v}`);
      else out.push(KEYWORD_NAMES[k] || k);
    }
    if (ab.evolution) {
      const c = [...ab.evolution.civs.map(civName), ...ab.evolution.races.map((r) => `《${r}》`)];
      out.push(`進化：自分の${c.length ? c.join('または') + 'の' : ''}クリーチャー1体の上に置く`);
    }
    for (const t of ab.triggers) out.push(`【${WHEN_NAMES[t.when]}】` + t.effects.map(describeEffect).join(' → '));
    if (ab.spell.length) out.push('【呪文】' + ab.spell.map(describeEffect).join(' → '));
    for (const st of ab.statics) out.push(`【常在】自分の${describeFilter(st.filter)}のパワー+${st.amount}`);
    return out;
  }

  /** 対応している言い回しの見本（カード編集画面のヘルプに表示） */
  const EXAMPLES = [
    'ブロッカー / スピードアタッカー / W・ブレイカー / T・ブレイカー / ワールド・ブレイカー',
    'S・トリガー / G・ストライク / パワーアタッカー+2000 / スレイヤー / マッハファイター / ジャストダイバー',
    'このクリーチャーは攻撃できない。 / このクリーチャーはブロックされない。',
    '進化－自分の火のクリーチャー1体の上に置く。',
    'このクリーチャーが出た時、カードを1枚引いてもよい。',
    'このクリーチャーが攻撃する時、相手のパワー3000以下のクリーチャーを1体破壊する。',
    'このクリーチャーが破壊された時、自分の山札の上から1枚目をマナゾーンに置く。',
    '相手のクリーチャーを1体選び、持ち主の手札に戻す。',
    '相手のタップしているクリーチャーを1体破壊する。 / 相手のクリーチャーをすべてタップする。',
    '相手の手札を見ないで1枚選び、捨てさせる。',
    '自分の墓地からクリーチャーを1体、手札に戻す。',
    '自分の山札を見る。その中からクリーチャーを1体選び、相手に見せてから手札に加える。その後、山札をシャッフルする。',
    '自分の山札の上から1枚目をシールド化する。',
    'バトルゾーンにある自分の他の火のクリーチャーのパワーは+1000される。',
  ];

  return { normalize, parse, parseSelector, parseSentence, describe, describeEffect, describeFilter, EXAMPLES };
});
