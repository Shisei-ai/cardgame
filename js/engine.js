/*
 * engine.js — ゲームのルール処理（画面表示とは完全に分離）
 *
 * ゲームは「時間」で進みます。update(dt) を呼ぶたびに dt 秒だけ時間が進み、
 *   ・詠唱中のカードの残り時間が減り、0になったら発動
 *   ・フェーズタイマーが0になったら次のフェーズ（マナ回復＋2枚ドロー）
 *   ・試合時間が尽きたら体力の多い方が勝ち
 * という処理が行われます。
 *
 * ブラウザでは毎フレーム実時間で update を呼び、
 * バランス検証用シミュレーター（tools/simulate.js）では 0.1 秒刻みで高速に回します。
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
    fieldLimit: 5,      // 場に出せるクリーチャーの上限
    fatigue: 2,         // 山札切れで引こうとしたときのダメージ
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
      if (counts[id] > cfg.maxCopies) errors.push(`「${Cards.get(id).name}」が${cfg.maxCopies}枚を超えています`);
    }
    return errors;
  }

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
        casting: null,  // { card, total, remain, start }
        silence: 0,     // 残り封印時間（秒）
        haste: 0,       // 残り加速時間（秒）
        curse: 0,       // 残り呪い時間（秒）。この間カードを使うと1ダメージ
        shield: 0,      // 防壁の残量
        stats: { damageDealt: 0, cardsPlayed: 0, countered: 0, played: {} },
      };
    }

    opp(p) { return this.players[1 - p.index]; }

    // ───────────── 時間の進行 ─────────────
    update(dt) {
      if (this.over) return;
      this.time += dt;

      for (const p of this.players) {
        if (p.silence > 0) { p.silence = Math.max(0, p.silence - dt); if (p.silence === 0) this._bump(); }
        if (p.haste > 0) { p.haste = Math.max(0, p.haste - dt); if (p.haste === 0) this._bump(); }
        if (p.curse > 0) { p.curse = Math.max(0, p.curse - dt); if (p.curse === 0) this._bump(); }
      }
      // 詠唱の進行（両者同時。同じ瞬間に完了した場合はプレイヤー番号順）
      for (const p of this.players) {
        if (!p.casting) continue;
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

      if (this.time >= this.cfg.matchTime) this._timeUp();
    }

    _newPhase() {
      this.phase++;
      this.phaseTimer += this.cfg.phaseTime;
      this.log(`第${this.phase}フェーズ開始`, 'phase');
      for (const p of this.players) {
        p.maxMana = Math.min(this.cfg.maxManaCap, p.maxMana + 1);
        p.mana = Math.max(p.mana, p.maxMana); // 余ったマナは持ち越さず最大値まで回復（雫などで超過している分は残す）
        this.draw(p, this.cfg.phaseDraw);
      }
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
      if (p.silence > 0) return { ok: false, reason: '封印中' };
      if (p.mana < c.cost) return { ok: false, reason: 'マナ不足' };
      if (c.cast > 0 && p.casting) return { ok: false, reason: '詠唱中' };
      if (c.type === 'creature' && p.field.length >= this.cfg.fieldLimit) return { ok: false, reason: '場が満杯' };
      if (c.canUse && !c.canUse(this, p, this.opp(p))) return { ok: false, reason: c.needText || '条件未達' };
      return { ok: true, reason: '' };
    }

    play(pi, idx) {
      const chk = this.canPlay(pi, idx);
      if (!chk.ok) return chk;
      const p = this.players[pi];
      const id = p.hand.splice(idx, 1)[0];
      const c = Cards.get(id);
      p.mana -= c.cost;
      p.stats.cardsPlayed++;
      p.stats.played[id] = (p.stats.played[id] || 0) + 1;

      if (c.cast <= 0) {
        this.log(`${p.name}：【${c.name}】（瞬間）`, 'play', p.index);
        this._emit({ type: 'play', player: p.index, card: c, instant: true });
        this._resolve(p, c);
      } else {
        p.casting = { card: c, total: c.cast, remain: c.cast, start: this.time };
        this.log(`${p.name}：【${c.name}】詠唱開始`, 'cast', p.index);
        this._emit({ type: 'play', player: p.index, card: c, instant: false });
      }
      if (p.curse > 0) this.damagePlayer(p, 1, '呪いの刻印');
      this._bump();
      return chk;
    }

    _resolve(p, c) {
      const op = this.opp(p);
      if (c.type === 'creature') {
        if (p.field.length >= this.cfg.fieldLimit) {
          this.log(`【${c.name}】は場が満杯で不発`, 'info', p.index);
          p.grave.push(c.id);
        } else {
          const unit = {
            uid: this.uidSeq++, id: c.id, name: c.name, icon: c.icon,
            atk: c.atk, hp: c.hp, maxHp: c.hp,
            guard: !!c.guard, stealth: !!c.stealth, lifesteal: !!c.lifesteal,
          };
          p.field.push(unit);
          this.log(`${p.name}：【${c.name}】召喚`, 'resolve', p.index);
          this._emit({ type: 'summon', player: p.index, unit });
          if (c.onSummon) c.onSummon(this, p, op, unit);
          this.attack(p, unit);
        }
      } else {
        if (c.cast > 0) this.log(`${p.name}：【${c.name}】発動`, 'resolve', p.index);
        c.effect(this, p, op);
        p.grave.push(c.id);
      }
      this._emit({ type: 'resolve', player: p.index, card: c });
      this._checkDeath();
      this._bump();
    }

    // ───────────── カード効果から呼ばれる基本操作 ─────────────
    /** クリーチャー unit で攻撃する。敵に守護がいればそちらが受け止める */
    attack(p, unit) {
      if (this.over || !p.field.includes(unit) || unit.hp <= 0) return;
      const op = this.opp(p);
      let target = null;
      if (!unit.stealth) {
        const guards = op.field.filter((u) => u.guard && u.hp > 0);
        if (guards.length) target = guards.reduce((a, b) => (b.hp > a.hp ? b : a));
      }
      if (target) {
        // クリーチャー同士は互いに攻撃力分のダメージを与え合う
        target.hp -= unit.atk;
        unit.hp -= target.atk;
        this.log(`${unit.name}(${unit.atk}) → 守護 ${target.name}`, 'attack', p.index);
        if (unit.lifesteal) this.heal(p, unit.atk);
        this._emit({ type: 'attack', player: p.index, unit, target });
        this._cleanup();
      } else {
        this._emit({ type: 'attack', player: p.index, unit, target: null });
        const dealt = this.damagePlayer(op, unit.atk, unit.name);
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

    damageUnit(owner, unit, amount) {
      unit.hp -= amount;
      this._emit({ type: 'unitDamage', player: owner.index, unit, amount });
      this._cleanup();
    }

    destroyUnit(owner, unit) {
      unit.hp = 0;
      this.log(`${unit.name}は破壊された`, 'info', owner.index);
      this._cleanup();
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

    addMana(p, n) {
      p.mana = Math.max(0, p.mana + n);
      this._bump();
    }

    silence(p, sec) {
      p.silence = Math.max(p.silence, sec);
      this.log(`${p.name}は${sec}秒間封印された`, 'info', p.index);
      this._bump();
    }

    curse(p, sec) {
      p.curse = sec;
      this.log(`${p.name}は${sec}秒間呪われた`, 'info', p.index);
      this._bump();
    }

    cancelCasting(target, by) {
      if (!target.casting) return;
      const c = target.casting.card;
      target.casting = null;
      target.grave.push(c.id);
      by.stats.countered++;
      this.log(`【${c.name}】は打ち消された！`, 'counter', target.index);
      this._emit({ type: 'counter', player: target.index, card: c });
      this._bump();
    }

    delayCasting(target, sec) {
      if (!target.casting) return;
      target.casting.remain += sec;
      target.casting.total += sec;
      this.log(`【${target.casting.card.name}】の詠唱が${sec}秒遅延`, 'info', target.index);
      this._bump();
    }

    discardRandom(p, n) {
      for (let i = 0; i < n && p.hand.length; i++) {
        const idx = Math.floor(this.rand() * p.hand.length);
        const id = p.hand.splice(idx, 1)[0];
        p.grave.push(id);
        this.log(`${p.name}は【${Cards.get(id).name}】を捨てた`, 'info', p.index);
      }
      this._bump();
    }

    // ───────────── 内部処理 ─────────────
    _cleanup() {
      for (const p of this.players) {
        const dead = p.field.filter((u) => u.hp <= 0);
        if (!dead.length) continue;
        p.field = p.field.filter((u) => u.hp > 0);
        dead.forEach((u) => {
          p.grave.push(u.id);
          this.log(`${u.name}は倒れた`, 'info', p.index);
        });
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

  return { Game, CONFIG, validateDeck };
});
