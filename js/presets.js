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
        bolt: 4, charge: 3, duel: 2, manacrystal: 2, quietblade: 3,
      },
    },
    {
      key: 'swarm', name: '群狼の行進（群れ）',
      desc: 'トークンで場を埋め、旗手や群れの長でまとめて殴る。',
      cards: {
        squire: 4, bannerman: 4, wolfmother: 4, herald: 3, packleader: 4, librarian: 3,
        reinforce: 4, charge: 4, warcry: 2, refill: 2, manacrystal: 1, drop: 3, moonwolf: 2,
      },
    },
    {
      key: 'control', name: '沈黙の檻（妨害）',
      desc: '打ち消し・封印・手札破壊で相手に何もさせず、棘と吸血でじわじわ削る。',
      cards: {
        counter: 4, finalhour: 2, reflect: 2, chains: 2, mindthief: 2, curse: 3, execute: 3, banish: 2, timestop: 2,
        manathorn: 3, silencer: 2, shieldman: 3, golem: 3, bat: 3, heal: 2, blessing: 2,
      },
    },
    {
      key: 'grave', name: '死者の行軍（墓地）',
      desc: '墓地を肥やして屍の巨人を安く呼び、倒れても倒れても蘇る。',
      cards: {
        gravekid: 4, whisper: 2, foresee: 2, bonesoldier: 4, ghoul: 4, wraith: 3, gravelord: 2, necromancer: 4,
        corpsegiant: 3, underworld: 3, archlich: 2, altar: 3, charge: 2, reaper: 2,
      },
    },
    {
      key: 'spell', name: '魔導連鎖（呪文）',
      desc: '見習い魔導士を置いて呪文を連打。瞬唱と模倣で詠唱を踏み倒す。',
      cards: {
        apprentice: 4, chantmaster: 3, arcane: 3, quickcast: 3, mimic: 3, torrent: 3, spark: 4,
        bolt: 4, grimoire: 3, insightful: 3, counter: 3, archmage: 2, spellmastery: 2,
      },
    },
    {
      key: 'blood', name: '血の契約（代償）',
      desc: '体力を削ってでも先手を取る。追い詰められてからが本番。',
      cards: {
        bloodpact: 4, berserker: 4, bloodblade: 4, dealmaker: 2, painpact: 4, vampirelord: 3, desperate: 3,
        bat: 4, wolf: 4, cursedblade: 3, charge: 2, laststand: 2, comeback: 1,
      },
    },
    {
      key: 'fortress', name: '鉄壁の城塞（城塞）',
      desc: '守護を並べて耐え、茨の盾兵と城壁砲で守りを攻撃に変える。',
      cards: {
        stonewall: 4, shieldman: 4, ironwarden: 4, thornguard: 4, golem: 3, castellan: 3,
        rampartcannon: 4, siege: 3, barrier: 3, heal: 3, healer: 2, greatheal: 1, counter: 2,
      },
    },
    {
      key: 'growth', name: '芽吹く森（成長）',
      desc: '序盤に種をまき、時間とともに育った軍勢で押し潰す。',
      cards: {
        seedling: 4, spirittree: 3, proudgiant: 2, forestking: 3, shieldman: 3, librarian: 3,
        growthsong: 3, gigantify: 4, duel: 3, charge: 3, resonance: 3, manaspring: 2, regenprayer: 1, heal: 3,
      },
    },
    {
      key: 'ramp', name: '巨獣の目覚め（巨獣）',
      desc: 'マナを伸ばし、古代の呼び声や卵で巨獣のコストを踏み倒す。一騎討ちで巨獣に何度も殴らせる。',
      cards: {
        resonance: 3, earthpulse: 2, leyline: 2, savings: 2, drop: 1, beastmaster: 3, egg: 3, ancientcall: 3,
        quaker: 2, titan: 2, dragon: 3, knight: 3, shieldman: 4, manadebt: 2, duel: 3, charge: 2,
      },
    },
    {
      key: 'discard', name: '狂気の宴（捨て札）',
      desc: '手札を捨てては引き直し、捨てられて目覚める魔神と霊で押し寄せる。墓地が溜まれば終末の詠唱。',
      cards: {
        ashbook: 2, sift: 2, impulse: 4, frenzy: 2, possessed: 4, pyre: 2, cremate: 1, madprophet: 3, fetish: 2,
        ragespirit: 4, flamedemon: 3, lifeprice: 2, apocalypse: 2, greedy: 1, madhound: 2, bolt: 2, whisper: 2,
      },
    },
    {
      key: 'sacrifice', name: '奈落の儀式（生贄）',
      desc: '子羊や器、トークンを差し出して、奈落の王や骸の巨兵を早い段階で呼び出す。巨体は一騎討ちで何度も殴らせる。',
      cards: {
        lamb: 4, soulvessel: 3, bloodpriest: 4, feast: 3, deathcaller: 3, bonecolossus: 3, abysslord: 3,
        bonesoldier: 4, wolfmother: 3, reinforce: 3, colossusseal: 2, charge: 3, duel: 2,
      },
    },
    // ── テーマをまたぐ混成デッキ（シナジーの見本） ──
    {
      key: 'machine', name: '鋼の歯車（自律×成長）',
      desc: '自力で攻撃する番犬や戦獣を力の付与で強化。強化されるたびに攻撃する育つ獣で連鎖させる。',
      cards: {
        watchdog: 4, rustgolem: 2, warbeast: 3, skyknight: 3, growbeast: 3, empower: 4, tamer: 3,
        growthsong: 3, seedling: 3, nightpact: 2, shieldman: 3, investment: 3, sift: 2, heroic: 2,
      },
    },
    {
      key: 'cycle', name: '血と癒しの円環（代償×回復）',
      desc: '体力を払うたびに血の猟犬が噛みつき、回復するたびに祝福の巫女が敵を焼く。失って、取り戻して、殴る。',
      cards: {
        bloodhound: 4, priestess: 4, nightpact: 3, bat: 3, bloodpact: 4, painpact: 3, cursedblade: 3,
        laststand: 2, heal: 3, lifedrain: 3, vampirelord: 2, bloodblade: 3, desperate: 3,
      },
    },
    {
      key: 'echo', name: '反響する英雄譚（召喚時効果）',
      desc: '反響の竪琴弾きで召喚時効果を2回発動。送還で手札に戻して、もう一度使い回す。',
      cards: {
        echoer: 4, firerat: 4, sharpshooter: 4, wolfmother: 3, librarian: 2, imp: 3, tamer: 2, archon: 2,
        bounce: 3, charge: 3, snipe: 2, refill: 2, packhunter: 3, drop: 3,
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
