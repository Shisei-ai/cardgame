/*
 * engine.js — ゲームのルール処理（画面表示とは完全に分離）
 *
 * ゲームは「時間」で進みます。update(dt) を呼ぶたびに dt 秒だけ時間が進み、
 *   ・詠唱中のカードの残り時間が減り、0になったら発動
 *   ・フェーズタイマーが0になったら次のフェーズ（マナ回復＋2枚ドロー＋フェーズ開始時の効果）
 *   ・試合時間が尽きたら体力の多い方が勝ち
 * という処理が行われます。
 *
 * ブラウザでは毎フレーム実時間で update を呼び、
 * バランス検証用シミュレーター（tools/simulate.js）では 0.1 秒刻みで高速に回します。
 *
 * ■ クリーチャーの能力（cards.js に書く「フック」）
 *   onSummon     召喚時（攻撃の前）          afterSummon  召喚時の攻撃の後
 *   onDeath      このクリーチャーが倒れた時（遺言）
 *   onAnyDeath   いずれかのクリーチャーが倒れた時
 *   onPhase      フェーズ開始時
 *   onAllyPlay   自分がカードを使った時       onEnemyPlay  相手がカードを使った時
 *   onBlock      守護としてクリーチャーの攻撃を受け止めた時
 *   onAllyDiscard 自分がカードを捨てた時
 *
 * ■ カード自体の能力
 *   onDiscard    このカードが手札から捨てられた時（狂気）
 *   sacCost      使うときに味方クリーチャーをこの数だけ破壊する（生贄）。弱い順（トークン優先）に自動で選ぶ
 *   noAttack     召喚時に攻撃しない（鈍重）
 *
 * ■ 守護は1フェーズに1回
 *   守護が攻撃を受け止められるのは、1フェーズにつき1回まで（フェーズ開始時に回復）。
 *   安いクリーチャーで守護を使わせ、その隙に本命を通す…という駆け引きのためのルール。
 *   auraAtk      場にいる間、他の味方の攻撃力を増やす数値
 *   auraCost     場にいる間、自分のカードのコストを補正する関数
 *   auraCast     場にいる間、自分のカードの詠唱時間に掛ける倍率を返す関数
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cards.js'));
  else root.Engine = factory(root.Cards);
})(typeof self !== 'undefined' ? self : this, function (Cards) {
  'use strict';

  // ── バランス調整の要となる数値はすべてここに集約 ──
  const CONFIG = {
    startHP: 30,        // 初期体力（＝最大体力）
    matchTime: 180,     // 試合の制限時間（秒）
    phaseTime: 10,      // 1フェーズの長さ（秒）
    startMana: 3,       // 最初のフェーズの最大マナ
    maxManaCap: 10,     // 最大マナの上限
    startHand: 5,       // 初期手札
    phaseDraw: 2,       // フェーズ開始時に引く枚数
    handLimit: 10,      // 手札上限（超えて引いたカードは墓地へ）
    fieldLimit: 5,      // 場に出せるクリーチャーの上限（満杯で召喚すると一番古い味方が倒れる）
    fatigue: 2,         // 山札切れで引こうとしたときのダメージ
    shieldCap: 10,      // 防壁の上限
    guardRetaliate: false, // 守護が攻撃を受け止めた時、攻撃してきたクリーチャーに反撃するか（反撃すると守護が強すぎた）
    deckSize: 40,       // デッキ枚数
    maxCopies: 4,       // 同名カードの上限枚数
  };

  // 再現性のある乱数（シードが同じなら同じ展開になる → バグ再現やテストに便利）
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // デッキが規定を満たしているか確認する。問題があればエラーメッセージの配列を返す
  function validateDeck(list, cfg = CONFIG) {
    const errors = [];
    if (list.length !== cfg.deckSize) errors.push(`デッキは${cfg.deckSize}枚ちょうどにしてください（現在${list.length}枚）`);
    const counts = {};
    list.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
    for (const id in counts) {
      const c = Cards.find(id);
      if (!c || c.token) { errors.push(`デッキに入れられないカードがあります（${id}）`); continue; }
      if (counts[id] > cfg.maxCopies) errors.push(`「${c.name}」が${cfg.maxCopies}枚を超えています`);
    }
    return errors;
  }

  const isSpell = (c) => c.type !== 'creature';

  class Game {
    /**
     * @param {object} opts
     *   decks : [カードID配列, カードID配列]
     *   names : ['あなた', 'CPU']
     *   seed  : 乱数シード（省略時はランダム）
     *   config: CONFIG の一部を上書き
     */
    constructor(opts) {
      this.cfg = Object.assign({}, CONFIG, opts.config || {});
      this.rand = mulberry32(opts.seed != null ? opts.seed : (Math.random() * 2 ** 32) >>> 0);
      this.time = 0;
      this.phase = 1;
      this.phaseTimer = this.cfg.phaseTime;
      this.over = false;
      this.winner = null;     // 0 / 1 / -1(引き分け)
      this.endReason = '';
      this.version = 0;       // 状態が変わるたびに増える。画面の再描画判定に使う
      this.logs = [];
      this.onEvent = null;    // 画面側が演出用に購読するコールバック
      this.uidSeq = 1;
      this._cleaning = false;
      this.players = [0, 1].map((i) => this._makePlayer(i, opts.decks[i], (opts.names || [])[i]));
      this.players.forEach((p) => {
        this._shuffle(p.deck);
        this.draw(p, this.cfg.startHand, true);
      });
      this.log('第1フェーズ開始', 'phase');
    }

    _makePlayer(index, deck, name) {
      return {
        index,
        name: name || (index === 0 ? 'プレイヤー1' : 'プレイヤー2'),
        hp: this.cfg.startHP,
        mana: this.cfg.startMana,
        maxMana: this.cfg.startMana,
        deck: [...deck],
        hand: [],
        field: [],
        grave: [],
        casting: null,      // { card, total, remain, start }
        silence: 0,         // 残り封印時間（秒）。カードを使えない
        stun: 0,            // 残り時間停止（秒）。カードを使えず、詠唱も止まる
        haste: 0,           // 残り加速時間（秒）。詠唱が2倍速
        curse: 0,           // 残り呪い時間（秒）。カードを使うと1ダメージ
        shield: 0,          // 防壁の残量
        instantNext: false, // 次に使うカードの詠唱時間が0
        spellDiscount: 0,   // 次に使う呪文のコスト軽減量
        spellsThisPhase: 0, // このフェーズに使った呪文の数
        lastSpell: null,    // 最後に使った呪文のID（秘術の模倣用）
        skipDraw: 0,        // 次のフェーズ開始時に引く枚数を減らす（禁断の知識など）
        manaDebt: 0,        // 次のフェーズ開始時に失うマナ（魔力の前借り）
        lastSacrificed: [], // 直前に生贄にしたクリーチャー（死の呼び手などが参照）
        stats: { damageDealt: 0, cardsPlayed: 0, countered: 0, played: {} },
      };
    }

    opp(p) { return this.players[1 - p.index]; }

    // ───────────── コスト・詠唱時間・攻撃力の計算 ─────────────
    /** 補正込みの実際のコスト */
    costOf(p, id) {
      const c = Cards.get(id);
      let cost = c.cost;
      if (c.costMod) cost += c.costMod(this, p);
      for (const u of p.field) {
        const d = Cards.get(u.id);
        if (d.auraCost) cost += d.auraCost(this, p, c);
      }
      if (isSpell(c) && p.spellDiscount) cost -= p.spellDiscount;
      return Math.max(0, cost);
    }

    /** 補正込みの実際の詠唱時間（秒） */
    castOf(p, id) {
      const c = Cards.get(id);
      if (c.cast <= 0 || p.instantNext) return 0;
      let t = c.cast;
      for (const u of p.field) {
        const d = Cards.get(u.id);
        if (d.auraCast) t *= d.auraCast(this, p, c);
      }
      return Math.round(t * 10) / 10;
    }

    /** オーラ込みの攻撃力 */
    atkOf(p, unit) {
      let a = unit.atk;
      for (const u of p.field) {
        if (u === unit) continue;
        const d = Cards.get(u.id);
        if (d.auraAtk) a += d.auraAtk;
      }
      return Math.max(0, a);
    }

    /** 今すぐ攻撃を受け止められる（このフェーズにまだ受け止めていない）守護 */
    readyGuards(p) { return p.field.filter((u) => u.guard && u.hp > 0 && !u.spent); }

    addShield(p, n) {
      p.shield = Math.min(this.cfg.shieldCap, p.shield + n);
      this._bump();
    }

    graveCreatures(p) { return p.grave.filter((id) => Cards.get(id).type === 'creature').length; }

    // ───────────── 時間の進行 ─────────────
    update(dt) {
      if (this.over) return;
      this.time += dt;

      for (const p of this.players) {
        for (const k of ['silence', 'stun', 'haste', 'curse']) {
          if (p[k] > 0) { p[k] = Math.max(0, p[k] - dt); if (p[k] === 0) this._bump(); }
        }
      }
      // 詠唱の進行（両者同時。同じ瞬間に完了した場合はプレイヤー番号順）
      for (const p of this.players) {
        if (!p.casting || p.stun > 0) continue;
        p.casting.remain -= dt * (p.haste > 0 ? 2 : 1);
        if (p.casting.remain <= 0) {
          const card = p.casting.card;
          p.casting = null;
          this._resolve(p, card);
          if (this.over) return;
        }
      }

      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) this._newPhase();

      if (!this.over && this.time >= this.cfg.matchTime) this._timeUp();
    }

    _newPhase() {
      this.phase++;
      this.phaseTimer += this.cfg.phaseTime;
      this.log(`第${this.phase}フェーズ開始`, 'phase');
      for (const p of this.players) {
        p.maxMana = Math.min(this.cfg.maxManaCap, p.maxMana + 1);
        p.mana = Math.max(p.mana, p.maxMana); // 余ったマナは持ち越さず最大値まで回復（雫などで超過している分は残す）
        if (p.manaDebt) {
          this.log(`${p.name}は前借りしたマナを${p.manaDebt}返済`, 'info', p.index);
          p.mana = Math.max(0, p.mana - p.manaDebt);
          p.manaDebt = 0;
        }
        p.spellsThisPhase = 0;
        p.field.forEach((u) => { u.spent = false; });
        const n = Math.max(0, this.cfg.phaseDraw - p.skipDraw);
        if (p.skipDraw) this.log(`${p.name}のドローが${this.cfg.phaseDraw - n}枚減った`, 'info', p.index);
        p.skipDraw = 0;
        this.draw(p, n);
      }
      // フェーズ開始時に誘発する能力
      for (const p of this.players) {
        for (const u of [...p.field]) {
          const d = Cards.get(u.id);
          if (d.onPhase && p.field.includes(u)) d.onPhase(this, p, this.opp(p), u);
        }
      }
      this._cleanup();
      this._emit({ type: 'phase', phase: this.phase });
      this._bump();
    }

    _timeUp() {
      const [a, b] = this.players;
      this.endReason = '時間切れ';
      this._finish(a.hp === b.hp ? -1 : a.hp > b.hp ? 0 : 1);
    }

    _finish(winner) {
      if (this.over) return;
      this.over = true;
      this.winner = winner;
      this.log(winner === -1 ? '引き分け！' : `${this.players[winner].name}の勝利！`, 'end');
      this._emit({ type: 'end', winner });
      this._bump();
    }

    _checkDeath() {
      const [a, b] = this.players;
      if (a.hp <= 0 || b.hp <= 0) {
        this.endReason = '体力0';
        this._finish(a.hp <= 0 && b.hp <= 0 ? -1 : a.hp <= 0 ? 1 : 0);
      }
    }

    // ───────────── カードの使用 ─────────────
    /** 手札の idx 番目のカードを今使えるか。{ok, reason} を返す */
    canPlay(pi, idx) {
      const p = this.players[pi];
      const id = p.hand[idx];
      if (this.over || id == null) return { ok: false, reason: '' };
      const c = Cards.get(id);
      if (p.stun > 0) return { ok: false, reason: '時間停止中' };
      if (p.silence > 0) return { ok: false, reason: '封印中' };
      if (p.mana < this.costOf(p, id)) return { ok: false, reason: 'マナ不足' };
      if (c.hpCost && p.hp <= c.hpCost) return { ok: false, reason: '体力不足' };
      if (c.sacCost && p.field.length < c.sacCost) return { ok: false, reason: `生贄が${c.sacCost}体必要` };
      if (this.castOf(p, id) > 0 && p.casting) return { ok: false, reason: '詠唱中' };
      if (c.canUse && !c.canUse(this, p, this.opp(p))) return { ok: false, reason: c.needText || '条件未達' };
      return { ok: true, reason: '' };
    }

    play(pi, idx) {
      const chk = this.canPlay(pi, idx);
      if (!chk.ok) return chk;
      const p = this.players[pi];
      const op = this.opp(p);
      const id = p.hand[idx];
      const c = Cards.get(id);
      // コストと詠唱時間は手札から取り除く前に確定させる
      const cost = this.costOf(p, id);
      const cast = this.castOf(p, id);
      p.hand.splice(idx, 1);
      p.mana -= cost;
      if (c.hpCost) this.loseLife(p, c.hpCost, `【${c.name}】の代償`);
      if (c.sacCost) this._paySacrifice(p, c);
      // 「次に使う〜」系の効果を消費
      p.instantNext = false;
      if (isSpell(c)) {
        p.spellDiscount = 0;
        p.spellsThisPhase++;
        if (!c.noCopy) p.lastSpell = c.id;
      }
      p.stats.cardsPlayed++;
      p.stats.played[id] = (p.stats.played[id] || 0) + 1;

      if (cast > 0) {
        p.casting = { card: c, total: cast, remain: cast, start: this.time };
        this.log(`${p.name}：【${c.name}】詠唱開始`, 'cast', p.index);
      } else {
        this.log(`${p.name}：【${c.name}】${c.cast > 0 ? '（即時詠唱）' : '（瞬間）'}`, 'play', p.index);
      }
      this._emit({ type: 'play', player: p.index, card: c, instant: cast <= 0 });

      // 「カードを使った時」に誘発する能力
      for (const u of [...p.field]) { const d = Cards.get(u.id); if (d.onAllyPlay) d.onAllyPlay(this, p, op, u, c); }
      for (const u of [...op.field]) { const d = Cards.get(u.id); if (d.onEnemyPlay) d.onEnemyPlay(this, op, p, u, c); }
      this._cleanup();
      if (p.curse > 0) this.damagePlayer(p, 1, '呪いの刻印');

      if (cast <= 0 && !this.over) this._resolve(p, c);
      this._bump();
      return chk;
    }

    _resolve(p, c) {
      const op = this.opp(p);
      if (c.type === 'creature') {
        this.summon(p, c.id);
      } else {
        if (c.cast > 0) this.log(`${p.name}：【${c.name}】発動`, 'resolve', p.index);
        c.effect(this, p, op);
        p.grave.push(c.id);
      }
      this._emit({ type: 'resolve', player: p.index, card: c });
      this._cleanup();
      this._checkDeath();
      this._bump();
    }

    // ───────────── カード効果から呼ばれる基本操作 ─────────────
    /**
     * クリーチャーを場に出す。
     * opts.attack: false にすると召喚時の攻撃をしない（トークン生成などで使用）
     */
    summon(p, id, opts = {}) {
      if (this.over) return null;
      const c = Cards.get(id);
      const op = this.opp(p);
      if (p.field.length >= this.cfg.fieldLimit) {
        // トークンは場が満杯なら生成されない
        if (c.token) return null;
        // 場が満杯なら、一番古い味方が場を譲って倒れる（遺言も誘発する）
        const oldest = p.field[0];
        oldest.hp = 0;
        oldest.undying = false;
        this.log(`場が満杯のため、${oldest.name}が場を譲った`, 'info', p.index);
        this._cleanup();
        if (p.field.length >= this.cfg.fieldLimit) return null; // 遺言でまた埋まった場合
      }
      const unit = {
        uid: this.uidSeq++, id: c.id, name: c.name, icon: c.icon,
        atk: c.atk, hp: c.hp, maxHp: c.hp,
        guard: !!c.guard, stealth: !!c.stealth, lifesteal: !!c.lifesteal,
        double: !!c.double, undying: !!c.undying, armor: c.armor || 0, pierce: !!c.pierce, token: !!c.token,
        spent: false, // 守護がこのフェーズに既に攻撃を受け止めたか
      };
      p.field.push(unit);
      this.log(`${p.name}：【${c.name}】${c.token ? '生成' : '召喚'}`, 'resolve', p.index);
      this._emit({ type: 'summon', player: p.index, unit });
      if (c.onSummon) c.onSummon(this, p, op, unit);
      if (opts.attack !== false && !c.noAttack) {
        this.attack(p, unit);
        if (unit.double) this.attack(p, unit);
      }
      if (c.afterSummon && p.field.includes(unit)) c.afterSummon(this, p, op, unit);
      this._cleanup();
      this._bump();
      return unit;
    }

    /** クリーチャー unit で攻撃する。敵に守護がいればそちらが受け止める */
    attack(p, unit) {
      if (this.over || !p.field.includes(unit) || unit.hp <= 0) return;
      const op = this.opp(p);
      const atk = this.atkOf(p, unit);
      let target = null;
      if (!unit.stealth) {
        const guards = this.readyGuards(op);
        if (guards.length) target = guards.reduce((a, b) => (b.hp > a.hp ? b : a));
      }
      if (target) {
        // 守護が受け止められるのは1フェーズに1回まで
        target.spent = true;
        // クリーチャー同士は互いに攻撃力分のダメージを与え合う
        const overflow = atk - (target.armor || 0) - Math.max(0, target.hp);
        this._hitUnit(target, atk);
        if (this.cfg.guardRetaliate) this._hitUnit(unit, this.atkOf(op, target));
        this.log(`${unit.name}(${atk}) → 守護 ${target.name}`, 'attack', p.index);
        if (unit.lifesteal) this.heal(p, atk);
        this._emit({ type: 'attack', player: p.index, unit, target });
        const td = Cards.get(target.id);
        if (td.onBlock) td.onBlock(this, op, p, target, unit);
        // 貫通：守護を倒してなお余ったダメージは本体へ
        if (unit.pierce && overflow > 0) this.damagePlayer(op, overflow, unit.name + '（貫通）');
        this._cleanup();
      } else {
        this._emit({ type: 'attack', player: p.index, unit, target: null });
        const dealt = this.damagePlayer(op, atk, unit.name);
        if (unit.lifesteal && dealt > 0) this.heal(p, dealt);
      }
      this._bump();
    }

    /** プレイヤー本体へのダメージ。防壁で軽減された後、実際に与えたダメージを返す */
    damagePlayer(target, amount, src) {
      if (this.over || amount <= 0) return 0;
      const absorbed = Math.min(target.shield, amount);
      target.shield -= absorbed;
      const dealt = amount - absorbed;
      target.hp -= dealt;
      this.opp(target).stats.damageDealt += dealt;
      this.log(`${src} → ${target.name}に${dealt}ダメージ${absorbed ? `（防壁で${absorbed}軽減）` : ''}`, 'damage', 1 - target.index);
      this._emit({ type: 'damage', player: target.index, amount: dealt, absorbed });
      this._checkDeath();
      this._bump();
      return dealt;
    }

    /** 体力を失う（防壁で防げない。体力コストや自傷効果） */
    loseLife(p, amount, src) {
      if (this.over || amount <= 0) return;
      p.hp -= amount;
      this.log(`${src}：${p.name}は体力を${amount}失った`, 'damage', p.index);
      this._emit({ type: 'damage', player: p.index, amount, absorbed: 0 });
      this._checkDeath();
      this._bump();
    }

    _hitUnit(unit, amount) {
      const n = Math.max(0, amount - (unit.armor || 0));
      unit.hp -= n;
      return n;
    }

    damageUnit(owner, unit, amount) {
      this._hitUnit(unit, amount);
      this._emit({ type: 'unitDamage', player: owner.index, unit, amount });
      this._cleanup();
    }

    destroyUnit(owner, unit) {
      unit.hp = 0;
      this.log(`${unit.name}は破壊された`, 'info', owner.index);
      this._cleanup();
    }

    buff(unit, atk, hp) {
      unit.atk += atk;
      unit.hp += hp;
      unit.maxHp += hp;
      this._bump();
    }

    heal(p, amount) {
      const before = p.hp;
      p.hp = Math.min(this.cfg.startHP, p.hp + amount);
      if (p.hp > before) {
        this.log(`${p.name}の体力が${p.hp - before}回復`, 'heal', p.index);
        this._emit({ type: 'heal', player: p.index, amount: p.hp - before });
      }
      this._bump();
    }

    draw(p, n, silent) {
      for (let i = 0; i < n; i++) {
        if (p.deck.length === 0) {
          if (!silent) this.log(`${p.name}の山札が尽きている！`, 'info', p.index);
          this.damagePlayer(p, this.cfg.fatigue, '山札切れ');
          continue;
        }
        const id = p.deck.pop();
        if (p.hand.length >= this.cfg.handLimit) {
          p.grave.push(id);
          this.log(`手札が上限のため【${Cards.get(id).name}】は焼失`, 'info', p.index);
        } else {
          p.hand.push(id);
        }
      }
      this._bump();
    }

    /** 山札の上から n 枚を墓地へ */
    mill(p, n) {
      const moved = [];
      for (let i = 0; i < n && p.deck.length; i++) { const id = p.deck.pop(); p.grave.push(id); moved.push(Cards.get(id).name); }
      if (moved.length) this.log(`${p.name}の山札から墓地へ：${moved.join('、')}`, 'info', p.index);
      this._bump();
    }

    /** 墓地のクリーチャーを復活させる。mode: 'random' | 'highest'（最もコストが高いもの） */
    reviveFromGrave(p, mode = 'random') {
      const idxs = p.grave.map((id, i) => i).filter((i) => Cards.get(p.grave[i]).type === 'creature');
      if (!idxs.length) return null;
      let pick;
      if (mode === 'highest') pick = idxs.reduce((a, b) => (Cards.get(p.grave[b]).cost > Cards.get(p.grave[a]).cost ? b : a));
      else pick = idxs[Math.floor(this.rand() * idxs.length)];
      const id = p.grave.splice(pick, 1)[0];
      this.log(`${p.name}：墓地から【${Cards.get(id).name}】が蘇る`, 'resolve', p.index);
      return this.summon(p, id);
    }

    /** 墓地からランダムなカードを n 枚手札に戻す */
    returnFromGrave(p, n, filter = () => true) {
      for (let i = 0; i < n; i++) {
        const idxs = p.grave.map((id, j) => j).filter((j) => filter(Cards.get(p.grave[j])));
        if (!idxs.length || p.hand.length >= this.cfg.handLimit) break;
        const id = p.grave.splice(idxs[Math.floor(this.rand() * idxs.length)], 1)[0];
        p.hand.push(id);
        this.log(`${p.name}：墓地から【${Cards.get(id).name}】を手札へ`, 'info', p.index);
      }
      this._bump();
    }

    /** カードをコスト・詠唱なしで直ちに使う（手札からは呼び出し側で取り除くこと） */
    playFree(p, id) {
      const c = Cards.get(id);
      this.log(`${p.name}：【${c.name}】をコストなしで発動`, 'resolve', p.index);
      if (c.type === 'creature') {
        this.summon(p, id);
      } else {
        c.effect(this, p, this.opp(p));
        p.grave.push(id);
      }
      this._cleanup();
    }

    addMana(p, n) {
      p.mana = Math.max(0, p.mana + n);
      this._bump();
    }

    silence(p, sec) {
      p.silence = Math.max(p.silence, sec);
      this.log(`${p.name}は${sec}秒間封印された`, 'info', p.index);
      this._bump();
    }

    stunPlayer(p, sec) {
      p.stun = Math.max(p.stun, sec);
      this.log(`${p.name}の時間が${sec}秒間停止した`, 'info', p.index);
      this._bump();
    }

    curse(p, sec) {
      p.curse = sec;
      this.log(`${p.name}は${sec}秒間呪われた`, 'info', p.index);
      this._bump();
    }

    cancelCasting(target, by) {
      if (!target.casting) return null;
      const c = target.casting.card;
      target.casting = null;
      target.grave.push(c.id);
      by.stats.countered++;
      this.log(`【${c.name}】は打ち消された！`, 'counter', target.index);
      this._emit({ type: 'counter', player: target.index, card: c });
      this._bump();
      return c;
    }

    delayCasting(target, sec) {
      if (!target.casting) return;
      target.casting.remain += sec;
      target.casting.total += sec;
      this.log(`【${target.casting.card.name}】の詠唱が${sec}秒遅延`, 'info', target.index);
      this._bump();
    }

    /**
     * 手札の idx 番目を捨てる。全ての「捨てる」効果はここを通る。
     * 捨てたカードの【狂気】（onDiscard）や、場の「捨てた時」の能力を誘発する。
     */
    discard(p, idx) {
      const id = p.hand.splice(idx, 1)[0];
      if (id == null) return null;
      const c = Cards.get(id);
      p.grave.push(id);
      this.log(`${p.name}は【${c.name}】を捨てた`, 'info', p.index);
      this._emit({ type: 'discard', player: p.index, card: c });
      const op = this.opp(p);
      for (const u of [...p.field]) { const d = Cards.get(u.id); if (d.onAllyDiscard) d.onAllyDiscard(this, p, op, u, c); }
      if (c.onDiscard) c.onDiscard(this, p, op);
      this._cleanup();
      this._bump();
      return c;
    }

    /** 手札からランダムに n 枚捨てる。捨てたカードの配列を返す */
    discardRandom(p, n) {
      const out = [];
      for (let i = 0; i < n && p.hand.length; i++) {
        const c = this.discard(p, Math.floor(this.rand() * p.hand.length));
        if (c) out.push(c);
      }
      return out;
    }

    /** 【狂気】用：捨てられたカードを墓地から取り出して、コストなしで召喚する */
    summonFromGrave(p, id) {
      const i = p.grave.lastIndexOf(id);
      if (i < 0) return null;
      p.grave.splice(i, 1);
      this.log(`${p.name}：【${Cards.get(id).name}】が狂気に駆られて現れた！`, 'resolve', p.index);
      return this.summon(p, id);
    }

    /** 生贄に選ばれるクリーチャー（弱い順。トークンを優先） */
    sacrificeTargets(p, n) {
      return [...p.field]
        .sort((a, b) => (b.token ? 1 : 0) - (a.token ? 1 : 0) || (a.atk + a.hp) - (b.atk + b.hp))
        .slice(0, n);
    }

    _paySacrifice(p, c) {
      const victims = this.sacrificeTargets(p, c.sacCost);
      p.lastSacrificed = victims.map((u) => ({ name: u.name, atk: this.atkOf(p, u), hp: u.hp, id: u.id }));
      this.log(`${p.name}：【${c.name}】の生贄に ${victims.map((u) => u.name).join('、')}`, 'info', p.index);
      victims.forEach((u) => { u.hp = 0; u.undying = false; });
      this._cleanup();
    }

    // ───────────── 内部処理 ─────────────
    /**
     * 体力0以下のクリーチャーを片付け、遺言などの能力を処理する。
     * 遺言の効果でさらに倒れるクリーチャーが出ることがあるので、いなくなるまで繰り返す。
     * 能力の処理中に再び呼ばれた場合は何もしない（外側のループが拾う）。
     */
    _cleanup() {
      if (this._cleaning) return;
      this._cleaning = true;
      try {
        for (let loop = 0; loop < 30; loop++) {
          const deaths = [];
          for (const p of this.players) {
            for (const u of p.field) {
              if (u.hp > 0) continue;
              if (u.undying && !u.usedUndying) {
                u.usedUndying = true;
                u.hp = 1;
                this.log(`${u.name}は不屈の力で踏みとどまった`, 'info', p.index);
              } else {
                deaths.push({ p, u });
              }
            }
          }
          if (!deaths.length) break;
          for (const { p, u } of deaths) {
            p.field = p.field.filter((x) => x !== u);
            if (!u.token) p.grave.push(u.id);
            this.log(`${u.name}は倒れた`, 'info', p.index);
          }
          for (const { p, u } of deaths) {
            const d = Cards.get(u.id);
            if (d.onDeath) d.onDeath(this, p, this.opp(p), u);
            for (const q of this.players) {
              for (const w of [...q.field]) {
                const wd = Cards.get(w.id);
                if (wd.onAnyDeath) wd.onAnyDeath(this, q, this.opp(q), w, u, p);
              }
            }
          }
        }
      } finally {
        this._cleaning = false;
      }
      this._bump();
    }

    _shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }

    log(text, kind, who) {
      this.logs.push({ t: this.time, text, kind, who });
      if (this.logs.length > 300) this.logs.shift();
      this._emit({ type: 'log' });
    }

    _emit(ev) { if (this.onEvent) this.onEvent(ev); }
    _bump() { this.version++; }
  }

  return { Game, CONFIG, validateDeck, isSpell };
});
