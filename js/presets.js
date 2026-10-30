/*
 * presets.js — 最初から用意されているデッキ
 * { カードID: 枚数 } の形で書き、toList() で40枚のID配列に変換して使います。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Presets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DECKS = [
    {
      key: 'aggro',
      name: '烈火の突撃（速攻）',
      desc: '軽いクリーチャーと火力で一気に押し切る。詠唱が短く、妨害されにくい。',
      cards: {
        squire: 4, wolf: 4, imp: 4, assassin: 3, knight: 3, packleader: 3,
        bolt: 4, charge: 4, duel: 3, drop: 3, insight: 3, counter: 2,
      },
    },
    {
      key: 'combo',
      name: '加速する群れ（コンボ）',
      desc: 'マナを伸ばして手札を集め、群れの長や突撃命令で一斉攻撃。最後は古竜。',
      cards: {
        resonance: 4, drop: 4, accel: 3, insight: 4, abyss: 3, librarian: 4,
        packleader: 4, charge: 4, squire: 4, dragon: 3, shieldman: 3,
      },
    },
    {
      key: 'control',
      name: '沈黙の檻（妨害）',
      desc: '打ち消し・封印・手札破壊で相手に何もさせず、守護と吸血でじわじわ削る。',
      cards: {
        counter: 4, jam: 3, chains: 3, mindbreak: 3, curse: 3, execute: 3, storm: 2,
        shieldman: 4, golem: 4, bat: 4, heal: 4, barrier: 2, insight: 1,
      },
    },
  ];

  function toList(cards) {
    const list = [];
    for (const id in cards) for (let i = 0; i < cards[id]; i++) list.push(id);
    return list;
  }

  return { DECKS, toList };
});
