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
 *   2. 行に分ける … 「■」や改行で能力ごとの行に、「▶」で選択肢の行に分ける
 *   3. 行を読む   … 各行が「キーワード能力」「進化の条件」「〜した時（誘発）」「常在効果」などのどれかを判定し、
 *                   効果の文を「動作（破壊する・手札に戻す…）」と「対象（相手の・パワー3000以下の…）」に分解する
 *
 *   読めなかった行は unparsed（未対応）に入れて画面に表示します。
 *   その場合は、カード編集画面で「対応している言い回し」に書き換えると動くようになります。
 *
 * ■ 結果の形（abilities）
 *   {
 *     keywords:  { blocker, speedAttacker, breaker, shieldTrigger, gStrike, powerAttacker, slayer, cantAttack, cantAttackPlayers,
 *                  unblockable, attackUntapped, machFighter, justDiver, yobinion, guardman, smashBurst, sinkarize, manaUntapped },
 *     evolution: { civs, races } または null,
 *     triggers:  [ { when, effects, oppTurnOnly } ]      … 〜した時（when の種類は WHEN_NAMES を参照）
 *     handTriggers: [ { when, cond, effects } ]          … 手札にある時に働く誘発（相手のターンの終わりに召喚 など）
 *     spell:     [...効果]                               … 呪文を唱えた時の効果
 *     statics:   [...]                                   … 常在効果（パワー増加・キーワードを与える）
 *     attackChance: { civs, races } または null          … アタック・チャンスの条件
 *     hyperCost: { tapOthers } / hyper: { power, keywords, triggers, statics } … ハイパー化とハイパーモード
 *     unparsed:  ['読めなかった行', ...],
 *   }
 *
 * ■ 効果（effect）の op 一覧は describeEffect() を見ると分かります。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.TextParser = factory(root.SimData);
})(typeof self !== 'undefined' ? self : this, function (SimData) {
  'use strict';

  const CIV_NAMES = '光|水|闇|火|自然';
  const civKey = (nm) => SimData.CIV_BY_NAME[nm];

  // ───────────── 1. 整える ─────────────
  function normalize(text) {
    let s = String(text || '');
    s = s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)); // 全角英数→半角
    s = s.replace(/＋/g, '+').replace(/[－−‐–]/g, '-'); // プラス・マイナス記号をそろえる（長音「ー」は残す）
    s = s.replace(/[･·]/g, '・').replace(/：/g, ':').replace(/！/g, '!');
    s = s.replace(/飛ばす/g, 'とばす').replace(/飛ばして/g, 'とばして');
    s = s.replace(/[ \t　]+/g, ''); // 日本語のカード文には空白は不要
    // （ ）の中は「注釈文」（キーワードの説明）なので取り除く。入れ子にも対応するため繰り返す
    for (let i = 0; i < 3; i++) s = s.replace(/（[^（）]*）|\([^()]*\)/g, '');
    s = s.replace(/<([^<>]+)>/g, '《$1》'); // 種族の囲み記号をそろえる
    return s;
  }

  // ───────────── 2. 行に分ける ─────────────
  function splitLines(s) {
    return s
      .replace(/[▶►▷]/g, '\n▶') // 選択肢の印。同じ行に続いていても分ける
      .split(/\r?\n|[■▪●◆□]/)
      .map((l) => l.replace(/^[・\-*]+/, '').trim())
      .filter((l) => l && !/^[。、▶]+$/.test(l));
  }

  // 「〜してもよい」を普通の形に直し、「任意（してもしなくてもよい）」の印を付けるための表
  const OPTIONAL_FORMS = [
    [/引いてもよい/, '引く'], [/破壊してもよい/, '破壊する'], [/戻してもよい/, '戻す'], [/置いてもよい/, '置く'],
    [/出してもよい/, '出す'], [/加えてもよい/, '加える'], [/アンタップしてもよい/, 'アンタップする'],
    [/タップしてもよい/, 'タップする'], [/捨ててもよい/, '捨てる'], [/ブレイクしてもよい/, 'ブレイクする'],
    [/唱えてもよい/, '唱える'], [/とばしてもよい/, 'とばす'], [/召喚してもよい/, '召喚する'], [/してもよい/, 'する'],
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
   *   filter … 絞り込み（パワー・コスト・タップ状態・文明・種族・ブロッカー・「他の」・カードの種類）
   */
  function parseSelector(phrase) {
    const p = phrase.replace(/、/g, '');
    if (/^(この|その)(クリーチャー|タマシード)/.test(p)) return { thisCard: true, count: 1 };
    const sel = { side: 'any', count: 1, upTo: false, filter: {} };
    if (/相手の/.test(p)) sel.side = 'opp';
    else if (/自分の/.test(p)) sel.side = 'self';
    if (/すべて|全て/.test(p)) sel.count = 'all';
    const n = p.match(/(\d+)(体|枚|つ)/);
    if (n) sel.count = Number(n[1]);
    if (/まで/.test(p)) sel.upTo = true;
    sel.filter = parseFilter(p);
    return sel;
  }
  /** 絞り込みの条件だけを読む（対象の数や持ち主は含まない） */
  function parseFilter(p) {
    const f = {};
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
    // 文明：「火の」「光または水の」（「自分の」「相手の」の後ろや、文の先頭にあるもの）
    const civRe = new RegExp(`(?:^|[のな、])((?:${CIV_NAMES})(?:または(?:${CIV_NAMES}))*)の`);
    if ((m = p.match(civRe))) f.civs = m[1].split('または').map(civKey);
    const races = [...p.matchAll(/《([^》]+)》/g)].map((x) => x[1]);
    if (races.length) f.races = races;
    if (/エレメント/.test(p)) f.type = 'element';
    else if (/タマシード/.test(p)) f.type = 'tamaseed';
    else if (/呪文/.test(p)) f.type = 'spell';
    else if (/クリーチャー/.test(p)) f.type = 'creature';
    return f;
  }

  // ───────────── 条件（〜なら） ─────────────
  function parseCondition(c) {
    let m;
    if ((m = c.match(/自分のマナゾーンに(?:ある)?カードが(\d+)枚以下/))) return { kind: 'manaLE', n: +m[1] };
    if ((m = c.match(/自分のマナゾーンに(?:ある)?カードが(\d+)枚以上/))) return { kind: 'manaGE', n: +m[1] };
    if ((m = c.match(/自分の手札が(\d+)枚以下/))) return { kind: 'handLE', n: +m[1] };
    if ((m = c.match(/自分のシールドが(\d+)つ以下/))) return { kind: 'shieldLE', n: +m[1] };
    if ((m = c.match(/相手のクリーチャーが自分のクリーチャーより(\d+)体以上多/))) return { kind: 'oppMoreCreatures', n: +m[1] };
    return null;
  }

  // ───────────── 効果の文を読む ─────────────
  const ZONE_WORD = { 手札: 'hand', マナゾーン: 'mana', 墓地: 'grave', シールドゾーン: 'shield', シールド: 'shield', 山札の下: 'deckBottom', 山札の一番下: 'deckBottom' };
  /**
   * 1つの文（「。」で区切った単位）を効果データにする。読めなければ null。
   * 上から順に試し、最初に当てはまったものを使う（具体的な言い回しほど上に置く）。
   */
  function parseSentence(raw) {
    const { text: s0, optional } = stripOptional(raw);
    let s = s0.replace(/^(このターン、|その後、|次に、)/, '').replace(/。$/, '');
    const done = (e) => (optional ? Object.assign(e, { optional: true }) : e);
    let m;

    // ── 条件付き：「〜なら、〜する」
    if ((m = s.match(/^(.+?)(?:なら|ならば|であれば|あれば)、(.+)$/))) {
      const cond = parseCondition(m[1]);
      const inner = cond && parseSentence(m[2]);
      if (cond && inner) return done({ op: 'if', cond, effects: [inner] });
    }
    // ── ターンの残りをとばす（「その攻撃の後」なら攻撃が終わってから）
    if (/その攻撃の後、?(?:相手は)?ターンの残りをとばす/.test(s)) return done({ op: 'skipAfterAttack' });
    if (/^(?:相手は|自分は)?ターンの残りをとばす$/.test(s)) return done({ op: 'skipTurn' });
    // ── 唱えた呪文を墓地からもう一度唱える
    if (/その呪文を(?:自分の)?墓地からコストを支払わずに(?:もう一度)?唱える/.test(s) || /その呪文をもう一度(?:自分の)?墓地からコストを支払わずに唱える/.test(s))
      return done({ op: 'recastEvent' });
    // ── 手札・墓地からタダで唱える
    if ((m = s.match(/^(.*?)呪文を(\d+)枚、?自分の(手札|墓地|手札または墓地|手札か墓地)からコストを支払わずに唱える$/))) {
      const from = /または|か墓地/.test(m[3]) ? 'handOrGrave' : m[3] === '墓地' ? 'grave' : 'hand';
      const f = parseFilter(m[1] + '呪文');
      f.type = 'spell';
      return done({ op: 'castFree', from, filter: f, n: +m[2] });
    }
    // ── このクリーチャーを召喚する（手札から）
    if (/^このクリーチャーを(?:コストを支払わずに)?召喚する$/.test(s)) return done({ op: 'summonSelf' });
    // ── カードを引く
    if ((m = s.match(/^カードを(\d+)枚(まで)?引く$/))) return done({ op: 'draw', n: +m[1], upTo: !!m[2] });
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
    if ((m = s.match(/^自分の手札を(\d+)枚(?:選んで|選び、)?捨てる$/))) return done({ op: 'discard', side: 'self', n: +m[1], how: 'owner' });
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
      const f = parseFilter(m[2]);
      f.type = 'creature';
      return done({ op: 'putToBattle', from, filter: f, n: +m[3], upTo: !!m[4] });
    }
    // ── 墓地・マナから手札へ（回収）
    if ((m = s.match(/(?:自分の)?(墓地|マナゾーン)から(.*?)を(\d+)(?:体|枚)(まで)?、?(?:選び、)?(?:自分の)?手札に(?:戻す|加える)/))) {
      const from = { 墓地: 'grave', マナゾーン: 'mana' }[m[1]];
      return done({ op: 'recover', from, filter: parseFilter(m[2]), n: +m[3], upTo: !!m[4] });
    }
    // ── パワーを変える（このターンの間）。「〜1枚につき」も読む
    if ((m = s.match(/^(.*?)のパワーを、?(.+?)(?:1枚|1体|1つ)につき([+-]\d+)する$/))) {
      const per = /マナゾーン/.test(m[2]) ? 'myMana' : /墓地/.test(m[2]) ? 'myGrave' : /手札/.test(m[2]) ? 'myHand' : /クリーチャー/.test(m[2]) ? 'myCreatures' : null;
      if (per) return done({ op: 'power', amount: +m[3], per, target: parseSelector(m[1].replace(/選び、(?:このターン、)?その/, '')) });
    }
    if ((m = s.match(/(.*?)のパワーを([+-]\d+)する/)) || (m = s.match(/(.*?)のパワーは([+-]\d+)される/))) {
      return done({ op: 'power', amount: +m[2], target: parseSelector(m[1].replace(/選び、(?:このターン、)?その/, '')) });
    }
    // ── クリーチャー・エレメントへの効果（文末の動作で見分ける）
    const verbs = [
      [/、?(?:選び、)?破壊する$/, 'destroy'],
      [/、?(?:選び、)?(?:持ち主の)?墓地に置く$/, 'toGrave'],
      [/、?(?:選び、)?(?:持ち主の)?手札に戻す$/, 'bounce'],
      [/、?(?:選び、)?(?:持ち主の)?マナゾーンに(?:置く|送る)$/, 'toMana'],
      [/、?(?:選び、)?アンタップする$/, 'untap'],
      [/、?(?:選び、)?タップする$/, 'tap'],
    ];
    for (const [re, op] of verbs) {
      if (!re.test(s)) continue;
      const phrase = s.replace(re, '').replace(/を$/, '');
      if (!phrase || /山札|墓地から|マナゾーンから|手札から|シールド|手札を/.test(phrase)) return null;
      return done({ op, target: parseSelector(phrase) });
    }
    return null;
  }

  /** 「その中から」に続く振り分けの指示（例：「1枚を手札に、1枚をマナゾーンに」）を読む */
  function parsePicks(seg) {
    const picks = [];
    for (const part of seg.split('、')) {
      const p = stripOptional(part);
      const m = p.text.match(/^(?:(.+?)を)?(\d+)(?:枚|体)(まで)?(?:を)?、?(?:表向きにして|相手に見せてから|見せてから)?(?:自分の)?(手札|マナゾーン|墓地|シールドゾーン|シールド|山札の下|山札の一番下)(?:に|へ)/);
      if (!m) return null;
      const f = m[1] ? parseFilter(m[1]) : {};
      picks.push({ to: ZONE_WORD[m[4]], count: +m[2], upTo: !!m[3] || p.optional, filter: f });
    }
    return picks;
  }

  /** 文のかたまり（誘発の後ろ・呪文の1行など）を効果の配列にする。読めない文があれば null */
  function parseEffects(text) {
    let s = text;
    const effects = [];
    const pre = (re, build) => {
      const m = s.match(re);
      if (!m) return;
      const e = build(m);
      if (!e) return;
      effects.push(e);
      s = s.replace(re, '');
    };
    // 複数の文にまたがる言い回しを先に処理する
    // ・山札全体を見て手札に加える（サーチ）
    pre(/(?:自分の)?山札を見る。その中から(.+?)を(\d+)(?:体|枚)(まで)?(?:選び、)?(?:相手に見せてから)?(?:自分の)?手札に加え(?:る|てもよい)。?(?:その後、)?山札をシャッフルする。?/,
      (m) => ({ op: 'search', filter: parseFilter(m[1]), n: +m[2], upTo: true }));
    // ・山札の上から何枚か見て振り分ける
    pre(/(?:自分の)?山札の上から(\d+)枚を見る。その中から(.+?)(?:置き|置く|加え|加える)?(?:。|、)(?:その後、)?残りを(?:好きな順序で)?(?:自分の)?(手札に加える|山札の(?:一番)?下に(?:好きな順序で)?置く|墓地に置く|マナゾーンに置く)。?/,
      (m) => {
        const picks = parsePicks(m[2]);
        if (!picks) return null;
        const rest = /手札/.test(m[3]) ? 'hand' : /墓地/.test(m[3]) ? 'grave' : /マナ/.test(m[3]) ? 'mana' : 'deckBottom';
        return { op: 'look', n: +m[1], picks, rest };
      });
    // ・墓地をシャッフルして山札の下へ
    pre(/プレイヤーを1人選ぶ。そのプレイヤーは、?自身の墓地のカードをすべてシャッフルし、?山札の下に置く。?/, () => ({ op: 'graveToDeckBottom', who: 'choose' }));
    pre(/(自分|相手)の墓地のカードをすべて(?:シャッフルし、?)?(?:持ち主の)?山札の下に置く。?/, (m) => ({ op: 'graveToDeckBottom', who: m[1] === '自分' ? 'self' : 'opp' }));
    // ・手札を山札の下に置いて、その枚数より多く引く
    pre(/自分の手札を(\d+)枚まで、?(?:好きな順序で)?山札の(?:一番)?下に(?:好きな順序で)?置く。?(?:その後、)?こうして(?:山札の下に)?置いた(?:カードの)?枚数より(\d+)枚多く、?カードを引く。?/,
      (m) => ({ op: 'cycleHand', max: +m[1], extra: +m[2] }));
    // ・「相手のクリーチャーを1体選ぶ。このターン、そのクリーチャーのパワーを〜につき-1000する」
    pre(/(相手の|自分の)?([^。]*?)クリーチャーを(\d+)体選ぶ。?(?:このターン、)?そのクリーチャーのパワーを、?(.+?)(?:1枚|1体|1つ)につき([+-]\d+)する。?/,
      (m) => {
        const per = /マナゾーン/.test(m[4]) ? 'myMana' : /墓地/.test(m[4]) ? 'myGrave' : /手札/.test(m[4]) ? 'myHand' : /クリーチャー/.test(m[4]) ? 'myCreatures' : null;
        if (!per) return null;
        const t = parseSelector(`${m[1] || ''}${m[2]}クリーチャーを${m[3]}体`);
        return { op: 'power', amount: +m[5], per, target: t };
      });
    // ・「相手のクリーチャーを1体選ぶ。このターン、そのクリーチャーは攻撃できない」
    pre(/相手のクリーチャーを(\d+)体選ぶ。?(?:このターン|次の相手のターン(?:の終わりまで|中))、?そのクリーチャーは攻撃(?:もブロックも)?できない。?/,
      (m) => ({ op: 'lockAttack', target: { side: 'opp', count: +m[1], upTo: false, filter: { type: 'creature' } } }));

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
  const KEYWORD_WORDS = {
    ブロッカー: ['blocker', true], スピードアタッカー: ['speedAttacker', true], ガードマン: ['guardman', true], スレイヤー: ['slayer', true],
    'W・ブレイカー': ['breaker', 2], 'T・ブレイカー': ['breaker', 3], 'Q・ブレイカー': ['breaker', 4], 'ワールド・ブレイカー': ['breaker', 99],
    マッハファイター: ['machFighter', true], ジャストダイバー: ['justDiver', true],
  };
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
    if (/^ヨビニオン$/.test(l)) return (kw.yobinion = true);
    if (/^ガードマン$/.test(l)) return (kw.guardman = true);
    if (/^スマッシュ・?バースト$/.test(l)) return (kw.smashBurst = true);
    if (/^(?:G・?ストライク)?シンカライズ$/.test(l)) { if (/G・?ストライク/.test(l)) kw.gStrike = true; return (kw.sinkarize = true); }
    if (/^このクリーチャーは攻撃できない$/.test(l)) return (kw.cantAttack = true);
    if (/^このクリーチャーは(?:相手)?プレイヤーを攻撃できない$/.test(l)) return (kw.cantAttackPlayers = true);
    if (/^このクリーチャーは(?:相手に)?ブロックされない$/.test(l)) return (kw.unblockable = true);
    if (/^このクリーチャーはアンタップしている(?:相手の)?クリーチャーを攻撃できる$/.test(l)) return (kw.attackUntapped = true);
    if (/マナゾーンに置く(?:時|際)、?(?:タップしてではなく|タップせずに|タップするかわりに)?アンタップ(?:して|状態で|したまま)置く$/.test(l)) return (kw.manaUntapped = true);
    return false;
  }

  /** 進化の条件の行か？ 例：「進化－自分の火のクリーチャー1体の上に置く。」「進化－自分の《竜》1体の上に置く。」 */
  function parseEvolution(line) {
    const m = line.match(/^進化(?:[-ー―]|クリーチャー)?(?::)?(.*)$/);
    if (!m) return null;
    const evo = { civs: [], races: [] };
    const cond = m[1].match(/(?:自分の)?(.+?)1体の上に置く/);
    if (cond) {
      const c = cond[1];
      const civM = c.match(new RegExp(`^((?:${CIV_NAMES})(?:または(?:${CIV_NAMES}))*)の(?:クリーチャー)?$`));
      if (civM) evo.civs = civM[1].split('または').map(civKey);
      else if (!/^クリーチャー$/.test(c)) evo.races = c.replace(/[《》]/g, '').split('または');
    }
    return evo;
  }

  /** 「〜した時、」で始まる行の、発動の場面を判定する */
  const TRIGGERS = [
    [/^このクリーチャーが召喚によって(?:バトルゾーンに)?出た時、?(?:または|か)、?(?:このクリーチャーが)?攻撃する時、/, ['summoned', 'attack']],
    [/^この(?:クリーチャー|タマシード)が(?:バトルゾーンに)?出た時、?(?:または|か)、?(?:このクリーチャーが)?攻撃する時、/, ['cip', 'attack']],
    [/^このクリーチャーを召喚した時、|^このクリーチャーが召喚によって(?:バトルゾーンに)?出た時、/, ['summoned']],
    [/^この(?:クリーチャー|タマシード)(?:をバトルゾーンに出した|がバトルゾーンに出た|が出た)時、/, ['cip']],
    [/^このクリーチャーが攻撃する時、/, ['attack']],
    [/^この(?:クリーチャー|タマシード)が破壊された時、/, ['destroyed']],
    [/^このクリーチャーがブロックした時、/, ['block']],
    [/^このクリーチャーがバトルに勝った時、/, ['winBattle']],
    [/^自分のターンの(?:はじめ|始め)に、/, ['turnStart']],
    [/^自分のターンの(?:終わり|おわり)に、/, ['turnEnd']],
    // 相手の行動に反応する（このカードがバトルゾーンにある間）
    [/^相手のクリーチャーが(?:バトルゾーンに)?出た時、?(?:または|か)、?相手が呪文を唱えた時、/, ['oppCreatureEnters', 'oppCastSpell']],
    [/^相手のクリーチャーが(?:バトルゾーンに)?出た時、/, ['oppCreatureEnters']],
    [/^相手が呪文を唱えた時、/, ['oppCastSpell']],
    [/^(?:相手のターン中、)?相手がマナゾーンにカードを置いた時、?(?:または|か)、?(?:相手が)?カードを使った時、/, ['oppManaPut', 'oppUseCard']],
    [/^(?:相手のターン中、)?相手がカードを使った時、/, ['oppUseCard']],
    [/^相手のクリーチャーが攻撃する時、/, ['oppAttack']],
    [/^自分の手札から呪文を唱えた時、/, ['selfCastFromHand']],
    [/^自分が呪文を唱えた時、/, ['selfCastSpell']],
  ];

  const GRANT_WORDS = {
    スピードアタッカー: 'speedAttacker', ガードマン: 'guardman', ブロッカー: 'blocker', スレイヤー: 'slayer', マッハファイター: 'machFighter',
    'W・ブレイカー': 'breaker', ジャストダイバー: 'justDiver',
  };
  /** 常在効果（パワーを上げる・キーワードを与える） */
  function parseStatic(line) {
    let m = line.match(/^(?:バトルゾーンにある)?(自分の.*?)(?:すべて)?のパワー(?:を|は)\+(\d+)(?:する|される)。?$/);
    if (m) return { kind: 'powerBuff', amount: +m[2], filter: parseFilter(m[1]) };
    m = line.match(/^(?:バトルゾーンにある)?(自分の.*?クリーチャー)(?:すべて|全体)?(?:に|は)(?:すべて)?((?:「[^」]+」(?:と|、)?)+)を(?:与える|得る)。?$/);
    if (m) {
      const kws = [...m[2].matchAll(/「([^」]+)」/g)].map((x) => x[1]);
      const keys = kws.map((k) => GRANT_WORDS[k]);
      if (keys.every(Boolean)) return { kind: 'grant', keywords: keys, filter: parseFilter(m[1]) };
    }
    return null;
  }

  /** アタック・チャンスの条件（例：「水と闇と自然のディスペクター」） */
  function parseAttackChance(line) {
    const m = line.match(/^アタック・?チャンス-?:?(.+?)。?$/);
    if (!m) return null;
    const c = m[1].match(new RegExp(`^((?:${CIV_NAMES})(?:と(?:${CIV_NAMES}))*)の(.+)$`));
    if (c) {
      const race = c[2].replace(/[《》]/g, '');
      return { civs: c[1].split('と').map(civKey), races: /^クリーチャー$/.test(race) ? [] : [race] };
    }
    return { civs: [], races: [m[1].replace(/[《》]/g, '')] };
  }

  const CHOOSE_RE = /次のうちいずれか(\d+)つを選ぶ|次の中から(\d+)回選ぶ|次のうち(\d+)つを選ぶ/;

  /**
   * カード1枚分のテキストを読む。
   * @param {string} text  カードの文章
   * @param {string} type  'creature' | 'evolution' | 'spell' | 'tamaseed'
   */
  function parse(text, type) {
    const ab = { keywords: {}, evolution: null, triggers: [], handTriggers: [], spell: [], statics: [], unparsed: [], attackChance: null, hyperCost: null, hyper: null };
    const hp = String(text || '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).match(/ハイパーモード[^\n]*?パワー\s*(\d+)/);
    const lines = splitLines(normalize(text));
    let cur = ab; // ハイパーモードの行以降は ab.hyper に書き込む
    let lastChoose = null;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      // 選択肢（▶）の行を、直前の「次のうちいずれか」にまとめる
      const options = [];
      if (CHOOSE_RE.test(line)) {
        while (i + 1 < lines.length && lines[i + 1].startsWith('▶')) options.push(lines[++i].slice(1));
      }
      if (line.startsWith('▶')) { ab.unparsed.push(line); continue; }
      const chooseM = line.match(CHOOSE_RE);
      const withChoose = (body) => {
        // 本文から選択の部分を取り出して、選択肢を効果にする
        if (!chooseM) return parseEffects(body);
        const [before] = body.split(CHOOSE_RE);
        const head = before.replace(/(?:その後、)?$/, '').replace(/。?その後、?$/, '');
        const effects = head.trim() ? parseEffects(head) : [];
        if (!effects) return null;
        const opts = options.map((o) => parseEffects(o));
        if (!opts.length || opts.some((o) => !o)) return null;
        const times = Number(chooseM[1] || chooseM[2] || chooseM[3]);
        const e = { op: 'choose', times, repeat: !!chooseM[2], options: opts, labels: options.map((o) => o.replace(/。$/, '')) };
        lastChoose = e;
        return [...effects, e];
      };
      const fail = () => { ab.unparsed.push(line); for (const o of options) ab.unparsed.push('▶' + o); };

      if (parseKeyword(line, cur.keywords)) continue;
      const evo = parseEvolution(line);
      if (evo) { ab.evolution = evo; continue; }
      const ac = parseAttackChance(line);
      if (ac) { ab.attackChance = ac; continue; }
      let m;
      if ((m = line.match(/^ハイパー化:?(.*)$/))) {
        const t = m[1].match(/自分の他のクリーチャーを(\d+)体タップする/);
        ab.hyperCost = { tapOthers: t ? +t[1] : 1 };
        continue;
      }
      if (/^ハイパーモード/.test(line)) {
        ab.hyper = { keywords: {}, triggers: [], statics: [], power: hp ? +hp[1] : null };
        cur = ab.hyper;
        continue;
      }
      // 「すべての文明があれば、2回選ぶかわりにすべてを1回ずつ選ぶ」
      if (/すべての文明.*(?:かわりに|代わりに).*(?:すべて|全部)(?:を|の選択肢を)?1回ずつ/.test(line) && lastChoose) { lastChoose.allIfFullCivs = true; continue; }
      // 手札にある時に働く：「相手のターンの終わりに、〜なら、このクリーチャーを召喚してもよい」
      if ((m = line.match(/^相手のターンの(?:終わり|おわり)に、(.+?)、このクリーチャーを(?:コストを支払わずに)?召喚してもよい。?$/))) {
        const cond = {};
        const c1 = m[1].match(/相手のクリーチャーが自分のクリーチャーより(\d+)体以上多/);
        if (c1) cond.oppMoreCreatures = +c1[1];
        const c2 = m[1].match(/自分の《(.+?)》がバトルゾーンに(?:い|あ)?なければ/);
        if (c2) cond.noneNamed = c2[1];
        if (c1 || c2) { ab.handTriggers.push({ when: 'oppTurnEnd', cond, effects: [{ op: 'summonSelf', optional: true }] }); continue; }
      }
      let handled = false;
      for (const [re, whens] of TRIGGERS) {
        const tm = line.match(re);
        if (!tm) continue;
        const effects = withChoose(line.slice(tm[0].length));
        if (effects) {
          const oppTurnOnly = /^相手のターン中、/.test(line);
          for (const w of whens) cur.triggers.push({ when: w, effects, oppTurnOnly });
          handled = true;
        }
        break;
      }
      if (handled) continue;
      if (type !== 'spell') {
        const st = parseStatic(line);
        if (st) { cur.statics.push(st); continue; }
      } else {
        const effects = withChoose(line);
        if (effects) { ab.spell.push(...effects); continue; }
      }
      fail();
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
    parts.push({ spell: '呪文', creature: 'クリーチャー', element: 'エレメント', tamaseed: 'タマシード' }[f.type] || 'カード');
    return parts.join('');
  }
  function describeTarget(t) {
    if (!t) return '';
    if (t.thisCard) return 'このクリーチャー';
    const side = { opp: '相手の', self: '自分の', any: '' }[t.side] || '';
    const cnt = t.count === 'all' ? 'すべて' : `${t.count}${t.filter && t.filter.type === 'element' ? 'つ' : '体'}${t.upTo ? 'まで' : ''}`;
    return `${side}${describeFilter(Object.assign({ type: 'creature' }, t.filter))}を${cnt}`;
  }
  const ZONE_JA = { grave: '墓地', hand: '手札', mana: 'マナゾーン', shield: 'シールド', deckBottom: '山札の下', handOrGrave: '手札か墓地' };
  const PER_JA = { myMana: '自分のマナ1枚', myGrave: '自分の墓地1枚', myHand: '自分の手札1枚', myCreatures: '自分のクリーチャー1体' };
  function describeCond(c) {
    return { manaLE: `マナが${c.n}枚以下`, manaGE: `マナが${c.n}枚以上`, handLE: `手札が${c.n}枚以下`, shieldLE: `シールドが${c.n}つ以下`, oppMoreCreatures: `相手のクリーチャーが${c.n}体以上多い` }[c.kind] || '条件';
  }
  function describeEffect(e) {
    const opt = e.optional ? '（してもよい）' : '';
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
      putToBattle: () => `${ZONE_JA[e.from]}から${describeFilter(e.filter)}を${e.n}体バトルゾーンに出す`,
      recover: () => `${ZONE_JA[e.from]}から${describeFilter(e.filter)}を${e.n}枚${e.upTo ? 'まで' : ''}手札に戻す`,
      search: () => `山札から${describeFilter(e.filter)}を${e.n}枚まで手札に加え、山札をシャッフル`,
      look: () => `山札の上から${e.n}枚を見て、${e.picks.map((p) => `${p.filter && Object.keys(p.filter).length ? describeFilter(p.filter) : ''}${p.count}枚${p.upTo ? 'まで' : ''}を${ZONE_JA[p.to]}に`).join('、')}、残りを${ZONE_JA[e.rest]}へ`,
      graveToDeckBottom: () => `${{ choose: '選んだプレイヤー', self: '自分', opp: '相手' }[e.who]}の墓地をすべてシャッフルして山札の下に置く`,
      cycleHand: () => `手札を${e.max}枚まで山札の下に置き、その枚数より${e.extra}枚多く引く`,
      power: () => `${describeTarget(e.target)}、このターンの間パワー${e.per ? `を${PER_JA[e.per]}につき` : ''}${e.amount > 0 ? '+' : ''}${e.amount}`,
      destroy: () => `${describeTarget(e.target)}破壊する`,
      toGrave: () => `${describeTarget(e.target)}墓地に置く`,
      bounce: () => `${describeTarget(e.target)}手札に戻す`,
      toMana: () => `${describeTarget(e.target)}マナゾーンに置く`,
      tap: () => `${describeTarget(e.target)}タップする`,
      untap: () => `${describeTarget(e.target)}アンタップする`,
      lockAttack: () => `${describeTarget(e.target)}選び、このターン攻撃できなくする`,
      skipTurn: () => 'ターンの残りをとばす',
      skipAfterAttack: () => 'その攻撃の後、ターンの残りをとばす',
      recastEvent: () => 'その呪文を墓地からタダでもう一度唱える',
      castFree: () => `${describeFilter(e.filter)}を${e.n}枚、${ZONE_JA[e.from]}からタダで唱える`,
      summonSelf: () => 'このクリーチャーをタダで召喚する',
      if: () => `${describeCond(e.cond)}なら：${e.effects.map(describeEffect).join(' → ')}`,
      choose: () => `${e.repeat ? `次から${e.times}回選ぶ` : `次から${e.times}つ選ぶ`}${e.allIfFullCivs ? '（すべての文明があれば全部）' : ''}：${e.options.map((o, i) => `[${i + 1}] ${o.map(describeEffect).join(' → ')}`).join(' ／ ')}`,
    }[e.op];
    return (d ? d() : e.op) + opt;
  }

  const KEYWORD_NAMES = {
    blocker: 'ブロッカー', speedAttacker: 'スピードアタッカー', shieldTrigger: 'S・トリガー', gStrike: 'G・ストライク',
    slayer: 'スレイヤー', machFighter: 'マッハファイター', justDiver: 'ジャストダイバー', cantAttack: '攻撃できない',
    cantAttackPlayers: 'プレイヤーを攻撃できない', unblockable: 'ブロックされない', attackUntapped: 'アンタップしているクリーチャーを攻撃できる',
    yobinion: 'ヨビニオン', guardman: 'ガードマン', smashBurst: 'スマッシュ・バースト', sinkarize: 'シンカライズ', manaUntapped: 'アンタップでマナに置ける',
  };
  const WHEN_NAMES = {
    cip: '出た時', summoned: '召喚した時', attack: '攻撃する時', destroyed: '破壊された時', block: 'ブロックした時', winBattle: 'バトルに勝った時',
    turnStart: '自分のターンのはじめに', turnEnd: '自分のターンの終わりに', oppCreatureEnters: '相手のクリーチャーが出た時', oppCastSpell: '相手が呪文を唱えた時',
    oppManaPut: '相手がマナを置いた時', oppUseCard: '相手がカードを使った時', oppAttack: '相手のクリーチャーが攻撃する時',
    selfCastFromHand: '自分が手札から呪文を唱えた時', selfCastSpell: '自分が呪文を唱えた時', oppTurnEnd: '相手のターンの終わりに（手札から）',
  };
  function describeKeywords(kw) {
    const out = [];
    for (const [k, v] of Object.entries(kw)) {
      if (!v) continue;
      if (k === 'breaker') out.push({ 2: 'W・ブレイカー', 3: 'T・ブレイカー', 4: 'Q・ブレイカー', 99: 'ワールド・ブレイカー' }[v] || `${v}枚ブレイク`);
      else if (k === 'powerAttacker') out.push(`パワーアタッカー+${v}`);
      else out.push(KEYWORD_NAMES[k] || k);
    }
    return out;
  }
  function describeStatic(st) {
    if (st.kind === 'grant') return `【常在】自分の${describeFilter(Object.assign({ type: 'creature' }, st.filter))}すべてに${st.keywords.map((k) => `「${KEYWORD_NAMES[k] || k}」`).join('')}を与える`;
    return `【常在】自分の${describeFilter(st.filter)}のパワー+${st.amount}`;
  }

  /** 読み取った能力を、画面に出す説明文の配列にする */
  function describe(ab) {
    const out = describeKeywords(ab.keywords);
    if (ab.evolution) {
      const c = [...ab.evolution.civs.map(civName), ...ab.evolution.races.map((r) => `《${r}》`)];
      out.push(`進化：自分の${c.length ? c.join('または') + 'の' : ''}クリーチャー1体の上に置く`);
    }
    if (ab.attackChance) out.push(`アタック・チャンス：自分の${ab.attackChance.civs.map(civName).join('と')}${ab.attackChance.races.map((r) => `の《${r}》`).join('')}が攻撃する時、タダで唱えてよい`);
    for (const t of ab.triggers) out.push(`【${WHEN_NAMES[t.when]}${t.oppTurnOnly ? '・相手のターン中' : ''}】` + t.effects.map(describeEffect).join(' → '));
    for (const t of ab.handTriggers || []) out.push(`【${WHEN_NAMES[t.when]}】${t.cond.oppMoreCreatures ? `相手のクリーチャーが${t.cond.oppMoreCreatures}体以上多く、` : ''}${t.cond.noneNamed ? `自分の《${t.cond.noneNamed}》がいなければ、` : ''}` + t.effects.map(describeEffect).join(' → '));
    if (ab.spell.length) out.push('【呪文】' + ab.spell.map(describeEffect).join(' → '));
    for (const st of ab.statics) out.push(describeStatic(st));
    if (ab.hyperCost) out.push(`ハイパー化：自分の他のクリーチャーを${ab.hyperCost.tapOthers}体タップする（メインステップ中）`);
    if (ab.hyper) {
      const h = ab.hyper;
      const inner = [...describeKeywords(h.keywords), ...h.triggers.map((t) => `【${WHEN_NAMES[t.when]}】` + t.effects.map(describeEffect).join(' → ')), ...h.statics.map(describeStatic)];
      out.push(`【ハイパーモード${h.power ? `・パワー${h.power}` : ''}】${inner.join(' ／ ')}`);
    }
    return out;
  }

  /** 対応している言い回しの見本（カード編集画面のヘルプに表示） */
  const EXAMPLES = [
    'ブロッカー / スピードアタッカー / W・ブレイカー / T・ブレイカー / ワールド・ブレイカー / ガードマン / ヨビニオン',
    'S・トリガー / G・ストライク / パワーアタッカー+2000 / スレイヤー / マッハファイター / ジャストダイバー / スマッシュ・バースト / シンカライズ',
    'このクリーチャーは攻撃できない。 / このクリーチャーはブロックされない。',
    '進化－自分の火のクリーチャー1体の上に置く。',
    'このクリーチャーが出た時、カードを1枚引いてもよい。 / このクリーチャーが召喚によってバトルゾーンに出た時または攻撃する時、〜',
    'このクリーチャーが攻撃する時、相手のパワー3000以下のクリーチャーを1体破壊する。',
    'このクリーチャーが破壊された時、自分の山札の上から1枚目をマナゾーンに置く。',
    '相手のクリーチャーを1体選び、持ち主の手札に戻す。 / 相手のコスト6以下のエレメントを1つ選び、破壊する。',
    '自分の手札を1枚捨てる。その後、次のうちいずれか1つを選ぶ。（次の行から「▶」で選択肢） / 次の中から2回選ぶ。',
    '自分の山札の上から4枚を見る。その中から1枚を手札に、1枚をマナゾーンに、1枚を墓地に置き、残りを山札の下に置く。',
    '自分の山札の上から1枚目をマナゾーンに置く。その後、自分のマナゾーンにカードが5枚以下なら、カードを1枚引く。',
    '相手のクリーチャーを1体選ぶ。このターン、そのクリーチャーのパワーを、自分のマナゾーンにあるカード1枚につき-1000する。',
    '相手のクリーチャーがバトルゾーンに出た時、または相手が呪文を唱えた時、ターンの残りをとばしてもよい。',
    'このクリーチャーが攻撃する時、水のコスト5以下の呪文を1枚、自分の手札からコストを支払わずに唱えてもよい。',
    'アタック・チャンス－水と闇と自然のディスペクター / 自分のクリーチャーすべてに「スピードアタッカー」と「ガードマン」を与える。',
    'ハイパー化：自分の他のクリーチャーを1体タップする。 / ハイパーモード パワー11000（この行より下がハイパーモード中の能力）',
    'バトルゾーンにある自分の他の火のクリーチャーのパワーは+1000される。',
  ];

  return { normalize, parse, parseSelector, parseFilter, parseSentence, describe, describeEffect, describeFilter, EXAMPLES, KEYWORD_NAMES, WHEN_NAMES };
});
