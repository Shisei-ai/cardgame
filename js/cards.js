/*
 * cards.js — カードの定義（カードプール）
 *
 * カードの追加・調整はこのファイルだけで完結するようにしています。
 *
 * 各カードの項目:
 *   id       : 内部ID（デッキ保存に使うので変更しないこと）
 *   name     : 表示名
 *   type     : 種類（TYPES のキー）
 *   cost     : 必要マナ
 *   cast     : 詠唱時間（秒）。0 なら「瞬間」= 即座に発動し、打ち消されない
 *   text     : カードの説明文
 *   icon     : 仮アート（絵文字）
 *   atk, hp  : クリーチャーのみ。攻撃力と体力
 *   guard    : 守護。敵クリーチャーの攻撃を本体の代わりに受ける
 *   stealth  : 潜伏。攻撃時に守護を無視して本体を狙う
 *   lifesteal: 吸血。与えたダメージ分、自分の体力を回復
 *   onSummon(g, me, op, unit): 召喚時の追加効果（攻撃より先に処理）
 *   effect(g, me, op)        : クリーチャー以外の効果
 *   canUse(g, me, op)        : 使用条件。false を返すと使えない
 *   needText                 : 使用条件を満たさないときの理由表示
 *   reactive                 : 相手の詠唱に反応して使うカード（AIが通常時に使わない）
 *   ai(g, me, op)            : AIがこのカードを使う価値の評価値（大きいほど優先、0以下は使わない）
 *   threat                   : AIが「このカードを打ち消すべきか」判断するときの脅威度
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cards = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TYPES = {
    creature: { label: 'クリーチャー', color: '#3d8b50' },
    attack:   { label: '攻撃',         color: '#b8433a' },
    draw:     { label: 'ドロー',       color: '#3a6fb8' },
    resource: { label: 'リソース',     color: '#c9962b' },
    disrupt:  { label: '妨害',         color: '#7a4fb0' },
    heal:     { label: '回復',         color: '#3aa3a8' },
  };

  // AI評価でよく使う小さな関数
  const fieldPower = (p) => p.field.reduce((s, u) => s + u.atk, 0);
  const missingHp = (g, p) => g.cfg.startHP - p.hp;
  const strongest = (p) => p.field.reduce((best, u) => (!best || u.atk > best.atk ? u : best), null);

  const LIST = [
    // ───────── クリーチャー ─────────
    { id: 'squire', name: '見習い剣士', type: 'creature', cost: 1, cast: 0.8, atk: 2, hp: 1, icon: '🗡️',
      text: '' },
    { id: 'wolf', name: '疾風の狼', type: 'creature', cost: 2, cast: 0.6, atk: 3, hp: 1, icon: '🐺',
      text: '詠唱が非常に速い。' },
    { id: 'shieldman', name: '盾持ちの兵', type: 'creature', cost: 2, cast: 1.0, atk: 1, hp: 4, icon: '🛡️',
      guard: true, text: '' },
    { id: 'imp', name: '炎の小鬼', type: 'creature', cost: 3, cast: 1.5, atk: 2, hp: 2, icon: '😈',
      text: '召喚時、敵本体に1ダメージ。',
      onSummon(g, me, op) { g.damagePlayer(op, 1, '炎の小鬼'); } },
    { id: 'librarian', name: '魔導書の番人', type: 'creature', cost: 3, cast: 1.5, atk: 2, hp: 3, icon: '📖',
      text: '召喚時、カードを1枚引く。',
      onSummon(g, me) { g.draw(me, 1); } },
    { id: 'bat', name: '吸血蝙蝠', type: 'creature', cost: 3, cast: 1.2, atk: 2, hp: 4, icon: '🦇',
      lifesteal: true, text: '' },
    { id: 'packleader', name: '群れの長', type: 'creature', cost: 4, cast: 2.0, atk: 3, hp: 4, icon: '🐾',
      text: '召喚時、他の味方クリーチャー全員も攻撃する。',
      onSummon(g, me, op, unit) {
        me.field.filter((u) => u !== unit).forEach((u) => g.attack(me, u));
      },
      threat: 5 },
    { id: 'assassin', name: '影の暗殺者', type: 'creature', cost: 4, cast: 1.5, atk: 3, hp: 2, icon: '🥷',
      stealth: true, text: '' },
    { id: 'golem', name: '鉄壁ゴーレム', type: 'creature', cost: 4, cast: 2.5, atk: 2, hp: 7, icon: '🗿',
      guard: true, text: '' },
    { id: 'knight', name: '雷鳴の騎士', type: 'creature', cost: 5, cast: 2.5, atk: 5, hp: 4, icon: '⚡',
      text: '' },
    { id: 'dragon', name: '古竜', type: 'creature', cost: 7, cast: 4.0, atk: 8, hp: 8, icon: '🐉',
      text: '召喚時、敵クリーチャー全てに2ダメージ。',
      onSummon(g, me, op) { [...op.field].forEach((u) => g.damageUnit(op, u, 2)); },
      threat: 10 },

    // ───────── 攻撃 ─────────
    { id: 'charge', name: '突撃命令', type: 'attack', cost: 2, cast: 1.0, icon: '📯',
      text: '味方クリーチャー全員が攻撃する。',
      canUse: (g, me) => me.field.length > 0, needText: '味方がいない',
      effect(g, me) { [...me.field].forEach((u) => g.attack(me, u)); },
      ai: (g, me) => fieldPower(me) * 0.9 - 1,
      threat: 4 },
    { id: 'bolt', name: 'ファイアボルト', type: 'attack', cost: 2, cast: 1.0, icon: '🔥',
      text: '敵本体に3ダメージ。',
      effect(g, me, op) { g.damagePlayer(op, 3, 'ファイアボルト'); },
      ai: () => 3 },
    { id: 'duel', name: '一騎討ち', type: 'attack', cost: 4, cast: 1.0, icon: '⚔️',
      text: '味方で最も攻撃力の高いクリーチャーが2回攻撃する。',
      canUse: (g, me) => me.field.length > 0, needText: '味方がいない',
      effect(g, me) {
        const u = strongest(me);
        if (!u) return;
        g.attack(me, u);
        g.attack(me, u);
      },
      ai: (g, me) => { const u = strongest(me); return u ? u.atk * 1.6 - 1 : 0; } },
    { id: 'storm', name: '火炎嵐', type: 'attack', cost: 4, cast: 2.5, icon: '🌋',
      text: '敵クリーチャー全てに3ダメージ。',
      effect(g, me, op) { [...op.field].forEach((u) => g.damageUnit(op, u, 3)); },
      ai: (g, me, op) => op.field.reduce((s, u) => s + Math.min(u.hp, 3) + (u.hp <= 3 ? u.atk : 0), 0) - 3,
      threat: 5 },
    { id: 'inferno', name: '獄炎', type: 'attack', cost: 6, cast: 3.0, icon: '☄️',
      text: '敵本体に7ダメージ。',
      effect(g, me, op) { g.damagePlayer(op, 7, '獄炎'); },
      ai: () => 7,
      threat: 7 },

    // ───────── ドロー ─────────
    { id: 'insight', name: '知識の泉', type: 'draw', cost: 2, cast: 1.5, icon: '💧',
      text: 'カードを2枚引く。',
      effect(g, me) { g.draw(me, 2); },
      ai: (g, me) => (me.hand.length <= 3 ? 4 : me.hand.length <= 6 ? 2 : 0) },
    { id: 'abyss', name: '深淵の洞察', type: 'draw', cost: 3, cast: 2.0, icon: '🔮',
      text: 'カードを3枚引き、マナを1得る。',
      effect(g, me) { g.draw(me, 3); g.addMana(me, 1); },
      ai: (g, me) => (me.hand.length <= 3 ? 5 : me.hand.length <= 5 ? 3 : 0) },

    // ───────── リソース ─────────
    { id: 'drop', name: 'マナの雫', type: 'resource', cost: 0, cast: 0.5, icon: '💠',
      text: 'マナを2得る。',
      effect(g, me) { g.addMana(me, 2); },
      ai: (g, me) => (me.hand.some((id) => { const c = get(id); return c.cost > me.mana && c.cost <= me.mana + 2; }) ? 4 : 0) },
    { id: 'resonance', name: '魔力共鳴', type: 'resource', cost: 1, cast: 1.0, icon: '🌀',
      text: '最大マナを1増やし、マナを1得る。',
      effect(g, me) { me.maxMana = Math.min(g.cfg.maxManaCap, me.maxMana + 1); g.addMana(me, 1); },
      ai: (g, me) => (me.maxMana < g.cfg.maxManaCap - 2 ? 3.5 : 0) },
    { id: 'accel', name: '時間加速', type: 'resource', cost: 1, cast: 1.0, icon: '⏩',
      text: '8秒間、自分の詠唱速度が2倍になる。',
      effect(g, me) { me.haste = 8; },
      ai: (g, me) => (me.hand.filter((id) => get(id).cast >= 1.5).length >= 2 ? 3 : 0) },

    // ───────── 妨害 ─────────
    { id: 'counter', name: '打ち消しの印', type: 'disrupt', cost: 2, cast: 0, icon: '🚫',
      text: '【瞬間】相手が詠唱中のカードを打ち消す。',
      reactive: true,
      canUse: (g, me, op) => !!op.casting, needText: '相手が詠唱していない',
      effect(g, me, op) { g.cancelCasting(op, me); } },
    { id: 'jam', name: '詠唱妨害', type: 'disrupt', cost: 1, cast: 0, icon: '⏳',
      text: '【瞬間】相手の詠唱を2.5秒遅らせる。',
      reactive: true,
      canUse: (g, me, op) => !!op.casting, needText: '相手が詠唱していない',
      effect(g, me, op) { g.delayCasting(op, 2.5); } },
    { id: 'chains', name: '凍てつく鎖', type: 'disrupt', cost: 2, cast: 1.0, icon: '⛓️',
      text: '相手は4秒間、カードを使えない。',
      effect(g, me, op) { g.silence(op, 4); },
      ai: (g, me, op) => (op.hand.length >= 2 && op.mana >= 2 ? 3 : 1) },
    { id: 'mindbreak', name: '精神破壊', type: 'disrupt', cost: 3, cast: 1.5, icon: '🧠',
      text: '相手の手札をランダムに2枚捨てさせる。',
      canUse: (g, me, op) => op.hand.length > 0, needText: '相手の手札がない',
      effect(g, me, op) { g.discardRandom(op, 2); },
      ai: (g, me, op) => Math.min(op.hand.length, 2) * 1.8 },
    { id: 'drain', name: 'マナ枯渇', type: 'disrupt', cost: 2, cast: 0.8, icon: '🕳️',
      text: '相手のマナを3減らし、自分はマナを1得る。',
      effect(g, me, op) { g.addMana(op, -3); g.addMana(me, 1); },
      ai: (g, me, op) => Math.min(op.mana, 3) * 1.1 },
    { id: 'curse', name: '呪いの刻印', type: 'disrupt', cost: 2, cast: 1.0, icon: '💀',
      text: '15秒間、相手がカードを使うたびに相手に1ダメージ。',
      canUse: (g, me, op) => op.curse === 0, needText: '既に呪われている',
      effect(g, me, op) { g.curse(op, 15); },
      ai: (g, me, op) => 2.5 + Math.min(op.hand.length, 5) * 0.3 },
    { id: 'execute', name: '暗殺命令', type: 'disrupt', cost: 2, cast: 1.5, icon: '🎯',
      text: '敵で最も攻撃力の高いクリーチャーを破壊する。',
      canUse: (g, me, op) => op.field.length > 0, needText: '敵クリーチャーがいない',
      effect(g, me, op) { const u = strongest(op); if (u) g.destroyUnit(op, u); },
      ai: (g, me, op) => { const u = strongest(op); return u ? u.atk + u.hp * 0.5 : 0; } },

    // ───────── 回復 ─────────
    { id: 'heal', name: '癒しの光', type: 'heal', cost: 2, cast: 1.5, icon: '✨',
      text: '体力を5回復する。',
      effect(g, me) { g.heal(me, 5); },
      ai: (g, me) => Math.min(missingHp(g, me), 5) - 1 },
    { id: 'sanctuary', name: '聖域', type: 'heal', cost: 4, cast: 2.0, icon: '⛪',
      text: '体力を5回復し、味方クリーチャー全ての体力を+2する。',
      effect(g, me) { g.heal(me, 5); me.field.forEach((u) => { u.hp += 2; u.maxHp += 2; }); },
      ai: (g, me) => Math.min(missingHp(g, me), 5) + me.field.length - 2 },
    { id: 'barrier', name: '防壁', type: 'heal', cost: 2, cast: 0, icon: '🔰',
      text: '【瞬間】次に受ける本体ダメージを合計6まで防ぐ。',
      canUse: (g, me) => me.shield === 0, needText: '防壁が残っている',
      effect(g, me) { me.shield = 6; },
      ai: (g, me, op) => (op.casting && (op.casting.card.type === 'attack' || op.casting.card.type === 'creature') ? 4 : 0) },
  ];

  const MAP = Object.fromEntries(LIST.map((c) => [c.id, c]));
  function get(id) {
    const c = MAP[id];
    if (!c) throw new Error('未知のカードID: ' + id);
    return c;
  }

  // カードの説明文（キーワードも含める）を作る。
  // 「召喚時に1回攻撃」は全クリーチャー共通のルールなので、カード面では省略し long=true の時だけ付ける
  function fullText(c, long) {
    const parts = [];
    if (c.type === 'creature') {
      const kw = [];
      if (c.guard) kw.push('守護');
      if (c.stealth) kw.push('潜伏');
      if (c.lifesteal) kw.push('吸血');
      if (kw.length) parts.push('【' + kw.join('・') + '】');
      if (long) parts.push('召喚時に1回攻撃。');
    }
    if (c.text) parts.push(c.text);
    return parts.join(' ');
  }

  return { TYPES, LIST, get, fullText };
});
