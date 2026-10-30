/*
 * presets.js — 最初から用意されているデッキ（各テーマの見本）
 * { カードID: 枚数 } の形で書き、toList() で40枚のID配列に変換して使います。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Presets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DECKS = [
    {
      key: 'aggro', name: '烈火の突撃（速攻）',
      desc: '軽いクリーチャーと火力で一気に押し切る。詠唱が短く、妨害されにくい。',
      cards: {
        squire: 4, firerat: 4, wolf: 4, raider: 4, imp: 4, assassin: 3, bannerman: 3,
        bolt: 4, charge: 3, duel: 2, drop: 2, insight: 3,
      },
    },
    {
      key: 'swarm', name: '群狼の行進（群れ）',
      desc: 'トークンで場を埋め、旗手や群れの長でまとめて殴る。',
      cards: {
        squire: 4, bannerman: 4, wolfmother: 4, herald: 3, packleader: 4, librarian: 3,
        reinforce: 4, charge: 4, allout: 2, insight: 3, drop: 3, resonance: 2,
      },
    },
    {
      key: 'control', name: '沈黙の檻（妨害）',
      desc: '打ち消し・封印・手札破壊で相手に何もさせず、棘と吸血でじわじわ削る。',
      cards: {
        counter: 4, jam: 2, reflect: 2, chains: 2, mindbreak: 2, curse: 3, execute: 3, storm: 2, timestop: 2,
        manathorn: 3, silencer: 2, shieldman: 3, golem: 3, bat: 3, heal: 2, insight: 2,
      },
    },
    {
      key: 'grave', name: '死者の行軍（墓地）',
      desc: '墓地を肥やして屍の巨人を安く呼び、倒れても倒れても蘇る。',
      cards: {
        gravekid: 4, whisper: 4, bonesoldier: 4, ghoul: 4, wraith: 3, shieldman: 2, necromancer: 4,
        corpsegiant: 3, underworld: 3, raisedead: 2, altar: 3, charge: 2, execute: 2,
      },
    },
    {
      key: 'spell', name: '魔導連鎖（呪文）',
      desc: '見習い魔導士を置いて呪文を連打。瞬唱と模倣で詠唱を踏み倒す。',
      cards: {
        apprentice: 4, chantmaster: 3, arcane: 3, quickcast: 3, mimic: 3, torrent: 3, spark: 4,
        bolt: 4, grimoire: 3, insight: 3, counter: 3, drop: 2, inferno: 2,
      },
    },
    {
      key: 'blood', name: '血の契約（代償）',
      desc: '体力を削ってでも先手を取る。追い詰められてからが本番。',
      cards: {
        bloodpact: 4, berserker: 4, bloodblade: 4, bloodrite: 3, painpact: 4, vampirelord: 3, desperate: 3,
        bat: 4, wolf: 4, imp: 3, charge: 2, assassin: 2,
      },
    },
    {
      key: 'fortress', name: '鉄壁の城塞（城塞）',
      desc: '守護を並べて耐え、茨の盾兵と城壁砲で守りを攻撃に変える。',
      cards: {
        stonewall: 4, shieldman: 4, ironwarden: 4, thornguard: 4, golem: 3, castellan: 3,
        rampartcannon: 4, siege: 3, barrier: 3, heal: 3, insight: 3, counter: 2,
      },
    },
    {
      key: 'growth', name: '芽吹く森（成長）',
      desc: '序盤に種をまき、時間とともに育った軍勢で押し潰す。',
      cards: {
        seedling: 4, spirittree: 3, mossrock: 2, forestking: 3, shieldman: 3, librarian: 3,
        growthsong: 3, gigantify: 4, duel: 3, charge: 3, resonance: 3, insight: 3, heal: 3,
      },
    },
    {
      key: 'ramp', name: '巨獣の目覚め（巨獣）',
      desc: 'マナを伸ばし、古代の呼び声や卵で巨獣のコストを踏み倒す。一騎討ちで巨獣に何度も殴らせる。',
      cards: {
        resonance: 3, earthpulse: 4, drop: 3, beastmaster: 3, egg: 3, ancientcall: 3,
        quaker: 2, titan: 2, dragon: 3, knight: 3, shieldman: 4, insight: 2, duel: 3, charge: 2,
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
