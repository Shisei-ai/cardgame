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
 *                   → メイン（召喚・呪文）→ 攻撃 → ターン終了
 *   ・コストの支払い：マナゾーンのカードを、コストと同じ枚数タップする。その中に、使うカードの
 *                     すべての文明が1枚以上ずつ含まれていなければならない
 *   ・多色カード（2つ以上の文明を持つカード）は、タップした状態でマナゾーンに置く
 *   ・召喚酔い：出たターンは攻撃できない（スピードアタッカー・進化クリーチャーは例外）
 *   ・攻撃できるのは「相手プレイヤー」か「相手のタップしているクリーチャー」
 *   ・ブロッカーは攻撃をブロックできる（タップしてバトル）
 *   ・バトル：パワーの大きい方が勝ち、負けた方は破壊。同じなら両方破壊
 *   ・プレイヤーへの攻撃が通ると、シールドをブレイク（手札に加える）。S・トリガーはその時タダで使える
 *   ・シールドが0枚の時にプレイヤーへの攻撃が通ると、ダイレクトアタックで勝ち
 *   ・山札が0枚になったプレイヤーは負け（ライブラリアウト）
 *   ・パワーが0以下になったクリーチャーは破壊される
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
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'), require('./textparser.js'));
  else root.Engine = factory(root.SimData, root.TextParser);
})(typeof self !== 'undefined' ? self : this, function (SimData, TextParser) {
  'use strict';
  const { RULES } = SimData;

  /** 勝敗が決まった時に、処理の途中から一気に抜けるための「例外」 */
  class GameOver extends Error {
    constructor(winner, reason) { super(reason); this.winner = winner; this.reason = reason; }
  }

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
  const isCreatureDef = (def) => def.type === 'creature' || def.type === 'evolution';

  /** デッキが規則を満たしているか（40枚・同名4枚まで）。問題があれば文の配列を返す */
  function validateDeck(defs) {
    const errors = [];
    if (defs.length !== RULES.deckSize) errors.push(`デッキは${RULES.deckSize}枚ちょうどにしてください（今は${defs.length}枚）`);
    const count = {};
    for (const d of defs) count[d.name] = (count[d.name] || 0) + 1;
    for (const [name, n] of Object.entries(count)) if (n > RULES.maxCopies) errors.push(`「${name}」が${n}枚あります（同じ名前は${RULES.maxCopies}枚まで）`);
    return errors;
  }

  const ZONE_KEYS = { deck: 'deck', hand: 'hand', mana: 'mana', battle: 'battle', shield: 'shields', grave: 'grave' };
  const ZONE_NAMES = { deck: '山札', hand: '手札', mana: 'マナゾーン', battle: 'バトルゾーン', shield: 'シールド', grave: '墓地' };

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
    ab(c) { return abilitiesOf(c.def); }
    kw(c, name) { return this.ab(c).keywords[name]; }
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    }
    zoneArr(c) { return this.players[c.owner][ZONE_KEYS[c.zone]]; }
    nameOf(c) { return `「${c.def.name}」`; }

    /** 今のパワー（元のパワー＋常在効果＋このターンの増減＋攻撃中のパワーアタッカー） */
    power(c) {
      let p = c.def.power || 0;
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

    /** カードが条件（filter）に合うか */
    matches(c, f = {}, source = null) {
      const d = c.def;
      if (f.type === 'creature' && !isCreatureDef(d)) return false;
      if (f.type === 'spell' && d.type !== 'spell') return false;
      if (f.evolution && d.type !== 'evolution') return false;
      if (f.maxPower != null || f.minPower != null) {
        const pw = c.zone === 'battle' ? this.power(c) : d.power || 0;
        if (f.maxPower != null && pw > f.maxPower) return false;
        if (f.minPower != null && pw < f.minPower) return false;
      }
      if (f.maxCost != null && d.cost > f.maxCost) return false;
      if (f.minCost != null && d.cost < f.minCost) return false;
      if (f.tapped === true && !c.tapped) return false;
      if (f.tapped === false && c.tapped) return false;
      if (f.blocker && !this.kw(c, 'blocker')) return false;
      if (f.other && c === source) return false;
      if (f.civs && !f.civs.some((k) => d.civs.includes(k))) return false;
      if (f.races && !f.races.some((r) => (d.races || []).some((x) => x.includes(r) || r.includes(x)))) return false;
      return true;
    }

    /**
     * カードを別のゾーンへ動かす。
     * 進化クリーチャーがバトルゾーンを離れる時は、下に重なっているカードも同じゾーンへ行く。
     */
    move(c, to, opts = {}) {
      const from = c.zone;
      const arr = this.zoneArr(c);
      const i = arr.indexOf(c);
      if (i >= 0) arr.splice(i, 1);
      const under = from === 'battle' && to !== 'battle' ? c.under : [];
      // 状態をリセット
      c.tempPower = 0; c.attacking = false; c.cantAttackTurn = -1; c.jdProtected = false;
      if (from === 'battle' && to !== 'battle') c.under = [];
      c.zone = to;
      const dest = this.players[c.owner][ZONE_KEYS[to]];
      if (to === 'deck' && opts.bottom) dest.unshift(c); else dest.push(c);
      if (to === 'battle') {
        c.tapped = !!opts.tapped;
        c.enteredTurn = this.turnNo;
        if (this.kw(c, 'justDiver')) c.jdProtected = true;
      } else if (to === 'mana') {
        c.tapped = opts.tapped || (c.def.civs || []).length >= 2; // 多色カードはタップして置く
      } else {
        c.tapped = false;
      }
      for (const u of under) { u.zone = 'battle'; this.move(u, to === 'mana' ? 'mana' : to, {}); }
      this.emit({ kind: 'move', uid: c.uid, from, to, owner: c.owner });
    }

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

    /** 進化元にできる自分のクリーチャー */
    evolutionBases(pi, def) {
      const evo = abilitiesOf(def).evolution || { civs: [], races: [] };
      return this.players[pi].battle.filter((c) => {
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
      for (const P of this.players) for (const c of P.battle) if (c.def.power != null && this.power(c) <= 0) dead.push(c);
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
      // ── ターン開始：自分のカードをすべてアンタップ
      this.phase = 'start';
      for (const c of [...P.battle, ...P.mana]) c.tapped = false;
      for (const c of P.battle) c.jdProtected = false; // ジャストダイバーの守りは、自分の次のターンのはじめに終わる
      this.say(`── ${this.turnNo}ターン目：${P.name}のターン ──`, pi);
      this.emit({ kind: 'turn', player: pi, turn: this.turnNo });
      await this.pace({ kind: 'turn' });
      for (const c of [...P.battle]) await this.fireSelf(c, 'turnStart');
      await this.flushTriggers();
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
        }
      }
      // ── メイン
      this.phase = 'main';
      for (let guard = 0; guard < 100; guard++) {
        const actions = this.mainActions(pi);
        const ans = await this.ask(pi, { type: 'main', actions });
        const act = actions.find((a) => ans && a.kind === ans.kind && a.uid === ans.uid) || { kind: 'toAttack' };
        if (act.kind === 'toAttack') break;
        await this.playCard(pi, this.card(act.uid));
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
      }
      // ── ターン終了
      this.phase = 'end';
      for (const c of [...P.battle]) await this.fireSelf(c, 'turnEnd');
      await this.flushTriggers();
      for (const Q of this.players) for (const c of Q.battle) c.tempPower = 0; // 「このターン」の効果が終わる
      await this.settle();
      this.emit({ kind: 'turnEnd', player: pi });
    }

    /** メインで今できること（召喚・呪文） */
    mainActions(pi) {
      const P = this.players[pi];
      const acts = [];
      for (const c of P.hand) {
        if (!this.canPay(pi, c.def)) continue;
        if (c.def.type === 'creature') acts.push({ kind: 'summon', uid: c.uid });
        else if (c.def.type === 'evolution') { if (this.evolutionBases(pi, c.def).length) acts.push({ kind: 'summon', uid: c.uid }); }
        else if (c.def.type === 'spell') acts.push({ kind: 'cast', uid: c.uid });
      }
      acts.push({ kind: 'toAttack' });
      return acts;
    }

    /** そのクリーチャーが今攻撃できる相手（'player' か クリーチャーの uid）の一覧 */
    attackTargets(c) {
      if (c.zone !== 'battle' || c.owner !== this.active || c.tapped) return [];
      if (this.kw(c, 'cantAttack') || c.cantAttackTurn === this.turnNo) return [];
      const sick = c.enteredTurn === this.turnNo && !this.kw(c, 'speedAttacker') && c.def.type !== 'evolution';
      const mach = this.kw(c, 'machFighter') && c.enteredTurn === this.turnNo;
      if (sick && !mach) return [];
      const targets = [];
      if (!sick && !this.kw(c, 'cantAttackPlayers')) targets.push('player');
      for (const t of this.players[this.opp(c.owner)].battle) {
        if (t.jdProtected) continue; // ジャストダイバー：攻撃されない
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
    async playCard(pi, c) {
      const P = this.players[pi];
      const pay = this.findPayment(pi, c.def);
      if (!pay || c.zone !== 'hand') return;
      let base = null;
      if (c.def.type === 'evolution') {
        const bases = this.evolutionBases(pi, c.def);
        if (!bases.length) return;
        [base] = await this.chooseCards(pi, bases, 1, 1, `${c.def.name}の進化元を選んでください`, { op: 'evoBase' });
      }
      for (const m of pay) m.tapped = true;
      this.emit({ kind: 'pay', uids: pay.map((m) => m.uid) });
      if (c.def.type === 'spell') {
        this.say(`${P.name}は呪文${this.nameOf(c)}を唱えた`, pi);
        await this.castSpell(pi, c);
      } else {
        await this.putCreature(pi, c, base, '召喚した');
      }
    }

    /** クリーチャーをバトルゾーンに出す（召喚・S・トリガー・効果で出す、共通） */
    async putCreature(pi, c, base, verb) {
      if (base) {
        const bArr = this.players[base.owner].battle;
        const idx = bArr.indexOf(base);
        const wasTapped = base.tapped;
        bArr.splice(idx, 1);
        const under = [base, ...base.under];
        base.under = [];
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
      await this.fireSelf(c, 'cip');
      await this.flushTriggers();
    }

    async castSpell(pi, c) {
      // 唱えている間は「解決中」の場所に置き、効果が終わったら墓地へ
      const arr = this.zoneArr(c);
      arr.splice(arr.indexOf(c), 1);
      c.zone = 'stack';
      this.emit({ kind: 'cast', uid: c.uid, player: pi });
      await this.pace({ kind: 'cast', uid: c.uid });
      await this.resolveEffects(pi, this.ab(c).spell, c);
      c.zone = 'grave';
      this.players[c.owner].grave.push(c);
      this.emit({ kind: 'move', uid: c.uid, from: 'stack', to: 'grave', owner: c.owner });
      await this.flushTriggers();
    }

    // ───────────── 誘発する能力（〜した時） ─────────────
    /** そのカード自身の「〜した時」を予約する */
    async fireSelf(c, when) {
      for (const t of this.ab(c).triggers) if (t.when === when) this.pendingTriggers.push({ card: c, controller: c.owner, effects: t.effects, when });
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
          await this.resolveEffects(t.controller, t.effects, t.card);
        }
      }
    }

    // ───────────── 効果の解決 ─────────────
    async resolveEffects(pi, effects, source) {
      if (++this.depth > RULES.effectDepth) { this.depth--; return; }
      try {
        for (const e of effects) {
          if (e.optional) {
            const yes = await this.ask(pi, { type: 'yesno', prompt: `${source.def.name}：${TextParser.describeEffect(Object.assign({}, e, { optional: false }))}。使いますか？`, purpose: { op: e.op, effect: e } });
            if (!yes) continue;
          }
          await this.doEffect(pi, e, source);
          await this.checkState();
        }
      } finally { this.depth--; }
    }

    /** 効果の対象になるバトルゾーンのクリーチャーを選ぶ */
    async selectCreatures(pi, target, source, prompt, op) {
      if (target.thisCard) return source.zone === 'battle' ? [source] : [];
      const sides = target.side === 'opp' ? [this.opp(pi)] : target.side === 'self' ? [pi] : [pi, this.opp(pi)];
      let cands = [];
      for (const s of sides) cands.push(...this.players[s].battle.filter((c) => this.matches(c, Object.assign({ type: 'creature' }, target.filter), source)));
      if (target.count === 'all') return cands;
      cands = cands.filter((c) => !(c.jdProtected && c.owner !== pi)); // ジャストダイバー：相手に選ばれない
      const n = target.count || 1;
      return this.chooseCards(pi, cands, target.upTo ? 0 : n, n, prompt, { op, side: target.side });
    }

    async doEffect(pi, e, source) {
      const P = this.players[pi];
      const O = this.players[this.opp(pi)];
      const label = TextParser.describeEffect(Object.assign({}, e, { optional: false }));
      switch (e.op) {
        case 'draw': {
          let n = e.n;
          if (e.upTo) n = await this.askNumber(pi, 0, e.n, `カードを何枚引きますか？（0〜${e.n}）`);
          await this.draw(pi, n);
          break;
        }
        case 'manaBoost':
          for (let i = 0; i < e.n && P.deck.length; i++) this.move(P.deck[P.deck.length - 1], 'mana', { tapped: e.tapped });
          this.say(`${P.name}は山札の上から${e.n}枚をマナゾーンに置いた`, pi);
          break;
        case 'addShield':
          for (let i = 0; i < e.n && P.deck.length; i++) this.move(P.deck[P.deck.length - 1], 'shield');
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
        case 'power': {
          const ts = await this.selectCreatures(pi, e.target, source, `${label}：対象を選んでください`, 'power');
          for (const c of ts) { c.tempPower += e.amount; this.say(`${this.nameOf(c)}のパワーが${e.amount > 0 ? '+' : ''}${e.amount}（このターン）`, pi); }
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
        default:
          this.say(`（未対応の効果：${e.op}）`, pi);
      }
    }

    async askNumber(pi, min, max, prompt) {
      if (min === max) return min;
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
        await this.fireSelf(c, 'destroyed');
      }
    }

    // ───────────── 攻撃 ─────────────
    async attack(att, target) {
      const pi = att.owner;
      const di = this.opp(pi);
      const D = this.players[di];
      att.tapped = true;
      att.attacking = true;
      const tgtCard = target === 'player' ? null : this.card(target);
      this.say(`${this.nameOf(att)}が${tgtCard ? this.nameOf(tgtCard) : D.name}を攻撃！`, pi);
      this.emit({ kind: 'attack', uid: att.uid, target });
      await this.pace({ kind: 'attack', uid: att.uid, target });
      try {
        await this.fireSelf(att, 'attack');
        await this.flushTriggers();
        await this.checkState();
        if (att.zone !== 'battle') return; // 攻撃中に離れたら、攻撃は終わり
        if (tgtCard && tgtCard.zone !== 'battle') return; // 攻撃先がいなくなった
        // ── ブロック
        if (!this.kw(att, 'unblockable')) {
          const blockers = D.battle.filter((c) => !c.tapped && this.kw(c, 'blocker') && c !== tgtCard);
          if (blockers.length) {
            const ans = await this.ask(di, { type: 'block', attacker: att.uid, target, candidates: blockers.map((c) => c.uid) });
            const b = ans != null ? this.card(ans) : null;
            if (b && blockers.includes(b)) {
              b.tapped = true;
              this.say(`${this.nameOf(b)}がブロック！`, di);
              this.emit({ kind: 'block', uid: b.uid, attacker: att.uid });
              await this.pace({ kind: 'block', uid: b.uid });
              await this.fireSelf(b, 'block');
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
      for (const w of winners) await this.fireSelf(w, 'winBattle');
      await this.flushTriggers();
    }

    /**
     * シールドをブレイクする：選ばれたシールドをすべて持ち主の手札に加え、
     * その後、S・トリガー（タダで使える）・G・ストライクを使うかどうかを持ち主が決める。
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
        const kw = this.ab(s).keywords;
        if (kw.shieldTrigger) {
          if (s.def.type === 'evolution' && !this.evolutionBases(di, s.def).length) continue;
          const yes = await this.ask(di, { type: 'yesno', prompt: `S・トリガー：${s.def.name}をコストを払わずに使いますか？`, purpose: { op: 'shieldTrigger', uid: s.uid } });
          if (!yes) continue;
          this.emit({ kind: 'shieldTrigger', uid: s.uid, player: di });
          this.say(`S・トリガー発動！ ${this.nameOf(s)}`, di);
          if (s.def.type === 'spell') await this.castSpell(di, s);
          else {
            let base = null;
            if (s.def.type === 'evolution') [base] = await this.chooseCards(di, this.evolutionBases(di, s.def), 1, 1, '進化元を選んでください', { op: 'evoBase' });
            await this.putCreature(di, s, base, 'S・トリガーで出した');
          }
          await this.checkState();
        } else if (kw.gStrike) {
          const cands = this.players[pi].battle.filter((c) => !c.jdProtected);
          if (!cands.length) continue;
          const yes = await this.ask(di, { type: 'yesno', prompt: `G・ストライク：${s.def.name}を見せて、相手のクリーチャー1体をこのターン攻撃できなくしますか？`, purpose: { op: 'gStrike', uid: s.uid } });
          if (!yes) continue;
          const [t] = await this.chooseCards(di, cands, 1, 1, 'このターン攻撃できなくするクリーチャーを選んでください', { op: 'lockAttack', side: 'opp' });
          if (t) { t.cantAttackTurn = this.turnNo; this.say(`G・ストライク！ ${this.nameOf(t)}はこのターン攻撃できない`, di); }
        }
      }
    }
  }

  return { Game, GameOver, validateDeck, abilitiesOf, isCreatureDef, makeRng, ZONE_NAMES };
});
