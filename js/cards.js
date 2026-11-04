/*
 * cards.js — 最初から使える基本カード
 *
 * 基本カードも、オリジナルカードと同じ規則（parts.js）で作っています。
 * 素質はすべて「銀」（倍率1.0）で、容量の範囲内に収まっていることを tools/check.js で確認できます。
 *
 * 書き方：
 *   C(ID, 名前, アイコン, コスト, パワー, [キーワード], [テキスト効果])   … クリーチャー（パワー0なら、残りの容量で入る限り大きく）
 *   S(ID, 名前, アイコン, コスト, [テキスト効果])                          … 呪文
 *   X(発動の場面, 効果, { n: 量, tgt: T(...), dur, per, lim, conds, pay, kw, tp, tapToo })
 *   T(誰を, 何体, どう選ぶ, 絞り込み, 絞り込みの値)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./parts.js'));
  else root.Cards = factory(root.Parts);
})(typeof self !== 'undefined' ? self : this, function (Parts) {
  'use strict';

  const T = (who, count = 1, how = 'choose', f = 'none', fn = 0) => ({ who, count, how, f, fn });
  const X = (trig, act, o = {}) => {
    const e = { trig, act, n: o.n != null ? o.n : 0, conds: o.conds || [], pay: o.pay || { k: 'none', n: 0 }, per: o.per || 'none' };
    if (o.tgt) e.tgt = o.tgt;
    if (o.dur) e.dur = o.dur;
    if (o.lim) e.lim = o.lim;
    if (o.kw) e.kw = o.kw;
    if (o.tp) e.tp = o.tp;
    if (o.tapToo) e.tapToo = true;
    return e;
  };
  const C = (id, name, icon, cost, power, keywords = [], effects = [], color) => {
    const c = { id, name, icon, kind: 'creature', cost, power, keywords, effects, grade: 'silver', base: true, color };
    if (!power) {
      c.power = Parts.POWER_MIN;
      while (c.power + Parts.POWER_STEP <= Parts.POWER_MAX && Parts.usage({ ...c, power: c.power + Parts.POWER_STEP }).total <= Parts.capacity(cost, 'silver')) c.power += Parts.POWER_STEP;
    }
    return c;
  };
  const S = (id, name, icon, cost, effects, color) => ({ id, name, icon, kind: 'spell', cost, keywords: [], effects, grade: 'silver', base: true, color });

  const BASE = [
    // ── クリーチャー ──
    C('b_sprite', '見習い妖精', '🧚', 1, 0),
    C('b_scout', '早駆けの斥候', '🏃', 2, 0, ['haste']),
    C('b_wall', '木の盾兵', '🪵', 2, 0, ['guard']),
    C('b_apprentice', '見習い魔術師', '🧑‍🎓', 2, 0, [], [X('summon', 'draw', { n: 1 })]),
    C('b_wolf', '灰色狼', '🐺', 2, 0),
    C('b_thief', '夜盗', '🦹', 2, 0, [], [X('summon', 'oppDiscard', { n: 1 })]),
    C('b_knight', '盾の騎士', '🛡️', 3, 0, ['guard']),
    C('b_archer', '森の弓兵', '🏹', 3, 0, ['sniper']),
    C('b_assassin', '影の刺客', '🥷', 3, 0, ['assassin']),
    C('b_charger', '突撃兵', '🐗', 3, 0, ['haste', 'fleeting']),
    C('b_healer', '癒し手', '💗', 3, 0, [], [X('summon', 'heal', { n: 1000 })]),
    C('b_alchemist', '錬金術師', '⚗️', 3, 0, [], [X('activate', 'draw', { n: 1, pay: { k: 'mana', n: 2 }, lim: 'turn1' })]),
    C('b_smith', '火床の鍛冶師', '🔨', 3, 0, [], [X('turnEnd', 'emberGain', { n: 1 })]),
    C('b_golem', '石のゴーレム', '🗿', 4, 0, ['guard', 'slow']),
    C('b_twinblade', '双剣士', '⚔️', 4, 0, ['double']),
    C('b_spellsword', '魔法剣士', '🗡️', 4, 0, ['pierce'], [X('spellCast', 'buff', { n: 1000, tgt: T('self'), dur: 'turn', lim: 'turn1' })]),
    C('b_raven', '告げ鴉', '🐦‍⬛', 4, 0, ['stealth'], [X('attack', 'draw', { n: 1, lim: 'turn1' })]),
    C('b_bannerman', '号令の旗手', '🚩', 4, 0, [], [X('static', 'buff', { n: 500, tgt: T('allyOther', 'all'), dur: 'perm' })]),
    C('b_librarian', '星図の司書', '📚', 4, 0, [], [X('summon', 'searchSpell', { n: 5 })]),
    C('b_berserker', '狂戦士', '😡', 4, 0, [], [X('static', 'buff', { n: 500, tgt: T('self'), dur: 'perm', per: 'enemy' })]),
    C('b_paladin', '聖騎士', '🛡️', 5, 0, ['guard', 'undying']),
    C('b_ogre', '岩山のオーガ', '👹', 5, 0),
    C('b_drake', '若き飛竜', '🐉', 5, 0, ['haste']),
    C('b_gravekeeper', '墓守', '⚰️', 5, 0, [], [X('summon', 'regrow', { n: 1 }), X('destroyed', 'draw', { n: 1 })]),
    C('b_broodmother', '巣の母', '🕷️', 5, 0, [], [X('summon', 'token', { n: 2, tp: 1000 })]),
    C('b_shrine', '痛みの巫女', '🔔', 5, 0, ['guard'], [X('damaged', 'draw', { n: 1, lim: 'turn1' })]),
    C('b_sage', '森の賢者', '🧙', 6, 0, ['guard'], [X('summon', 'draw', { n: 2 })]),
    C('b_executioner', '処刑人', '🪓', 6, 0, [], [X('summon', 'destroy', { tgt: T('enemy', 1, 'choose', 'powerLE', 2000) })]),
    C('b_warden', '牢番', '🔐', 7, 0, ['guard'], [X('static', 'auraOppCost', { n: 1 })]),
    C('b_gatekeeper', '小門の門番', '🚪', 7, 0, [], [X('static', 'summonLockLE', { n: 2 })]),
    C('b_bonelord', '骸骨の王', '💀', 6, 0, [], [X('allyDestroyed', 'token', { n: 1, tp: 1000, lim: 'turn1' })]),
    C('b_titan', '鋼の巨人', '🤖', 7, 0),
    C('b_commander', '軍団長', '🎖️', 7, 0, ['guard'], [X('summon', 'buff', { n: 500, tgt: T('ally', 'all'), dur: 'perm' })]),
    C('b_necromancer', '死霊術師', '🧟', 7, 0, [], [X('summon', 'reanimate', { n: 5 })]),
    C('b_phoenix', '不死鳥', '🔥', 8, 0, ['haste', 'undying', 'drain']),
    C('b_leviathan', '深淵の巨獣', '🐋', 10, 0),
    C('b_dragon', '古竜', '🐲', 12, 0, [], [X('summon', 'weaken', { n: 2000, tgt: T('enemy', 'all'), dur: 'turn' })]),
    C('b_stargazer', '星読みの導師', '🔭', 15, 0, ['guard', 'undying', 'ward'], [X('summon', 'rampMax', { n: 3 }), X('turnStart', 'draw', { n: 1 })]),
    C('b_worldeater', '世界喰らい', '🌑', 20, 0, ['double', 'assassin'], [X('summon', 'draw', { n: 2 })]),

    // ── 呪文 ──
    S('b_zap', '雷撃', '⚡', 1, [X('cast', 'destroy', { tgt: T('enemy', 1, 'choose', 'powerLE', 1000) })]),
    S('b_insight', '知恵の泉', '📘', 2, [X('cast', 'draw', { n: 3 })]),
    S('b_growth', '大地の恵み', '🌱', 2, [X('cast', 'rampMax', { n: 1 }), X('cast', 'draw', { n: 1 })]),
    S('b_rain', '癒しの雨', '🌧️', 2, [X('cast', 'heal', { n: 2000 }), X('cast', 'draw', { n: 1 })]),
    S('b_parry', '受け流し', '🔰', 2, [X('react', 'weaken', { n: 1000, tgt: T('attacker'), dur: 'turn' }), X('react', 'draw', { n: 1 })]),
    S('b_tome', '禁書の頁', '📖', 1, [X('cast', 'loot', { n: 3 })]),
    S('b_fireball', '火球', '☄️', 3, [X('cast', 'burn', { n: 2000 })]),
    S('b_mindrot', '心砕き', '🌀', 3, [X('cast', 'oppDiscard', { n: 2 }), X('cast', 'draw', { n: 1 })]),
    S('b_rally', '鬨の声', '📯', 3, [X('cast', 'buff', { n: 1000, tgt: T('ally', 'all'), dur: 'turn' }), X('cast', 'draw', { n: 1 })]),
    S('b_gust', '送還の風', '🍃', 3, [X('cast', 'bounce', { tgt: T('enemy') }), X('cast', 'draw', { n: 1 })]),
    S('b_frost', '氷の吐息', '❄️', 3, [X('cast', 'freeze', { tgt: T('enemy') }), X('cast', 'draw', { n: 2 })]),
    S('b_negate', '打ち消しの印', '🚫', 5, [X('counter', 'negate')]),
    S('b_peek', '記憶の盗人', '👁️', 3, [X('cast', 'oppDiscardPick', { n: 1 }), X('cast', 'draw', { n: 1 })]),
    S('b_smite', '断罪の光', '✨', 4, [X('cast', 'destroy', { tgt: T('enemy', 1, 'choose', 'powerLE', 4000) }), X('cast', 'draw', { n: 1 })]),
    S('b_pitfall', '落とし穴', '🕳️', 4, [X('react', 'destroy', { tgt: T('attacker') })]),
    S('b_seal', '封印の呪', '🔒', 6, [X('cast', 'spellLock'), X('cast', 'oppDiscard', { n: 1 }), X('cast', 'draw', { n: 1 })]),
    S('b_shock', '衝撃波', '💥', 5, [X('cast', 'weaken', { n: 2000, tgt: T('enemy', 'all'), dur: 'turn' }), X('cast', 'tap', { tgt: T('enemy', 'all') })]),
    S('b_hush', '静寂の鐘', '🔕', 4, [X('cast', 'spellLockLE', { n: 3 }), X('cast', 'draw', { n: 1 })]),
    S('b_tombseal', '墓所の封印', '🪦', 3, [X('cast', 'graveLock'), X('cast', 'draw', { n: 1 })]),
    S('b_drought', '魔力の枯渇', '🏜️', 4, [X('cast', 'manaCap', { n: 5 }), X('cast', 'draw', { n: 1 })]),
    S('b_snare', '足止めの罠', '🪤', 4, [X('react', 'attackLimit', { n: 1 })]),
    S('b_charm', '魅了の歌', '💘', 5, [X('cast', 'steal', { tgt: T('enemy', 1, 'choose', 'powerLE', 4000), dur: 'perm' })]),
    S('b_tempest', '大嵐', '🌪️', 9, [X('cast', 'destroy', { tgt: T('enemy', 'all') })]),
  ];

  const MAP = new Map(BASE.map((c) => [c.id, c]));
  const get = (id) => MAP.get(id);

  return { BASE, get, X, T };
});
