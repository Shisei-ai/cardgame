/*
 * ai.js — CPU（コンピューター）の考え方
 *
 * エンジン（engine.js）から質問（charge / main / attack / block / target / yesno / number）が来るたびに、
 * 「点数」を付けて一番よさそうな答えを返します。先読みはせず、その場の状況だけで判断する簡単なCPUです。
 *
 * ※ CPUは、見えないはずの情報（相手の手札・シールドの中身・山札の順番）は見ないように作っています。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(typeof self !== 'undefined' ? self : this);
  else root.CpuAgent = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  const Eng = () => root.Engine || require('./engine.js');
  // 相手にとって「嫌な」効果（相手のカードを選ぶ時は強いものを、自分のカードを選ぶ時は弱いものを選ぶ）
  const HARMFUL = new Set(['destroy', 'toGrave', 'bounce', 'toMana', 'tap', 'lockAttack', 'discard', 'breakShield', 'shieldToGrave', 'manaToGrave', 'manaToHand', 'discardOwn']);

  class CpuAgent {
    constructor(opts = {}) {
      this.wait = opts.wait || 0; // 考えている「間」（画面で見やすくするため。テストでは0）
    }

    async choose(game, pi, req) {
      if (this.wait) await new Promise((r) => setTimeout(r, this.wait));
      const fn = this['on_' + req.type];
      return fn ? fn.call(this, game, pi, req) : null;
    }

    /** カードの「価値」のざっくりした目安 */
    value(game, c) {
      const d = c.def;
      let v = (d.cost || 0) * 10 + (d.power || 0) / 500;
      const kw = game.ab(c).keywords;
      if (kw.blocker) v += 8;
      if (kw.breaker) v += kw.breaker * 6;
      if (kw.speedAttacker) v += 4;
      return v;
    }

    // ── マナチャージ：どのカードをマナに置くか
    on_charge(game, pi, req) {
      const P = game.players[pi];
      const hand = req.candidates.map((u) => game.card(u));
      if (P.mana.length >= 9 && hand.length <= 3) return null;
      const civsInMana = new Set(P.mana.flatMap((c) => c.def.civs));
      let best = null, bestScore = -Infinity;
      for (const c of hand) {
        let s = 0;
        const cost = c.def.cost || 0;
        if (cost > P.mana.length + 2) s += 3;                 // まだ当分使えない重いカード
        if (c.def.civs.some((k) => !civsInMana.has(k))) s += P.mana.length < 4 ? 3 : 1; // 新しい文明を足せる
        if (cost === P.mana.length + 1) s -= 3;                // 次のターンにちょうど使える
        if (game.ab(c).keywords.shieldTrigger) s -= 1;
        if (c.def.civs.length >= 2 && P.mana.length < 3) s -= 1; // 序盤の多色はタップで置かれる
        s += hand.filter((x) => x.def.name === c.def.name).length - 1; // 同じカードが手札に複数ある
        s += game.rng() * 0.5;
        if (s > bestScore) { bestScore = s; best = c; }
      }
      return best ? best.uid : null;
    }

    /** 呪文を今唱える意味があるか（対象がいない除去呪文などは唱えない） */
    spellUseful(game, pi, c) {
      const O = game.players[1 - pi];
      const P = game.players[pi];
      const sv = Eng().spellView(c.def);
      if (!sv) return false;
      const effects = Eng().abilitiesOf(sv).spell;
      if (!effects.length) return true;
      return effects.some((e) => {
        if (['destroy', 'toGrave', 'bounce', 'toMana', 'tap', 'lockAttack'].includes(e.op) && e.target && e.target.side !== 'self') {
          return O.battle.some((x) => game.matches(x, Object.assign({ type: 'creature' }, e.target.filter), c));
        }
        if (e.op === 'power') return e.amount > 0 ? P.battle.length > 0 : O.battle.length > 0;
        if (e.op === 'discard' && e.side === 'opp') return O.hand.length > 0;
        if (e.op === 'recover') return (e.from === 'grave' ? P.grave : P.mana).length > 0;
        if (e.op === 'putToBattle') return (e.from === 'grave' ? P.grave : e.from === 'hand' ? P.hand : P.mana).some((x) => x.def.type === 'creature');
        if (e.op === 'manaToGrave' || e.op === 'manaToHand') return O.mana.length > 0;
        if (e.op === 'draw' || e.op === 'search' || e.op === 'look' || e.op === 'cycleHand') return P.deck.length > 10;
        if (e.op === 'choose') return true;
        return true;
      });
    }

    // ── メイン：召喚・呪文のどれを使うか（重いものから）
    on_main(game, pi, req) {
      let best = null, bestScore = 0;
      for (const a of req.actions) {
        if (a.kind === 'toAttack') continue;
        const c = game.card(a.uid);
        if (a.kind === 'hyper') {
          // ハイパー化：タップしても困らない（召喚酔い・攻撃できない）クリーチャーがいる時だけ
          const spare = game.hyperCandidates(pi, c).filter((x) => x.enteredTurn === game.turnNo || game.kw(x, 'cantAttack'));
          if (spare.length) { const sh = 4 + game.rng(); if (sh > bestScore) { bestScore = sh; best = a; } }
          continue;
        }
        const useDef = a.kind === 'cast' && c.def.type !== 'spell' ? Eng().spellSideDef(c.def) : c.def;
        let s = (useDef.cost || 0) * 10 + 5;
        if (a.kind === 'cast' && !this.spellUseful(game, pi, c)) continue;
        if (a.kind === 'summon') s += 3;
        if (c.def.type === 'evolution') s += 6;
        s += game.rng();
        if (s > bestScore) { bestScore = s; best = a; }
      }
      return best || { kind: 'toAttack' };
    }

    // ── 攻撃：どのクリーチャーで、どこを攻撃するか
    on_attack(game, pi, req) {
      const O = game.players[1 - pi];
      const P = game.players[pi];
      const oppBlockers = O.battle.filter((c) => !c.tapped && game.kw(c, 'blocker'));
      // 相手の次のターンに、こちらが受ける攻撃の強さ（守りに残すかの判断に使う）
      const oppAttackers = O.battle.filter((c) => !game.kw(c, 'cantAttack')).length;
      const myAttackers = req.actions.filter((a) => a.kind === 'attack' && a.target === 'player').length;
      let best = null, bestScore = 0;
      for (const a of req.actions) {
        if (a.kind !== 'attack') continue;
        const att = game.card(a.attacker);
        const pw = game.power(att) + (game.kw(att, 'powerAttacker') || 0);
        let s;
        if (a.target === 'player') {
          const safeFromBlock = game.kw(att, 'unblockable') || oppBlockers.every((b) => game.power(b) < pw);
          if (!O.shields.length) s = safeFromBlock || oppBlockers.length < myAttackers ? 1000 : 40;
          else {
            s = 20 + (game.kw(att, 'breaker') || 1) * 5;
            if (!safeFromBlock) s -= 15;
            // ブロッカーは守りに残す（相手がこちらを攻撃できそうな時）
            if (game.kw(att, 'blocker') && oppAttackers > 0 && P.shields.length <= 3) s -= 25;
            // 相手の方がクリーチャーが多い時は、むやみに攻めない
            if (oppAttackers > P.battle.length + 1 && P.shields.length <= 2) s -= 10;
          }
        } else {
          const t = game.card(a.target);
          const tp = game.power(t);
          if (pw > tp) s = 30 + this.value(game, t) / 2;
          else if (pw === tp) s = this.value(game, t) - this.value(game, att);
          else s = game.kw(att, 'slayer') ? this.value(game, t) - this.value(game, att) : -1;
        }
        s += game.rng();
        if (s > bestScore) { bestScore = s; best = a; }
      }
      return best || { kind: 'end' };
    }

    // ── ブロック：するかどうか、どれでするか
    on_block(game, pi, req) {
      const P = game.players[pi];
      const att = game.card(req.attacker);
      const apw = game.power(att);
      const blockers = req.candidates.map((u) => game.card(u));
      const winners = blockers.filter((b) => game.power(b) > apw).sort((a, b) => this.value(game, a) - this.value(game, b));
      if (winners.length) return winners[0].uid;
      const toPlayer = req.target === 'player';
      const danger = toPlayer && (P.shields.length === 0 || P.shields.length <= (game.kw(att, 'breaker') || 1));
      if (danger || (toPlayer && P.shields.length <= 2)) {
        const cheapest = [...blockers].sort((a, b) => this.value(game, a) - this.value(game, b))[0];
        return cheapest.uid;
      }
      return null;
    }

    // ── 対象を選ぶ
    on_target(game, pi, req) {
      const cands = req.candidates.map((u) => game.card(u));
      const op = (req.purpose && req.purpose.op) || '';
      const harmful = HARMFUL.has(op);
      const score = (c) => {
        const mine = c.owner === pi;
        let v = this.value(game, c);
        if (op === 'evoBase') return -v + (c.tapped ? -50 : 0); // 弱く、アンタップしている進化元を選ぶ
        if (op === 'hyperCost') return -v + (c.enteredTurn === game.turnNo ? 100 : 0); // 召喚酔いのものをタップ
        if (op === 'cycleHand') return (c.def.cost || 0) - game.players[pi].mana.length; // 重すぎるカードを戻す
        if (op === 'look') return req.purpose.to === 'hand' ? v : req.purpose.to === 'mana' ? -v + (c.def.civs.length > 1 ? 5 : 0) : -v;
        if (op === 'castFree') return v;
        if (op === 'guardman') return -v;
        if (op === 'discardOwn') return -v;                     // 捨てるのは安いカード
        if (op === 'breakShield' || op === 'shieldToGrave') return game.rng(); // シールドの中身は見えない
        if (harmful) return mine ? -v : v;                       // 相手には強いものを、自分には弱いものを
        return mine ? v : -v;                                    // 良い効果は自分の強いものに
      };
      const sorted = [...cands].sort((a, b) => score(b) - score(a));
      // 「まで」で選ばなくてもよい時、自分に害がある場合は選ばない
      let n = req.max;
      // 害のある効果で「〜まで」選ぶ時は、相手のカードだけを選ぶ（自分のカードは選ばない）
      if (harmful && req.min < req.max && op !== 'discardOwn' && op !== 'cycleHand') n = Math.max(req.min, Math.min(req.max, sorted.filter((c) => c.owner !== pi).length));
      if (op === 'cycleHand') n = sorted.filter((c) => (c.def.cost || 0) > game.players[pi].mana.length + 1).length;
      if (op === 'guardman') {
        // ガードマン：攻撃を受けても勝てる（または狙われたクリーチャーの方が大事な）時だけ
        const att = game.card(req.purpose.attacker), tgt = game.card(req.purpose.target);
        const g = sorted[0];
        n = g && (game.power(g) > game.power(att) || this.value(game, tgt) > this.value(game, g) + 10) ? 1 : 0;
      }
      return sorted.slice(0, Math.max(req.min, n)).map((c) => c.uid);
    }

    // ── 「〜してもよい」
    on_yesno(game, pi, req) {
      const p = req.purpose || {};
      if (p.op === 'shieldTrigger' || p.op === 'gStrike') return true;
      if (p.op === 'smashBurst' || p.op === 'attackChance') {
        const c = game.card(p.uid);
        return this.spellUseful(game, pi, c);
      }
      const e = p.effect || {};
      const P = game.players[pi];
      if (e.op === 'skipTurn') return game.active !== pi; // 相手のターンだけとばす
      if (e.op === 'summonSelf') return true;
      // 山札が少ない時は、引く・マナに置く効果を使わない（山札切れで負けないように）
      if (e.op === 'draw' || e.op === 'search' || e.op === 'look') return P.deck.length > 10 && P.hand.length < 9;
      if (e.op === 'manaBoost' || e.op === 'addShield') return P.deck.length > 8;
      if (e.op === 'recastEvent') return P.deck.length > 10;
      if (e.op === 'discard' && e.side === 'self') return P.hand.length >= 5;
      if (e.target && e.target.side === 'self' && HARMFUL.has(e.op)) return false;
      return true;
    }

    /** 効果の並び（選択肢1つ分）の「うれしさ」 */
    effectsScore(game, pi, effects) {
      const P = game.players[pi], O = game.players[1 - pi];
      let s = 0;
      for (const e of effects) {
        switch (e.op) {
          case 'draw': s += P.deck.length > 14 ? 10 + Math.max(0, 5 - P.hand.length) * 3 : P.deck.length > 8 ? Math.max(0, 4 - P.hand.length) * 3 : -25; break;
          case 'destroy': case 'bounce': case 'toMana': case 'toGrave': {
            const f = Object.assign({ type: 'creature' }, (e.target && e.target.filter) || {});
            const t = O.battle.filter((c) => game.matches(c, f));
            s += t.length ? 15 + Math.max(...t.map((c) => this.value(game, c))) / 4 : -5;
            break;
          }
          case 'discard': s += e.side === 'opp' ? (O.hand.length ? 9 : 0) : -6; break;
          case 'addShield': s += P.deck.length < 8 ? -15 : 9; break;
          case 'manaBoost': s += P.deck.length < 8 ? -15 : P.mana.length < 7 ? 10 : 3; break;
          case 'recover': s += 3; break;
          case 'cycleHand': s += 7; break;
          default: s += 4;
        }
      }
      return s;
    }

    on_option(game, pi, req) {
      const p = req.purpose || {};
      if (p.op === 'choosePlayer') {
        // 自分の山札が少なければ自分の墓地を戻して山札切れを防ぐ。そうでなければ相手の墓地を消す
        const me = game.players[pi], op = game.players[1 - pi];
        if (me.grave.length && (me.deck.length < 10 || !op.grave.length)) return 0;
        return 1;
      }
      if (p.op === 'twinSide') return 1;
      if (p.op === 'choose' && p.effect) {
        let best = 0, bestS = -Infinity;
        p.avail.forEach((optIdx, i) => {
          const sc = this.effectsScore(game, pi, p.effect.options[optIdx]) + game.rng();
          if (sc > bestS) { bestS = sc; best = i; }
        });
        return best;
      }
      return 0;
    }

    on_number(game, pi, req) {
      const P = game.players[pi];
      return Math.max(req.min, Math.min(req.max, P.deck.length - 10, 9 - P.hand.length));
    }
  }

  return CpuAgent;
});
