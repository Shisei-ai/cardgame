/*
 * ai.js — CPU対戦相手
 *
 * 人間と同じ条件で戦わせるため、AIにも次の制約を設けています。
 *   think : 何秒おきに行動を考えるか（＝操作の速さ）
 *   react : 相手が詠唱を始めてから何秒後に反応できるか（＝反射神経）
 *   counterAt : この脅威度以上のカードなら打ち消しを使う
 *   reserve : 打ち消し用のマナを温存するか
 *   blunder : 判断をサボる確率（弱いAIほど大きい）
 *
 * カードごとの判断は cards.js の ai / aiBonus / react に書かれており、
 * このファイルはそれらを比べて一番良い手を選ぶだけです。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cards.js'));
  else root.AI = factory(root.Cards);
})(typeof self !== 'undefined' ? self : this, function (Cards) {
  'use strict';

  const LEVELS = {
    easy:   { label: 'やさしい', think: 1.4, react: 1.6, counterAt: 6, reserve: false, blunder: 0.35 },
    normal: { label: 'ふつう',   think: 0.7, react: 0.9, counterAt: 4, reserve: false, blunder: 0.12 },
    hard:   { label: 'つよい',   think: 0.3, react: 0.45, counterAt: 3, reserve: true,  blunder: 0.0 },
  };

  class AI {
    constructor(game, playerIndex, level = 'normal') {
      this.g = game;
      this.pi = playerIndex;
      this.L = LEVELS[level] || LEVELS.normal;
      this.timer = game.rand() * this.L.think;
      this.handledCast = null; // 同じ詠唱に何度も反応しないための記録
    }

    update(dt) {
      if (this.g.over) return;
      this.timer += dt;
      if (this.timer < this.L.think) return;
      this.timer = 0;
      this.act();
    }

    act() {
      const g = this.g;
      const me = g.players[this.pi];
      const op = g.opp(me);
      if (me.silence > 0 || me.stun > 0) return;

      const playable = me.hand
        .map((id, i) => ({ i, card: Cards.get(id) }))
        .filter((h) => g.canPlay(this.pi, h.i).ok);
      if (!playable.length) return;
      if (this.L.blunder && g.rand() < this.L.blunder) return;

      // ① 相手の詠唱への反応（打ち消し・遅延・防壁など）
      if (op.casting && op.casting !== this.handledCast && g.time - op.casting.start >= this.L.react) {
        const threat = this.threat(op.casting.card);
        let best = null;
        for (const h of playable) {
          if (!h.card.react) continue;
          const s = h.card.react(g, me, op, threat, this.L);
          if (s > 0 && (!best || s > best.s)) best = { h, s };
        }
        if (best) {
          this.handledCast = op.casting;
          g.play(this.pi, best.h.i);
          return;
        }
      }

      // ② 自分から仕掛ける
      const reserveCost = this.reserveCost(me);
      let best = null;
      for (const h of playable) {
        if (h.card.reactive) continue;
        let score = this.score(h.card, me, op);
        // 生贄にする味方の価値を差し引く（遺言持ちやトークンは安い）
        if (h.card.sacCost) {
          for (const u of g.sacrificeTargets(me, h.card.sacCost)) {
            score -= u.token ? 0.3 : (g.atkOf(me, u) + u.hp) * 0.45 - (Cards.get(u.id).onDeath ? 2 : 0);
          }
        }
        if (score <= 0) continue;
        const cost = g.costOf(me, h.card.id);
        // 打ち消し用マナを残せなくなる場合は、よほど価値が高くない限り見送る
        if (reserveCost && me.mana - cost < reserveCost && score < 6) score *= 0.4;
        // 体力を払うカードは、体力が少ないほど慎重に
        if (h.card.hpCost) score -= h.card.hpCost * (me.hp <= 10 ? 1.2 : 0.25);
        // 少しだけ揺らぎを入れて単調さを防ぐ
        score += g.rand() * 0.5;
        if (!best || score > best.score) best = { h, score };
      }
      if (best && best.score > 1) g.play(this.pi, best.h.i);
    }

    /** 手札にある一番安い「打ち消し系」カードのコスト（温存用） */
    reserveCost(me) {
      if (!this.L.reserve) return 0;
      const costs = me.hand.map(Cards.get).filter((c) => c.react && c.id !== 'barrier').map((c) => this.g.costOf(me, c.id));
      return costs.length ? Math.min(...costs) : 0;
    }

    score(card, me, op) {
      const g = this.g;
      if (card.type === 'creature') {
        // 鈍重（召喚時に攻撃しない）は、場に残る価値だけで評価する
        let v = card.noAttack ? card.atk * 0.5 + card.hp * 0.5 : card.atk * (card.double ? 2 : 1) + card.hp * 0.5;
        // 敵に守護がいる場合、召喚時の攻撃は守護に受け止められる（潜伏は除く）
        const guards = card.stealth || card.noAttack ? [] : g.readyGuards(op);
        if (guards.length) {
          const t = guards.reduce((a, b) => (b.hp > a.hp ? b : a));
          const kills = card.atk - (t.armor || 0) >= t.hp;
          const dies = g.cfg.guardRetaliate && g.atkOf(op, t) - (card.armor || 0) >= card.hp;
          if (dies && !kills) {
            // 一方的に倒されるだけ…だが、守護を疲労させる「おとり」にはなる。
            // 後続（他のクリーチャーや全体攻撃）が手札にあり、安いカードならおとりとして出す
            const followers = me.hand.filter((id) => id !== card.id && (Cards.get(id).type === 'creature' || id === 'charge' || id === 'allout')).length;
            v = followers && g.costOf(me, card.id) <= 2 ? 1.6 + Math.min(followers, 3) * 0.3 : 0.3;
          }
          else if (dies) v = (t.atk + t.hp) * 0.5;                  // 相討ち
          else {
            // 生き残る：場に残って後で攻撃でき、守護の「1フェーズ1回」も使わせられる
            v = card.atk * 0.7 + card.hp * 0.4 + 0.8 + (kills ? (t.atk + t.hp) * 0.5 : 0);
          }
          if (card.pierce) v += Math.max(0, card.atk - t.hp);
        }
        if (card.guard) v += 1.5 + op.field.length * 0.5;
        if (card.lifesteal) v += card.atk * 0.5;
        if (card.aiBonus) v += card.aiBonus(g, me, op);
        // 場が満杯なら一番古い味方を失う（遺言持ちならむしろ得）
        if (me.field.length >= g.cfg.fieldLimit) {
          const old = me.field[0];
          v -= (g.atkOf(me, old) + old.hp) * 0.5 - (Cards.get(old.id).onDeath ? 2.5 : 0);
        }
        return v;
      }
      if (card.ai) return card.ai(g, me, op);
      return card.cost;
    }

    threat(card) {
      if (card.threat != null) return card.threat;
      if (card.type === 'creature') return card.atk * 0.7 * (card.double ? 2 : 1) + card.hp * 0.3 + (card.onSummon ? 1 : 0);
      return card.cost;
    }
  }

  return { AI, LEVELS };
});
