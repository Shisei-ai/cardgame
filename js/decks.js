/*
 * decks.js — 最初から用意しているデッキ（基本カードだけで組んだ見本）
 *   { カードID: 枚数 } で書き、toList(デッキ, 引き当て関数) で spec の配列にする。
 */
(function (root) {
  'use strict';
  const STARTERS = [
    {
      id: 'starter_fire', name: '見本：炎の先陣', desc: '軽いクリーチャーで先に殴り、火球で押し切る速攻型',
      cards: { b_sprite: 4, b_scout: 4, b_wolf: 4, b_thief: 2, b_charger: 4, b_archer: 2, b_twinblade: 3, b_drake: 3, b_ogre: 2, b_zap: 4, b_fireball: 4, b_rally: 2, b_parry: 2 },
    },
    {
      id: 'starter_fort', name: '見本：大樹の砦', desc: '守護で耐えながらマナを伸ばし、大型で逆転する',
      cards: { b_wall: 4, b_apprentice: 3, b_knight: 4, b_healer: 3, b_golem: 3, b_paladin: 3, b_sage: 3, b_executioner: 2, b_commander: 2, b_leviathan: 2, b_insight: 3, b_growth: 4, b_smite: 2, b_pitfall: 2 },
    },
  ];

  /** { id: 枚数 } を spec の配列に。見つからないカードは無視して、missing に数える */
  function toList(cards, resolve) {
    const list = [];
    let missing = 0;
    for (const id in cards) {
      const s = resolve(id);
      if (!s) { missing += cards[id]; continue; }
      for (let i = 0; i < cards[id]; i++) list.push(s);
    }
    return { list, missing };
  }

  root.Decks = { STARTERS, toList };
})(this);
