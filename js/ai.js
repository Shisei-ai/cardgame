/*
 * ai.js — CPU対戦相手
 *
 * 人間と同じ条件で戦わせるため、AIにも次の制約を設けています。
 *   think : 何秒おきに行動を考えるか（＝操作の速さ）
 *   react : 相手が詠唱を始めてから何秒後に反応できるか（＝反射神経）
 *   counterAt : この脅威度以上のカードなら打ち消しを使う
 *   reserve : 打ち消し用のマナを温存するか
 *   blunder : 判断をサボる確率（弱いAIほど大きい）
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
      if (me.silence > 0) return;

      const playable = me.hand
        .map((id, i) => ({ i, card: Cards.get(id) }))
        .filter((h) => g.canPlay(this.pi, h.i).ok);
      if (!playable.length) return;
      if (this.L.blunder && g.rand() < this.L.blunder) return;

      // ① 相手の詠唱への反応
      if (op.casting && op.casting !== this.handledCast && g.time - op.casting.start >= this.L.react) {
        const threat = this.threat(op.casting.card);
        const counter = playable.find((h) => h.card.id === 'counter');
        if (counter && threat >= this.L.counterAt) {
          this.handledCast = op.casting;
          g.play(this.pi, counter.i);
          return;
        }
        const jam = playable.find((h) => h.card.id === 'jam');
        if (jam && threat >= this.L.counterAt - 1 && op.casting.remain < 1.2) {
          this.handledCast = op.casting;
          g.play(this.pi, jam.i);
          return;
        }
        const barrier = playable.find((h) => h.card.id === 'barrier');
        if (barrier && threat >= 3 && (op.casting.card.type === 'attack' || op.casting.card.type === 'creature')) {
          this.handledCast = op.casting;
          g.play(this.pi, barrier.i);
          return;
        }
      }

      // ② 自分から仕掛ける
      const reserveCost = this.L.reserve && me.hand.includes('counter') ? Cards.get('counter').cost : 0;
      let best = null;
      for (const h of playable) {
        if (h.card.reactive) continue;
        let score = this.score(h.card, me, op);
        if (score <= 0) continue;
        // 打ち消し用マナを残せなくなる場合は、よほど価値が高くない限り見送る
        if (reserveCost && me.mana - h.card.cost < reserveCost && score < 6) score *= 0.4;
        // 少しだけ揺らぎを入れて単調さを防ぐ
        score += g.rand() * 0.5;
        if (!best || score > best.score) best = { h, score };
      }
      if (best && best.score > 1) g.play(this.pi, best.h.i);
    }

    score(card, me, op) {
      if (card.ai) return card.ai(this.g, me, op);
      if (card.type === 'creature') {
        // 敵に守護がいる場合、潜伏持ち以外は本体に届きにくい
        const guarded = op.field.some((u) => u.guard) && !card.stealth;
        let v = card.atk * (guarded ? 0.6 : 1) + card.hp * 0.5 + (card.guard ? 1.5 : 0);
        if (card.onSummon) v += 1.5;
        return v;
      }
      return card.cost;
    }

    threat(card) {
      if (card.threat != null) return card.threat;
      if (card.type === 'creature') return card.atk * 0.7 + card.hp * 0.3 + (card.onSummon ? 1 : 0);
      return card.cost;
    }
  }

  return { AI, LEVELS };
});
