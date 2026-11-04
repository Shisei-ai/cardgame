/*
 * engine.js — 対戦のルール処理（画面表示とは完全に分離）
 *
 * ■ ターンの流れ
 *   ターン開始（自分のクリーチャーが全てアンタップ）→ 最大マナ+1（上限20）・マナ全回復 → ドロー
 *   → メインステップ（カードを使う）→ アタックステップ（クリーチャーで攻撃）→ ターン終了
 *
 * ■ 勝敗
 *   相手の体力を0にした方の勝ち。山札が0枚の時にカードを引こうとした方の負け。
 *
 * ■ 火種（ひだね）… 攻撃のリスク
 *   相手のクリーチャーに攻撃されるたび、攻撃された側は火種を emberPerAttack 個得る（emberCap 個まで）。
 *   火種はマナの代わりに使える（支払いは、まずマナから、足りない分を火種で）。ターンをまたいで残る。
 *   また、相手本体への攻撃を、火種を emberBlockCost 個払って、アンタップの自分のクリーチャーで
 *   受け止める（ブロック）こともできる。ブロックしたクリーチャーはタップし、攻撃してきたクリーチャーとバトルする。
 *   攻撃するほど相手に資源と守りの手段を与えるので、「攻撃する価値があるか」「どの順に攻撃するか」を考える必要が生まれる。
 *
 * ■ 選択の仕組み（ジェネレーター）
 *   効果の対象選び・「〜してもよい」・迎撃呪文を使うか、などの選択が必要になると、処理は
 *   yield { player, kind, prompt, options, min, max } で一時停止する。
 *   ・そのプレイヤーに chooser（AIの選択関数）があれば、すぐに答えを受け取って続ける
 *   ・人間なら this.pending に置いて止まり、画面から answer(答え) が呼ばれたら続きを処理する
 *   選択の種類（kind）：
 *     'targets' … options はクリーチャーの uid。min〜max 個を選ぶ。答えは uid の配列
 *     'confirm' … 「〜してもよい」。答えは true / false
 *     'discard' … 手札から捨てるカード。options はカードの iid。答えは iid の配列
 *     'react'   … 相手の攻撃に迎撃呪文を使うか。options は使える呪文の iid。答えは iid の配列（空なら使わない）
 *     'block'   … 火種を払ってブロックするか。options はブロックできるクリーチャーの uid。答えは uid の配列（空ならしない）
 *     'counter' … 相手の呪文に対抗呪文を使うか。options は使える呪文の iid
 *     'pickCard'… カードを選ぶ（サーチ・墓地回収・相手の手札など）。options は iid、cards は spec、zone は場所
 *
 * ■ テキスト効果（parts.js の文法）
 *   発動の場面ごとに、出来事が起きた所から _selfTrigger / _trigger で効果を呼ぶ。
 *   常在効果（場にいる限り）は効果としては動かさず、powerOf / hasKw / costOf の計算に毎回反映する。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./parts.js'));
  else root.Engine = factory(root.Parts);
})(typeof self !== 'undefined' ? self : this, function (Parts) {
  'use strict';

  const CONFIG = {
    startHP: 10000,
    emberPerAttack: 1, // 攻撃されるたびに得る火種の数
    emberCap: 5,       // 火種の上限
    emberBlockCost: 1, // ブロックに必要な火種の数（0ならブロックなし）
    maxManaCap: 20,   // 最大マナの上限
    startHand: 5,
    secondBonus: 0,   // 後攻が最初に多く引く枚数（火種の導入で先攻と後攻が釣り合ったので0）
    secondMana: 0,    // 後攻の最大マナの初期値（先攻は0から）
    secondCoin: 0,    // 後攻の最初のターンだけ、マナがこの数だけ多い（最大マナは増えない）
    deckSize: 40,
    maxCopies: 4,
    fieldLimit: 6,
    handLimit: 10,    // 超えて引いたカードは墓地へ
    maxDepth: 12,     // 効果が効果を呼ぶ連鎖の上限（無限ループ防止）
    playsPerTurn: 12, // 1ターンに使えるカードの枚数の上限（「墓地から戻してまた使う」などの無限ループ防止）
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** デッキ（spec の配列）が規定を満たすか。エラーメッセージの配列を返す */
  function validateDeck(specs, cfg = CONFIG) {
    const err = [];
    if (specs.length !== cfg.deckSize) err.push(`デッキは${cfg.deckSize}枚ちょうどにしてください（現在${specs.length}枚）`);
    const cnt = {};
    for (const s of specs) cnt[s.id] = (cnt[s.id] || 0) + 1;
    for (const s of specs) if (cnt[s.id] > cfg.maxCopies) { err.push(`「${s.name}」が${cfg.maxCopies}枚を超えています`); cnt[s.id] = 0; }
    return err;
  }

  const P = Parts;
  const TRIG = P.TRIGGERS;

  class Game {
    /**
     * opts.decks : [spec配列, spec配列]   opts.names : ['あなた', 'CPU']
     * opts.seed  : 乱数シード              opts.first : 先攻のプレイヤー番号（省略時はランダム）
     */
    constructor(opts) {
      this.cfg = Object.assign({}, CONFIG, opts.config || {});
      this.rand = mulberry32(opts.seed != null ? opts.seed : (Math.random() * 2 ** 32) >>> 0);
      this.seq = 1;
      this.turn = 0;          // 通算のターン数
      this.active = 0;        // 手番のプレイヤー
      this.step = 'main';     // 'main' | 'attack'
      this.over = false;
      this.winner = null;
      this.endReason = '';
      this.version = 0;
      this.onEvent = null;    // 画面の演出用
      this.pending = null;    // 人間の選択待ち
      this._task = null;
      this._depth = 0;
      this._windows = 0;      // 対抗呪文の割り込みの深さ
      this.players = [0, 1].map((i) => ({
        index: i, name: (opts.names || [])[i] || (i ? 'CPU' : 'あなた'),
        hp: this.cfg.startHP, maxMana: 0, mana: 0, ember: 0,
        deck: this._shuffle(opts.decks[i].map((spec) => this._inst(spec, i))),
        hand: [], field: [], grave: [], exile: [],
        restrict: [],       // 相手のメタ効果による制限 [{ k, n, by }]（by のプレイヤーのターンの始めに解ける）
        spentThisTurn: 0,   // このターンに使ったマナと火種（「マナを◯までしか使えない」用）
        attacksThisTurn: 0, // このターンに攻撃した回数
        nextDiscount: 0,    // 次に使うカードのコスト軽減（このターン）
        spellsThisTurn: 0,
        playsThisTurn: 0,
        turns: 0,           // 自分のターンの回数
        chooser: null,      // AIの選択関数。null なら人間（pending で止まる）
        stats: { damage: 0, played: 0, destroyed: 0 },
      }));
      this.first = opts.first != null ? opts.first : (this.rand() < 0.5 ? 0 : 1);
      this.players[1 - this.first].maxMana = this.cfg.secondMana;
    }

    _inst(spec, owner) { return { iid: this.seq++, spec, owner }; }
    opp(p) { return this.players[1 - p.index]; }
    findUnit(uid) { for (const p of this.players) { const u = p.field.find((x) => x.uid === uid); if (u) return u; } return null; }
    _emit(ev) { if (this.onEvent) this.onEvent(ev); }
    _bump() { this.version++; }
    _shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    }

    // ───────────── 常在効果を含めた、今の状態 ─────────────
    /** 常在効果（場にいる限り）の一覧 [{ src, owner, e }] */
    _statics() {
      const out = [];
      for (const q of this.players) for (const s of q.field) {
        if (s.silenced) continue;
        for (const e of s.spec.effects || []) if (e.trig === 'static') out.push({ src: s, owner: q, e });
      }
      return out;
    }

    /** 常在効果 st の対象に u が入るか */
    _staticHits(st, u) {
      const t = st.e.tgt || {};
      if (t.who === 'self') return u === st.src;
      const mine = u.owner === st.owner.index;
      if (t.who === 'enemy' && mine) return false;
      if ((t.who === 'ally' || t.who === 'allyOther') && !mine) return false;
      if (t.who === 'allyOther' && u === st.src) return false;
      const f = P.FILTERS[t.f || 'none'];
      if (f && f.test && !['powerLE', 'powerGE'].includes(t.f) && !f.test(this, u, t.fn)) return false;
      return true;
    }

    /** 「〜につき」の倍率（最大 PER_MAX） */
    perCount(p, source, per) {
      if (!per || per === 'none') return 1;
      const op = this.opp(p);
      const n = ({
        ally: p.field.length, allyOther: p.field.filter((u) => u !== source).length, enemy: op.field.length,
        hand: p.hand.length, grave3: Math.floor(p.grave.length / 3), ember: p.ember, spells: p.spellsThisTurn,
      })[per] || 0;
      return Math.min(P.CAP.PER_MAX, n);
    }

    /** 今のパワー（効果の補正・常在効果を含む） */
    powerOf(u) {
      let v = u.power + u.plus;
      for (const m of u.mods) if (m.pw) v += m.pw;
      if (!this._inPower) {
        this._inPower = true;
        try {
          for (const st of this._statics()) {
            if (st.e.act !== 'buff' && st.e.act !== 'weaken') continue;
            if (!this._staticHits(st, u)) continue;
            const k = this.perCount(st.owner, st.src, st.e.per);
            v += (st.e.act === 'buff' ? 1 : -1) * st.e.n * k;
          }
        } finally { this._inPower = false; }
      }
      return Math.max(0, v);
    }

    /** キーワード効果を持っているか（与えられたもの・常在効果を含む） */
    hasKw(u, k) {
      if (!u.silenced && (u.spec.keywords || []).includes(k)) return true;
      if (u.kws.includes(k) || u.mods.some((m) => m.kw === k)) return true;
      for (const st of this._statics()) if (st.e.act === 'grantKw' && st.e.kw === k && this._staticHits(st, u)) return true;
      return false;
    }

    // ───────────── メタ効果（相手のカードの使用の制限） ─────────────
    /** p にかかっている制限の一覧 [{ k, n, statik }]（相手の効果で掛けられたもの＋相手の場の常在効果） */
    metaOn(p) {
      const out = p.restrict.map((r) => ({ k: r.k, n: r.n }));
      for (const st of this._statics()) if (st.owner !== p && P.META[st.e.act]) out.push({ k: st.e.act, n: st.e.n, statik: true });
      return out;
    }
    _metaN(p, k) { return this.metaOn(p).filter((r) => r.k === k).map((r) => r.n); }
    _has(p, k) { return this._metaN(p, k).length > 0; }

    /** このカードを、制限のせいで使えないなら理由を返す */
    metaBlocks(p, s) {
      const L = this.metaOn(p);
      for (const r of L) {
        if (s.kind === 'spell') {
          if (r.k === 'spellLock') return '呪文を封じられている';
          if (r.k === 'spellLockLE' && s.cost <= r.n) return `コスト${r.n}以下の呪文を封じられている`;
          if (r.k === 'spellLockGE' && s.cost >= r.n) return `コスト${r.n}以上の呪文を封じられている`;
          if (r.k === 'reactLock' && this._spellTiming(s) !== 'main') return '迎撃・対抗を封じられている';
        } else {
          if (r.k === 'summonLock') return '召喚を封じられている';
          if (r.k === 'summonLockLE' && s.cost <= r.n) return `コスト${r.n}以下の召喚を封じられている`;
          if (r.k === 'summonLockGE' && s.cost >= r.n) return `コスト${r.n}以上の召喚を封じられている`;
        }
        if (r.k === 'playLimit' && p.playsThisTurn >= r.n) return `このターンはカードを${r.n}枚まで`;
      }
      return '';
    }

    /** 今使えるマナの量（火種を含む。「マナを◯まで」の制限を反映） */
    budget(p) {
      let b = p.mana + (this._has(p, 'emberLock') ? 0 : p.ember);
      const caps = this._metaN(p, 'manaCap');
      if (caps.length) b = Math.min(b, Math.max(0, Math.min(...caps) - p.spentThisTurn));
      return b;
    }

    /** 実際のコスト（常在効果・次のカードの軽減を含む） */
    costOf(p, spec) {
      let c = spec.cost;
      for (const st of this._statics()) {
        if (st.e.act === 'auraCost' && st.owner === p) c -= st.e.n;
        if (st.e.act === 'auraOppCost' && st.owner !== p) c += st.e.n;
      }
      c = Math.max(Math.min(1, spec.cost), c);
      return Math.max(0, c - p.nextDiscount);
    }

    // ───────────── 公開の操作（画面やAIから呼ぶ） ─────────────
    start() {
      this._run((function* () {
        for (const p of this.players) {
          const n = this.cfg.startHand + (p.index === this.first ? 0 : this.cfg.secondBonus);
          for (let i = 0; i < n; i++) this._drawOne(p);
        }
        yield* this._beginTurn(this.players[this.first]);
      }).call(this));
    }

    _busy() { return this.over || this.pending || this._task; }

    /** 手札のカードを今使えるか { ok, reason } */
    canPlay(pi, iid) {
      const p = this.players[pi];
      const inst = p.hand.find((c) => c.iid === iid);
      if (!inst || this._busy()) return { ok: false, reason: '' };
      const s = inst.spec;
      const timed = this._spellTiming(s);
      if (timed === 'react') return { ok: false, reason: '相手の攻撃時に使える' };
      if (timed === 'counter') return { ok: false, reason: '相手が呪文を唱えた時に使える' };
      if (this.active !== pi || this.step !== 'main') return { ok: false, reason: '自分のメインステップのみ' };
      if (p.playsThisTurn >= this.cfg.playsPerTurn) return { ok: false, reason: `1ターンに${this.cfg.playsPerTurn}枚まで` };
      const blocked = this.metaBlocks(p, s);
      if (blocked) return { ok: false, reason: blocked };
      if (this.costOf(p, s) > this.budget(p)) return { ok: false, reason: this.costOf(p, s) <= p.mana + p.ember ? 'マナの使用を制限されている' : 'マナ不足' };
      if (s.kind === 'creature' && p.field.length >= this.cfg.fieldLimit) return { ok: false, reason: '場がいっぱい' };
      return { ok: true, reason: '' };
    }

    play(pi, iid) {
      const chk = this.canPlay(pi, iid);
      if (!chk.ok) return chk;
      this._run(this._playTask(this.players[pi], iid));
      return chk;
    }

    /** 起動効果（idx 番目のテキスト効果）を今使えるか */
    canActivate(pi, uid, idx) {
      const p = this.players[pi];
      const u = p.field.find((x) => x.uid === uid);
      if (!u || this._busy() || this.active !== pi || this.step !== 'main' || u.silenced) return false;
      const e = (u.spec.effects || [])[idx];
      if (!e || e.trig !== 'activate') return false;
      if (this._has(p, 'activateLock')) return false;
      if (!this._limitOk(u, idx, e)) return false;
      const needTap = e.tapToo || (e.pay && e.pay.k === 'tapSelf');
      if (needTap && (u.tapped || u.sick)) return false;
      if (e.pay && e.pay.k !== 'tapSelf' && !this._canPayCost(p, u, e.pay)) return false;
      return this._condsOk(p, u, e);
    }

    activate(pi, uid, idx) {
      if (!this.canActivate(pi, uid, idx)) return false;
      const p = this.players[pi];
      const u = p.field.find((x) => x.uid === uid);
      const e = u.spec.effects[idx];
      this._run((function* () {
        this._useLimit(u, idx, e);
        if (e.tapToo || (e.pay && e.pay.k === 'tapSelf')) u.tapped = true;
        if (e.pay && e.pay.k !== 'tapSelf' && e.pay.k !== 'none') yield* this._payCost(p, u, e.pay);
        if (this.over) return;
        this._emit({ type: 'activate', player: pi, unit: u });
        yield* this._runEffect(p, u, e, {}, null, true);
      }).call(this));
      return true;
    }

    toAttack(pi) {
      if (this._busy() || this.active !== pi || this.step !== 'main') return false;
      this.step = 'attack';
      this._emit({ type: 'step', step: 'attack', player: pi });
      this._bump();
      return true;
    }

    canAttack(pi, uid) {
      const p = this.players[pi];
      const u = p.field.find((x) => x.uid === uid);
      if (!u || this._busy() || this.active !== pi || this.step !== 'attack') return false;
      if (this._has(p, 'attackLock')) return false;
      const lim = this._metaN(p, 'attackLimit');
      if (lim.length && p.attacksThisTurn >= Math.min(...lim)) return false;
      return !u.tapped && !u.sick && u.attacks > 0 && !this.hasKw(u, 'slow');
    }

    attackTargets(pi, uid) {
      if (!this.canAttack(pi, uid)) return [];
      const p = this.players[pi];
      const u = p.field.find((x) => x.uid === uid);
      const op = this.opp(p);
      const list = ['player'];
      for (const t of op.field) if (t.tapped || this.hasKw(u, 'sniper')) list.push(t.uid);
      return list;
    }

    attack(pi, uid, target) {
      if (!this.attackTargets(pi, uid).includes(target)) return false;
      const p = this.players[pi];
      this._run(this._attackTask(p, p.field.find((x) => x.uid === uid), target));
      return true;
    }

    endTurn(pi) {
      if (this._busy() || this.active !== pi) return false;
      this._run(this._endTurnTask(this.players[pi]));
      return true;
    }

    answer(value) {
      if (!this.pending) return;
      this.pending = null;
      this._step(value);
    }

    // ───────────── ジェネレーターの実行 ─────────────
    _run(gen) { this._task = gen; this._step(undefined); }

    _step(input) {
      let r;
      try {
        r = this._task.next(input);
        while (!r.done) {
          const req = r.value;
          const p = this.players[req.player];
          if (this.over) { r = this._task.return(); break; }
          if (p.chooser) { r = this._task.next(p.chooser(req)); continue; }
          this.pending = req;
          this._emit({ type: 'choice', request: req });
          this._bump();
          return;
        }
      } catch (e) {
        this._task = null;
        throw e;
      }
      this._task = null;
      this._bump();
    }

    // ───────────── ターン ─────────────
    *_beginTurn(p) {
      this.turn++;
      this.active = p.index;
      this.step = 'main';
      p.turns++;
      const op = this.opp(p);
      // 「次の自分のターンの始めまで」の効果が切れる
      for (const q of this.players) {
        q.restrict = q.restrict.filter((r) => r.by !== p.index);
        q.spentThisTurn = 0;
        q.attacksThisTurn = 0;
        for (const u of q.field) {
          u.mods = u.mods.filter((m) => !(m.exp === 'next' && m.pi === p.index));
          if (u.protectedBy === p.index) u.protectedBy = null;
        }
      }
      for (const q of this.players) for (const u of q.field) u.used = {};
      for (const u of p.field) {
        if (u.frozen) u.frozen = false; else u.tapped = false;
        u.sick = false;
        u.attacks = this.hasKw(u, 'double') ? 2 : 1;
      }
      p.maxMana = Math.min(this.cfg.maxManaCap, p.maxMana + 1);
      p.mana = p.maxMana + (this.turn === 2 ? this.cfg.secondCoin : 0);
      p.spellsThisTurn = 0;
      p.playsThisTurn = 0;
      p.nextDiscount = 0;
      this._emit({ type: 'turn', player: p.index, turn: this.turn });
      if (this.turn !== 1) { this._drawOne(p); if (this.over) return; }
      yield* this._trigger(p, 'turnStart', {});
      if (this.over) return;
      yield* this._trigger(op, 'oppTurnStart', {});
      this._bump();
    }

    *_endTurnTask(p) {
      const op = this.opp(p);
      yield* this._trigger(p, 'turnEnd', {});
      if (this.over) return;
      yield* this._trigger(op, 'oppTurnEnd', {});
      if (this.over) return;
      for (const u of [...p.field]) if (this.hasKw(u, 'fleeting')) yield* this._destroy(u, '自壊');
      if (this.over) return;
      // 「このターンの間」奪ったクリーチャーを返す
      for (const q of this.players) for (const u of [...q.field]) {
        if (u.returnTo != null && u.returnTo !== q.index) this._moveControl(u, this.players[u.returnTo]);
      }
      for (const q of this.players) for (const u of q.field) u.mods = u.mods.filter((m) => m.exp !== 'turn');
      p.nextDiscount = 0;
      yield* this._sweep();
      if (this.over) return;
      this._emit({ type: 'endTurn', player: p.index });
      yield* this._beginTurn(op);
    }

    // ───────────── カードを使う ─────────────
    *_playTask(p, iid) {
      const idx = p.hand.findIndex((c) => c.iid === iid);
      const inst = p.hand.splice(idx, 1)[0];
      const s = inst.spec;
      this._pay(p, this.costOf(p, s));
      p.nextDiscount = 0;
      p.playsThisTurn++;
      p.stats.played++;
      if (s.kind === 'creature') yield* this._summon(p, inst);
      else yield* this._cast(p, inst, {});
    }

    _newUnit(p, inst) {
      const s = inst.spec;
      return {
        uid: this.seq++, inst, spec: s, owner: p.index, name: s.name, icon: s.icon,
        power: s.power, plus: 0, mods: [], kws: [], tapped: false, frozen: false,
        sick: !(s.keywords || []).includes('haste'), attacks: (s.keywords || []).includes('double') ? 2 : 1,
        undyingUsed: false, silenced: false, used: {}, usedGame: {}, returnTo: null, protectedBy: null,
      };
    }

    *_summon(p, inst) {
      if (p.field.length >= this.cfg.fieldLimit) { if (!inst.spec.token) p.grave.push(inst); return null; }
      const u = this._newUnit(p, inst);
      if (this.hasKw(u, 'haste')) u.sick = false;
      p.field.push(u);
      this._emit({ type: 'summon', player: p.index, unit: u });
      this._bump();
      yield* this._selfTrigger(p, u, 'summon', {});
      if (this.over) return u;
      yield* this._trigger(p, 'allySummon', { other: u }, u);
      if (this.over) return u;
      yield* this._trigger(this.opp(p), 'enemySummon', { other: u });
      return u;
    }

    _spellTiming(s) {
      if (s.kind !== 'spell' || !(s.effects || []).length) return 'main';
      const t = s.effects[0].trig;
      return t === 'react' || t === 'counter' ? t : 'main';
    }

    *_cast(p, inst, ctx) {
      const s = inst.spec;
      const op = this.opp(p);
      p.spellsThisTurn++;
      this._emit({ type: 'cast', player: p.index, card: s });
      this._bump();
      // 相手の対抗呪文
      const spellCtx = { ...ctx, spell: s, negated: false };
      yield* this._counterWindow(op, p, spellCtx);
      if (this.over) return;
      if (spellCtx.negated) {
        this._emit({ type: 'negated', player: p.index, card: s });
      } else {
        for (const e of s.effects) {
          yield* this._runEffect(p, null, e, spellCtx, s);
          if (this.over) return;
        }
      }
      p.grave.push(inst);
      this._bump();
      yield* this._trigger(p, 'spellCast', { card: s });
      if (this.over) return;
      yield* this._trigger(op, 'oppSpellCast', { card: s });
    }

    /** 呪文 spellCtx が唱えられた時、相手（responder）が対抗呪文を使うか */
    *_counterWindow(responder, caster, spellCtx) {
      if (this._windows >= 3) return;
      const usable = responder.hand.filter((c) => this._spellTiming(c.spec) === 'counter' && this.costOf(responder, c.spec) <= this.budget(responder) && !this.metaBlocks(responder, c.spec));
      if (!usable.length) return;
      const ans = yield { player: responder.index, kind: 'counter', prompt: `相手が【${spellCtx.spell.name}】を唱えた！ 対抗呪文を使いますか？`, options: usable.map((c) => c.iid), min: 0, max: 1, spell: spellCtx.spell };
      const iid = ans && ans[0];
      const i = iid ? responder.hand.findIndex((c) => c.iid === iid) : -1;
      if (i < 0) return;
      const inst = responder.hand.splice(i, 1)[0];
      this._pay(responder, this.costOf(responder, inst.spec));
      responder.playsThisTurn++;
      responder.stats.played++;
      this._windows++;
      try { yield* this._cast(responder, inst, { countering: spellCtx }); } finally { this._windows--; }
    }

    _pay(p, cost) {
      const fromMana = Math.min(p.mana, cost);
      p.mana -= fromMana;
      p.ember = Math.max(0, p.ember - (cost - fromMana));
      p.spentThisTurn += cost;
    }

    // ───────────── 攻撃とバトル ─────────────
    *_attackTask(p, u, target) {
      const op = this.opp(p);
      u.attacks--;
      u.tapped = true;
      p.attacksThisTurn++;
      yield* this._attackBody(p, u, target);
      if (this.over) return;
      yield* this._gainEmber(op, this.cfg.emberPerAttack);
    }

    *_attackBody(p, u, target) {
      const op = this.opp(p);
      let tgt = target === 'player' ? null : op.field.find((x) => x.uid === target);
      this._emit({ type: 'attackDeclare', player: p.index, unit: u, target: tgt });
      this._bump();
      yield* this._selfTrigger(p, u, 'attack', { target: tgt });
      if (this.over || !p.field.includes(u)) return;
      yield* this._trigger(op, 'oppAttack', { attacker: u });
      if (this.over || !p.field.includes(u)) return;
      yield* this._reactWindow(op, u);
      if (this.over || !p.field.includes(u)) return;
      if (tgt && !op.field.includes(tgt)) return;
      let blocked = false;
      if (!this.hasKw(u, 'stealth')) {
        const guards = op.field.filter((g) => this.hasKw(g, 'guard') && !g.tapped && g !== tgt);
        if (guards.length) {
          const g = guards.reduce((a, b) => (this.powerOf(b) > this.powerOf(a) ? b : a));
          g.tapped = true;
          tgt = g;
          blocked = true;
          this._emit({ type: 'guard', player: op.index, unit: g });
        }
      }
      if (!tgt && !this.hasKw(u, 'stealth') && this.cfg.emberBlockCost > 0 && op.ember >= this.cfg.emberBlockCost && !this._has(op, 'emberLock')) {
        const blockers = op.field.filter((b) => !b.tapped);
        if (blockers.length) {
          const ans = yield { player: op.index, kind: 'block', prompt: `【${u.name}】（パワー${this.powerOf(u)}）があなたを攻撃！ 火種${this.cfg.emberBlockCost}つでブロックしますか？`, options: blockers.map((b) => b.uid), min: 0, max: 1, attacker: u.uid };
          const b = ans && ans[0] && op.field.find((x) => x.uid === ans[0] && !x.tapped);
          if (b) {
            op.ember -= this.cfg.emberBlockCost;
            b.tapped = true;
            tgt = b;
            blocked = true;
            this._emit({ type: 'block', player: op.index, unit: b, attacker: u });
          }
        }
      }
      if (tgt) {
        if (blocked) { yield* this._selfTrigger(op, tgt, 'block', { attacker: u }); if (this.over) return; }
        yield* this._selfTrigger(op, tgt, 'attacked', { attacker: u });
        if (this.over || !p.field.includes(u)) return;
        if (!op.field.includes(tgt)) return;
        yield* this._battle(p, u, op, tgt, true);
      } else {
        const dmg = this.powerOf(u);
        this._emit({ type: 'hitPlayer', player: p.index, unit: u, amount: dmg });
        yield* this._damageGen(op, dmg, p);
        if (this.over) return;
        if (this.hasKw(u, 'drain')) yield* this._healGen(p, dmg);
        if (p.field.includes(u)) yield* this._selfTrigger(p, u, 'hitPlayer', { amount: dmg });
      }
      if (u.attacks > 0 && p.field.includes(u)) u.tapped = false;
    }

    *_battle(p, a, op, d, attacking) {
      const pa = this.powerOf(a), pd = this.powerOf(d);
      this._emit({ type: 'battle', a, d, pa, pd });
      yield* this._selfTrigger(p, a, 'battle', { other: d });
      if (this.over) return;
      yield* this._selfTrigger(op, d, 'battle', { other: a });
      if (this.over) return;
      const qa = this.powerOf(a), qd = this.powerOf(d);
      const aWins = qa > qd, dWins = qd > qa;
      const toDestroy = new Set();
      if (!aWins) toDestroy.add(a);
      if (!dWins) toDestroy.add(d);
      if (this.hasKw(a, 'assassin')) toDestroy.add(d);
      if (this.hasKw(d, 'assassin')) toDestroy.add(a);
      for (const u of toDestroy) {
        yield* this._destroy(u, 'バトル');
        if (this.over) return;
      }
      if (aWins && p.field.includes(a)) {
        if (attacking && this.hasKw(a, 'pierce')) {
          yield* this._damageGen(op, qa - qd, p);
          if (this.over) return;
          if (this.hasKw(a, 'drain')) yield* this._healGen(p, qa - qd);
          yield* this._selfTrigger(p, a, 'hitPlayer', { amount: qa - qd });
          if (this.over) return;
        }
        yield* this._selfTrigger(p, a, 'win', {});
      }
      if (dWins && op.field.includes(d)) yield* this._selfTrigger(op, d, 'win', {});
    }

    *_reactWindow(defender, attacker) {
      for (let k = 0; k < 3; k++) {
        const usable = defender.hand.filter((c) => this._spellTiming(c.spec) === 'react' && this.costOf(defender, c.spec) <= this.budget(defender) && !this.metaBlocks(defender, c.spec));
        if (!usable.length) return;
        const ans = yield { player: defender.index, kind: 'react', prompt: `${attacker.name}が攻撃してきた！ 迎撃呪文を使いますか？`, options: usable.map((c) => c.iid), min: 0, max: 1, attacker: attacker.uid };
        const iid = ans && ans[0];
        if (!iid) return;
        const i = defender.hand.findIndex((c) => c.iid === iid);
        if (i < 0) return;
        const inst = defender.hand.splice(i, 1)[0];
        this._pay(defender, this.costOf(defender, inst.spec));
        defender.playsThisTurn++;
        defender.stats.played++;
        yield* this._cast(defender, inst, { attacker });
        if (this.over || !this.players[attacker.owner].field.includes(attacker)) return;
      }
    }

    // ───────────── 効果の発動 ─────────────
    *_trigger(p, trig, ctx, except) {
      for (const u of [...p.field]) {
        if (u === except || !p.field.includes(u)) continue;
        yield* this._selfTrigger(p, u, trig, ctx);
        if (this.over) return;
      }
    }

    _limitOk(u, i, e) {
      const t = TRIG[e.trig];
      if (!t || !t.rep || t.static) return true;
      const lim = P.LIMITS[e.lim || 'turn1'] || P.LIMITS.turn1;
      if (lim.game) return !u.usedGame[i];
      return (u.used[i] || 0) < lim.max;
    }
    _useLimit(u, i, e) {
      const t = TRIG[e.trig];
      if (!t || !t.rep || t.static) return;
      const lim = P.LIMITS[e.lim || 'turn1'] || P.LIMITS.turn1;
      if (lim.game) u.usedGame[i] = true;
      u.used[i] = (u.used[i] || 0) + 1;
    }

    *_selfTrigger(p, u, trig, ctx) {
      if (u.silenced) return;
      const effs = u.spec.effects || [];
      for (let i = 0; i < effs.length; i++) {
        const e = effs[i];
        if (e.trig !== trig) continue;
        if (!this._limitOk(u, i, e)) continue;
        if (!this._condsOk(p, u, e)) continue;
        this._useLimit(u, i, e);
        yield* this._runEffect(p, u, e, ctx);
        if (this.over) return;
      }
    }

    _condsOk(p, source, e) {
      for (const c of e.conds || []) {
        const cd = P.CONDS[c.k];
        if (cd && !cd.test(this, p, source, c.n)) return false;
      }
      return true;
    }

    _canPayCost(p, source, pay) {
      const n = pay.n;
      switch (pay.k) {
        case 'none': return true;
        case 'tapSelf': return !!source && !source.tapped;
        case 'discard': return p.hand.length >= n;
        case 'life': return p.hp > n;
        case 'mana': return this.budget(p) >= n;
        case 'ember': return p.ember >= n && !this._has(p, 'emberLock');
        case 'sacSelf': return !!source && p.field.includes(source);
        case 'sacAlly': return p.field.some((u) => u !== source);
        case 'exileGrave': return p.grave.length >= n;
      }
      return false;
    }

    *_payCost(p, source, pay) {
      const n = pay.n;
      switch (pay.k) {
        case 'tapSelf': source.tapped = true; break;
        case 'discard': {
          const ans = yield { player: p.index, kind: 'discard', prompt: `捨てるカードを${n}枚選んでください`, options: p.hand.map((c) => c.iid), min: n, max: n };
          const ids = (ans || []).slice(0, n);
          while (ids.length < n && p.hand.length > ids.length) { const c = p.hand.find((x) => !ids.includes(x.iid)); ids.push(c.iid); }
          for (const iid of ids) { yield* this._discard(p, iid); if (this.over) return; }
          break;
        }
        case 'life': this._loseLife(p, n); break;
        case 'mana': this._pay(p, n); break;
        case 'ember': p.ember -= n; p.spentThisTurn += n; break;
        case 'sacSelf': yield* this._destroy(source, '代償'); break;
        case 'sacAlly': {
          const pool = p.field.filter((u) => u !== source);
          const ans = yield { player: p.index, kind: 'targets', prompt: '破壊する味方を1体選んでください（代償）', options: pool.map((u) => u.uid), min: 1, max: 1, cost: true };
          const u = pool.find((x) => x.uid === (ans && ans[0])) || pool[0];
          yield* this._destroy(u, '代償');
          break;
        }
        case 'exileGrave': for (let i = 0; i < n && p.grave.length; i++) p.exile.push(p.grave.shift()); break;
      }
      this._bump();
    }

    /** テキスト効果1つを処理する。source はそのクリーチャー（呪文なら null）。activated は起動効果（コスト支払い済み） */
    *_runEffect(p, source, e, ctx, spellSpec, activated) {
      if (this._depth >= this.cfg.maxDepth) return;
      this._depth++;
      try {
        if (spellSpec && !this._condsOk(p, source, e)) return;
        const name = (source && source.name) || (spellSpec && spellSpec.name) || '';
        // 「〜してもよい。そうしたら」
        if (!activated && e.pay && e.pay.k && e.pay.k !== 'none') {
          if (!this._canPayCost(p, source, e.pay)) return;
          const yes = yield { player: p.index, kind: 'confirm', prompt: `【${name}】${P.COSTS[e.pay.k].dict(e.pay.n)}？`, effect: e, source: source && source.uid, spec: spellSpec || (source && source.spec) };
          if (!yes) return;
          yield* this._payCost(p, source, e.pay);
          if (this.over) return;
        }
        const a = P.ACTIONS[e.act];
        const mult = a.per && e.per && e.per !== 'none' ? this.perCount(p, source, e.per) : 1;
        if (mult <= 0) return;
        let targets = [];
        if (a.side !== 'none') {
          targets = yield* this._pickTargets(p, source, e, a, ctx, name);
          if (!targets.length) return;
        }
        this._emit({ type: 'effect', player: p.index, source, effect: e, card: spellSpec || (source && source.spec) });
        yield* this._apply(p, source, e, targets, mult, ctx, spellSpec);
        if (this.over) return;
        yield* this._sweep();
      } finally {
        this._depth--;
      }
    }

    /** 効果の対象になれるクリーチャーの一覧（選ぶ前の候補） */
    targetPool(p, source, e, ctx) {
      const op = this.opp(p);
      const t = e.tgt || {};
      const targetable = (u) => !(u.owner !== p.index && this.hasKw(u, 'ward') && t.count !== 'all');
      let pool;
      switch (t.who) {
        case 'self': return source && p.field.includes(source) ? [source] : [];
        case 'attacker': return ctx && ctx.attacker && op.field.includes(ctx.attacker) && !this.hasKw(ctx.attacker, 'ward') ? [ctx.attacker] : [];
        case 'ally': pool = p.field.slice(); break;
        case 'allyOther': pool = p.field.filter((u) => u !== source); break;
        case 'any': pool = [...op.field, ...p.field]; break;
        default: pool = op.field.slice();
      }
      pool = pool.filter(targetable);
      const f = P.FILTERS[t.f || 'none'];
      if (f && f.test) pool = pool.filter((u) => f.test(this, u, t.fn));
      return pool;
    }

    *_pickTargets(p, source, e, a, ctx, name) {
      const t = e.tgt || {};
      let pool = this.targetPool(p, source, e, ctx);
      if (!pool.length) return [];
      if (t.who === 'self' || t.who === 'attacker') return pool;
      const n = t.count === 'all' ? pool.length : Math.min(Number(t.count || 1), pool.length);
      if (t.count === 'all') return pool;
      const how = t.how || 'choose';
      if (how === 'random') { this._shuffle(pool); return pool.slice(0, n); }
      if (how === 'strongest' || how === 'weakest') {
        pool.sort((x, y) => (how === 'strongest' ? this.powerOf(y) - this.powerOf(x) : this.powerOf(x) - this.powerOf(y)));
        return pool.slice(0, n);
      }
      const ans = yield { player: p.index, kind: 'targets', prompt: `【${name}】対象を${n === 1 ? '1体' : n + '体まで'}選んでください（${a.label}）`, options: pool.map((u) => u.uid), min: 1, max: n, effect: e, source: source && source.uid };
      const picked = (ans || []).map((uid) => pool.find((u) => u.uid === uid)).filter(Boolean).slice(0, n);
      return picked.length ? picked : pool.slice(0, 1);
    }

    /** カードを選ぶ（サーチ・墓地回収・相手の手札を見て捨てさせる、など） */
    *_pickCards(p, zone, list, n, prompt) {
      if (!list.length) return [];
      if (list.length <= n && zone !== 'deck' && zone !== 'top') return list.slice();
      const ans = yield { player: p.index, kind: 'pickCard', prompt, zone, options: list.map((c) => c.iid), cards: list.map((c) => c.spec), min: Math.min(n, list.length), max: n };
      const picked = (ans || []).map((iid) => list.find((c) => c.iid === iid)).filter(Boolean).slice(0, n);
      return picked.length ? picked : list.slice(0, Math.min(n, list.length));
    }

    _mod(u, pw, kw, dur, pi) {
      if (dur === 'perm') { if (pw) u.plus += pw; if (kw && !u.kws.includes(kw)) u.kws.push(kw); return; }
      u.mods.push({ pw: pw || 0, kw: kw || null, exp: dur === 'untilNext' ? 'next' : 'turn', pi });
    }

    *_apply(p, source, e, targets, mult, ctx, spellSpec) {
      const op = this.opp(p);
      const n = e.n;
      const k = mult;
      switch (e.act) {
        // カード・手札
        case 'draw': if (this._has(p, 'drawLock')) break; for (let i = 0; i < n * k && !this.over; i++) this._drawOne(p); break;
        case 'loot': {
          if (!this._has(p, 'drawLock')) for (let i = 0; i < n && !this.over; i++) this._drawOne(p);
          if (this.over || !p.hand.length) break;
          const ans = yield { player: p.index, kind: 'discard', prompt: '捨てるカードを1枚選んでください', options: p.hand.map((c) => c.iid), min: 1, max: 1 };
          yield* this._discard(p, (ans && ans[0]) || p.hand[0].iid);
          break;
        }
        case 'discardSelf': {
          const m = Math.min(n, p.hand.length);
          if (!m) break;
          const ans = yield { player: p.index, kind: 'discard', prompt: `捨てるカードを${m}枚選んでください`, options: p.hand.map((c) => c.iid), min: m, max: m };
          const ids = (ans || []).slice(0, m);
          while (ids.length < m) ids.push(p.hand.find((c) => !ids.includes(c.iid)).iid);
          for (const iid of ids) yield* this._discard(p, iid);
          break;
        }
        case 'oppDiscard':
          for (let i = 0; i < n && op.hand.length; i++) yield* this._discard(op, op.hand[Math.floor(this.rand() * op.hand.length)].iid);
          break;
        case 'oppDiscardPick': {
          const picked = yield* this._pickCards(p, 'oppHand', op.hand.slice(), n, `相手の手札から、捨てさせるカードを${n}枚選んでください`);
          for (const c of picked) yield* this._discard(op, c.iid);
          break;
        }
        case 'searchCreature': case 'searchSpell': {
          const kind = e.act === 'searchCreature' ? 'creature' : 'spell';
          const list = p.deck.filter((c) => c.spec.kind === kind && c.spec.cost <= n);
          const picked = yield* this._pickCards(p, 'deck', list, 1, '山札から手札に加えるカードを選んでください');
          for (const c of picked) { p.deck.splice(p.deck.indexOf(c), 1); this._toHand(p, c); }
          this._shuffle(p.deck);
          break;
        }
        case 'lookTop': {
          const top = p.deck.slice(-n).reverse();
          if (!top.length) break;
          const picked = yield* this._pickCards(p, 'top', top, 1, `山札の上から${top.length}枚。手札に加えるカードを1枚選んでください（残りは墓地へ）`);
          for (const c of top) {
            p.deck.splice(p.deck.indexOf(c), 1);
            if (picked.includes(c)) this._toHand(p, c); else p.grave.push(c);
          }
          break;
        }
        case 'regrow': case 'regrowAny': {
          if (this._has(p, 'graveLock')) break;
          const list = p.grave.filter((c) => e.act === 'regrowAny' || c.spec.kind === 'creature');
          const picked = yield* this._pickCards(p, 'grave', list, n, `墓地から手札に戻すカードを${n}枚選んでください`);
          for (const c of picked) { p.grave.splice(p.grave.indexOf(c), 1); this._toHand(p, c); }
          break;
        }
        case 'millSelf': for (let i = 0; i < n && p.deck.length; i++) p.grave.push(p.deck.pop()); break;
        case 'millOpp': for (let i = 0; i < n * k && op.deck.length; i++) op.grave.push(op.deck.pop()); break;
        // マナ・火種
        case 'manaGain': p.mana = Math.min(p.maxMana, p.mana + n * k); break;
        case 'rampMax': p.maxMana = Math.min(this.cfg.maxManaCap, p.maxMana + n); p.mana = Math.min(p.maxMana, p.mana + n); break;
        case 'manaBurn': op.maxMana = Math.max(0, op.maxMana - n); op.mana = Math.min(op.mana, op.maxMana); break;
        case 'emberGain': yield* this._gainEmber(p, n * k); break;
        case 'emberBurn': op.ember = Math.max(0, op.ember - n); break;
        case 'costDown': p.nextDiscount += n; break;
        // 体力
        case 'burn': yield* this._damageGen(op, n * k, p); break;
        case 'drainLife': yield* this._damageGen(op, n * k, p); if (!this.over) yield* this._healGen(p, n * k); break;
        case 'burnBoth': yield* this._damageGen(op, n, p); if (!this.over) yield* this._damageGen(p, n, op); break;
        case 'heal': yield* this._healGen(p, n * k); break;
        case 'selfDamage': yield* this._damageGen(p, n, null); break;
        // 除去
        case 'destroy': for (const u of targets) { yield* this._destroy(u, '効果'); if (this.over) return; } break;
        case 'exile': for (const u of targets) { yield* this._leave(u, 'exile'); if (this.over) return; } break;
        case 'bounce': for (const u of targets) { yield* this._leave(u, 'hand'); if (this.over) return; } break;
        case 'deckBottom': for (const u of targets) { yield* this._leave(u, 'bottom'); if (this.over) return; } break;
        case 'weaken': for (const u of targets) this._mod(u, -n * k, null, e.dur || 'turn', p.index); break;
        case 'fight': {
          const mine = source && p.field.includes(source) ? source : p.field.slice().sort((x, y) => this.powerOf(y) - this.powerOf(x))[0];
          const t = targets[0];
          if (!mine || !t || !op.field.includes(t)) break;
          yield* this._battle(p, mine, op, t, false);
          break;
        }
        // 妨害・封じ
        case 'tap': for (const u of targets) u.tapped = true; break;
        case 'freeze': for (const u of targets) { u.tapped = true; u.frozen = true; } break;
        case 'silence': for (const u of targets) { u.silenced = true; u.kws = []; u.mods = u.mods.filter((m) => !m.kw); } break;
        case 'steal':
          for (const u of targets) {
            if (!op.field.includes(u) || p.field.length >= this.cfg.fieldLimit) continue;
            this._moveControl(u, p);
            if (e.dur === 'perm') { u.returnTo = null; u.sick = true; } else { u.returnTo = op.index; u.tapped = false; u.sick = false; u.attacks = this.hasKw(u, 'double') ? 2 : 1; }
            this._emit({ type: 'steal', player: p.index, unit: u });
          }
          break;
        case 'negate': if (ctx.countering) ctx.countering.negated = true; break;
        case 'negateLE': if (ctx.countering && ctx.countering.spell.cost <= n) ctx.countering.negated = true; break;
        // 強化
        case 'buff': for (const u of targets) this._mod(u, n * k, null, e.dur || 'turn', p.index); break;
        case 'grantKw':
          for (const u of targets) {
            this._mod(u, 0, e.kw, e.dur || 'turn', p.index);
            if (e.kw === 'haste' && u.sick) u.sick = false;
            if (e.kw === 'double' && this.active === u.owner) u.attacks = Math.max(u.attacks, 1) + 1;
          }
          break;
        case 'untap': for (const u of targets) u.tapped = false; break;
        case 'extraAttack': for (const u of targets) { u.attacks += 1; u.tapped = false; } break;
        case 'protect': for (const u of targets) u.protectedBy = p.index; break;
        // 召喚
        case 'token':
          if (this._has(p, 'noFreeSummon')) break;
          for (let i = 0; i < n && p.field.length < this.cfg.fieldLimit; i++) {
            const tspec = { id: `tk_${e.tp || 1000}_${e.kw || ''}`, name: 'トークン', icon: '✨', kind: 'creature', cost: 0, power: e.tp || 1000, keywords: e.kw ? [e.kw] : [], effects: [], token: true, grade: 'silver', base: true };
            yield* this._summon(p, this._inst(tspec, p.index));
            if (this.over) return;
          }
          break;
        case 'reanimate': case 'cheatHand': {
          if (this._has(p, 'noFreeSummon') || (e.act === 'reanimate' && this._has(p, 'graveLock'))) break;
          const zone = e.act === 'reanimate' ? p.grave : p.hand;
          const list = zone.filter((c) => c.spec.kind === 'creature' && c.spec.cost <= n);
          if (!list.length || p.field.length >= this.cfg.fieldLimit) break;
          const picked = yield* this._pickCards(p, e.act === 'reanimate' ? 'grave' : 'hand', list, 1, '場に出すクリーチャーを選んでください');
          for (const c of picked) { zone.splice(zone.indexOf(c), 1); yield* this._summon(p, c); }
          break;
        }
        case 'topSummon': {
          const c = p.deck.pop();
          if (!c) break;
          this._emit({ type: 'reveal', player: p.index, card: c.spec });
          if (c.spec.kind === 'creature' && p.field.length < this.cfg.fieldLimit && !this._has(p, 'noFreeSummon')) yield* this._summon(p, c);
          else this._toHand(p, c);
          break;
        }
        case 'returnSelf': {
          if (!source) break;
          if (p.field.includes(source)) { yield* this._leave(source, 'hand'); break; }
          const i = p.grave.indexOf(source.inst);
          if (i >= 0 && !this._has(p, 'graveLock')) { p.grave.splice(i, 1); this._toHand(p, source.inst); }
          break;
        }
      }
      // メタ効果：相手に制限を掛ける（自分の次のターンの始めまで）
      if (P.META[e.act] && e.trig !== 'static') op.restrict.push({ k: e.act, n, by: p.index });
      this._bump();
    }

    // ───────────── 基本の処理 ─────────────
    _toHand(p, inst) {
      if (inst.spec.token) return;
      if (p.hand.length < this.cfg.handLimit) p.hand.push(inst); else p.grave.push(inst);
    }

    _moveControl(u, to) {
      const from = this.players[u.owner];
      from.field = from.field.filter((x) => x !== u);
      to.field.push(u);
      u.owner = to.index;
      if (u.returnTo === to.index) u.returnTo = null;
      this._bump();
    }

    /** パワーが0になったクリーチャーを破壊する */
    *_sweep() {
      for (let loop = 0; loop < 5; loop++) {
        const dead = [];
        for (const q of this.players) for (const u of q.field) if (this.powerOf(u) <= 0) dead.push(u);
        if (!dead.length) return;
        for (const u of dead) { yield* this._destroy(u, 'パワー0'); if (this.over) return; }
      }
    }

    _drawOne(p) {
      if (p.deck.length === 0) {
        this.endReason = `${p.name}の山札が尽きた`;
        this._finish(1 - p.index);
        return;
      }
      const c = p.deck.pop();
      if (p.hand.length >= this.cfg.handLimit) { p.grave.push(c); this._emit({ type: 'burnCard', player: p.index, card: c.spec }); }
      else { p.hand.push(c); this._emit({ type: 'draw', player: p.index }); }
      this._bump();
    }

    *_discard(p, iid) {
      const i = p.hand.findIndex((c) => c.iid === iid);
      if (i < 0) return;
      const c = p.hand.splice(i, 1)[0];
      p.grave.push(c);
      this._emit({ type: 'discard', player: p.index, card: c.spec });
      this._bump();
      yield* this._trigger(p, 'discard', { card: c.spec });
    }

    *_destroy(u, cause) {
      const p = this.players[u.owner];
      if (!p.field.includes(u)) return;
      if (u.protectedBy != null) { this._emit({ type: 'protected', unit: u }); return; }
      if (this.hasKw(u, 'undying') && !u.undyingUsed) {
        u.undyingUsed = true;
        this._emit({ type: 'undying', unit: u });
        this._bump();
        return;
      }
      p.field = p.field.filter((x) => x !== u);
      if (!u.spec.token) (this.players[u.inst.owner] || p).grave.push(u.inst);
      this.opp(p).stats.destroyed++;
      this._emit({ type: 'destroy', unit: u, cause });
      this._bump();
      yield* this._selfTrigger(p, u, 'destroyed', {});
      if (this.over) return;
      yield* this._selfTrigger(p, u, 'leave', {});
      if (this.over) return;
      yield* this._trigger(p, 'allyDestroyed', { other: u });
      if (this.over) return;
      yield* this._trigger(this.opp(p), 'enemyDestroyed', { other: u });
    }

    /** 破壊以外で場を離れる（hand: 手札へ / exile: 除外 / bottom: 山札の一番下へ） */
    *_leave(u, to) {
      const p = this.players[u.owner];
      if (!p.field.includes(u)) return;
      p.field = p.field.filter((x) => x !== u);
      // 奪われていたクリーチャーは、元の持ち主のところへ行く
      const home = this.players[u.inst.owner] || p;
      if (!u.spec.token) {
        if (to === 'hand') this._toHand(home, u.inst);
        else if (to === 'exile') home.exile.push(u.inst);
        else home.deck.unshift(u.inst);
      }
      this._emit({ type: to === 'hand' ? 'bounce' : to === 'exile' ? 'exile' : 'toDeck', unit: u });
      this._bump();
      yield* this._selfTrigger(p, u, 'leave', {});
    }

    *_gainEmber(p, n) {
      const gain = Math.min(n, this.cfg.emberCap - p.ember);
      if (gain <= 0) return;
      p.ember += gain;
      this._emit({ type: 'ember', player: p.index, amount: gain });
      this._bump();
      yield* this._trigger(p, 'emberGained', { amount: gain });
    }

    *_damageGen(target, amount, from) {
      if (this.over || amount <= 0) return;
      target.hp -= amount;
      if (from) from.stats.damage += amount;
      this._emit({ type: 'damage', player: target.index, amount });
      this._bump();
      if (target.hp <= 0) { this.endReason = '体力0'; this._finish(1 - target.index); return; }
      yield* this._trigger(target, 'damaged', { amount });
    }

    *_healGen(p, amount) {
      if (amount <= 0 || this._has(p, 'healLock')) return;
      const before = p.hp;
      p.hp = Math.min(this.cfg.startHP, p.hp + amount);
      if (p.hp === before) return;
      this._emit({ type: 'heal', player: p.index, amount: p.hp - before });
      this._bump();
      yield* this._trigger(p, 'healed', { amount: p.hp - before });
    }

    _loseLife(p, amount) {
      p.hp -= amount;
      this._emit({ type: 'damage', player: p.index, amount, self: true });
      if (p.hp <= 0) { this.endReason = '体力0'; this._finish(1 - p.index); }
    }

    _finish(winner) {
      if (this.over) return;
      this.over = true;
      this.winner = winner;
      this._emit({ type: 'end', winner });
      this._bump();
    }
  }

  return { Game, CONFIG, validateDeck };
});
