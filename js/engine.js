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

  const has = (u, k) => !u.muted && u.spec.keywords && u.spec.keywords.includes(k);

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
      this.players = [0, 1].map((i) => ({
        index: i, name: (opts.names || [])[i] || (i ? 'CPU' : 'あなた'),
        hp: this.cfg.startHP, maxMana: 0, mana: 0, ember: 0,
        deck: this._shuffle(opts.decks[i].map((spec) => this._inst(spec))),
        hand: [], field: [], grave: [],
        spellLock: false,  // 呪文を唱えられない（相手の効果）
        chooser: null,     // AIの選択関数。null なら人間（pending で止まる）
        stats: { damage: 0, played: 0, destroyed: 0 },
      }));
      this.first = opts.first != null ? opts.first : (this.rand() < 0.5 ? 0 : 1);
      this.players[1 - this.first].maxMana = this.cfg.secondMana;
    }

    _inst(spec) { return { iid: this.seq++, spec }; }
    opp(p) { return this.players[1 - p.index]; }
    findUnit(uid) { for (const p of this.players) { const u = p.field.find((x) => x.uid === uid); if (u) return u; } return null; }
    _emit(ev) { if (this.onEvent) this.onEvent(ev); }
    _bump() { this.version++; }
    _shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    }

    // ───────────── 公開の操作（画面やAIから呼ぶ） ─────────────
    /** 試合開始：お互いに初期手札を引き、先攻の1ターン目を始める */
    start() {
      this._run((function* () {
        for (const p of this.players) {
          const n = this.cfg.startHand + (p.index === this.first ? 0 : this.cfg.secondBonus);
          for (let i = 0; i < n; i++) this._drawOne(p);
        }
        yield* this._beginTurn(this.players[this.first]);
      }).call(this));
    }

    /** 手札のカードを今使えるか { ok, reason } */
    canPlay(pi, iid) {
      const p = this.players[pi];
      const inst = p.hand.find((c) => c.iid === iid);
      if (!inst || this.over || this.pending || this._task) return { ok: false, reason: '' };
      const s = inst.spec;
      if (this.active !== pi || this.step !== 'main') return { ok: false, reason: s.kind === 'spell' && this._isReact(s) ? '相手の攻撃時に使える' : '自分のメインステップのみ' };
      if (s.kind === 'spell' && this._isReact(s)) return { ok: false, reason: '相手の攻撃時に使える' };
      if (s.cost > p.mana + p.ember) return { ok: false, reason: 'マナ不足' };
      if (s.kind === 'spell' && p.spellLock) return { ok: false, reason: '呪文を封じられている' };
      if (s.kind === 'creature' && p.field.length >= this.cfg.fieldLimit) return { ok: false, reason: '場がいっぱい' };
      return { ok: true, reason: '' };
    }

    play(pi, iid) {
      const chk = this.canPlay(pi, iid);
      if (!chk.ok) return chk;
      this._run(this._playTask(this.players[pi], iid));
      return chk;
    }

    /** 「タップして発動する」効果を今使えるか */
    canActivate(pi, uid, idx) {
      const p = this.players[pi];
      const u = p.field.find((x) => x.uid === uid);
      if (!u || this.over || this.pending || this._task || this.active !== pi || this.step !== 'main') return false;
      const e = u.spec.effects[idx];
      if (!e || e.trig !== 'tap' || u.muted) return false;
      return !u.tapped && !u.sick && !u.used[idx];
    }

    activate(pi, uid, idx) {
      if (!this.canActivate(pi, uid, idx)) return false;
      const p = this.players[pi];
      const u = p.field.find((x) => x.uid === uid);
      this._run((function* () {
        u.tapped = true;
        u.used[idx] = true;
        this._emit({ type: 'activate', player: pi, unit: u });
        yield* this._runEffect(p, u, u.spec.effects[idx], {});
      }).call(this));
      return true;
    }

    /** メインステップからアタックステップへ */
    toAttack(pi) {
      if (this.over || this.pending || this._task || this.active !== pi || this.step !== 'main') return false;
      this.step = 'attack';
      this._emit({ type: 'step', step: 'attack', player: pi });
      this._bump();
      return true;
    }

    /** このクリーチャーが今攻撃できるか */
    canAttack(pi, uid) {
      const p = this.players[pi];
      const u = p.field.find((x) => x.uid === uid);
      if (!u || this.over || this.pending || this._task || this.active !== pi || this.step !== 'attack') return false;
      return !u.tapped && !u.sick && u.attacks > 0 && !has(u, 'slow');
    }

    /** 攻撃先の候補。'player' または相手クリーチャーの uid */
    attackTargets(pi, uid) {
      if (!this.canAttack(pi, uid)) return [];
      const p = this.players[pi];
      const u = p.field.find((x) => x.uid === uid);
      const op = this.opp(p);
      const list = ['player'];
      for (const t of op.field) if (t.tapped || has(u, 'sniper')) list.push(t.uid);
      return list;
    }

    attack(pi, uid, target) {
      if (!this.attackTargets(pi, uid).includes(target)) return false;
      const p = this.players[pi];
      this._run(this._attackTask(p, p.field.find((x) => x.uid === uid), target));
      return true;
    }

    endTurn(pi) {
      if (this.over || this.pending || this._task || this.active !== pi) return false;
      this._run(this._endTurnTask(this.players[pi]));
      return true;
    }

    /** 人間の選択に答える */
    answer(value) {
      if (!this.pending) return;
      this.pending = null;
      this._step(value);
    }

    // ───────────── ジェネレーターの実行 ─────────────
    _run(gen) {
      this._task = gen;
      this._step(undefined);
    }

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
      const op = this.opp(p);
      // 自分のターンが来たら、自分がかけた呪文封じは解ける（「次の自分のターンの始めまで」）
      if (op.spellLockBy === p.index) { op.spellLock = false; op.spellLockBy = null; }
      for (const u of p.field) {
        u.tapped = false; u.sick = false; u.turnPlus = 0; u.used = {};
        u.attacks = has(u, 'double') ? 2 : 1;
      }
      for (const u of op.field) u.turnPlus = 0;
      p.maxMana = Math.min(this.cfg.maxManaCap, p.maxMana + 1);
      p.mana = p.maxMana + (this.turn === 2 ? this.cfg.secondCoin : 0);
      this._emit({ type: 'turn', player: p.index, turn: this.turn });
      // 先攻の1ターン目はドローしない
      const skip = this.turn === 1;
      if (!skip) { this._drawOne(p); if (this.over) return; }
      yield* this._trigger(p, 'turnStart', {});
      this._bump();
    }

    *_endTurnTask(p) {
      yield* this._trigger(p, 'turnEnd', {});
      if (this.over) return;
      // 【自壊】
      for (const u of [...p.field]) if (has(u, 'fleeting')) yield* this._destroy(u, '自壊');
      if (this.over) return;
      for (const q of this.players) for (const u of q.field) u.turnPlus = 0;
      this._emit({ type: 'endTurn', player: p.index });
      yield* this._beginTurn(this.opp(p));
    }

    // ───────────── カードを使う ─────────────
    *_playTask(p, iid) {
      const idx = p.hand.findIndex((c) => c.iid === iid);
      const inst = p.hand.splice(idx, 1)[0];
      const s = inst.spec;
      this._pay(p, s.cost);
      p.stats.played++;
      if (s.kind === 'creature') {
        yield* this._summon(p, inst);
      } else {
        yield* this._cast(p, inst, {});
      }
    }

    *_summon(p, inst) {
      const s = inst.spec;
      const u = {
        uid: this.seq++, inst, spec: s, owner: p.index, name: s.name, icon: s.icon,
        power: s.power, plus: 0, turnPlus: 0, tapped: false,
        sick: !(s.keywords || []).includes('haste'), attacks: (s.keywords || []).includes('double') ? 2 : 1,
        undyingUsed: false, muted: false, used: {},
      };
      p.field.push(u);
      this._emit({ type: 'summon', player: p.index, unit: u });
      this._bump();
      yield* this._selfTrigger(p, u, 'summon', {});
      if (this.over) return;
      yield* this._trigger(p, 'allySummon', { other: u }, u);
    }

    *_cast(p, inst, ctx) {
      const s = inst.spec;
      this._emit({ type: 'cast', player: p.index, card: s });
      for (const e of s.effects) {
        yield* this._runEffect(p, null, e, ctx, s);
        if (this.over) return;
      }
      p.grave.push(inst);
      this._bump();
      yield* this._trigger(p, 'spellCast', { card: s });
    }

    /** コストを払う：まずマナから、足りない分を火種で */
    _pay(p, cost) {
      const fromMana = Math.min(p.mana, cost);
      p.mana -= fromMana;
      p.ember -= cost - fromMana;
    }

    _isReact(s) { return s.kind === 'spell' && s.effects.length && s.effects[0].trig === 'react'; }

    // ───────────── 攻撃とバトル ─────────────
    powerOf(u) { return Math.max(0, u.power + u.plus + u.turnPlus); }

    *_attackTask(p, u, target) {
      const op = this.opp(p);
      u.attacks--;
      u.tapped = true;
      // 攻撃された側は、攻撃が終わった後に火種を得る（攻撃のリスク）
      yield* this._attackBody(p, u, target);
      if (this.over) return;
      const gain = Math.min(this.cfg.emberPerAttack, this.cfg.emberCap - op.ember);
      if (gain > 0) { op.ember += gain; this._emit({ type: 'ember', player: op.index, amount: gain }); this._bump(); }
    }

    *_attackBody(p, u, target) {
      const op = this.opp(p);
      let tgt = target === 'player' ? null : op.field.find((x) => x.uid === target);
      this._emit({ type: 'attackDeclare', player: p.index, unit: u, target: tgt });
      this._bump();
      // 攻撃した時の効果
      yield* this._selfTrigger(p, u, 'attack', { target: tgt });
      if (this.over || !p.field.includes(u)) return;
      // 相手の迎撃呪文
      yield* this._reactWindow(op, u);
      if (this.over || !p.field.includes(u)) return;
      if (tgt && !op.field.includes(tgt)) return; // 攻撃先がいなくなった
      // 守護：アンタップしている守護が、攻撃を代わりに受ける（隠密は無視する）
      if (!has(u, 'stealth')) {
        const guards = op.field.filter((g) => has(g, 'guard') && !g.tapped && g !== tgt);
        if (guards.length) {
          const g = guards.reduce((a, b) => (this.powerOf(b) > this.powerOf(a) ? b : a));
          g.tapped = true;
          tgt = g;
          this._emit({ type: 'guard', player: op.index, unit: g });
        }
      }
      // ブロック：相手本体への攻撃を、火種を払ってアンタップのクリーチャーで受け止める（隠密は受け止められない）
      if (!tgt && !has(u, 'stealth') && this.cfg.emberBlockCost > 0 && op.ember >= this.cfg.emberBlockCost) {
        const blockers = op.field.filter((b) => !b.tapped);
        if (blockers.length) {
          const ans = yield { player: op.index, kind: 'block', prompt: `【${u.name}】（パワー${this.powerOf(u)}）があなたを攻撃！ 火種${this.cfg.emberBlockCost}つでブロックしますか？`, options: blockers.map((b) => b.uid), min: 0, max: 1, attacker: u.uid };
          const b = ans && ans[0] && op.field.find((x) => x.uid === ans[0] && !x.tapped);
          if (b) {
            op.ember -= this.cfg.emberBlockCost;
            b.tapped = true;
            tgt = b;
            this._emit({ type: 'block', player: op.index, unit: b, attacker: u });
          }
        }
      }
      if (!tgt) {
        const dmg = this.powerOf(u);
        this._emit({ type: 'hitPlayer', player: p.index, unit: u, amount: dmg });
        this._damage(op, dmg, p);
        if (has(u, 'drain')) this._heal(p, dmg);
        // 攻撃が終わったら、残りの攻撃回数があればアンタップして次に備える（連撃）
        if (u.attacks > 0 && p.field.includes(u)) u.tapped = false;
        return;
      }
      yield* this._battle(p, u, op, tgt, true);
      if (u.attacks > 0 && p.field.includes(u)) u.tapped = false;
    }

    *_battle(p, a, op, d, attacking) {
      const pa = this.powerOf(a), pd = this.powerOf(d);
      this._emit({ type: 'battle', a, d, pa, pd });
      const aWins = pa > pd, dWins = pd > pa;
      // パワーが小さい方が破壊される。同じパワーなら両方破壊
      const toDestroy = new Set();
      if (!aWins) toDestroy.add(a);
      if (!dWins) toDestroy.add(d);
      // 刺客：勝敗に関わらず、バトルした相手を破壊する
      if (has(a, 'assassin')) toDestroy.add(d);
      if (has(d, 'assassin')) toDestroy.add(a);
      for (const u of toDestroy) {
        yield* this._destroy(u, 'バトル');
        if (this.over) return;
      }
      if (aWins && p.field.includes(a)) {
        if (attacking && has(a, 'pierce')) { this._damage(op, pa - pd, p); if (has(a, 'drain')) this._heal(p, pa - pd); }
        if (this.over) return;
        yield* this._selfTrigger(p, a, 'win', {});
      }
      if (dWins && op.field.includes(d)) yield* this._selfTrigger(op, d, 'win', {});
    }

    /** 攻撃された側が、迎撃呪文を使うか選ぶ */
    *_reactWindow(defender, attacker) {
      for (let guard = 0; guard < 3; guard++) {
        const usable = defender.hand.filter((c) => this._isReact(c.spec) && c.spec.cost <= defender.mana + defender.ember && !defender.spellLock);
        if (!usable.length) return;
        const ans = yield { player: defender.index, kind: 'react', prompt: `${attacker.name}が攻撃してきた！ 迎撃呪文を使いますか？`, options: usable.map((c) => c.iid), min: 0, max: 1, attacker: attacker.uid };
        const iid = ans && ans[0];
        if (!iid) return;
        const i = defender.hand.findIndex((c) => c.iid === iid);
        if (i < 0) return;
        const inst = defender.hand.splice(i, 1)[0];
        this._pay(defender, inst.spec.cost);
        defender.stats.played++;
        yield* this._cast(defender, inst, { attacker });
        if (this.over || !this.players[attacker.owner].field.includes(attacker)) return;
      }
    }

    // ───────────── 効果 ─────────────
    /** p の場のクリーチャー全ての trig 効果を発動する（except は除外するクリーチャー） */
    *_trigger(p, trig, ctx, except) {
      for (const u of [...p.field]) {
        if (u === except || !p.field.includes(u)) continue;
        yield* this._selfTrigger(p, u, trig, ctx);
        if (this.over) return;
      }
    }

    *_selfTrigger(p, u, trig, ctx) {
      if (u.muted) return;
      const effs = u.spec.effects || [];
      for (let i = 0; i < effs.length; i++) {
        const e = effs[i];
        if (e.trig !== trig) continue;
        const once = Parts.TRIGGERS[trig] && Parts.TRIGGERS[trig].once;
        if (once && u.used[i]) continue;
        if (once) u.used[i] = true;
        yield* this._runEffect(p, u, e, ctx);
        if (this.over) return;
      }
    }

    /** テキスト効果1つを処理する。source はそのクリーチャー（呪文なら null） */
    *_runEffect(p, source, e, ctx, spellSpec) {
      if (this._depth >= this.cfg.maxDepth) return;
      this._depth++;
      try {
        const op = this.opp(p);
        const cond = Parts.CONDS[e.cond || 'none'];
        if (cond.test && !cond.test(this, p)) return;
        // 「〜してもよい。そうしたら」
        if (e.pay && e.pay !== 'none') {
          if (!this._canPay(p, source, e.pay)) return;
          const name = (source && source.name) || (spellSpec && spellSpec.name) || '';
          const yes = yield { player: p.index, kind: 'confirm', prompt: `【${name}】${Parts.PAYS[e.pay].label}？`, effect: e, source: source && source.uid };
          if (!yes) return;
          yield* this._pay(p, source, e.pay);
          if (this.over) return;
        }
        const a = Parts.ACTIONS[e.act];
        let targets = [];
        if (a.side !== 'none') {
          targets = yield* this._pickTargets(p, source, e, a, ctx);
          if (!targets.length) return;
        }
        this._emit({ type: 'effect', player: p.index, source, effect: e, card: spellSpec || (source && source.spec) });
        yield* this._apply(p, op, source, e, targets);
      } finally {
        this._depth--;
      }
    }

    _canPay(p, source, pay) {
      if (pay === 'tapSelf') return source && !source.tapped;
      if (pay === 'discard1') return p.hand.length > 0;
      if (pay === 'life500') return p.hp > 500;
      if (pay === 'life1000') return p.hp > 1000;
      return true;
    }

    *_pay(p, source, pay) {
      if (pay === 'tapSelf') source.tapped = true;
      else if (pay === 'life500') this._loseLife(p, 500);
      else if (pay === 'life1000') this._loseLife(p, 1000);
      else if (pay === 'discard1') {
        const ans = yield { player: p.index, kind: 'discard', prompt: '捨てるカードを1枚選んでください', options: p.hand.map((c) => c.iid), min: 1, max: 1 };
        const iid = (ans && ans[0]) || p.hand[0].iid;
        yield* this._discard(p, iid);
      }
      this._bump();
    }

    /** 効果の対象を決める。選べる候補がなければ空配列 */
    *_pickTargets(p, source, e, a, ctx) {
      const op = this.opp(p);
      const tg = Parts.TARGETS[e.tgt];
      if (tg.how === 'self') return source && p.field.includes(source) ? [source] : [];
      if (tg.how === 'attacker') return ctx.attacker && op.field.includes(ctx.attacker) ? [ctx.attacker] : [];
      let pool = a.side === 'enemy' ? op.field.filter((u) => !has(u, 'ward')) : p.field.slice();
      if (a.filter && e.amt) pool = pool.filter((u) => this.powerOf(u) <= e.amt);
      if (!pool.length) return [];
      if (tg.how === 'all') return pool;
      if (tg.how === 'random') return [pool[Math.floor(this.rand() * pool.length)]];
      const n = Math.min(tg.n, pool.length);
      const ans = yield { player: p.index, kind: 'targets', prompt: `対象を${n === 1 ? '1体' : n + '体まで'}選んでください（${a.label}）`, options: pool.map((u) => u.uid), min: 1, max: n, effect: e, source: source && source.uid };
      const picked = (ans || []).map((uid) => pool.find((u) => u.uid === uid)).filter(Boolean).slice(0, n);
      return picked.length ? picked : pool.slice(0, 1);
    }

    *_apply(p, op, source, e, targets) {
      const n = e.amt;
      switch (e.act) {
        case 'draw': for (let i = 0; i < n && !this.over; i++) this._drawOne(p); break;
        case 'rampMax': p.maxMana = Math.min(this.cfg.maxManaCap, p.maxMana + n); break;
        case 'manaGain': p.mana = Math.min(p.maxMana, p.mana + n); break;
        case 'heal': this._heal(p, n); break;
        case 'burn': this._damage(op, n, p); break;
        case 'discardOpp':
          for (let i = 0; i < n && op.hand.length; i++) yield* this._discard(op, op.hand[Math.floor(this.rand() * op.hand.length)].iid);
          break;
        case 'manaBurn': op.maxMana = Math.max(0, op.maxMana - n); op.mana = Math.min(op.mana, op.maxMana); break;
        case 'spellLock': op.spellLock = true; op.spellLockBy = p.index; break;
        case 'regrow': {
          for (let i = 0; i < n; i++) {
            const idxs = p.grave.map((c, j) => j).filter((j) => p.grave[j].spec.kind === 'creature');
            if (!idxs.length || p.hand.length >= this.cfg.handLimit) break;
            p.hand.push(p.grave.splice(idxs[Math.floor(this.rand() * idxs.length)], 1)[0]);
          }
          break;
        }
        case 'destroy': for (const u of targets) { yield* this._destroy(u, '効果'); if (this.over) return; } break;
        case 'tapEnemy': for (const u of targets) u.tapped = true; break;
        case 'weaken': for (const u of targets) u.turnPlus -= n; break;
        case 'bounce':
          for (const u of targets) {
            const q = this.players[u.owner];
            if (!q.field.includes(u)) continue;
            q.field = q.field.filter((x) => x !== u);
            if (q.hand.length < this.cfg.handLimit) q.hand.push(u.inst); else q.grave.push(u.inst);
            this._emit({ type: 'bounce', unit: u });
          }
          break;
        case 'buffTurn': for (const u of targets) u.turnPlus += n; break;
        case 'buffPerm': for (const u of targets) u.plus += n; break;
        case 'untap': for (const u of targets) u.tapped = false; break;
      }
      // パワーが0以下になったクリーチャーは破壊される
      for (const q of this.players) for (const u of [...q.field]) if (this.powerOf(u) <= 0) { yield* this._destroy(u, 'パワー0'); if (this.over) return; }
      this._bump();
    }

    // ───────────── 基本の処理 ─────────────
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
      if (has(u, 'undying') && !u.undyingUsed) {
        u.undyingUsed = true;
        this._emit({ type: 'undying', unit: u });
        this._bump();
        return;
      }
      p.field = p.field.filter((x) => x !== u);
      p.grave.push(u.inst);
      this.opp(p).stats.destroyed++;
      this._emit({ type: 'destroy', unit: u, cause });
      this._bump();
      yield* this._selfTrigger(p, u, 'destroyed', {});
    }

    _damage(target, amount, from) {
      if (this.over || amount <= 0) return;
      target.hp -= amount;
      if (from) from.stats.damage += amount;
      this._emit({ type: 'damage', player: target.index, amount });
      this._bump();
      if (target.hp <= 0) { this.endReason = '体力0'; this._finish(1 - target.index); }
    }

    _loseLife(p, amount) {
      p.hp -= amount;
      this._emit({ type: 'damage', player: p.index, amount, self: true });
      if (p.hp <= 0) { this.endReason = '体力0'; this._finish(1 - p.index); }
    }

    _heal(p, amount) {
      if (amount <= 0) return;
      p.hp = Math.min(this.cfg.startHP, p.hp + amount);
      this._emit({ type: 'heal', player: p.index, amount });
      this._bump();
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
