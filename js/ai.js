/*
 * ai.js — CPU
 *
 *   ・対戦での行動（1手ずつ step() で進める。画面は間を空けて呼び、シミュレーターは続けて呼ぶ）
 *   ・選択への答え（choose）
 *   ・オリジナルカードの生成（forgeRandom）と、デッキ作り（buildDeck）
 *
 * カードの価値の見積もりには、基本的に「使った容量」をそのまま使う。
 * 容量はカードの強さの物差しとして作ってあるので、CPUもそれで比べられる。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./parts.js'), require('./cards.js'));
  else root.AI = factory(root.Parts, root.Cards);
})(typeof self !== 'undefined' ? self : this, function (Parts, Cards) {
  'use strict';

  const LEVELS = {
    easy:   { label: 'やさしい', mistake: 0.3, risk: 0.4 },
    normal: { label: 'ふつう',   mistake: 0.08, risk: 0.8 },
    hard:   { label: 'つよい',   mistake: 0, risk: 1.0 },
  };

  const has = (u, k) => !u.muted && u.spec.keywords && u.spec.keywords.includes(k);
  const unitValue = (g, u) => Parts.usage(u.spec).total * 0.6 + g.powerOf(u) / 100 * 0.5;

  class AI {
    constructor(game, pi, level = 'normal') {
      this.g = game;
      this.pi = pi;
      this.L = LEVELS[level] || LEVELS.normal;
      game.players[pi].chooser = (req) => this.choose(req);
    }

    get me() { return this.g.players[this.pi]; }
    get op() { return this.g.opp(this.me); }

    /** 1手だけ進める。何かしたら true。自分の手番でなければ false */
    step() {
      const g = this.g;
      if (g.over || g.pending || g.active !== this.pi) return false;
      if (g.step === 'main') {
        if (this.playBest()) return true;
        g.toAttack(this.pi);
        return true;
      }
      if (this.attackBest()) return true;
      g.endTurn(this.pi);
      return true;
    }

    /** 自分の手番が終わるまで続ける（シミュレーター用） */
    playTurn() {
      let guard = 0;
      while (this.g.active === this.pi && !this.g.over && guard++ < 200) this.step();
    }

    // ───────────── メインステップ ─────────────
    playBest() {
      const g = this.g, me = this.me;
      let best = null;
      for (const c of me.hand) {
        if (!g.canPlay(this.pi, c.iid).ok) continue;
        let v = this.cardValue(c.spec);
        if (this.L.mistake && g.rand() < this.L.mistake) v *= g.rand();
        if (v > 0 && (!best || v > best.v)) best = { v, c };
      }
      // タップして発動する効果
      for (const u of me.field) {
        (u.spec.effects || []).forEach((e, i) => {
          if (!g.canActivate(this.pi, u.uid, i)) return;
          // 攻撃できるクリーチャーをタップするのは、効果の価値が攻撃より高い時だけ
          const v = this.effectValue(e, u) - (!has(u, 'slow') ? g.powerOf(u) / 200 : 0);
          if (v > 2 && (!best || v > best.v)) best = { v, act: [u.uid, i] };
        });
      }
      if (!best) return false;
      if (best.act) return g.activate(this.pi, best.act[0], best.act[1]);
      return g.play(this.pi, best.c.iid).ok;
    }

    /** カードを今使う価値 */
    cardValue(s) {
      const g = this.g, me = this.me;
      if (s.kind === 'creature') {
        let v = Parts.usage(s).total;
        // 場がいっぱいに近いなら控える
        if (me.field.length >= g.cfg.fieldLimit - 1) v *= 0.7;
        return v + 1;
      }
      let v = 0;
      for (const e of s.effects) v += this.effectValue(e, null);
      return v;
    }

    /** テキスト効果を今発動した時の価値の見積もり（対象がいない、意味がない時は0） */
    effectValue(e, source) {
      const g = this.g, me = this.me, op = this.op;
      const a = Parts.ACTIONS[e.act];
      const cond = Parts.CONDS[e.cond || 'none'];
      if (cond.test && !cond.test(g, me)) return 0;
      let base = Parts.effectPoints(e);
      if (a.side === 'enemy') {
        let pool = op.field.filter((u) => !has(u, 'ward'));
        if (a.filter && e.amt) pool = pool.filter((u) => g.powerOf(u) <= e.amt);
        if (!pool.length) return 0;
        const tg = Parts.TARGETS[e.tgt];
        const vals = pool.map((u) => unitValue(g, u)).sort((x, y) => y - x);
        const hit = tg.how === 'all' ? vals.reduce((s, x) => s + x, 0) : vals.slice(0, tg.n).reduce((s, x) => s + x, 0);
        if (e.act === 'tapEnemy') return pool.filter((u) => !u.tapped).length ? base * 0.8 : 0;
        if (e.act === 'weaken') return Math.min(base * 1.5, hit * 0.5);
        return Math.min(base * 1.5, hit);
      }
      if (a.side === 'ally') {
        const tg = Parts.TARGETS[e.tgt];
        const pool = tg.how === 'self' ? (source ? [source] : []) : me.field.slice();
        if (!pool.length) return 0;
        if (e.act === 'untap' && !pool.some((u) => u.tapped)) return 0;
        // このターンだけの強化は、攻撃できるクリーチャーがいる時だけ
        if (e.act === 'buffTurn' && !pool.some((u) => !u.tapped && !u.sick)) return 0;
        return base * Math.min(1, pool.length / (tg.how === 'all' ? 3 : 1));
      }
      switch (e.act) {
        case 'draw': return me.hand.length + e.amt > g.cfg.handLimit ? 0 : base;
        case 'rampMax': return me.maxMana >= g.cfg.maxManaCap ? 0 : base;
        case 'manaGain': return 0; // メインで使うと無駄になりやすい
        case 'heal': return me.hp < g.cfg.startHP - e.amt * 0.5 ? base * (me.hp < 2000 ? 2 : 1) : 0;
        case 'burn': return op.hp <= e.amt ? 999 : base;
        case 'discardOpp': return op.hand.length ? base : 0;
        case 'manaBurn': return op.maxMana > 1 ? base : 0;
        case 'spellLock': return op.hand.length >= 2 ? base : 0;
        case 'regrow': return me.grave.some((c) => c.spec.kind === 'creature') ? base : 0;
      }
      return base;
    }

    // ───────────── アタックステップ ─────────────
    attackBest() {
      const g = this.g, me = this.me, op = this.op;
      const attackers = me.field.filter((u) => g.canAttack(this.pi, u.uid));
      if (!attackers.length) return false;
      // 止めを刺せるなら本体へ
      const guards = op.field.filter((u) => has(u, 'guard') && !u.tapped);
      const total = attackers.reduce((s, u) => s + g.powerOf(u) * (u.attacks || 1), 0);
      const blockable = attackers.filter((u) => !has(u, 'stealth')).length;
      if (total >= op.hp && guards.length === 0) {
        const u = attackers.sort((a, b) => g.powerOf(b) - g.powerOf(a))[0];
        return g.attack(this.pi, u.uid, 'player');
      }
      let best = null;
      for (const u of attackers) {
        const pw = g.powerOf(u);
        // 攻撃するとタップして、相手のターンに狙われる。相手の場に自分より強いクリーチャーがいれば危ない
        // （相手が必ず狙うとは限らないので、危険は半分に見積もる）
        const threat = op.field.some((t) => g.powerOf(t) >= pw && !has(t, 'slow'));
        const risk = threat ? unitValue(g, u) * 0.5 * this.L.risk : 0;
        const guard = has(u, 'stealth') ? null : guards.reduce((a, b) => (!a || g.powerOf(b) > g.powerOf(a) ? b : a), null);
        // 攻撃すると相手が火種（マナ1つ分＝容量10ほど）を得る
        const emberCost = Math.min(g.cfg.emberPerAttack, g.cfg.emberCap - op.ember) * 10;
        for (const t of g.attackTargets(this.pi, u.uid)) {
          let v;
          const tgt = t === 'player' ? null : op.field.find((x) => x.uid === t);
          const vs = guard && guard !== tgt ? guard : tgt;
          // 相手に火種があれば、本体への攻撃はアンタップのクリーチャーにブロックされうる
          const canBlock = !tgt && !has(u, 'stealth') && g.cfg.emberBlockCost > 0 && op.ember >= g.cfg.emberBlockCost
            ? op.field.filter((b) => !b.tapped && (g.powerOf(b) >= pw || has(b, 'assassin'))) : [];
          if (!vs && canBlock.length) {
            v = -unitValue(g, u) * 0.8;
          } else if (!vs) {
            // ダメージの重み：パワー40につき1（容量の物差しと同じ）
            const dmg = pw;
            v = (dmg / 40) * (op.hp <= dmg * 2 ? 1.6 : 1.0) - risk;
            if (blockable && op.hp <= 1500) v += 10;
          } else {
            const pv = g.powerOf(vs);
            if (pw > pv || has(u, 'assassin')) v = unitValue(g, vs) * 1.2 - (pw > pv ? risk * 0.5 : unitValue(g, u)) + (has(u, 'pierce') && pw > pv ? (pw - pv) / 100 : 0);
            else if (pw === pv) v = unitValue(g, vs) - unitValue(g, u);
            else v = -unitValue(g, u);
          }
          v -= emberCost;
          if (!best || v > best.v) best = { v, u, t };
        }
      }
      if (!best || best.v <= 0) return false;
      return g.attack(this.pi, best.u.uid, best.t);
    }

    // ───────────── 選択への答え ─────────────
    choose(req) {
      const g = this.g, me = this.me;
      if (req.kind === 'confirm') {
        const pay = req.effect.pay;
        if (pay === 'life500' || pay === 'life1000') return me.hp > 2500;
        if (pay === 'discard1') return me.hand.length >= 3;
        if (pay === 'tapSelf') { const u = me.field.find((x) => x.uid === req.source); return !u || u.sick || g.step !== 'main' || has(u, 'slow') || this.effectValue({ ...req.effect, pay: 'none' }, u) > g.powerOf(u) / 150; }
        return true;
      }
      if (req.kind === 'discard') {
        // 一番安いカードを捨てる
        const opts = req.options.map((iid) => me.hand.find((c) => c.iid === iid)).filter(Boolean);
        opts.sort((a, b) => a.spec.cost - b.spec.cost);
        return opts.slice(0, req.min || 1).map((c) => c.iid);
      }
      if (req.kind === 'targets') {
        const units = req.options.map((uid) => g.findUnit(uid)).filter(Boolean);
        const act = req.effect && req.effect.act;
        const mine = units.length && units[0].owner === this.pi;
        let score;
        if (!mine) score = (u) => unitValue(g, u);
        else if (act === 'untap') score = (u) => (u.tapped ? 10 : 0) + g.powerOf(u) / 1000;
        else score = (u) => (!u.tapped && !u.sick ? 5 : 0) + g.powerOf(u) / 1000;
        units.sort((a, b) => score(b) - score(a));
        return units.slice(0, req.max).map((u) => u.uid);
      }
      if (req.kind === 'block') {
        const attacker = g.findUnit(req.attacker);
        if (!attacker) return [];
        const pa = g.powerOf(attacker);
        const units = req.options.map((uid) => g.findUnit(uid)).filter(Boolean);
        // 勝てる（または相打ちで済む）クリーチャーがいれば、一番安いものでブロック
        const win = units.filter((b) => g.powerOf(b) > pa || has(b, 'assassin')).sort((a, b) => unitValue(g, a) - unitValue(g, b))[0];
        if (win) return [win.uid];
        const tie = units.filter((b) => g.powerOf(b) === pa && unitValue(g, b) <= unitValue(g, attacker)).sort((a, b) => unitValue(g, a) - unitValue(g, b))[0];
        if (tie) return [tie.uid];
        // 負けるブロック（身代わり）は、ダメージが大きい時か、止めを刺されそうな時だけ
        const cheap = units.sort((a, b) => unitValue(g, a) - unitValue(g, b))[0];
        if (cheap && (pa >= me.hp || pa / 40 > unitValue(g, cheap) * 1.5)) return [cheap.uid];
        return [];
      }
      if (req.kind === 'react') {
        const attacker = g.findUnit(req.attacker);
        if (!attacker) return [];
        const pw = g.powerOf(attacker);
        // 体力への脅威が大きい、または強いクリーチャーの攻撃なら迎撃する
        const worth = pw >= 2500 || pw >= me.hp || unitValue(g, attacker) >= 30;
        if (!worth) return [];
        const c = req.options.map((iid) => me.hand.find((x) => x.iid === iid)).filter(Boolean)
          .sort((a, b) => Parts.usage(b.spec).total - Parts.usage(a.spec).total)[0];
        return c ? [c.iid] : [];
      }
      return req.options.slice(0, req.min || 1);
    }
  }

  // ───────────── オリジナルカードの生成 ─────────────
  const ICONS = ['🦊', '🦉', '🐍', '🦂', '🐙', '🦇', '🐲', '🦄', '🐺', '🦅', '🐢', '🦈', '👻', '🤖', '🧞', '🧜', '🌋', '🌊', '🌪️', '🔥', '❄️', '⚡', '🌙', '☀️', '🍄', '🌵', '💎', '🗝️', '📜', '🔮'];
  const NAME_A = ['紅蓮の', '蒼き', '黒鉄の', '月影の', '嵐の', '古の', '囁く', '燃える', '凍てつく', '星降る', '眠れる', '狂える', '白銀の', '翠の', '深淵の'];
  const NAME_C = ['狼', '騎士', '魔女', '番人', '大蛇', '巨人', '亡霊', '獅子', '射手', '僧兵', '竜', '人形', '魔像', '道化', '鷲'];
  const NAME_S = ['の嵐', 'の契約', 'の囁き', 'の楔', 'の祝福', 'の呪い', 'の雷', 'の鏡', 'の門', 'の炎'];

  /**
   * ランダムにオリジナルカードを作る（CPUのデッキ用・お試し用）。
   * opts.grade を省略すると素質も引く。容量に収まるように部品を足していく。
   */
  function forgeRandom(rand = Math.random, opts = {}) {
    const pick = (a) => a[Math.floor(rand() * a.length)];
    const grade = opts.grade || Parts.rollGrade(rand);
    const kind = opts.kind || (rand() < 0.7 ? 'creature' : 'spell');
    const cost = opts.cost || pick(kind === 'creature' ? [1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 7, 8] : [1, 2, 2, 3, 3, 4, 5, 6]);
    const cap = Parts.capacity(cost, grade);
    const spec = { name: '', icon: pick(ICONS), kind, cost, grade, keywords: [], effects: [] };
    if (kind === 'creature') {
      spec.name = pick(NAME_A) + pick(NAME_C);
      // 容量の5〜8割をパワーに
      const share = 0.5 + rand() * 0.3;
      let p = Math.floor((cap * share * 100) / Parts.POWER_STEP) * Parts.POWER_STEP;
      while (Parts.powerPoints(p) > cap * share && p > Parts.POWER_MIN) p -= Parts.POWER_STEP;
      spec.power = Math.max(Parts.POWER_MIN, Math.min(Parts.POWER_MAX, p));
    } else {
      spec.name = pick(NAME_A).replace(/の$/, '') + pick(NAME_S);
    }
    const opt = Parts.optionsFor(kind);
    const left = () => cap - Parts.usage(spec).total;
    // キーワードとテキスト効果を、入る限り試しに足す
    for (let tries = 0; tries < 40 && left() > 3; tries++) {
      if (kind === 'creature' && spec.keywords.length < Parts.MAX_KEYWORDS && rand() < 0.45) {
        const k = pick(opt.keywords.filter((x) => x.pts > 0)).id;
        if (spec.keywords.includes(k)) continue;
        spec.keywords.push(k);
        if (Parts.validate(spec).length) spec.keywords.pop();
        continue;
      }
      if (spec.effects.length >= Parts.MAX_EFFECTS) {
        if (kind === 'creature' && spec.keywords.length < Parts.MAX_KEYWORDS) continue;
        break;
      }
      // 呪文の効果は発動の場面をそろえる
      const trig = kind === 'spell' && spec.effects.length ? spec.effects[0].trig : pick(opt.triggers).id;
      const a = pick(opt.actions);
      const e = { trig, act: a.id, amt: pick(a.amounts), tgt: null, cond: rand() < 0.2 ? pick(opt.conds).id : 'none', pay: rand() < 0.15 ? pick(opt.pays).id : 'none' };
      const tgs = Parts.targetsFor(spec, e);
      if (a.side !== 'none') { if (!tgs.length) continue; e.tgt = pick(tgs).id; }
      spec.effects.push(e);
      if (Parts.validate(spec).length) spec.effects.pop();
    }
    if (kind === 'spell' && !spec.effects.length) {
      spec.effects.push({ trig: 'cast', act: 'draw', amt: 1, tgt: null, cond: 'none', pay: 'none' });
    }
    // 余った容量でパワーを上げる
    if (kind === 'creature') {
      while (spec.power + Parts.POWER_STEP <= Parts.POWER_MAX) {
        spec.power += Parts.POWER_STEP;
        if (Parts.validate(spec).length) { spec.power -= Parts.POWER_STEP; break; }
      }
    }
    return spec;
  }

  /**
   * CPUのデッキを作る：オリジナルカードを数種類（各2〜3枚）＋基本カード
   * 返り値は spec の配列（40枚）
   */
  function buildDeck(rand = Math.random, opts = {}) {
    const forgedKinds = opts.forged != null ? opts.forged : 6;
    const deck = [];
    for (let i = 0; i < forgedKinds; i++) {
      const s = forgeRandom(rand);
      s.id = 'cpu_' + i + '_' + Math.floor(rand() * 1e6);
      const n = 2 + Math.floor(rand() * 2);
      for (let k = 0; k < n; k++) deck.push(s);
    }
    // 基本カードはコストの低いものを多めに（マナカーブ）
    const pool = Cards.BASE.slice();
    const counts = {};
    let guard = 0;
    while (deck.length < 40 && guard++ < 2000) {
      const c = pool[Math.floor(rand() * pool.length)];
      const w = c.cost <= 3 ? 1 : c.cost <= 6 ? 0.6 : c.cost <= 10 ? 0.25 : 0.1;
      if (rand() > w || (counts[c.id] || 0) >= 3) continue;
      counts[c.id] = (counts[c.id] || 0) + 1;
      deck.push(c);
    }
    return deck;
  }

  return { AI, LEVELS, forgeRandom, buildDeck };
});
