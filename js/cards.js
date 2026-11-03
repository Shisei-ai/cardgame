/*
 * cards.js — 最初から使える基本カード
 *
 * 基本カードも、オリジナルカードと同じ規則（parts.js）で作っています。
 * 素質はすべて「銀」（倍率1.0）で、容量の範囲内に収まっていることを tools/check.js で確認できます。
 *
 * 書き方の例：
 *   C('b_knight', '盾の騎士', '🛡️', 3, 0, ['guard'])                     … クリーチャー（コスト3・パワー2500・守護）
 *   S('b_insight', '知恵の泉', '📘', 2, [E('cast', 'draw', 2)])             … 呪文（唱えた時、カードを2枚引く）
 *   E(発動の場面, 効果, 量, 対象, 条件, 代償)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./parts.js'));
  else root.Cards = factory(root.Parts);
})(typeof self !== 'undefined' ? self : this, function (Parts) {
  'use strict';

  const E = (trig, act, amt = 0, tgt = null, cond = 'none', pay = 'none') => ({ trig, act, amt, tgt, cond, pay });
  // power に 0 を書くと、キーワードと効果を付けた残りの容量で、入る限り大きいパワーにする
  const C = (id, name, icon, cost, power, keywords = [], effects = [], color) => {
    const c = { id, name, icon, kind: 'creature', cost, power, keywords, effects, grade: 'silver', base: true, color };
    if (!power) {
      c.power = Parts.POWER_MIN;
      while (c.power + Parts.POWER_STEP <= Parts.POWER_MAX && Parts.usage({ ...c, power: c.power + Parts.POWER_STEP }).total <= Parts.capacity(cost, 'silver')) c.power += Parts.POWER_STEP;
    }
    return c;
  };
  const S = (id, name, icon, cost, effects, color) =>
    ({ id, name, icon, kind: 'spell', cost, keywords: [], effects, grade: 'silver', base: true, color });

  const BASE = [
    // ── クリーチャー ──
    C('b_sprite', '見習い妖精', '🧚', 1, 0),
    C('b_scout', '早駆けの斥候', '🏃', 2, 0, ['haste']),
    C('b_wall', '木の盾兵', '🪵', 2, 0, ['guard']),
    C('b_apprentice', '見習い魔術師', '🧑‍🎓', 2, 0, [], [E('summon', 'draw', 1)]),
    C('b_wolf', '灰色狼', '🐺', 2, 0),
    C('b_thief', '夜盗', '🦹', 2, 0, [], [E('summon', 'discardOpp', 1)]),
    C('b_knight', '盾の騎士', '🛡️', 3, 0, ['guard']),
    C('b_archer', '森の弓兵', '🏹', 3, 0, ['sniper']),
    C('b_assassin', '影の刺客', '🥷', 3, 0, ['assassin']),
    C('b_charger', '突撃兵', '🐗', 3, 0, ['haste', 'fleeting']),
    C('b_healer', '癒し手', '💗', 3, 0, [], [E('summon', 'heal', 1000)]),
    C('b_golem', '石のゴーレム', '🗿', 4, 0, ['guard', 'slow']),
    C('b_twinblade', '双剣士', '⚔️', 4, 0, ['double']),
    C('b_spellsword', '魔法剣士', '🗡️', 4, 0, ['pierce'], [E('spellCast', 'buffTurn', 1000, 'self')]),
    C('b_raven', '告げ鴉', '🐦‍⬛', 4, 0, ['stealth'], [E('attack', 'draw', 1)]),
    C('b_paladin', '聖騎士', '🛡️', 5, 0, ['guard', 'undying']),
    C('b_ogre', '岩山のオーガ', '👹', 5, 0),
    C('b_drake', '若き飛竜', '🐉', 5, 0, ['haste']),
    C('b_gravekeeper', '墓守', '⚰️', 5, 0, [], [E('summon', 'regrow', 1), E('destroyed', 'draw', 1)]),
    C('b_sage', '森の賢者', '🧙', 6, 0, ['guard'], [E('summon', 'draw', 2)]),
    C('b_executioner', '処刑人', '🪓', 6, 0, [], [E('summon', 'destroy', 2000, 'one')]),
    C('b_titan', '鋼の巨人', '🤖', 7, 0),
    C('b_commander', '軍団長', '🎖️', 7, 0, ['guard'], [E('summon', 'buffPerm', 500, 'allAlly')]),
    C('b_phoenix', '不死鳥', '🔥', 8, 0, ['haste', 'undying', 'drain']),
    C('b_leviathan', '深淵の巨獣', '🐋', 10, 0),
    C('b_dragon', '古竜', '🐲', 12, 0, [], [E('summon', 'weaken', 2000, 'allEnemy')]),
    C('b_stargazer', '星読みの導師', '🔭', 15, 0, ['guard', 'undying', 'ward'], [E('summon', 'rampMax', 3), E('turnStart', 'draw', 1)]),
    C('b_worldeater', '世界喰らい', '🌑', 20, 0, ['double', 'assassin'], [E('summon', 'draw', 2)]),

    // ── 呪文 ──
    S('b_zap', '雷撃', '⚡', 1, [E('cast', 'destroy', 1000, 'one')]),
    S('b_insight', '知恵の泉', '📘', 2, [E('cast', 'draw', 2)]),
    S('b_growth', '大地の恵み', '🌱', 2, [E('cast', 'rampMax', 1), E('cast', 'draw', 1)]),
    S('b_rain', '癒しの雨', '🌧️', 2, [E('cast', 'heal', 1000), E('cast', 'draw', 1)]),
    S('b_parry', '受け流し', '🔰', 2, [E('react', 'weaken', 1000, 'attacker'), E('react', 'draw', 1)]),
    S('b_fireball', '火球', '☄️', 3, [E('cast', 'burn', 1500)]),
    S('b_mindrot', '心砕き', '🌀', 3, [E('cast', 'discardOpp', 2)]),
    S('b_rally', '鬨の声', '📯', 3, [E('cast', 'buffTurn', 1000, 'allAlly'), E('cast', 'draw', 1)]),
    S('b_gust', '送還の風', '🍃', 3, [E('cast', 'bounce', 0, 'one'), E('cast', 'draw', 1)]),
    S('b_smite', '断罪の光', '✨', 4, [E('cast', 'destroy', 3000, 'one')]),
    S('b_pitfall', '落とし穴', '🕳️', 4, [E('react', 'destroy', 0, 'attacker')]),
    S('b_seal', '封印の呪', '🔒', 4, [E('cast', 'spellLock'), E('cast', 'discardOpp', 1)]),
    S('b_shock', '衝撃波', '💥', 5, [E('cast', 'weaken', 1000, 'allEnemy'), E('cast', 'tapEnemy', 0, 'allEnemy')]),
    S('b_tempest', '大嵐', '🌪️', 9, [E('cast', 'destroy', 0, 'allEnemy')]),
  ];

  const MAP = new Map(BASE.map((c) => [c.id, c]));
  const get = (id) => MAP.get(id);

  return { BASE, get, E };
});
