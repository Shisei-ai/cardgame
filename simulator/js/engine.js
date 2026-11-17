/*
 * engine.js — 対戦のルール処理（画面とは完全に分けてある）
 *
 * ■ このファイルの役割
 *   ゾーン（山札・手札・マナ・バトルゾーン・シールド・墓地）の管理、ターンの進行、
 *   召喚・呪文・攻撃・ブロック・バトル・シールドのブレイク・S・トリガー・勝敗の判定を行います。
 *   画面（battle-ui.js）は、ここが出す「お知らせ（イベント）」を見て表示を作るだけです。
 *
 * ■ 再現しているルール（基本ルール）
 *   ・デッキ40枚。対戦の最初に、山札の上から5枚をシールドに、5枚を手札にする
 *   ・先攻の最初のターンはドローしない
 *   ・ターンの流れ：ターン開始（自分のカードをすべてアンタップ）→ ドロー → マナチャージ（1ターンに1枚まで）
 *                   → メイン（召喚・呪文・ハイパー化）→ 攻撃 → ターン終了
 *   ・コストの支払い：マナゾーンのカードを、コストと同じ枚数タップする。その中に、使うカードの
 *                     すべての文明が1枚以上ずつ含まれていなければならない
 *   ・多色カード（2つ以上の文明を持つカード）は、タップした状態でマナゾーンに置く
 *   ・召喚酔い：出たターンは攻撃できない（スピードアタッカー・進化クリーチャーは例外）
 *   ・攻撃できるのは「相手プレイヤー」か「相手のタップしているクリーチャー」
 *   ・ブロッカーは攻撃をブロックできる（タップしてバトル）。ガードマンは自分の他のクリーチャーへの攻撃を引き受ける
 *   ・バトル：パワーの大きい方が勝ち、負けた方は破壊。同じなら両方破壊
 *   ・プレイヤーへの攻撃が通ると、シールドをブレイク（手札に加える）。S・トリガーはその時タダで使える
 *   ・シールドが0枚の時にプレイヤーへの攻撃が通ると、ダイレクトアタックで勝ち
 *   ・山札が0枚になったプレイヤーは負け（ライブラリアウト）
 *   ・パワーが0以下になったクリーチャーは破壊される
 *   ・誘発した能力は、ターンのプレイヤーの分から先に解決する
 *   ・「ターンの残りをとばす」と、そのターンは即座に終わる（「ターンの終わりに」の能力も誘発しない）
 *
 * ■ カードの種類
 *   ・クリーチャー / 進化クリーチャー / 呪文 / タマシード（バトルゾーンに置くが、クリーチャーではない。攻撃・ブロックしない）
 *   ・ツインパクト：クリーチャーのカードに def.spellSide（呪文側）がある。手札からはどちらの面でも使える
 *   ・「エレメント」＝ バトルゾーンにあるクリーチャーとタマシード
 *
 * ■ 選択の仕組み
 *   プレイヤーの判断が必要になると、await this.ask(プレイヤー番号, 質問) で止まって答えを待ちます。
 *   質問に答えるのは「エージェント」（人間なら画面、CPUなら ai.js）です。
 *   質問の種類（type）：
 *     'charge'  … マナに置くカード。candidates は手札の uid。答えは uid か null（置かない）
 *     'main'    … メインでする行動。actions から1つ選ぶ。答えは行動のオブジェクト
 *     'attack'  … 攻撃する行動。actions から1つ選ぶ（{kind:'end'} でターン終了）
 *     'block'   … ブロックに使うクリーチャー。答えは uid か null（ブロックしない）
 *     'target'  … カードを選ぶ。candidates から min〜max 枚。答えは uid の配列
 *     'yesno'   … 「〜してもよい」。答えは true / false
 *     'number'  … 数を選ぶ（「〜枚まで引く」）。答えは min〜max の整数
 *     'option'  … 選択肢から1つ選ぶ（「次のうちいずれか1つ」など）。options は文の配列。答えは番号
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'), require('./textparser.js'));
  else root.Engine = factory(root.SimData, root.TextParser);
})(typeof self !== 'undefined' ? self : this, function (SimData, TextParser) {
  'use strict';
  const { RULES } = SimData;
  const ALL_CIVS = ['light', 'water', 'darkness', 'fire', 'nature'];

  /** 勝敗が決まった時に、処理の途中から一気に抜けるための「例外」 */
  class GameOver extends Error {
    constructor(winner, reason) { super(reason); this.winner = winner; this.reason = reason; }
  }
  /** 「ターンの残りをとばす」時に、処理の途中からターンの終わりまで抜けるための「例外」 */
  class SkipTurn extends Error {}

  /** 決まった種（seed）から同じ乱数列を作る（テストで同じ対戦を再現できるように） */
  function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // カードのテキストを毎回読み直さないよう、読んだ結果を覚えておく
  const abilityCache = new WeakMap();
  function abilitiesOf(def) {
    let ab = abilityCache.get(def);
    if (!ab || ab._text !== def.text || ab._type !== def.type) {
      ab = TextParser.parse(def.text || '', def.type);
      ab._text = def.text; ab._type = def.type;
      abilityCache.set(def, ab);
    }
    return ab;
  }
  // ツインパクトの呪文側を、ひとつのカード定義のように扱うための入れ物
  const spellSideCache = new WeakMap();
  function spellSideDef(def) {
    if (!def || !def.spellSide || !def.spellSide.name) return null;
    let s = spellSideCache.get(def);
    const src = def.spellSide;
    if (!s || s._src !== src || s.text !== src.text || s.cost !== src.cost) {
      s = { id: def.id + '#spell', name: src.name, type: 'spell', civs: src.civs && src.civs.length ? src.civs : def.civs, cost: src.cost, power: null, races: [], text: src.text || '', image: null, twinOf: def, _src: src };
      spellSideCache.set(def, s);
    }
    return s;
  }
  const isCreatureDef = (def) => def.type === 'creature' || def.type === 'evolution';
  const isElementDef = (def) => isCreatureDef(def) || def.type === 'tamaseed';
  /** そのカードを「呪文として」見た時の定義（呪文そのもの、またはツインパクトの呪文側） */
  const spellView = (def) => (def.type === 'spell' ? def : spellSideDef(def));

  /** デッキが規則を満たしているか（40枚・同名4枚まで）。問題があれば文の配列を返す */
  function validateDeck(defs) {
    const errors = [];
    if (defs.length !== RULES.deckSize) errors.push(`デッキは${RULES.deckSize}枚ちょうどにしてください（今は${defs.length}枚）`);
    const count = {};
    for (const d of defs) count[d.name] = (count[d.name] || 0) + 1;
    for (const [name, n] of Object.entries(count)) if (n > RULES.maxCopies) errors.push(`「${name}」が${n}枚あります（同じ名前は${RULES.maxCopies}枚まで）`);
    return errors;
  }

  /** 名前を「」で囲む（「真実を見極めよ」のように、すでに「」で始まる名前はそのまま） */
  const q = (name) => (/^「.*」$/.test(name) ? name : `「${name}」`);

  const ZONE_KEYS = { deck: 'deck', hand: 'hand', mana: 'mana', battle: 'battle', shield: 'shields', grave: 'grave' };
  const ZONE_NAMES = { deck: '山札', hand: '手札', mana: 'マナゾーン', battle: 'バトルゾーン', shield: 'シールド', grave: '墓地', deckBottom: '山札の下' };

  class Game {
    /**
     * @param {object} o
     *   decks  … [プレイヤー0のデッキ, プレイヤー1のデッキ]（カード定義の配列）
     *   agents … [エージェント0, エージェント1]（choose(game, 番号, 質問) を持つもの）
     *   names  … 表示名
     *   seed   … 乱数の種
     *   first  … 先攻のプレイヤー番号（省略するとランダム）
     *   pace   … 演出のための待ち時間を入れる関数（画面用。省略可）
     */
    constructor(o) {
      this.rng = makeRng(o.seed == null ? Date.now() : o.seed);
      this.agents = o.agents;
      this.pace = o.pace || (async () => {});
      this.listeners = [];
      this.uidSeq = 1;
      this.cards = new Map(); // uid → カード（場所を問わず全カード）
      this.turnNo = 0;
      this.active = 0;
      this.phase = 'setup';
      this.winner = null;
      this.endReason = '';
      this.depth = 0;
      this.pendingTriggers = [];
      this.skipAfterAttack = false;
      this.players = [0, 1].map((i) => ({
        idx: i, name: (o.names || ['あなた', 'CPU'])[i],
        deck: [], hand: [], mana: [], battle: [], shields: [], grave: [],
        charged: false,
      }));
      o.decks.forEach((defs, i) => {
        for (const def of defs) {
          const c = { uid: this.uidSeq++, def, owner: i, zone: 'deck', tapped: false, enteredTurn: -1, under: [], tempPower: 0 };
          this.cards.set(c.uid, c);
          this.players[i].deck.push(c);
        }
      });
      this.first = o.first != null ? o.first : (this.rng() < 0.5 ? 0 : 1);
    }

    // ───────────── お知らせ（画面・ログ用） ─────────────
    on(fn) { this.listeners.push(fn); }
    emit(ev) { for (const fn of this.listeners) fn(ev, this); }
    say(text, player) { this.emit({ kind: 'log', text, player }); }

    // ───────────── 基本の道具 ─────────────
    opp(i) { return 1 - i; }
    card(uid) { return this.cards.get(uid); }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    }
    zoneArr(c) { const k = ZONE_KEYS[c.zone]; return k ? this.players[c.owner][k] : null; }
    nameOf(c) { return q(c.def.name); }
    /** そのカードは今クリーチャーか（タマシードや呪文はちがう） */
    isCreature(c) { return isCreatureDef(c.def); }

    /**
     * 能力（ハイパーモード中なら、ハイパーモードの能力も合わせたもの）
     * ハイパーモードの能力はカードの文章の「ハイパーモード」の行より下に書かれている
     */
    ab(c) {
      const base = abilitiesOf(c.def);
      if (!c.hyper || !base.hyper) return base;
      const h = base.hyper;
      return Object.assign({}, base, {
        keywords: Object.assign({}, base.keywords, h.keywords),
        triggers: [...base.triggers, ...h.triggers],
        statics: [...base.statics, ...h.statics],
      });
    }
    /** キーワード能力（他のカードから与えられたものも含む） */
    kw(c, name) {
      const own = this.ab(c).keywords[name];
      if (own) return own;
      if (c.zone !== 'battle' || this._granting) return own;
      this._granting = true; // 与える効果の条件を調べる間に、もう一度ここが呼ばれて止まらなくなるのを防ぐ
      try {
        for (const src of this.players[c.owner].battle) {
          for (const st of this.ab(src).statics) {
            if (st.kind !== 'grant' || !st.keywords.includes(name)) continue;
            if (st.filter.other && src === c) continue;
            if (!this.isCreature(c)) continue;
            if (this.matches(c, Object.assign({}, st.filter, { type: null }), src)) return name === 'breaker' ? 2 : true;
          }
        }
      } finally { this._granting = false; }
      return own;
    }

    /** 今のパワー（元のパワー＋常在効果＋このターンの増減＋攻撃中のパワーアタッカー） */
    power(c) {
      const base = abilitiesOf(c.def);
      let p = c.hyper && base.hyper && base.hyper.power ? base.hyper.power : c.def.power || 0;
      if (c.zone !== 'battle') return p;
      p += c.tempPower;
      if (c.attacking) p += this.kw(c, 'powerAttacker') || 0;
      for (const src of this.players[c.owner].battle) {
        for (const st of this.ab(src).statics) {
          if (st.kind !== 'powerBuff') continue;
          if (st.filter.other && src === c) continue;
          // パワーの条件は付けずに判定する（パワーの計算が自分自身を呼び続けないように）
          const f = Object.assign({}, st.filter, { maxPower: null, minPower: null });
          if (this.matches(c, f, src)) p += st.amount;
        }
      }
      return p;
    }

    /** カード定義が条件（filter）に合うか（ゾーンに関係しない部分） */
    defMatches(d, f) {
      if (f.maxCost != null && d.cost > f.maxCost) return false;
      if (f.minCost != null && d.cost < f.minCost) return false;
      if (f.civs && !f.civs.some((k) => (d.civs || []).includes(k))) return false;
      if (f.races && !f.races.some((r) => (d.races || []).some((x) => x.includes(r) || r.includes(x)))) return false;
      if (f.evolution && d.type !== 'evolution') return false;
      return true;
    }
    /** カードが条件（filter）に合うか */
    matches(c, f = {}, source = null) {
      const d = c.def;
      if (f.other && c === source) return false;
      // カードの種類：バトルゾーン以外では、ツインパクトはクリーチャーでもあり呪文でもある
      let views = [d];
      if (f.type === 'creature') { if (!isCreatureDef(d)) return false; }
      else if (f.type === 'element') { if (!isElementDef(d)) return false; }
      else if (f.type === 'tamaseed') { if (d.type !== 'tamaseed') return false; }
      else if (f.type === 'spell') { const sv = c.zone === 'battle' ? null : spellView(d); if (!sv) return false; views = [sv]; }
      else if (d.spellSide && c.zone !== 'battle') views = [d, spellSideDef(d)];
      if (!views.some((v) => this.defMatches(v, f))) return false;
      if (f.maxPower != null || f.minPower != null) {
        if (c.zone === 'battle' && !this.isCreature(c)) return false;
        const pw = c.zone === 'battle' ? this.power(c) : d.power || 0;
        if (f.maxPower != null && pw > f.maxPower) return false;
        if (f.minPower != null && pw < f.minPower) return false;
      }
      if (f.tapped === true && !c.tapped) return false;
      if (f.tapped === false && c.tapped) return false;
      if (f.blocker && !this.kw(c, 'blocker')) return false;
      return true;
    }

    /**
     * カードを別のゾーンへ動かす。
     * 進化クリーチャーがバトルゾーンを離れる時は、下に重なっているカードも同じゾーンへ行く。
     * to に 'deckBottom' を指定すると山札の一番下へ。
     */
    move(c, to, opts = {}) {
      const from = c.zone;
      const arr = this.zoneArr(c);
      if (arr) { const i = arr.indexOf(c); if (i >= 0) arr.splice(i, 1); }
      if (to === 'deckBottom') { to = 'deck'; opts = Object.assign({}, opts, { bottom: true }); }
      const under = from === 'battle' && to !== 'battle' ? c.under : [];
      // 状態をリセット
      c.tempPower = 0; c.attacking = false; c.cantAttackTurn = -1; c.jdProtected = false;
      if (from === 'battle' && to !== 'battle') { c.under = []; c.hyper = false; }
      c.zone = to;
      const dest = this.players[c.owner][ZONE_KEYS[to]];
      if (to === 'deck' && opts.bottom) dest.unshift(c); else dest.push(c);
      if (to === 'battle') {
        c.tapped = !!opts.tapped;
        c.enteredTurn = this.turnNo;
        if (this.kw(c, 'justDiver')) c.jdProtected = true;
      } else if (to === 'mana') {
        const multi = (c.def.civs || []).length >= 2; // 多色カードはタップして置く
        const untappedOk = from === 'hand' && abilitiesOf(c.def).keywords.manaUntapped;
        c.tapped = !!opts.tapped || (multi && !untappedOk);
      } else {
        c.tapped = false;
      }
      for (const u of under) { u.zone = 'battle'; this.move(u, to === 'mana' ? 'mana' : to, {}); }
      this.emit({ kind: 'move', uid: c.uid, from, to, owner: c.owner });
    }
    /** 山札の上のカード */
    topOfDeck(pi) { const D = this.players[pi].deck; return D[D.length - 1]; }

    // ───────────── コストの支払い ─────────────
    /**
     * そのカードを使うためにタップするマナを探す。払えなければ null。
     * まず「必要な文明」を1枚ずつ割り当て（多色カードはなるべく温存）、残りを他のカードで埋める。
     */
    findPayment(pi, def) {
      const P = this.players[pi];
      const untapped = P.mana.filter((c) => !c.tapped);
      const cost = def.cost || 0;
      if (untapped.length < cost) return null;
      const need = (def.civs || []).filter((k) => k !== 'zero');
      if (need.length > Math.max(cost, 0) && cost > 0) return null;
      const byFew = [...untapped].sort((a, b) => a.def.civs.length - b.def.civs.length);
      const used = new Set();
      const assign = (i) => {
        if (i === need.length) return true;
        for (const c of byFew) {
          if (used.has(c) || !c.def.civs.includes(need[i])) continue;
          used.add(c);
          if (assign(i + 1)) return true;
          used.delete(c);
        }
        return false;
      };
      if (cost === 0) return [];
      if (!assign(0)) return null;
      // 残りは「今回の文明と関係ない・文明が少ない」カードから使う（大事なマナを残すため）
      const rest = byFew.filter((c) => !used.has(c)).sort((a, b) => {
        const ra = a.def.civs.some((k) => need.includes(k)) ? 1 : 0;
        const rb = b.def.civs.some((k) => need.includes(k)) ? 1 : 0;
        return ra - rb || a.def.civs.length - b.def.civs.length;
      });
      const pay = [...used, ...rest.slice(0, cost - used.size)];
      return pay.length === cost ? pay : null;
    }
    canPay(pi, def) { return !!this.findPayment(pi, def); }

    /** 進化元にできる自分のクリーチャー（シンカライズを持つタマシードも） */
    evolutionBases(pi, def) {
      const evo = abilitiesOf(def).evolution || { civs: [], races: [] };
      return this.players[pi].battle.filter((c) => {
        if (!this.isCreature(c) && !this.kw(c, 'sinkarize')) return false;
        if (evo.civs.length && !evo.civs.some((k) => c.def.civs.includes(k))) return false;
        if (evo.races.length && !evo.races.some((r) => (c.def.races || []).some((x) => x.includes(r) || r.includes(x)))) return false;
        return true;
      });
    }

    // ───────────── 質問する ─────────────
    async ask(pi, req) {
      req.player = pi;
      this.emit({ kind: 'ask', req });
      const ans = await this.agents[pi].choose(this, pi, req);
      this.emit({ kind: 'answered', req, ans });
      return ans;
    }

    /** 候補から min〜max 枚選ばせる（候補が足りない・選ぶ必要がない時は自動で決める） */
    async chooseCards(pi, candidates, min, max, prompt, purpose = {}) {
      max = Math.min(max, candidates.length);
      min = Math.min(min, max);
      if (max <= 0) return [];
      if (min === max && candidates.length === max) return [...candidates];
      const ans = await this.ask(pi, { type: 'target', prompt, candidates: candidates.map((c) => c.uid), min, max, purpose });
      const picked = (Array.isArray(ans) ? ans : []).map((u) => this.card(u)).filter((c) => c && candidates.includes(c));
      const uniq = [...new Set(picked)].slice(0, max);
      // 答えがおかしい時（数が足りない等）は先頭から補う
      for (const c of candidates) { if (uniq.length >= min) break; if (!uniq.includes(c)) uniq.push(c); }
      return uniq;
    }
    async askYesNo(pi, prompt, purpose = {}) { return !!(await this.ask(pi, { type: 'yesno', prompt, purpose })); }
    async askOption(pi, prompt, options, purpose = {}) {
      const ans = await this.ask(pi, { type: 'option', prompt, options, purpose });
      const n = Number(ans);
      return Number.isInteger(n) && n >= 0 && n < options.length ? n : 0;
    }

    // ───────────── 対戦の流れ ─────────────
    /** 対戦を最後まで進める。終わると { winner, reason } を返す */
    async run() {
      try {
        this.setup();
        for (let t = 0; t < RULES.turnLimit; t++) await this.playTurn();
        this.finish(-1, `${RULES.turnLimit}ターンを過ぎたので引き分け`);
      } catch (e) {
        if (e instanceof GameOver) this.finish(e.winner, e.reason);
        else throw e;
      }
      return { winner: this.winner, reason: this.endReason, turns: this.turnNo };
    }
    finish(winner, reason) {
      this.winner = winner; this.endReason = reason; this.phase = 'over';
      this.say(winner < 0 ? `引き分け：${reason}` : `${this.players[winner].name}の勝ち！（${reason}）`);
      this.emit({ kind: 'gameover', winner, reason });
    }
    lose(pi, reason) { throw new GameOver(this.opp(pi), reason); }

    setup() {
      for (const P of this.players) {
        this.shuffle(P.deck);
        for (let i = 0; i < RULES.startShields; i++) this.move(P.deck[P.deck.length - 1], 'shield');
        for (let i = 0; i < RULES.startHand; i++) this.move(P.deck[P.deck.length - 1], 'hand');
      }
      this.say(`対戦開始！ 先攻は${this.players[this.first].name}`);
      this.emit({ kind: 'start' });
    }

    /** ルール上いつでも確かめること（山札切れ・パワー0以下）。勝敗が決まれば GameOver を投げる */
    async checkState() {
      const out = this.players.filter((P) => P.deck.length === 0);
      if (out.length === 2) throw new GameOver(-1, '両方の山札が0枚になった');
      if (out.length === 1) this.lose(out[0].idx, `${out[0].name}の山札が0枚になった（ライブラリアウト）`);
      const dead = [];
      for (const P of this.players) for (const c of P.battle) if (this.isCreature(c) && this.power(c) <= 0) dead.push(c);
      if (dead.length) {
        for (const c of dead) this.say(`${this.nameOf(c)}はパワーが0以下になり破壊された`, c.owner);
        await this.destroyCards(dead);
      }
    }

    /** 予約された能力とルール上の確認を、何も起きなくなるまで繰り返す */
    async settle() {
      for (let i = 0; i < 20; i++) {
        await this.checkState();
        if (!this.pendingTriggers.length) return;
        await this.flushTriggers();
      }
    }

    async playTurn() {
      this.turnNo++;
      this.active = this.turnNo === 1 ? this.first : this.opp(this.active);
      const pi = this.active;
      const P = this.players[pi];
      P.charged = false;
      this.skipAfterAttack = false;
      let skipped = false;
      try {
        // ── ターン開始：自分のカードをすべてアンタップ。ハイパーモード・ジャストダイバーはここで終わる
        this.phase = 'start';
        for (const c of [...P.battle, ...P.mana]) c.tapped = false;
        for (const c of P.battle) { c.jdProtected = false; if (c.hyper) { c.hyper = false; this.say(`${this.nameOf(c)}のハイパーモードが終わった`, pi); } }
        this.say(`── ${this.turnNo}ターン目：${P.name}のターン ──`, pi);
        this.emit({ kind: 'turn', player: pi, turn: this.turnNo });
        await this.pace({ kind: 'turn' });
        for (const c of [...P.battle]) this.fireSelf(c, 'turnStart');
        await this.settle();
        // ── ドロー（先攻の最初のターンは引かない）
        this.phase = 'draw';
        if (!(this.turnNo === 1)) await this.draw(pi, 1);
        // ── マナチャージ
        this.phase = 'charge';
        if (P.hand.length) {
          const ans = await this.ask(pi, { type: 'charge', candidates: P.hand.map((c) => c.uid) });
          const c = ans != null ? this.card(ans) : null;
          if (c && c.zone === 'hand' && c.owner === pi) {
            this.move(c, 'mana');
            P.charged = true;
            this.say(`${P.name}は${this.nameOf(c)}をマナゾーンに置いた`, pi);
            this.emit({ kind: 'charge', uid: c.uid });
            await this.pace({ kind: 'charge' });
            this.fireEvent('manaPut', { player: pi });
            await this.settle();
          }
        }
        // ── メイン
        this.phase = 'main';
        for (let guard = 0; guard < 100; guard++) {
          const actions = this.mainActions(pi);
          const ans = await this.ask(pi, { type: 'main', actions });
          const act = actions.find((a) => ans && a.kind === ans.kind && a.uid === ans.uid) || { kind: 'toAttack' };
          if (act.kind === 'toAttack') break;
          if (act.kind === 'hyper') await this.activateHyper(pi, this.card(act.uid));
          else await this.playCard(pi, this.card(act.uid), act.kind === 'cast' ? 'spell' : 'main');
          await this.settle();
        }
        // ── 攻撃
        this.phase = 'attack';
        for (let guard = 0; guard < 100; guard++) {
          const actions = this.attackActions(pi);
          if (!actions.length) break;
          const ans = await this.ask(pi, { type: 'attack', actions: [...actions, { kind: 'end' }] });
          const act = actions.find((a) => ans && a.kind === ans.kind && a.attacker === ans.attacker && a.target === ans.target);
          if (!act) break;
          await this.attack(this.card(act.attacker), act.target);
          await this.settle();
          if (this.skipAfterAttack) { this.skipAfterAttack = false; this.say('攻撃の後、ターンの残りがとばされた', pi); throw new SkipTurn(); }
        }
        // ── ターン終了
        this.phase = 'end';
        for (const c of [...P.battle]) this.fireSelf(c, 'turnEnd');
        await this.settle();
        await this.handTriggersAtTurnEnd(pi);
      } catch (e) {
        if (!(e instanceof SkipTurn)) throw e;
        skipped = true;
        this.pendingTriggers = []; // とばされたターンでは、待っている能力も解決しない
        this.emit({ kind: 'skip', player: pi });
        await this.pace({ kind: 'skip' });
      }
      this.phase = 'end';
      for (const Q of this.players) for (const c of Q.battle) { c.tempPower = 0; c.attacking = false; } // 「このターン」の効果が終わる
      await this.checkState();
      this.emit({ kind: 'turnEnd', player: pi, skipped });
    }

    /** メインで今できること（召喚・呪文・タマシード・ハイパー化） */
    mainActions(pi) {
      const P = this.players[pi];
      const acts = [];
      for (const c of P.hand) {
        const d = c.def;
        if (this.canPay(pi, d)) {
          if (d.type === 'creature' || d.type === 'tamaseed') acts.push({ kind: 'summon', uid: c.uid });
          else if (d.type === 'evolution') { if (this.evolutionBases(pi, d).length) acts.push({ kind: 'summon', uid: c.uid }); }
          else if (d.type === 'spell') acts.push({ kind: 'cast', uid: c.uid });
        }
        const sv = d.type !== 'spell' && spellSideDef(d);
        if (sv && this.canPay(pi, sv)) acts.push({ kind: 'cast', uid: c.uid });
      }
      for (const c of P.battle) if (this.canHyper(pi, c)) acts.push({ kind: 'hyper', uid: c.uid });
      acts.push({ kind: 'toAttack' });
      return acts;
    }

    // ───────────── ハイパー化 ─────────────
    hyperCandidates(pi, c) { return this.players[pi].battle.filter((x) => x !== c && !x.tapped && this.isCreature(x)); }
    canHyper(pi, c) {
      const ab = abilitiesOf(c.def);
      return !!(ab.hyperCost && ab.hyper && !c.hyper && c.zone === 'battle' && this.hyperCandidates(pi, c).length >= ab.hyperCost.tapOthers);
    }
    async activateHyper(pi, c) {
      if (!this.canHyper(pi, c)) return;
      const n = abilitiesOf(c.def).hyperCost.tapOthers;
      const tapped = await this.chooseCards(pi, this.hyperCandidates(pi, c), n, n, `ハイパー化：タップする自分の他のクリーチャーを${n}体選んでください`, { op: 'hyperCost' });
      for (const t of tapped) { t.tapped = true; this.emit({ kind: 'tap', uid: t.uid, tapped: true }); }
      c.hyper = true;
      this.say(`${this.nameOf(c)}がハイパー化！（パワー${this.power(c)}、次の自分のターンのはじめまで）`, pi);
      this.emit({ kind: 'hyper', uid: c.uid });
      await this.pace({ kind: 'trigger', uid: c.uid });
    }

    /** そのクリーチャーが今攻撃できる相手（'player' か クリーチャーの uid）の一覧 */
    attackTargets(c) {
      if (c.zone !== 'battle' || c.owner !== this.active || c.tapped || !this.isCreature(c)) return [];
      if (this.kw(c, 'cantAttack') || c.cantAttackTurn === this.turnNo) return [];
      const sick = c.enteredTurn === this.turnNo && !this.kw(c, 'speedAttacker') && c.def.type !== 'evolution';
      const mach = this.kw(c, 'machFighter') && c.enteredTurn === this.turnNo;
      if (sick && !mach) return [];
      const targets = [];
      if (!sick && !this.kw(c, 'cantAttackPlayers')) targets.push('player');
      for (const t of this.players[this.opp(c.owner)].battle) {
        if (!this.isCreature(t) || t.jdProtected) continue; // ジャストダイバー：攻撃されない
        if (t.tapped || this.kw(c, 'attackUntapped') || mach) targets.push(t.uid);
      }
      return targets;
    }
    attackActions(pi) {
      const acts = [];
      for (const c of this.players[pi].battle) for (const t of this.attackTargets(c)) acts.push({ kind: 'attack', attacker: c.uid, target: t });
      return acts;
    }

    // ───────────── カードを使う ─────────────
    /**
     * 手札のカードを、マナを払って使う。
     * @param side 'main'（カードの本来の面）か 'spell'（ツインパクトの呪文側）
     */
    async playCard(pi, c, side = 'main') {
      const P = this.players[pi];
      if (!c || c.zone !== 'hand') return;
      const useDef = side === 'spell' ? spellView(c.def) : c.def;
      if (!useDef) return;
      const pay = this.findPayment(pi, useDef);
      if (!pay) return;
      let base = null;
      if (useDef.type === 'evolution') {
        const bases = this.evolutionBases(pi, useDef);
        if (!bases.length) return;
        [base] = await this.chooseCards(pi, bases, 1, 1, `${useDef.name}の進化元を選んでください`, { op: 'evoBase' });
      }
      for (const m of pay) m.tapped = true;
      this.emit({ kind: 'pay', uids: pay.map((m) => m.uid) });
      if (useDef.type === 'spell') {
        this.say(`${P.name}は呪文${q(useDef.name)}を唱えた`, pi);
        await this.castSpell(pi, c, { fromHand: true });
      } else {
        await this.putCreature(pi, c, base, useDef.type === 'tamaseed' ? '使った' : '召喚した', { summoned: true });
      }
    }

    /**
     * クリーチャー・タマシードをバトルゾーンに出す（召喚・S・トリガー・効果で出す、共通）
     * @param opts.summoned 召喚によって出たか（「召喚した時」「ヨビニオン」「カードを使った時」に関係する）
     */
    async putCreature(pi, c, base, verb, opts = {}) {
      if (base) {
        const bArr = this.players[base.owner].battle;
        const idx = bArr.indexOf(base);
        const wasTapped = base.tapped;
        bArr.splice(idx, 1);
        const under = [base, ...base.under];
        base.under = []; base.hyper = false;
        for (const u of under) { u.zone = 'under'; u.tapped = false; }
        this.move(c, 'battle', { tapped: wasTapped });
        // 進化元の位置に入れ替える（見た目のため）
        bArr.splice(bArr.indexOf(c), 1); bArr.splice(idx, 0, c);
        c.under = under;
        this.say(`${this.players[pi].name}は${this.nameOf(base)}を${this.nameOf(c)}に進化させた`, pi);
      } else {
        this.move(c, 'battle');
        this.say(`${this.players[pi].name}は${this.nameOf(c)}を${verb}`, pi);
      }
      this.emit({ kind: 'summon', uid: c.uid, player: pi });
      await this.pace({ kind: 'summon', uid: c.uid });
      this.fireSelf(c, 'cip');
      if (opts.summoned) {
        this.fireSelf(c, 'summoned');
        if (this.kw(c, 'yobinion')) this.pendingTriggers.push({ card: c, controller: c.owner, effects: [{ op: 'yobinion' }], when: 'summoned' });
        this.fireEvent('useCard', { player: pi, card: c });
      }
      if (this.isCreature(c)) this.fireEvent('creatureEnters', { player: pi, card: c });
      await this.flushTriggers();
    }

    /**
     * 呪文を唱える。
     * @param opts.fromHand 手札から唱えたか（「手札から呪文を唱えた時」に関係する）
     * @param opts.keepCard カードを動かさずに唱える（スマッシュ・バースト：クリーチャーはバトルゾーンに残る）
     */
    async castSpell(pi, c, opts = {}) {
      const sdef = spellView(c.def);
      if (!opts.keepCard) {
        // 唱えている間は「解決中」の場所に置き、効果が終わったら墓地へ
        const arr = this.zoneArr(c);
        if (arr) arr.splice(arr.indexOf(c), 1);
        if (c.zone === 'battle') { c.under = []; }
        c.zone = 'stack';
      }
      this.emit({ kind: 'cast', uid: c.uid, player: pi, name: sdef.name });
      await this.pace({ kind: 'cast', uid: c.uid });
      this.fireEvent('useCard', { player: pi, card: c });
      this.fireEvent('castSpell', { player: pi, card: c, fromHand: !!opts.fromHand });
      try {
        await this.resolveEffects(pi, abilitiesOf(sdef).spell, c, sdef);
      } finally {
        if (!opts.keepCard && c.zone === 'stack') {
          c.zone = 'grave';
          this.players[c.owner].grave.push(c);
          this.emit({ kind: 'move', uid: c.uid, from: 'stack', to: 'grave', owner: c.owner });
        }
      }
      await this.flushTriggers();
    }

    // ───────────── 誘発する能力（〜した時） ─────────────
    /** そのカード自身の「〜した時」を予約する */
    fireSelf(c, when, event = {}) {
      for (const t of this.ab(c).triggers) if (t.when === when) this.pendingTriggers.push({ card: c, controller: c.owner, effects: t.effects, when, event });
    }
    /**
     * 出来事（クリーチャーが出た・呪文を唱えた・マナを置いた・カードを使った・攻撃した）を知らせ、
     * それに反応するバトルゾーンのカードの能力を予約する
     */
    fireEvent(kind, data) {
      for (const P of this.players) {
        for (const c of P.battle) {
          const mine = data.player === c.owner;
          for (const t of this.ab(c).triggers) {
            let hit = false;
            switch (t.when) {
              case 'oppCreatureEnters': hit = kind === 'creatureEnters' && !mine; break;
              case 'oppCastSpell': hit = kind === 'castSpell' && !mine; break;
              case 'oppManaPut': hit = kind === 'manaPut' && !mine; break;
              case 'oppUseCard': hit = kind === 'useCard' && !mine; break;
              case 'oppAttack': hit = kind === 'attack' && !mine; break;
              case 'selfCastFromHand': hit = kind === 'castSpell' && mine && data.fromHand; break;
              case 'selfCastSpell': hit = kind === 'castSpell' && mine; break;
              default:
            }
            if (hit && t.oppTurnOnly && this.active === c.owner) hit = false;
            if (hit && data.card === c) hit = false; // 自分自身の登場には反応しない
            if (hit) this.pendingTriggers.push({ card: c, controller: c.owner, effects: t.effects, when: t.when, event: data });
          }
        }
      }
    }
    /** 予約した能力を解決する（ターンのプレイヤーの分から先に） */
    async flushTriggers() {
      while (this.pendingTriggers.length) {
        const list = this.pendingTriggers.splice(0);
        list.sort((a, b) => (a.controller === this.active ? 0 : 1) - (b.controller === this.active ? 0 : 1));
        for (const t of list) {
          this.emit({ kind: 'trigger', uid: t.card.uid, when: t.when });
          this.say(`${this.nameOf(t.card)}の能力が発動`, t.controller);
          await this.pace({ kind: 'trigger', uid: t.card.uid });
          await this.resolveEffects(t.controller, t.effects, t.card, null, t.event);
        }
      }
    }
    /** 相手のターンの終わりに、手札から働く能力（例：条件を満たせばタダで召喚） */
    async handTriggersAtTurnEnd(activePi) {
      const pi = this.opp(activePi);
      const P = this.players[pi];
      for (const c of [...P.hand]) {
        for (const t of abilitiesOf(c.def).handTriggers || []) {
          if (t.when !== 'oppTurnEnd' || c.zone !== 'hand') continue;
          const cond = t.cond || {};
          const mine = P.battle.filter((x) => this.isCreature(x)).length;
          const theirs = this.players[activePi].battle.filter((x) => this.isCreature(x)).length;
          if (cond.oppMoreCreatures && theirs - mine < cond.oppMoreCreatures) continue;
          if (cond.noneNamed && P.battle.some((x) => x.def.name.includes(cond.noneNamed))) continue;
          await this.resolveEffects(pi, t.effects, c);
          await this.settle();
        }
      }
    }

    // ───────────── 効果の解決 ─────────────
    /**
     * @param sourceDef 効果の元のカード定義（ツインパクトの呪文側など、source.def と違う時に指定）
     * @param event     誘発のきっかけになった出来事（「その呪文を」などで使う）
     */
    async resolveEffects(pi, effects, source, sourceDef = null, event = {}) {
      if (++this.depth > RULES.effectDepth) { this.depth--; return; }
      const sname = (sourceDef || source.def).name;
      try {
        for (const e of effects) {
          if (e.optional && e.op !== 'castFree') {
            const yes = await this.askYesNo(pi, `${sname}：${TextParser.describeEffect(Object.assign({}, e, { optional: false }))}。使いますか？`, { op: e.op, effect: e, uid: source.uid });
            if (!yes) continue;
          }
          await this.doEffect(pi, e, source, event, sname);
          await this.checkState();
        }
      } finally { this.depth--; }
    }

    /** 効果の対象になるバトルゾーンのクリーチャー（エレメント）を選ぶ */
    async selectCreatures(pi, target, source, prompt, op) {
      if (target.thisCard) return source.zone === 'battle' ? [source] : [];
      const sides = target.side === 'opp' ? [this.opp(pi)] : target.side === 'self' ? [pi] : [pi, this.opp(pi)];
      const f = Object.assign({}, target.filter);
      if (!f.type) f.type = 'creature';
      let cands = [];
      for (const s of sides) cands.push(...this.players[s].battle.filter((c) => this.matches(c, f, source)));
      if (target.count === 'all') return cands;
      cands = cands.filter((c) => !(c.jdProtected && c.owner !== pi)); // ジャストダイバー：相手に選ばれない
      const n = target.count || 1;
      return this.chooseCards(pi, cands, target.upTo ? 0 : n, n, prompt, { op, side: target.side });
    }

    /** すべての文明がそろっているか（自分のエレメント＝バトルゾーンのカード） */
    hasAllCivs(pi) {
      const have = new Set(this.players[pi].battle.flatMap((c) => c.def.civs || []));
      return ALL_CIVS.every((k) => have.has(k));
    }
    checkCond(pi, c) {
      const P = this.players[pi];
      switch (c.kind) {
        case 'manaLE': return P.mana.length <= c.n;
        case 'manaGE': return P.mana.length >= c.n;
        case 'handLE': return P.hand.length <= c.n;
        case 'shieldLE': return P.shields.length <= c.n;
        case 'oppMoreCreatures': {
          const mine = P.battle.filter((x) => this.isCreature(x)).length;
          const theirs = this.players[this.opp(pi)].battle.filter((x) => this.isCreature(x)).length;
          return theirs - mine >= c.n;
        }
        default: return false;
      }
    }
    /** カードをある場所へ置く（効果で山札から見たカードなど、どこにも属していないカードにも使える） */
    place(c, to, pi) {
      this.move(c, to);
      if (to === 'mana') this.fireEvent('manaPut', { player: pi });
    }

    async doEffect(pi, e, source, event = {}, sname = '') {
      const P = this.players[pi];
      const O = this.players[this.opp(pi)];
      const label = TextParser.describeEffect(Object.assign({}, e, { optional: false }));
      switch (e.op) {
        case 'draw': {
          let n = e.n;
          if (e.upTo) n = await this.askNumber(pi, 0, Math.min(e.n, P.deck.length), `カードを何枚引きますか？（0〜${e.n}）`);
          await this.draw(pi, n);
          break;
        }
        case 'manaBoost':
          for (let i = 0; i < e.n && P.deck.length; i++) this.move(this.topOfDeck(pi), 'mana', { tapped: e.tapped });
          this.say(`${P.name}は山札の上から${e.n}枚をマナゾーンに置いた`, pi);
          this.fireEvent('manaPut', { player: pi });
          break;
        case 'addShield':
          for (let i = 0; i < e.n && P.deck.length; i++) this.move(this.topOfDeck(pi), 'shield');
          this.say(`${P.name}はシールドを${e.n}つ増やした`, pi);
          break;
        case 'discard': {
          const T = e.side === 'opp' ? O : P;
          const n = Math.min(e.n, T.hand.length);
          let picked = [];
          if (e.how === 'all') picked = [...T.hand];
          else if (e.how === 'random') { const h = [...T.hand]; this.shuffle(h); picked = h.slice(0, n); }
          else if (e.how === 'controller') picked = await this.chooseCards(pi, T.hand, n, n, '捨てさせるカードを選んでください', { op: 'discard', side: 'opp' });
          else picked = await this.chooseCards(T.idx, T.hand, n, n, `捨てるカードを${n}枚選んでください`, { op: 'discardOwn' });
          for (const c of picked) { this.move(c, 'grave'); this.say(`${T.name}は${this.nameOf(c)}を捨てた`, T.idx); }
          break;
        }
        case 'breakShield': {
          const picked = await this.chooseCards(pi, O.shields, e.n, e.n, `ブレイクするシールドを${e.n}つ選んでください`, { op: 'breakShield' });
          await this.breakShields(pi, picked, source);
          break;
        }
        case 'shieldToGrave': {
          const picked = await this.chooseCards(pi, O.shields, e.n, e.n, `墓地に置くシールドを選んでください`, { op: 'shieldToGrave' });
          for (const c of picked) { this.move(c, 'grave'); this.say(`${O.name}のシールド${this.nameOf(c)}が墓地に置かれた`, pi); }
          break;
        }
        case 'manaToGrave':
        case 'manaToHand': {
          const to = e.op === 'manaToGrave' ? 'grave' : 'hand';
          const picked = await this.chooseCards(pi, O.mana, e.n, e.n, `相手のマナを${e.n}枚選んでください`, { op: e.op });
          for (const c of picked) { this.move(c, to); this.say(`${O.name}のマナ${this.nameOf(c)}が${ZONE_NAMES[to]}へ`, pi); }
          break;
        }
        case 'putToBattle': {
          const zoneArr = { grave: P.grave, hand: P.hand, mana: P.mana }[e.from];
          const cands = zoneArr.filter((c) => c.def.type === 'creature' && this.matches(c, e.filter, source));
          const picked = await this.chooseCards(pi, cands, e.upTo ? 0 : e.n, e.n, `バトルゾーンに出すクリーチャーを選んでください`, { op: 'putToBattle' });
          for (const c of picked) await this.putCreature(pi, c, null, `${ZONE_NAMES[e.from]}からバトルゾーンに出した`);
          break;
        }
        case 'recover': {
          const zoneArr = e.from === 'grave' ? P.grave : P.mana;
          const cands = zoneArr.filter((c) => this.matches(c, e.filter, source));
          const picked = await this.chooseCards(pi, cands, e.upTo ? 0 : e.n, e.n, `手札に戻すカードを選んでください`, { op: 'recover' });
          for (const c of picked) { this.move(c, 'hand'); this.say(`${P.name}は${this.nameOf(c)}を${ZONE_NAMES[e.from]}から手札に戻した`, pi); }
          break;
        }
        case 'search': {
          const cands = P.deck.filter((c) => this.matches(c, e.filter, source));
          const picked = await this.chooseCards(pi, cands, 0, e.n, `山札から手札に加えるカードを選んでください`, { op: 'search' });
          for (const c of picked) { this.move(c, 'hand'); this.say(`${P.name}は山札から${this.nameOf(c)}を手札に加えた`, pi); }
          this.shuffle(P.deck);
          break;
        }
        case 'look': {
          // 山札の上から何枚か見て、決められた場所へ振り分ける
          const seen = [];
          for (let i = 0; i < e.n && P.deck.length; i++) { const c = P.deck.pop(); c.zone = 'look'; seen.push(c); }
          this.say(`${P.name}は山札の上から${seen.length}枚を見た`, pi);
          let rest = [...seen];
          for (const pk of e.picks) {
            const cands = rest.filter((c) => this.matches(c, pk.filter || {}, source));
            const n = Math.min(pk.count, cands.length);
            const picked = await this.chooseCards(pi, cands, pk.upTo ? 0 : n, n, `見たカードから${ZONE_NAMES[pk.to]}に置くカードを選んでください（${pk.count}枚${pk.upTo ? 'まで' : ''}）`, { op: 'look', to: pk.to });
            for (const c of picked) { this.place(c, pk.to, pi); this.say(`${this.nameOf(c)}を${ZONE_NAMES[pk.to]}に置いた`, pi); }
            rest = rest.filter((c) => !picked.includes(c));
          }
          if (e.rest === 'deckBottom') this.shuffle(rest); // 好きな順序で（ここではランダム）
          for (const c of rest) this.place(c, e.rest, pi);
          if (rest.length) this.say(`残りの${rest.length}枚を${ZONE_NAMES[e.rest]}に置いた`, pi);
          break;
        }
        case 'graveToDeckBottom': {
          let who = e.who === 'self' ? pi : e.who === 'opp' ? this.opp(pi) : null;
          if (who == null) who = (await this.askOption(pi, 'どちらのプレイヤーの墓地を山札の下に戻しますか？', ['自分', '相手'], { op: 'choosePlayer', effect: e })) === 0 ? pi : this.opp(pi);
          const T = this.players[who];
          const g = [...T.grave];
          this.shuffle(g);
          for (const c of g) this.move(c, 'deckBottom');
          this.say(`${T.name}の墓地の${g.length}枚がシャッフルされて山札の下に置かれた`, pi);
          break;
        }
        case 'cycleHand': {
          const picked = await this.chooseCards(pi, P.hand, 0, e.max, `山札の下に置く手札を${e.max}枚まで選んでください`, { op: 'cycleHand' });
          for (const c of picked) this.move(c, 'deckBottom');
          this.say(`${P.name}は手札を${picked.length}枚山札の下に置いた`, pi);
          await this.draw(pi, picked.length + e.extra);
          break;
        }
        case 'if':
          if (this.checkCond(pi, e.cond)) await this.resolveEffects(pi, e.effects, source, null, event);
          break;
        case 'choose': {
          let picks = [];
          if (e.allIfFullCivs && this.hasAllCivs(pi)) {
            picks = e.options.map((_, i) => i);
            this.say(`${sname}：すべての文明がそろっているので、すべてを1回ずつ選ぶ`, pi);
          } else {
            const avail = e.options.map((_, i) => i);
            for (let k = 0; k < e.times && avail.length; k++) {
              const labels = avail.map((i) => e.labels[i] || TextParser.describeEffect({ op: 'choose', options: [e.options[i]], times: 1 }));
              const idx = avail[await this.askOption(pi, `${sname}：${e.times > 1 ? `${k + 1}回目を` : ''}選んでください`, labels, { op: 'choose', effect: e, avail })];
              picks.push(idx);
              if (!e.repeat) avail.splice(avail.indexOf(idx), 1);
            }
          }
          for (const i of picks) {
            this.say(`${sname}：「${e.labels[i] || '選択肢' + (i + 1)}」を選んだ`, pi);
            await this.resolveEffects(pi, e.options[i], source, null, event);
          }
          break;
        }
        case 'power': {
          const ts = await this.selectCreatures(pi, e.target, source, `${label}：対象を選んでください`, 'power');
          let amount = e.amount;
          if (e.per) {
            const cnt = { myMana: P.mana.length, myGrave: P.grave.length, myHand: P.hand.length, myCreatures: P.battle.filter((x) => this.isCreature(x)).length }[e.per] || 0;
            amount = e.amount * cnt;
          }
          for (const c of ts) { c.tempPower += amount; this.say(`${this.nameOf(c)}のパワーが${amount > 0 ? '+' : ''}${amount}（このターン）`, pi); }
          break;
        }
        case 'lockAttack': {
          const ts = await this.selectCreatures(pi, e.target, source, `このターン攻撃できなくするクリーチャーを選んでください`, 'lockAttack');
          for (const c of ts) { c.cantAttackTurn = this.turnNo; this.say(`${this.nameOf(c)}はこのターン攻撃できない`, pi); }
          break;
        }
        case 'destroy': case 'toGrave': case 'bounce': case 'toMana': case 'tap': case 'untap': {
          const ts = await this.selectCreatures(pi, e.target, source, `${label}：対象を選んでください`, e.op);
          if (!ts.length) break;
          if (e.op === 'destroy') { for (const c of ts) this.say(`${this.nameOf(c)}は破壊された`, pi); await this.destroyCards(ts); }
          else if (e.op === 'tap' || e.op === 'untap') { for (const c of ts) { c.tapped = e.op === 'tap'; this.emit({ kind: 'tap', uid: c.uid, tapped: c.tapped }); } this.say(`${ts.map((c) => this.nameOf(c)).join('、')}を${e.op === 'tap' ? 'タップ' : 'アンタップ'}した`, pi); }
          else {
            const to = { toGrave: 'grave', bounce: 'hand', toMana: 'mana' }[e.op];
            for (const c of ts) { this.move(c, to); this.say(`${this.nameOf(c)}は${ZONE_NAMES[to]}に置かれた`, pi); }
          }
          await this.pace({ kind: e.op });
          break;
        }
        case 'skipTurn':
          this.say(`${sname}の能力で、ターンの残りがとばされる！`, pi);
          throw new SkipTurn();
        case 'skipAfterAttack':
          this.skipAfterAttack = true;
          this.say(`${sname}：この攻撃の後、ターンの残りがとばされる`, pi);
          break;
        case 'recastEvent': {
          // 「その呪文を墓地からもう一度唱える」：きっかけになった呪文が墓地にあれば
          const c = event.card;
          if (c && c.zone === 'grave' && spellView(c.def)) {
            this.say(`${sname}：${q(spellView(c.def).name)}を墓地からもう一度唱える`, pi);
            await this.castSpell(pi, c, { fromHand: false });
          }
          break;
        }
        case 'castFree': {
          // 「〜の呪文を1枚、自分の手札からコストを支払わずに唱えてもよい」
          const zones = e.from === 'handOrGrave' ? [P.hand, P.grave] : e.from === 'grave' ? [P.grave] : [P.hand];
          const cands = zones.flat().filter((c) => { const sv = spellView(c.def); return sv && this.defMatches(sv, e.filter); });
          const max = Math.min(e.n || 1, cands.length);
          if (!max) break;
          const picked = await this.chooseCards(pi, cands, e.optional ? 0 : max, max, `タダで唱える呪文を選んでください（${TextParser.describeFilter(e.filter)}）`, { op: 'castFree' });
          for (const c of picked) {
            const fromHand = c.zone === 'hand';
            this.say(`${P.name}は${q(spellView(c.def).name)}をコストを支払わずに唱えた`, pi);
            await this.castSpell(pi, c, { fromHand });
          }
          break;
        }
        case 'summonSelf':
          if (source.zone === 'hand') await this.putCreature(pi, source, null, 'コストを支払わずに召喚した', { summoned: true });
          break;
        case 'yobinion': {
          // ヨビニオン：山札の上から、このクリーチャーよりコストが小さいクリーチャーが出るまで表向きにする
          const shown = [];
          let found = null;
          while (P.deck.length) {
            const c = P.deck.pop(); c.zone = 'look'; shown.push(c);
            if (c.def.type === 'creature' && (c.def.cost || 0) < (source.def.cost || 0)) { found = c; break; }
          }
          this.say(`ヨビニオン：山札の上から${shown.length}枚を表向きにした${found ? `（${this.nameOf(found)}が出た）` : '（当たりなし）'}`, pi);
          const rest = shown.filter((c) => c !== found);
          this.shuffle(rest);
          for (const c of rest) this.move(c, 'deckBottom');
          if (found) await this.putCreature(pi, found, null, 'ヨビニオンでバトルゾーンに出した');
          break;
        }
        default:
          this.say(`（未対応の効果：${e.op}）`, pi);
      }
    }

    async askNumber(pi, min, max, prompt) {
      if (min >= max) return Math.max(0, max);
      const ans = await this.ask(pi, { type: 'number', min, max, prompt });
      const n = Math.round(Number(ans));
      return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : max;
    }

    async draw(pi, n) {
      const P = this.players[pi];
      for (let i = 0; i < n; i++) {
        if (!P.deck.length) break;
        const c = P.deck[P.deck.length - 1];
        this.move(c, 'hand');
        this.emit({ kind: 'draw', uid: c.uid, player: pi });
      }
      if (n > 0) this.say(`${P.name}はカードを${n}枚引いた`, pi);
      await this.pace({ kind: 'draw' });
      await this.checkState();
    }

    /** 破壊する（同時に）。破壊された時の能力を予約する */
    async destroyCards(list) {
      const alive = list.filter((c) => c.zone === 'battle');
      for (const c of alive) {
        this.emit({ kind: 'destroy', uid: c.uid });
      }
      await this.pace({ kind: 'destroy', uids: alive.map((c) => c.uid) });
      for (const c of alive) {
        this.move(c, 'grave');
        this.fireSelf(c, 'destroyed');
      }
    }

    // ───────────── 攻撃 ─────────────
    async attack(att, target) {
      const pi = att.owner;
      const di = this.opp(pi);
      const D = this.players[di];
      const P = this.players[pi];
      att.tapped = true;
      att.attacking = true;
      let tgtCard = target === 'player' ? null : this.card(target);
      this.say(`${this.nameOf(att)}が${tgtCard ? this.nameOf(tgtCard) : D.name}を攻撃！`, pi);
      this.emit({ kind: 'attack', uid: att.uid, target });
      await this.pace({ kind: 'attack', uid: att.uid, target });
      try {
        this.fireSelf(att, 'attack');
        this.fireEvent('attack', { player: pi, card: att });
        await this.flushTriggers();
        // ── アタック・チャンス（手札の呪文をタダで唱える）とスマッシュ・バースト（自分の呪文側を唱える）
        await this.attackChance(pi, att);
        if (att.zone === 'battle' && this.kw(att, 'smashBurst') && spellSideDef(att.def)) {
          const sv = spellSideDef(att.def);
          if (await this.askYesNo(pi, `スマッシュ・バースト：${q(sv.name)}をコストを支払わずに唱えますか？`, { op: 'smashBurst', uid: att.uid })) {
            this.say(`スマッシュ・バースト！ ${P.name}は${q(sv.name)}を唱えた`, pi);
            await this.castSpell(pi, att, { keepCard: true });
          }
        }
        await this.checkState();
        if (att.zone !== 'battle') return; // 攻撃中に離れたら、攻撃は終わり
        if (tgtCard && tgtCard.zone !== 'battle') return; // 攻撃先がいなくなった
        // ── ガードマン：自分の他のクリーチャーへの攻撃を、かわりに受ける
        if (tgtCard) {
          const guards = D.battle.filter((c) => c !== tgtCard && !c.tapped && this.isCreature(c) && this.kw(c, 'guardman'));
          if (guards.length) {
            const [g] = await this.chooseCards(di, guards, 0, 1, `ガードマン：${this.nameOf(tgtCard)}への攻撃を引き受けるクリーチャーを選べます`, { op: 'guardman', attacker: att.uid, target: tgtCard.uid });
            if (g) {
              g.tapped = true;
              tgtCard = g;
              this.say(`ガードマン！ ${this.nameOf(g)}が攻撃を引き受けた`, di);
              this.emit({ kind: 'block', uid: g.uid, attacker: att.uid });
              await this.pace({ kind: 'block', uid: g.uid });
            }
          }
        }
        // ── ブロック
        if (!this.kw(att, 'unblockable')) {
          const blockers = D.battle.filter((c) => !c.tapped && this.isCreature(c) && this.kw(c, 'blocker') && c !== tgtCard);
          if (blockers.length) {
            const ans = await this.ask(di, { type: 'block', attacker: att.uid, target: tgtCard ? tgtCard.uid : 'player', candidates: blockers.map((c) => c.uid) });
            const b = ans != null ? this.card(ans) : null;
            if (b && blockers.includes(b)) {
              b.tapped = true;
              this.say(`${this.nameOf(b)}がブロック！`, di);
              this.emit({ kind: 'block', uid: b.uid, attacker: att.uid });
              await this.pace({ kind: 'block', uid: b.uid });
              this.fireSelf(b, 'block');
              await this.flushTriggers();
              if (att.zone === 'battle' && b.zone === 'battle') await this.battle(att, b);
              return;
            }
          }
        }
        // ── クリーチャーへの攻撃 → バトル
        if (tgtCard) { await this.battle(att, tgtCard); return; }
        // ── プレイヤーへの攻撃
        if (!D.shields.length) {
          this.emit({ kind: 'direct', uid: att.uid });
          await this.pace({ kind: 'direct' });
          throw new GameOver(pi, `${this.nameOf(att)}のダイレクトアタック`);
        }
        const n = Math.min(this.kw(att, 'breaker') || 1, D.shields.length);
        const picked = await this.chooseCards(pi, D.shields, n, n, `ブレイクするシールドを${n}つ選んでください`, { op: 'breakShield' });
        await this.breakShields(pi, picked, att);
      } finally {
        att.attacking = false;
      }
    }

    /** アタック・チャンス：攻撃したクリーチャーが条件に合えば、手札のその呪文をタダで唱えてよい */
    async attackChance(pi, att) {
      const P = this.players[pi];
      for (const c of [...P.hand]) {
        if (att.zone !== 'battle' || c.zone !== 'hand') continue;
        const sv = spellView(c.def);
        const ac = sv && abilitiesOf(sv).attackChance;
        if (!ac) continue;
        if (ac.civs.length && !ac.civs.every((k) => att.def.civs.includes(k))) continue;
        if (ac.races.length && !ac.races.some((r) => (att.def.races || []).some((x) => x.includes(r) || r.includes(x)))) continue;
        if (!(await this.askYesNo(pi, `アタック・チャンス：${q(sv.name)}をコストを支払わずに唱えますか？`, { op: 'attackChance', uid: c.uid }))) continue;
        this.say(`アタック・チャンス！ ${P.name}は${q(sv.name)}を唱えた`, pi);
        await this.castSpell(pi, c, { fromHand: true });
      }
    }

    /** バトル：パワーを比べ、負けた方を破壊する（同じなら両方） */
    async battle(a, b) {
      const pa = this.power(a), pb = this.power(b);
      this.say(`バトル：${this.nameOf(a)}(${pa}) 対 ${this.nameOf(b)}(${pb})`, a.owner);
      this.emit({ kind: 'battle', a: a.uid, b: b.uid, pa, pb });
      await this.pace({ kind: 'battle', a: a.uid, b: b.uid });
      const losers = [];
      if (pa >= pb) losers.push(b);
      if (pb >= pa) losers.push(a);
      // スレイヤー：バトルに負けても、相手を道連れにする
      for (const [x, y] of [[a, b], [b, a]]) if (losers.includes(x) && this.kw(x, 'slayer') && !losers.includes(y)) losers.push(y);
      const winners = [a, b].filter((c) => !losers.includes(c));
      for (const c of losers) this.say(`${this.nameOf(c)}はバトルに負けて破壊された`, c.owner);
      await this.destroyCards(losers);
      for (const w of winners) this.fireSelf(w, 'winBattle');
      await this.flushTriggers();
    }

    /**
     * シールドをブレイクする：選ばれたシールドをすべて持ち主の手札に加え、
     * その後、S・トリガー（タダで使える）・G・ストライクを使うかどうかを持ち主が決める。
     * ツインパクトは、呪文側にS・トリガーがあれば呪文側を唱えられる。
     */
    async breakShields(pi, shields, source) {
      if (!shields.length) return;
      const di = this.opp(pi);
      const D = this.players[di];
      for (const s of shields) { this.move(s, 'hand'); this.emit({ kind: 'break', uid: s.uid, player: di }); }
      this.say(`${D.name}のシールドを${shields.length}つブレイク！（残り${D.shields.length}）`, pi);
      await this.pace({ kind: 'break', uids: shields.map((s) => s.uid) });
      for (const s of shields) {
        if (s.zone !== 'hand') continue;
        const mainKw = abilitiesOf(s.def).keywords;
        const sv = s.def.type !== 'spell' && spellSideDef(s.def);
        const spellKw = sv ? abilitiesOf(sv).keywords : {};
        const sides = [];
        if (mainKw.shieldTrigger && !(s.def.type === 'evolution' && !this.evolutionBases(di, s.def).length)) sides.push('main');
        if (spellKw.shieldTrigger) sides.push('spell');
        if (sides.length) {
          let side = sides[0];
          if (sides.length === 2) {
            const k = await this.askOption(di, `S・トリガー：${s.def.name}のどちらの面を使いますか？`, [`${s.def.name}（クリーチャー）`, `${sv.name}（呪文）`, '使わない'], { op: 'twinSide' });
            if (k === 2) continue;
            side = k === 0 ? 'main' : 'spell';
          } else {
            const nm = side === 'spell' ? sv.name : s.def.name;
            const yes = await this.askYesNo(di, `S・トリガー：${nm}をコストを払わずに使いますか？`, { op: 'shieldTrigger', uid: s.uid });
            if (!yes) continue;
          }
          this.emit({ kind: 'shieldTrigger', uid: s.uid, player: di });
          const useDef = side === 'spell' ? spellView(s.def) : s.def;
          this.say(`S・トリガー発動！ ${q(useDef.name)}`, di);
          if (useDef.type === 'spell') await this.castSpell(di, s, { fromHand: false });
          else {
            let base = null;
            if (useDef.type === 'evolution') [base] = await this.chooseCards(di, this.evolutionBases(di, useDef), 1, 1, '進化元を選んでください', { op: 'evoBase' });
            await this.putCreature(di, s, base, 'S・トリガーで出した', { summoned: true });
          }
          await this.checkState();
        } else if (mainKw.gStrike || spellKw.gStrike) {
          const cands = this.players[pi].battle.filter((c) => this.isCreature(c) && !c.jdProtected);
          if (!cands.length) continue;
          const yes = await this.askYesNo(di, `G・ストライク：${s.def.name}を見せて、相手のクリーチャー1体をこのターン攻撃できなくしますか？`, { op: 'gStrike', uid: s.uid });
          if (!yes) continue;
          const [t] = await this.chooseCards(di, cands, 1, 1, 'このターン攻撃できなくするクリーチャーを選んでください', { op: 'lockAttack', side: 'opp' });
          if (t) { t.cantAttackTurn = this.turnNo; this.say(`G・ストライク！ ${this.nameOf(t)}はこのターン攻撃できない`, di); }
        }
      }
    }
  }

  return { Game, GameOver, SkipTurn, validateDeck, abilitiesOf, spellSideDef, spellView, isCreatureDef, isElementDef, makeRng, ZONE_NAMES };
});
