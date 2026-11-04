/*
 * ai.js — CPU
 *
 *   ・対戦での行動（1手ずつ step() で進める。画面は間を空けて呼び、シミュレーターは続けて呼ぶ）
 *   ・選択への答え（choose）
 *   ・オリジナルカードの生成（forgeRandom）と、デッキ作り（buildDeck）
 *
 * カードの価値の見積もりには、基本的に「使った容量」をそのまま使う。
 * 容量はカードの強さの物差しとして作ってあるので、CPUもそれで比べられる。
 * テキスト効果は「今使って意味があるか」（対象がいるか、手札に空きがあるか…）だけを確かめて、容量の値で評価する。
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

  const unitValue = (g, u) => Math.max(1, Parts.usage(u.spec).total) * 0.6 + g.powerOf(u) / 100 * 0.5;
  const HARMFUL = ['destroy', 'exile', 'bounce', 'deckBottom', 'weaken', 'fight', 'tap', 'freeze', 'silence', 'steal'];

  class AI {
    constructor(game, pi, level = 'normal') {
      this.g = game;
      this.pi = pi;
      this.L = LEVELS[level] || LEVELS.normal;
      game.players[pi].chooser = (req) => this.choose(req);
    }

    get me() { return this.g.players[this.pi]; }
    get op() { return this.g.opp(this.me); }

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
      for (const u of me.field) {
        (u.spec.effects || []).forEach((e, i) => {
          if (!g.canActivate(this.pi, u.uid, i)) return;
          let v = this.effectValue(e, u, {});
          // タップが必要なら、攻撃の機会を失う分を引く
          if ((e.tapToo || (e.pay && e.pay.k === 'tapSelf')) && !g.hasKw(u, 'slow')) v -= g.powerOf(u) / 120;
          v -= this.payPenalty(e.pay, u);
          if (v > 3 && (!best || v > best.v)) best = { v, act: [u.uid, i] };
        });
      }
      if (!best) return false;
      if (best.act) return g.activate(this.pi, best.act[0], best.act[1]);
      return g.play(this.pi, best.c.iid).ok;
    }

    cardValue(s) {
      const g = this.g, me = this.me;
      if (s.kind === 'creature') {
        let v = Math.max(1, Parts.usage(s).total);
        if (me.field.length >= g.cfg.fieldLimit - 1) v *= 0.7;
        // 召喚時の効果が無駄にならないか（対象がいない除去など）は少しだけ考える
        for (const e of s.effects || []) if (e.trig === 'summon' && this.effectValue(e, null, {}) <= 0 && Parts.effectPoints(e) > 0) v -= Parts.effectPoints(e) * 0.7;
        return v + 1;
      }
      if (g._spellTiming(s) !== 'main') return 0;
      let v = 0;
      for (const e of s.effects) v += this.effectValue(e, null, {});
      return v;
    }

    /** 代償を払う重さ（容量の目安） */
    payPenalty(pay, source) {
      if (!pay || pay.k === 'none') return 0;
      const g = this.g, me = this.me;
      switch (pay.k) {
        case 'mana': return pay.n * 2;
        case 'ember': return pay.n * 4;
        case 'discard': return pay.n * 6;
        case 'life': return pay.n / 100 * (me.hp < 3000 ? 3 : 1);
        case 'sacSelf': return source ? unitValue(g, source) : 10;
        case 'sacAlly': { const w = me.field.filter((u) => u !== source).sort((a, b) => unitValue(g, a) - unitValue(g, b))[0]; return w ? unitValue(g, w) : 99; }
        case 'exileGrave': return 1;
        case 'tapSelf': return source ? g.powerOf(source) / 120 : 0;
      }
      return 0;
    }

    /** テキスト効果を今発動した時の価値の見積もり */
    effectValue(e, source, ctx) {
      const g = this.g, me = this.me, op = this.op;
      const a = Parts.ACTIONS[e.act];
      if (!a || e.trig === 'static') return 0;
      if (!g._condsOk(me, source, e)) return 0;
      const tm = (Parts.TRIGGERS[e.trig] || { mult: 1 }).mult;
      let base = Parts.effectPoints({ ...e, pay: { k: 'none', n: 0 }, lim: 'turn1' }) / tm;
      if (a.per && e.per && e.per !== 'none') base = base / Parts.PERS[e.per].mult * g.perCount(me, source, e.per);
      if (a.side !== 'none') {
        const pool = g.targetPool(me, source, e, ctx);
        if (!pool.length) return 0;
        const harmful = HARMFUL.includes(e.act);
        if (harmful) {
          const enemies = pool.filter((u) => u.owner !== this.pi);
          if (!enemies.length) return 0;
          const vals = enemies.map((u) => unitValue(g, u)).sort((x, y) => y - x);
          const t = e.tgt || {};
          const n = t.count === 'all' ? vals.length : Number(t.count || 1);
          let hit = vals.slice(0, n).reduce((s, x) => s + x, 0);
          // 敵味方問わず全てなら、自分の分を差し引く
          if (t.count === 'all' && t.who === 'any') hit -= pool.filter((u) => u.owner === this.pi).reduce((s, u) => s + unitValue(g, u), 0);
          if (e.act === 'tap' || e.act === 'freeze') hit = enemies.filter((u) => !u.tapped).length ? hit * 0.3 : 0;
          if (e.act === 'weaken' && (!e.dur || e.dur === 'turn')) hit *= 0.5;
          if (e.act === 'steal' && me.field.length >= g.cfg.fieldLimit) return 0;
          return Math.min(base * 1.5, hit);
        }
        if (e.act === 'untap' && !pool.some((u) => u.tapped)) return 0;
        if ((e.act === 'buff' || e.act === 'grantKw') && (!e.dur || e.dur === 'turn') && !pool.some((u) => !u.tapped && !u.sick)) return base * 0.2;
        if (e.act === 'extraAttack' && g.step !== 'main') return base * 0.5;
        return base;
      }
      // メタ効果：相手に使えるものがある時だけ（効き目は相手次第なので、少し低めに見積もる）
      if (Parts.META[e.act]) {
        const attackish = ['attackLock', 'attackLimit'].includes(e.act);
        const relevant = attackish ? op.field.length : op.hand.length;
        if (g.metaOn(op).some((r) => r.k === e.act && r.n === e.n)) return 0; // もう掛かっている
        return relevant >= 2 ? base * 0.7 : relevant ? base * 0.3 : 0;
      }
      switch (e.act) {
        case 'draw': case 'loot': return me.hand.length + e.n > g.cfg.handLimit || g.metaOn(me).some((r) => r.k === 'drawLock') ? 0 : base;
        case 'discardSelf': return -6 * e.n;
        case 'selfDamage': return -e.n / 100;
        case 'rampMax': return me.maxMana >= g.cfg.maxManaCap ? 0 : base;
        case 'manaGain': return me.hand.some((c) => g.costOf(me, c.spec) > me.mana && g.costOf(me, c.spec) <= me.mana + e.n) ? base : 0;
        case 'costDown': return me.hand.length >= 2 ? base * 0.6 : 0;
        case 'heal': return me.hp < g.cfg.startHP - e.n * 0.5 ? base * (me.hp < 3000 ? 2 : 1) : 0;
        case 'burn': case 'drainLife': return op.hp <= e.n * (e.per && e.per !== 'none' ? g.perCount(me, source, e.per) : 1) ? 999 : base;
        case 'burnBoth': return me.hp > op.hp + e.n ? base : 0;
        case 'oppDiscard': case 'oppDiscardPick': return op.hand.length ? base : 0;
        case 'manaBurn': return op.maxMana > 1 ? base : 0;
        case 'emberGain': return me.ember < g.cfg.emberCap ? base : 0;
        case 'emberBurn': return op.ember ? base : 0;
        case 'negate': case 'negateLE': return 0;
        case 'regrow': return me.grave.some((c) => c.spec.kind === 'creature') ? base : 0;
        case 'regrowAny': return me.grave.length ? base : 0;
        case 'searchCreature': return me.deck.some((c) => c.spec.kind === 'creature' && c.spec.cost <= e.n) ? base : 0;
        case 'searchSpell': return me.deck.some((c) => c.spec.kind === 'spell' && c.spec.cost <= e.n) ? base : 0;
        case 'reanimate': return me.field.length < g.cfg.fieldLimit && me.grave.some((c) => c.spec.kind === 'creature' && c.spec.cost <= e.n) ? base : 0;
        case 'cheatHand': return me.field.length < g.cfg.fieldLimit && me.hand.some((c) => c.spec.kind === 'creature' && c.spec.cost <= e.n) ? base : 0;
        case 'token': case 'topSummon': return me.field.length < g.cfg.fieldLimit ? base : 0;
        case 'negate': return 0;
      }
      return base;
    }

    // ───────────── アタックステップ ─────────────
    attackBest() {
      const g = this.g, me = this.me, op = this.op;
      const attackers = me.field.filter((u) => g.canAttack(this.pi, u.uid));
      if (!attackers.length) return false;
      const guards = op.field.filter((u) => g.hasKw(u, 'guard') && !u.tapped);
      const total = attackers.reduce((s, u) => s + g.powerOf(u) * (u.attacks || 1), 0);
      const blockable = attackers.filter((u) => !g.hasKw(u, 'stealth')).length;
      if (total >= op.hp && guards.length === 0 && op.ember < g.cfg.emberBlockCost) {
        const u = attackers.sort((a, b) => g.powerOf(b) - g.powerOf(a))[0];
        return g.attack(this.pi, u.uid, 'player');
      }
      let best = null;
      for (const u of attackers) {
        const pw = g.powerOf(u);
        const threat = op.field.some((t) => g.powerOf(t) >= pw && !g.hasKw(t, 'slow'));
        const risk = threat ? unitValue(g, u) * 0.5 * this.L.risk : 0;
        const guard = g.hasKw(u, 'stealth') ? null : guards.reduce((a, b) => (!a || g.powerOf(b) > g.powerOf(a) ? b : a), null);
        const emberCost = Math.min(g.cfg.emberPerAttack, g.cfg.emberCap - op.ember) * 10;
        for (const t of g.attackTargets(this.pi, u.uid)) {
          let v;
          const tgt = t === 'player' ? null : op.field.find((x) => x.uid === t);
          const vs = guard && guard !== tgt ? guard : tgt;
          const canBlock = !tgt && !g.hasKw(u, 'stealth') && g.cfg.emberBlockCost > 0 && op.ember >= g.cfg.emberBlockCost
            ? op.field.filter((b) => !b.tapped && (g.powerOf(b) >= pw || g.hasKw(b, 'assassin'))) : [];
          if (!vs && canBlock.length) {
            v = -unitValue(g, u) * 0.8;
          } else if (!vs) {
            const dmg = pw;
            v = (dmg / 40) * (op.hp <= dmg * 2 ? 1.6 : 1.0) - risk;
            if (blockable && op.hp <= 1500) v += 10;
          } else {
            const pv = g.powerOf(vs);
            const ass = g.hasKw(u, 'assassin');
            if (pw > pv || ass) v = unitValue(g, vs) * 1.2 - (pw > pv ? risk * 0.5 : unitValue(g, u)) + (g.hasKw(u, 'pierce') && pw > pv ? (pw - pv) / 100 : 0);
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
        const src = req.source != null ? g.findUnit(req.source) : null;
        const v = this.effectValue({ ...req.effect, pay: { k: 'none', n: 0 } }, src, {});
        const pay = req.effect.pay;
        if (pay.k === 'life' && me.hp <= pay.n + 2000) return false;
        if (pay.k === 'tapSelf' && src && !src.sick && !src.tapped && g.step === 'main' && g.active === this.pi && !g.hasKw(src, 'slow')) return v > g.powerOf(src) / 100;
        return v > this.payPenalty(pay, src);
      }
      if (req.kind === 'discard') {
        const opts = req.options.map((iid) => me.hand.find((c) => c.iid === iid)).filter(Boolean);
        opts.sort((a, b) => a.spec.cost - b.spec.cost);
        return opts.slice(0, req.min || 1).map((c) => c.iid);
      }
      if (req.kind === 'pickCard') {
        // 自分のためなら一番重い（強い）カード、相手の手札なら一番重いカードを捨てさせる
        const idx = req.cards.map((c, i) => i).sort((a, b) => req.cards[b].cost - req.cards[a].cost);
        if (req.zone === 'grave' || req.zone === 'hand') {
          const room = me.mana + me.ember;
          idx.sort((a, b) => (req.cards[b].cost <= room ? 1 : 0) - (req.cards[a].cost <= room ? 1 : 0) || req.cards[b].cost - req.cards[a].cost);
        }
        return idx.slice(0, req.max).map((i) => req.options[i]);
      }
      if (req.kind === 'targets') {
        const units = req.options.map((uid) => g.findUnit(uid)).filter(Boolean);
        if (req.cost) return units.sort((a, b) => unitValue(g, a) - unitValue(g, b)).slice(0, 1).map((u) => u.uid);
        const act = req.effect && req.effect.act;
        const harmful = HARMFUL.includes(act);
        const score = (u) => {
          const mine = u.owner === this.pi;
          if (harmful) return mine ? -unitValue(g, u) : unitValue(g, u);
          if (act === 'untap' || act === 'extraAttack') return (u.tapped ? 10 : 0) + g.powerOf(u) / 1000 + (mine ? 0 : -50);
          if (act === 'bounce') return mine ? (Parts.usage(u.spec).total) : -50;
          return (mine ? 0 : -50) + (!u.tapped && !u.sick ? 5 : 0) + g.powerOf(u) / 1000;
        };
        units.sort((a, b) => score(b) - score(a));
        return units.slice(0, req.max).map((u) => u.uid);
      }
      if (req.kind === 'react') {
        const attacker = g.findUnit(req.attacker);
        if (!attacker) return [];
        const pw = g.powerOf(attacker);
        const worth = pw >= 2500 || pw >= me.hp || unitValue(g, attacker) >= 30;
        if (!worth) return [];
        const c = req.options.map((iid) => me.hand.find((x) => x.iid === iid)).filter(Boolean)
          .sort((a, b) => Parts.usage(b.spec).total - Parts.usage(a.spec).total)[0];
        return c ? [c.iid] : [];
      }
      if (req.kind === 'counter') {
        const sp = req.spell;
        const v = Parts.usage(sp).total;
        const lethal = (sp.effects || []).some((e) => (e.act === 'burn' || e.act === 'drainLife') && e.n >= me.hp);
        const opts = req.options.map((iid) => me.hand.find((x) => x.iid === iid)).filter(Boolean);
        const negater = opts.find((c) => c.spec.effects.some((e) => e.act === 'negate' || (e.act === 'negateLE' && sp.cost <= e.n)));
        if (negater && (v >= 22 || lethal)) return [negater.iid];
        const other = opts.find((c) => !c.spec.effects.some((e) => e.act === 'negate' || e.act === 'negateLE'));
        return other && Parts.usage(other.spec).total > 10 ? [other.iid] : [];
      }
      if (req.kind === 'block') {
        const attacker = g.findUnit(req.attacker);
        if (!attacker) return [];
        const pa = g.powerOf(attacker);
        const units = req.options.map((uid) => g.findUnit(uid)).filter(Boolean);
        const win = units.filter((b) => g.powerOf(b) > pa || g.hasKw(b, 'assassin')).sort((a, b) => unitValue(g, a) - unitValue(g, b))[0];
        if (win) return [win.uid];
        const tie = units.filter((b) => g.powerOf(b) === pa && unitValue(g, b) <= unitValue(g, attacker)).sort((a, b) => unitValue(g, a) - unitValue(g, b))[0];
        if (tie) return [tie.uid];
        const cheap = units.sort((a, b) => unitValue(g, a) - unitValue(g, b))[0];
        if (cheap && (pa >= me.hp || pa / 40 > unitValue(g, cheap) * 1.5)) return [cheap.uid];
        return [];
      }
      return (req.options || []).slice(0, req.min || 1);
    }
  }

  // ───────────── オリジナルカードの生成 ─────────────
  const ICONS = ['🦊', '🦉', '🐍', '🦂', '🐙', '🦇', '🐲', '🦄', '🐺', '🦅', '🐢', '🦈', '👻', '🤖', '🧞', '🧜', '🌋', '🌊', '🌪️', '🔥', '❄️', '⚡', '🌙', '☀️', '🍄', '🌵', '💎', '🗝️', '📜', '🔮'];
  const NAME_A = ['紅蓮の', '蒼き', '黒鉄の', '月影の', '嵐の', '古の', '囁く', '燃える', '凍てつく', '星降る', '眠れる', '狂える', '白銀の', '翠の', '深淵の'];
  const NAME_C = ['狼', '騎士', '魔女', '番人', '大蛇', '巨人', '亡霊', '獅子', '射手', '僧兵', '竜', '人形', '魔像', '道化', '鷲'];
  const NAME_S = ['の嵐', 'の契約', 'の囁き', 'の楔', 'の祝福', 'の呪い', 'の雷', 'の鏡', 'の門', 'の炎'];

  /** テキスト効果を1つ、文法に沿ってランダムに作る（規則違反なら null） */
  function randomEffect(spec, rand, trigFixed) {
    const pick = (a) => a[Math.floor(rand() * a.length)];
    const opt = Parts.optionsFor(spec.kind);
    const trig = trigFixed || pick(opt.triggers).id;
    const t = Parts.TRIGGERS[trig];
    const acts = opt.actions.filter((a) => (!a.trig || a.trig === trig) && (t.static ? (a.statik || a.statikOnly) : !a.statikOnly));
    if (!acts.length) return null;
    const a = pick(acts);
    const e = { trig, act: a.id, n: a.ns ? pick(a.ns) : 0, conds: [], pay: { k: 'none', n: 0 }, per: 'none' };
    if (t.rep && !t.static) e.lim = pick(['turn1', 'turn1', 'turn1', 'turn2', 'game1']);
    if (a.dur) e.dur = a.durs ? pick(a.durs) : t.static ? 'perm' : pick(['turn', 'turn', 'untilNext', 'perm']);
    if (a.kw) e.kw = pick(Object.keys(Parts.KEYWORDS).filter((k) => Parts.KEYWORDS[k].pts > 0));
    if (e.act === 'token') { e.tp = pick([500, 1000, 1500, 2000]); if (rand() < 0.6) delete e.kw; }
    if (Parts.unitAction(a)) {
      const whos = Parts.whosFor(spec, e);
      if (!whos.length) return null;
      const who = pick(whos).id;
      const counts = t.static ? ['all'] : a.counts || ['1', '1', '1', '2', 'all'];
      const count = Parts.WHO[who].self ? 1 : pick(counts);
      const f = t.static ? 'none' : rand() < 0.3 ? pick(['powerLE', 'tapped', 'costLE', 'untapped']) : 'none';
      e.tgt = { who, count: count === 'all' ? 'all' : Number(count), how: pick(['choose', 'choose', 'random', 'strongest']), f, fn: Parts.FILTERS[f].ns[0] };
      if (f !== 'none') e.tgt.fn = pick(Parts.FILTERS[f].ns);
    }
    if (a.per && rand() < 0.15) e.per = pick(Object.keys(Parts.PERS).filter((k) => k !== 'none' && (!Parts.PERS[k].kind || Parts.PERS[k].kind === spec.kind)));
    if (!t.static && rand() < 0.2) { const c = pick(opt.conds); e.conds.push({ k: c.id, n: pick(c.ns) }); }
    if (t.activated) { const c = pick(opt.costs.filter((x) => x.id !== 'none')); e.pay = { k: c.id, n: pick(c.ns) }; if (rand() < 0.4 && c.id !== 'tapSelf') e.tapToo = true; }
    else if (!t.static && rand() < 0.15) { const c = pick(opt.costs.filter((x) => x.id !== 'none')); e.pay = { k: c.id, n: pick(c.ns) }; }
    if (Parts.ACTIONS[e.act].pts(e) < 0) return null; // ランダム生成ではデメリット効果は作らない
    return Parts.effectErrors(spec, e).length ? null : e;
  }

  function forgeRandom(rand = Math.random, opts = {}) {
    const pick = (a) => a[Math.floor(rand() * a.length)];
    const grade = opts.grade || Parts.rollGrade(rand);
    const kind = opts.kind || (rand() < 0.7 ? 'creature' : 'spell');
    const cost = opts.cost || pick(kind === 'creature' ? [1, 2, 2, 3, 3, 3, 4, 4, 5, 5, 6, 7, 8] : [1, 2, 2, 3, 3, 4, 5, 6]);
    const cap = Parts.capacity(cost, grade);
    const spec = { name: '', icon: pick(ICONS), kind, cost, grade, keywords: [], effects: [] };
    if (kind === 'creature') {
      spec.name = pick(NAME_A) + pick(NAME_C);
      const share = 0.45 + rand() * 0.3;
      let p = Parts.POWER_MIN;
      while (p + Parts.POWER_STEP <= Parts.POWER_MAX && Parts.powerPoints(p + Parts.POWER_STEP) <= cap * share) p += Parts.POWER_STEP;
      spec.power = p;
    } else {
      spec.name = pick(NAME_A).replace(/の$/, '') + pick(NAME_S);
    }
    const left = () => cap - Parts.usage(spec).total;
    for (let tries = 0; tries < 60 && left() > 3; tries++) {
      if (kind === 'creature' && spec.keywords.length < Parts.MAX_KEYWORDS && rand() < 0.35) {
        const k = pick(Object.keys(Parts.KEYWORDS).filter((x) => Parts.KEYWORDS[x].pts > 0));
        if (spec.keywords.includes(k)) continue;
        spec.keywords.push(k);
        if (Parts.validate({ ...spec, name: 'x' }).length) spec.keywords.pop();
        continue;
      }
      if (spec.effects.length >= Parts.MAX_EFFECTS) { if (kind === 'spell') break; continue; }
      const e = randomEffect(spec, rand, kind === 'spell' && spec.effects.length ? spec.effects[0].trig : (kind === 'spell' ? pick(['cast', 'cast', 'cast', 'cast', 'react', 'counter']) : null));
      if (!e) continue;
      spec.effects.push(e);
      if (Parts.validate({ ...spec, name: 'x' }).length) spec.effects.pop();
    }
    if (kind === 'spell' && !spec.effects.length) spec.effects.push({ trig: 'cast', act: 'draw', n: 1, conds: [], pay: { k: 'none', n: 0 }, per: 'none' });
    if (kind === 'creature') {
      while (spec.power + Parts.POWER_STEP <= Parts.POWER_MAX) {
        spec.power += Parts.POWER_STEP;
        if (Parts.validate({ ...spec, name: 'x' }).length) { spec.power -= Parts.POWER_STEP; break; }
      }
    }
    return spec;
  }

  function buildDeck(rand = Math.random, opts = {}) {
    const forgedKinds = opts.forged != null ? opts.forged : 6;
    const deck = [];
    for (let i = 0; i < forgedKinds; i++) {
      const s = forgeRandom(rand);
      s.id = 'cpu_' + i + '_' + Math.floor(rand() * 1e6);
      const n = 2 + Math.floor(rand() * 2);
      for (let k = 0; k < n; k++) deck.push(s);
    }
    const pool = Cards.BASE.slice();
    const counts = {};
    let guard = 0;
    while (deck.length < 40 && guard++ < 3000) {
      const c = pool[Math.floor(rand() * pool.length)];
      const w = c.cost <= 3 ? 1 : c.cost <= 6 ? 0.6 : c.cost <= 10 ? 0.25 : 0.1;
      if (rand() > w || (counts[c.id] || 0) >= 3) continue;
      counts[c.id] = (counts[c.id] || 0) + 1;
      deck.push(c);
    }
    return deck;
  }

  return { AI, LEVELS, forgeRandom, buildDeck, randomEffect };
});
