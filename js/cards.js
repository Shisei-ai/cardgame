/*
 * cards.js — カードの定義（カードプール）
 *
 * カードの追加・調整はこのファイルだけで完結するようにしています。
 *
 * ■ 基本項目
 *   id       : 内部ID（デッキ保存に使うので変更しないこと）
 *   name     : 表示名
 *   type     : 種類（TYPES のキー）。'creature'（クリーチャー）/ 'spell'（呪文）/ 'relic'（レリック）の3つ
 *   tags     : 検索タグ（TAGS のキーの配列）。呪文は先頭が主なタグ。効果の文章からも自動で付く（untag で外せる）
 *   cost     : 必要マナ
 *   hpCost   : 追加で支払う体力（血の契約）。体力がこの値以下だと使えない
 *   cast     : 詠唱時間（秒）。0 なら「瞬間」= 即座に発動し、打ち消されない
 *   counter  : 【カウンター】カウンターステップでも使える（その時は詠唱なしで発動）
 *   text     : カードの説明文
 *   icon     : 仮アート（絵文字）
 *   tier     : 設計上の強さ（内部用・プレイヤーには非表示）
 *              'weak'=弱カード / 'niche'=局所的に光るカード / 'strong'=強カード
 *   arch     : 主に活躍するテーマ（ARCHES のキーの配列）。デッキ構築画面の絞り込みに使う
 *
 * ■ レリック（type: 'relic'）
 *   クリーチャーと同じように場に出て場の枠（上限5）を使うが、攻撃は一切しない。hp は「耐久」。
 *   「クリーチャー」を対象にする効果は効かない（relics: true の対象指定や、場全体への効果は別）。
 *   守護を持てる。生贄にできる。壊れても「クリーチャーが倒れるたび」の効果は誘発しない。
 *
 * ■ クリーチャー専用
 *   atk, hp  : 攻撃力と体力
 *   guard    : 守護。敵クリーチャーの攻撃を本体の代わりに受ける
 *   stealth  : 潜伏。攻撃時に守護を無視して本体を狙う
 *   lifesteal: 吸血。与えたダメージ分、自分の体力を回復
 *   double   : 連撃。召喚時に2回攻撃する
 *   undying  : 不屈。最初に倒れた時、体力1で踏みとどまる
 *   armor    : 堅牢。受けるダメージをこの値だけ減らす
 *   pierce   : 貫通。守護に受け止められても、余ったダメージは本体に届く
 *   その他の能力（onSummon, onDeath, onPhase など）は engine.js 冒頭の説明を参照
 *
 * ■ 効果と使用条件
 *   effect(g, me, op)   : 呪文の効果
 *   costMod(g, me)      : コストの増減（墓地の枚数で安くなる、など）
 *   canUse(g, me, op)   : 使用条件。false を返すと使えない（needText が理由として表示される）
 *   noCopy              : 秘術の模倣でコピーされない
 *
 * ■ AI用
 *   ai(g, me, op)       : 呪文を使う価値（大きいほど優先、0以下は使わない）
 *   aiBonus(g, me, op)  : クリーチャーの基本評価に足す値
 *   reactive            : 相手の詠唱に反応して使うカード（通常時は使わない）
 *   react(g, me, op, threat, L) : 相手の詠唱に反応する価値
 *   threat              : 相手から見て「打ち消すべきか」の脅威度
 *   counterAi(g, me, op, t) : カウンターステップで使う価値（t は対象）。0以下なら使わない
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Cards = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // カードの種類は3つだけ。呪文の「攻撃」「妨害」などは検索タグ（TAGS）で表す
  const TYPES = {
    creature: { label: 'クリーチャー', color: '#3d8b50', glyph: '⚔' },
    spell:    { label: '呪文',         color: '#5a6fb8', glyph: '✦' },
    relic:    { label: 'レリック',     color: '#9a7b3c', glyph: '◈' },
  };

  // 検索タグ。デッキ構築で絞り込みに使う。呪文は先頭のタグの色でカードの枠を塗る
  //   カードに書いた tags に加えて、効果の文章から自動で付く（autoTags）。付けたくないものは untag に書く
  const TAGS = {
    attack:  { label: '攻撃',       color: '#b8433a', glyph: '✹', desc: '敵本体へのダメージ、攻撃を増やす' },
    removal: { label: '除去',       color: '#9a3a5a', glyph: '✂', desc: '敵のクリーチャー・レリックを倒す、手札に戻す' },
    disrupt: { label: '妨害',       color: '#7a4fb0', glyph: '✖', desc: '打ち消し・封印・手札破壊・マナ破壊・能力消し' },
    draw:    { label: 'ドロー',     color: '#3a6fb8', glyph: '❖', desc: 'カードを引く、手札に加える' },
    mana:    { label: 'マナ',       color: '#c9962b', glyph: '◆', desc: 'マナを得る、回復を速くする、コストを下げる' },
    heal:    { label: '回復・防御', color: '#3aa3a8', glyph: '✚', desc: '体力の回復、防壁、守護、味方を守る' },
    summon:  { label: '召喚',       color: '#6f9a3a', glyph: '✧', desc: 'トークンの生成、復活、コストなしの召喚' },
    buff:    { label: '強化',       color: '#c0702a', glyph: '⬆', desc: '味方の攻撃力・体力を上げる' },
  };
  const ARCHES = {
    aggro:    { label: '速攻',     desc: '軽いクリーチャーと火力で、相手が構える前に押し切る' },
    swarm:    { label: '群れ',     desc: '数を並べ、全体攻撃や強化でまとめて殴る' },
    control:  { label: '妨害',     desc: '打ち消し・封印・除去で相手に何もさせない' },
    grave:    { label: '墓地',     desc: '墓地を肥やし、倒れたクリーチャーを力に変える' },
    spell:    { label: '呪文連鎖', desc: '呪文を連打し、詠唱短縮・踏み倒しで畳みかける' },
    blood:    { label: '血の契約', desc: '体力をコストに先手を取る。追い詰められるほど強い' },
    fortress: { label: '城塞',     desc: '守護を並べて耐え、守りの厚さを攻撃に転じる' },
    growth:   { label: '成長',     desc: '時間とともに育つクリーチャーで終盤を制する' },
    ramp:     { label: '巨獣',     desc: 'マナを伸ばし、コストを踏み倒して巨大な一撃を' },
    discard:  { label: '捨て札',   desc: '手札を捨てて引き直し、捨てられて目覚める【狂気】で畳みかける' },
    sacrifice:{ label: '生贄',     desc: '弱い味方を差し出して、巨大なクリーチャーを呼ぶ' },
    generic:  { label: '汎用',     desc: 'どんなデッキにも入る' },
  };

  const TIERS = { weak: '弱', niche: '局所', strong: '強' };

  // ── 効果やAI評価で使う小さな関数 ──
  const isUnit = (c) => c.type === 'creature' || c.type === 'relic'; // 場に出るカード
  const isSpell = (c) => !isUnit(c);                                // 呪文（場に出ないカード）
  const crs = (p) => p.field.filter((u) => !u.relic);               // 場のクリーチャーだけ（レリックを除く）
  const fieldPower = (g, p) => crs(p).reduce((s, u) => s + g.atkOf(p, u), 0);
  const missingHp = (g, p) => g.cfg.startHP - p.hp;
  const restPhases = (g) => g.phasesLeft(); // 試合の残りフェーズ数（今のフェーズの残りを小数で含む）
  const strongest = (g, p) => crs(p).reduce((b, u) => (!b || g.atkOf(p, u) > g.atkOf(p, b) ? u : b), null);
  // 最も弱い味方（攻撃予約を持つものは、予約が無駄になるので後回し）
  const weakest = (g, p) => { const w = (u) => u.atk + u.hp + g.reservedOf(u.uid) * (u.atk + 2); return p.field.reduce((b, u) => (!b || w(u) < w(b) ? u : b), null); };
  const guardsOf = (p) => p.field.filter((u) => u.guard);
  // 味方全員で times 回ずつ攻撃したとき、本体に届く見込みのダメージ。
  // 場の順に攻撃し、潜伏以外の攻撃は、使える守護が残っている限りそちらに受け止められる
  const expectedFace = (g, me, op, times = 1) => {
    const guards = g.readyGuards(op).map((u) => u.hp + (u.armor || 0)).sort((a, b) => b - a);
    let face = 0;
    for (let k = 0; k < times; k++) {
      for (const u of crs(me)) {
        const atk = g.atkOf(me, u);
        if (u.stealth || !guards.length) face += atk;
        else { const gh = guards.shift(); if (u.pierce) face += Math.max(0, atk - gh); }
      }
    }
    return face;
  };
  const room = (g, p) => g.cfg.fieldLimit - p.field.length;
  // ── カウンターステップ用（AIの判断） ──
  // owner の予約（攻撃と本体へのダメージ）が、クロノホールで相手本体に与える見込みのダメージ。
  // opts.extraGuard: 相手に守護（その体力）が1体増えたら / opts.noGuard: 相手の守護 unit が守護を失ったら / opts.without: 予約から除く uid
  const pendingFace = (g, owner, opts = {}) => {
    const op = g.opp(owner);
    const guards = g.readyGuards(op).filter((u) => u !== opts.noGuard).map((u) => u.hp + (u.armor || 0));
    if (opts.extraGuard) guards.push(opts.extraGuard);
    guards.sort((a, b) => b - a);
    let face = 0;
    for (const r of g.queue) {
      if (r.kind === 'damage') { if (r.target === op.index) face += r.amount; continue; }
      if (r.pi !== owner.index || r.uid === opts.without) continue;
      const u = owner.field.find((x) => x.uid === r.uid);
      if (!u) continue;
      const atk = g.atkOf(owner, u);
      if (u.stealth || !guards.length) face += atk;
      else { const gh = guards.shift(); if (u.pierce) face += Math.max(0, atk - gh); }
    }
    return face;
  };
  // 相手の予約を1体分なくしたら、自分が受けるダメージがどれだけ減るか
  const threatOf = (g, t) => pendingFace(g, t.owner) - pendingFace(g, t.owner, { without: t.unit.uid });
  // 受けるダメージが致命的なら大きく評価する（体力を守る系のカウンター用）
  const savedValue = (g, me, saved) => { const inc = pendingFace(g, g.opp(me)); return saved + (inc >= me.hp && inc - saved < me.hp ? 20 : 0); };
  const spellIdsInHand = (p) => p.hand.filter((id) => isSpell(get(id)));
  // 相手が詠唱中のカードが、指定の種類かタグのどれかに当てはまるか（例：opCastingIs(op, 'attack', 'creature')）
  const opCastingIs = (op, ...kinds) => op.casting && kinds.some((k) => op.casting.card.type === k || (op.casting.card.tags || []).includes(k));
  // 手札にある【狂気】カードの数（捨てる効果の価値が上がる）
  const madnessInHand = (p) => p.hand.filter((id) => get(id).onDiscard).length;
  // 手札にある「生贄を使うカード」の数（生贄要員の価値が上がる）
  const sacPayoffInHand = (p) => p.hand.filter((id) => get(id).sacCost || id === 'offering').length;
  // 対象（ctx.target）が、発動時点でもまだ場にいれば返す
  const alive = (ctx) => (ctx && ctx.target && ctx.target.owner.field.includes(ctx.target.unit) ? ctx.target : null);
  // AI用：クリーチャーの価値、ダメージで倒せる場合の価値、能力の価値
  const unitValue = (g, t) => g.atkOf(t.owner, t.unit) + t.unit.hp * 0.5 + abilityValue(t.unit) + (t.unit.token ? -1 : 0);
  const killValue = (g, t, dmg) => (t.unit.hp + (t.unit.armor || 0) <= dmg ? unitValue(g, t) : dmg * 0.3);
  const abilityValue = (u) => { const d = get(u.id); if (u.muted) return 0; let v = 0; if (u.guard) v += 1.5; if (u.auto) v += 3; if (u.stealth || u.lifesteal || u.pierce) v += 1; if (d.auraAtk || d.auraCost || d.auraCast || d.auraLifesteal) v += 3; if (d.onPhase || d.onAllyPlay || d.onEnemyPlay || d.onAnyDeath || d.onAllySummon || d.onLifeLoss || d.onHeal || d.onBlock || d.onAllyDiscard || d.onGrow) v += 2.5; return v; };
  const growPriority = (u) => (get(u.id).onGrow ? 10 : 0) + (u.auto ? 5 : 0) + u.atk;
  const sacPriority = (u) => (get(u.id).onDeath ? 10 : 0) + (u.token ? 5 : 0) - (u.atk + u.hp) * 0.3 + u.atk * 0.5;

  const LIST = [
    // ═══════════════════ クリーチャー ═══════════════════
    // ── 速攻 ──
    { id: 'squire', name: '見習い剣士', type: 'creature', cost: 1, cast: 0.8, atk: 2, hp: 2, icon: '🗡️',
      tier: 'weak', arch: ['aggro', 'swarm'], text: '' },
    { id: 'firerat', name: '火吹き鼠', type: 'creature', cost: 1, cast: 0.5, atk: 2, hp: 1, icon: '🐀',
      tier: 'niche', arch: ['aggro'], text: '召喚時、敵本体に1ダメージ。',
      onSummon(g, me, op) { g.damagePlayer(op, 1, '火吹き鼠'); }, aiBonus: () => 1 },
    { id: 'wolf', name: '疾風の狼', type: 'creature', cost: 2, cast: 0.6, atk: 3, hp: 2, icon: '🐺',
      tier: 'niche', arch: ['aggro'], text: '詠唱が非常に速い。' },
    { id: 'raider', name: '略奪兵', type: 'creature', cost: 2, cast: 0.8, atk: 2, hp: 2, icon: '🪓',
      double: true, pierce: true, tier: 'strong', arch: ['aggro'], text: '' },
    { id: 'slinger', name: '投石兵', type: 'creature', cost: 2, cast: 1.5, atk: 1, hp: 2, icon: '🪨',
      tier: 'weak', arch: ['aggro'], text: '召喚時、敵本体に1ダメージ。',
      onSummon(g, me, op) { g.damagePlayer(op, 1, '投石兵'); } },
    { id: 'imp', name: '炎の小鬼', type: 'creature', cost: 3, cast: 1.5, atk: 2, hp: 2, icon: '😈',
      tier: 'niche', arch: ['aggro'], text: '召喚時、敵本体に2ダメージ。',
      onSummon(g, me, op) { g.damagePlayer(op, 2, '炎の小鬼'); } },
    { id: 'kamikaze', name: '決死隊', type: 'creature', cost: 3, cast: 1.0, atk: 4, hp: 1, icon: '🎌',
      pierce: true, tier: 'weak', arch: ['aggro', 'grave'], text: '攻撃した後、自壊する。',
      afterAttack(g, me, op, unit) { g.destroyUnit(me, unit); } },
    { id: 'assassin', name: '影の暗殺者', type: 'creature', cost: 4, cast: 1.5, atk: 4, hp: 2, icon: '🥷',
      stealth: true, tier: 'niche', arch: ['aggro'], text: '' },

    // ── 群れ ──
    { id: 'bannerman', name: '号令の旗手', type: 'creature', cost: 2, cast: 1.0, atk: 1, hp: 2, icon: '🚩',
      auraAtk: 1, tier: 'strong', arch: ['swarm'], text: '場にいる間、他の味方の攻撃力+1。',
      aiBonus: (g, me) => crs(me).length * 1.2 },
    { id: 'herald', name: '戦場の伝令', type: 'creature', cost: 3, cast: 1.0, atk: 2, hp: 2, icon: '📣',
      tier: 'niche', arch: ['swarm', 'aggro'], text: '召喚時、他の味方全員+1/+1。',
      onSummon(g, me, op, unit) { crs(me).forEach((u) => { if (u !== unit) g.buff(u, 1, 1); }); },
      aiBonus: (g, me) => crs(me).length * 1.0 },
    { id: 'wolfmother', name: '狼の母', type: 'creature', cost: 3, cast: 1.5, atk: 2, hp: 3, icon: '🐺',
      tier: 'niche', arch: ['swarm'], text: '召喚時、子狼(1/1)を2体生成。',
      onSummon(g, me) { g.summon(me, 't_pup', { attack: false }); g.summon(me, 't_pup', { attack: false }); },
      aiBonus: (g, me) => Math.min(2, room(g, me) - 1) * 1.2 },
    { id: 'librarian', name: '魔導書の番人', type: 'creature', cost: 3, cast: 1.5, atk: 2, hp: 3, icon: '📖',
      tier: 'niche', arch: ['generic', 'spell'], text: '召喚時、カードを1枚引く。',
      onSummon(g, me) { g.draw(me, 1); }, aiBonus: () => 1.5 },
    { id: 'packleader', name: '群れの長', type: 'creature', cost: 5, cast: 2.0, atk: 3, hp: 4, icon: '🐾',
      tier: 'strong', arch: ['swarm'], text: '召喚時、他の味方クリーチャー全員も攻撃する。',
      onSummon(g, me, op, unit) { crs(me).filter((u) => u !== unit).forEach((u) => g.attack(me, u)); },
      aiBonus: (g, me, op) => expectedFace(g, me, op) * 0.9, threat: 5 },

    // ── 墓地 ──
    { id: 'gravekid', name: '墓守りの少年', type: 'creature', cost: 1, cast: 0.8, atk: 1, hp: 2, icon: '⚰️',
      tier: 'niche', arch: ['grave'], text: '召喚時、山札の上から3枚を墓地へ置く。',
      onSummon(g, me) { g.mill(me, 3); }, aiBonus: () => 1 },
    { id: 'lostghost', name: '迷える亡霊', type: 'creature', cost: 2, cast: 1.5, atk: 1, hp: 1, icon: '👻',
      tier: 'weak', arch: ['grave'], text: '倒れた時、カードを1枚引く。',
      onDeath(g, me) { g.draw(me, 1); } },
    { id: 'bonesoldier', name: '骨の兵隊', type: 'creature', cost: 2, cast: 1.0, atk: 3, hp: 2, icon: '🦴',
      tier: 'niche', arch: ['grave', 'swarm'], text: '倒れた時、骸骨兵(1/1)を2体生成。',
      onDeath(g, me) { g.summon(me, 't_skeleton', { attack: false }); g.summon(me, 't_skeleton', { attack: false }); }, aiBonus: () => 1.5 },
    { id: 'ghoul', name: '腐肉喰らい', type: 'creature', cost: 2, cast: 1.0, atk: 2, hp: 3, icon: '🧟',
      tier: 'niche', arch: ['grave'], text: 'いずれかのクリーチャーが倒れるたび、+1/+1。',
      onAnyDeath(g, me, op, unit) { g.buff(unit, 1, 1); }, aiBonus: (g, me, op) => (crs(me).length + crs(op).length) * 0.4 },
    { id: 'wraith', name: '怨霊', type: 'creature', cost: 2, cast: 1.2, atk: 2, hp: 1, icon: '🫥',
      undying: true, stealth: true, tier: 'niche', arch: ['grave', 'aggro'], text: '' },
    { id: 'necromancer', name: '死霊術師', type: 'creature', cost: 3, cast: 2.0, atk: 3, hp: 3, icon: '🧙',
      tier: 'strong', arch: ['grave'], text: '召喚時、自分の墓地で最もコストの高いクリーチャー1体を復活させる。',
      onSummon(g, me) { g.reviveFromGrave(me, 'highest'); },
      aiBonus: (g, me) => (g.graveCreatures(me) ? 3 : -1), threat: 5 },
    { id: 'corpsegiant', name: '屍の巨人', type: 'creature', cost: 8, cast: 3.0, atk: 8, hp: 8, icon: '🧌',
      tier: 'strong', arch: ['grave'], text: '自分の墓地のカード3枚につき、コスト-2。',
      costMod: (g, me) => -Math.floor(me.grave.length / 3) * 2, threat: 7 },

    // ── 呪文連鎖 ──
    { id: 'apprentice', name: '見習い魔導士', type: 'creature', cost: 2, cast: 1.0, atk: 1, hp: 3, icon: '🧑‍🎓',
      tier: 'niche', arch: ['spell'], text: '自分が呪文を使うたび、敵本体に1ダメージ。',
      onAllyPlay(g, me, op, unit, card) { if (isSpell(card)) g.damagePlayer(op, 1, '見習い魔導士'); },
      aiBonus: (g, me) => spellIdsInHand(me).length * 0.6 },
    { id: 'chantmaster', name: '詠唱の達人', type: 'creature', cost: 2, cast: 1.5, atk: 2, hp: 3, icon: '📜',
      tier: 'niche', arch: ['spell'], text: '場にいる間、自分の呪文の詠唱時間が半分になる。',
      auraCast: (g, me, card) => (isSpell(card) ? 0.5 : 1),
      aiBonus: (g, me) => spellIdsInHand(me).length * 0.4 },
    { id: 'arcane', name: 'アルカナの賢者', type: 'creature', cost: 4, cast: 2.5, atk: 3, hp: 4, icon: '🔯',
      tier: 'strong', arch: ['spell'], text: '召喚時、手札の呪文2枚をランダムにコストなしで発動する。',
      onSummon(g, me, op) {
        for (let k = 0; k < 2; k++) {
          const usable = me.hand.map((id, i) => i).filter((i) => {
            const c = get(me.hand[i]);
            return isSpell(c) && !c.reactive && (!c.canUse || c.canUse(g, me, op));
          });
          if (!usable.length) return;
          const id = me.hand.splice(usable[Math.floor(g.rand() * usable.length)], 1)[0];
          g.playFree(me, id);
        }
      },
      aiBonus: (g, me) => (spellIdsInHand(me).length ? 3 : 0), threat: 6 },

    // ── 血の契約 ──
    { id: 'bloodpact', name: '血の盟約者', type: 'creature', cost: 0, hpCost: 3, cast: 1.0, atk: 4, hp: 3, icon: '🩸',
      tier: 'niche', arch: ['blood'], text: '' },
    { id: 'berserker', name: '狂戦士', type: 'creature', cost: 3, cast: 1.0, atk: 2, hp: 3, icon: '😡',
      pierce: true, tier: 'niche', arch: ['blood', 'aggro'], text: '召喚時、自分の体力が30以下なら攻撃力+3。',
      onSummon(g, me, op, unit) { if (me.hp <= 30) g.buff(unit, 3, 0); },
      aiBonus: (g, me) => (me.hp <= 30 ? 3 : 0) },
    { id: 'bat', name: '吸血蝙蝠', type: 'creature', cost: 3, cast: 1.2, atk: 2, hp: 4, icon: '🦇',
      lifesteal: true, tier: 'niche', arch: ['blood', 'control'], text: '' },
    { id: 'vampirelord', name: '吸血鬼の君主', type: 'creature', cost: 5, cast: 3.5, atk: 3, hp: 6, icon: '🧛',
      lifesteal: true, double: true, tier: 'strong', arch: ['blood'], text: '', threat: 8 },

    // ── 城塞 ──
    { id: 'stonewall', name: '石壁', type: 'relic', cost: 2, cast: 0.8, atk: 0, hp: 3, icon: '🧱',
      guard: true, tier: 'weak', arch: ['fortress'], text: '' },
    { id: 'shieldman', counter: true, counterAi: (g, me, op) => savedValue(g, me, pendingFace(g, op) - pendingFace(g, op, { extraGuard: 4 })) - 0.5, name: '盾持ちの兵', type: 'creature', cost: 2, cast: 1.0, atk: 1, hp: 4, icon: '🛡️',
      guard: true, tier: 'niche', arch: ['fortress', 'control'], text: '' },
    { id: 'ironwarden', name: '鉄の番兵', type: 'creature', cost: 3, cast: 1.5, atk: 2, hp: 4, icon: '🏯',
      guard: true, armor: 1, tier: 'niche', arch: ['fortress'], text: '' },
    { id: 'thornguard', name: '茨の盾兵', type: 'creature', cost: 3, cast: 1.5, atk: 1, hp: 4, icon: '🌵',
      guard: true, tier: 'niche', arch: ['fortress'], text: '攻撃を受け止めるたび、敵本体に1ダメージ。',
      onBlock(g, me, op) { g.damagePlayer(op, 1, '茨の盾兵'); } },
    { id: 'golem', name: '鉄壁ゴーレム', type: 'creature', cost: 4, cast: 2.5, atk: 2, hp: 6, icon: '🗿',
      guard: true, tier: 'niche', arch: ['fortress', 'control'], text: '' },
    { id: 'castellan', name: '城塞の主', type: 'creature', cost: 6, cast: 2.5, atk: 3, hp: 6, icon: '🏰',
      guard: true, tier: 'strong', arch: ['fortress'], text: 'フェーズ開始時、自分の防壁+1。',
      onPhase(g, me) { g.addShield(me, 1); }, aiBonus: () => 3 },
    { id: 'oldfort', name: '古びた砦', type: 'relic', cost: 5, cast: 3.0, atk: 0, hp: 10, icon: '🏚️',
      guard: true, tier: 'weak', arch: ['fortress'], text: '' },

    // ── 成長 ──
    { id: 'seedling', name: '芽吹く種', type: 'creature', cost: 1, cast: 0.8, atk: 1, hp: 2, icon: '🌱',
      tier: 'niche', arch: ['growth'], text: 'フェーズ開始時、+1/+1。',
      onPhase(g, me, op, unit) { g.buff(unit, 1, 1); },
      aiBonus: (g) => restPhases(g) * 1.2 },
    { id: 'mossrock', name: '苔むした岩', type: 'relic', cost: 3, cast: 1.5, atk: 0, hp: 4, icon: '🪨',
      guard: true, tier: 'weak', arch: ['growth', 'fortress'], text: 'フェーズ開始時、耐久+1。',
      onPhase(g, me, op, unit) { g.buff(unit, 0, 1); } },
    { id: 'spirittree', name: '大樹の精', type: 'creature', cost: 4, cast: 2.0, atk: 2, hp: 5, icon: '🌳',
      guard: true, tier: 'niche', arch: ['growth', 'fortress'], text: 'フェーズ開始時、味方全員+0/+1、自分の体力を1回復。',
      onPhase(g, me) { crs(me).forEach((u) => g.buff(u, 0, 1)); g.heal(me, 1); }, aiBonus: () => 2 },
    { id: 'forestking', name: '森の王', type: 'creature', cost: 6, cast: 2.5, atk: 4, hp: 4, icon: '🦌',
      tier: 'strong', arch: ['growth', 'swarm'], text: '召喚時、自身を含む味方全員+2/+2。',
      onSummon(g, me) { crs(me).forEach((u) => g.buff(u, 2, 2)); },
      aiBonus: (g, me) => 3 + crs(me).length * 2.5, threat: 7 },

    // ── 巨獣 ──
    { id: 'egg', name: '原初の卵', type: 'relic', cost: 1, cast: 0.8, atk: 0, hp: 3, icon: '🥚',
      tier: 'niche', arch: ['ramp', 'grave'], text: '壊れた時、山札で最もコストの高いクリーチャーを召喚。',
      onDeath(g, me) {
        let best = -1;
        me.deck.forEach((id, i) => { const c = get(id); if (c.type === 'creature' && (best < 0 || c.cost > get(me.deck[best]).cost)) best = i; });
        if (best >= 0) g.summon(me, me.deck.splice(best, 1)[0]);
      } },
    { id: 'beastmaster', name: '巨獣使い', type: 'creature', cost: 3, cast: 1.5, atk: 2, hp: 2, icon: '🧑‍🌾',
      tier: 'niche', arch: ['ramp'], text: '場にいる間、自分のコスト5以上のカードの詠唱時間が半分になる。',
      auraCast: (g, me, card) => (card.cost >= 5 ? 0.5 : 1),
      aiBonus: (g, me) => me.hand.filter((id) => get(id).cost >= 5).length * 1.5 },
    { id: 'mercenary', name: '傭兵', type: 'creature', cost: 4, cast: 2.0, atk: 4, hp: 4, icon: '💰',
      tier: 'weak', arch: ['generic'], text: '' },
    { id: 'archer', name: '見張りの弓兵', type: 'creature', cost: 3, cast: 1.5, atk: 2, hp: 3, icon: '🏹',
      tier: 'weak', arch: ['generic'], text: '' },
    { id: 'knight', name: '雷鳴の騎士', type: 'creature', cost: 5, cast: 2.5, atk: 5, hp: 4, icon: '⚡',
      pierce: true, tier: 'niche', arch: ['generic', 'ramp'], text: '' },
    { id: 'mammoth', name: '鈍重な巨象', type: 'creature', cost: 6, cast: 3.5, atk: 5, hp: 6, icon: '🦣',
      pierce: true, tier: 'weak', arch: ['ramp'], text: '' },
    { id: 'quaker', name: '地を揺らす者', type: 'creature', cost: 6, cast: 2.5, atk: 6, hp: 6, icon: '🦏',
      tier: 'niche', arch: ['ramp'], text: '召喚時、他の全てのクリーチャーに2ダメージ。',
      onSummon(g, me, op, unit) {
        [...crs(me), ...crs(op)].forEach((u) => { if (u !== unit) g._hitUnit(u, 2); });
        g._cleanup();
      },
      aiBonus: (g, me, op) => crs(op).length * 1.5 - crs(me).length, threat: 7 },
    { id: 'dragon', name: '古竜', type: 'creature', cost: 7, cast: 4.0, atk: 7, hp: 7, icon: '🐉',
      tier: 'strong', arch: ['ramp'], text: '召喚時、敵クリーチャー全てに2ダメージ。',
      onSummon(g, me, op) { [...crs(op)].forEach((u) => g._hitUnit(u, 2)); g._cleanup(); },
      threat: 10 },
    { id: 'titan', name: '大地の巨人', type: 'creature', cost: 10, cast: 5.0, atk: 12, hp: 12, icon: '🗻',
      guard: true, tier: 'niche', arch: ['ramp'], text: '', threat: 12 },

    // ── 妨害 ──
    { id: 'manathorn', name: '魔力の棘', type: 'relic', cost: 2, cast: 1.0, atk: 0, hp: 3, icon: '🌹',
      tier: 'niche', arch: ['control'], text: '相手がカードを使うたび、敵本体に1ダメージ（1フェーズに3回まで）。',
      onPhase(g, me, op, unit) { unit.thorns = 0; },
      onEnemyPlay(g, me, op, unit) { if ((unit.thorns || 0) < 3) { unit.thorns = (unit.thorns || 0) + 1; g.damagePlayer(op, 1, '魔力の棘'); } }, aiBonus: () => 2 },
    { id: 'silencer', name: '静寂の司祭', type: 'creature', cost: 3, cast: 1.5, atk: 2, hp: 3, icon: '🤫',
      tier: 'niche', arch: ['control'], text: '相手が詠唱を始めるたび、その詠唱を0.8秒遅らせる。',
      onEnemyPlay(g, me, op) { if (op.casting) g.delayCasting(op, 0.8); }, aiBonus: () => 1.5 },

    // ═══════════════════ 召喚術 ═══════════════════
    { id: 'reinforce', name: '増援要請', type: 'spell', tags: ['summon'], cost: 1, cast: 1.0, icon: '🪖',
      tier: 'niche', arch: ['swarm'], text: '新兵(1/1)を2体生成（召喚時の攻撃はしない）。',
      canUse: (g, me) => room(g, me) > 0, needText: '場が満杯',
      effect(g, me) { for (let i = 0; i < 2; i++) g.summon(me, 't_recruit', { attack: false }); },
      ai: (g, me) => Math.min(2, room(g, me)) * 1.4 },
    { id: 'raisedead', name: '死者蘇生', type: 'spell', tags: ['summon'], cost: 3, cast: 2.0, icon: '🪦',
      tier: 'strong', arch: ['grave'], text: '自分の墓地で最もコストの高いクリーチャーを復活させる。',
      canUse: (g, me) => g.graveCreatures(me) > 0, needText: '墓地にクリーチャーがいない',
      effect(g, me) { g.reviveFromGrave(me, 'highest'); },
      ai: (g, me) => { const best = Math.max(0, ...me.grave.map(get).filter((c) => c.type === 'creature').map((c) => c.cost)); return best + 1; },
      threat: 6 },
    { id: 'ancientcall', name: '古代の呼び声', type: 'spell', tags: ['summon'], cost: 4, cast: 0, icon: '📯',
      tier: 'strong', arch: ['ramp'], text: '【瞬間】手札で最もコストの高いクリーチャーを、コストを払わず召喚する（詠唱しないので打ち消されない）。',
      canUse: (g, me) => me.hand.some((id) => get(id).type === 'creature'), needText: '手札にクリーチャーがいない',
      effect(g, me) {
        let best = -1;
        me.hand.forEach((id, i) => { const c = get(id); if (c.type === 'creature' && (best < 0 || c.cost > get(me.hand[best]).cost)) best = i; });
        if (best >= 0) g.playFree(me, me.hand.splice(best, 1)[0]);
      },
      ai: (g, me) => { const m = Math.max(0, ...me.hand.map(get).filter((c) => c.type === 'creature').map((c) => c.cost)); return m >= 6 ? m : 0; },
      threat: 6 },

    // ═══════════════════ 攻撃 ═══════════════════
    { id: 'spark', name: '火花', type: 'spell', tags: ['attack'], cost: 0, cast: 0.5, icon: '✴️',
      tier: 'weak', arch: ['spell'], text: '敵本体に1ダメージ。',
      effect(g, me, op) { g.damagePlayer(op, 1, '火花'); }, ai: () => 1.2 },
    { id: 'bolt', name: 'ファイアボルト', type: 'spell', tags: ['attack'], cost: 2, cast: 1.0, icon: '🔥',
      tier: 'strong', arch: ['aggro', 'spell'], text: '敵本体に3ダメージ。',
      effect(g, me, op) { g.damagePlayer(op, 3, 'ファイアボルト'); }, ai: () => 3 },
    { id: 'bloodblade', name: '血の刃', type: 'spell', tags: ['attack'], cost: 1, hpCost: 2, cast: 0.8, icon: '🩸',
      tier: 'niche', arch: ['blood'], text: '敵本体に4ダメージ。',
      effect(g, me, op) { g.damagePlayer(op, 4, '血の刃'); }, ai: () => 3.5 },
    { id: 'charge', name: '突撃命令', type: 'spell', tags: ['attack'], cost: 3, cast: 1.5, icon: '📯',
      tier: 'strong', arch: ['swarm'], text: '味方クリーチャー全員が攻撃する。',
      canUse: (g, me) => crs(me).length > 0, needText: '味方がいない',
      effect(g, me) { [...crs(me)].forEach((u) => g.attack(me, u)); },
      ai: (g, me, op) => expectedFace(g, me, op) * 0.9 - 1, threat: 4 },
    { id: 'desperate', name: '捨て身の一撃', type: 'spell', tags: ['attack'], cost: 3, cast: 1.0, icon: '💢',
      tier: 'niche', arch: ['blood'], text: '自分が失っている体力の1/3（切り捨て、最大10）のダメージを敵本体に。',
      effect(g, me, op) { g.damagePlayer(op, Math.min(10, Math.floor(missingHp(g, me) / 3)), '捨て身の一撃'); },
      ai: (g, me) => Math.min(10, Math.floor(missingHp(g, me) / 3)) - 1 },
    { id: 'gigantify', name: '巨大化', type: 'spell', tags: ['attack'], cost: 3, cast: 1.0, icon: '🍄',
      tier: 'niche', arch: ['growth'], text: '味方で最も攻撃力の高いクリーチャーを+2/+2し、攻撃させる。',
      canUse: (g, me) => crs(me).length > 0, needText: '味方がいない',
      effect(g, me) { const u = strongest(g, me); if (u) { g.buff(u, 2, 2); g.attack(me, u); } },
      ai: (g, me) => (crs(me).length ? 4.5 : 0) },
    { id: 'torrent', name: '魔力の奔流', type: 'spell', tags: ['attack'], cost: 3, cast: 1.5, icon: '🌊',
      tier: 'niche', arch: ['spell'], text: 'このフェーズに使った呪文1枚につき、敵本体に2ダメージ（最大10）。',
      effect(g, me, op) { g.damagePlayer(op, Math.min(10, me.spellsThisPhase * 2), '魔力の奔流'); },
      ai: (g, me) => (me.spellsThisPhase + 1) * 2 - 2 },
    { id: 'rampartcannon', name: '城壁砲', type: 'spell', tags: ['attack'], cost: 4, cast: 1.5, icon: '💣',
      tier: 'niche', arch: ['fortress'], text: '味方の守護（クリーチャー・レリック）1体につき、敵本体に1ダメージ。',
      canUse: (g, me) => guardsOf(me).length > 0, needText: '守護がいない',
      effect(g, me, op) { g.damagePlayer(op, guardsOf(me).length, '城壁砲'); },
      ai: (g, me) => guardsOf(me).length - 0.5 },
    { id: 'duel', name: '一騎討ち', type: 'spell', tags: ['attack'], cost: 4, cast: 1.0, icon: '⚔️',
      tier: 'niche', arch: ['growth', 'aggro'], text: '味方で最も攻撃力の高いクリーチャーが2回攻撃する。',
      canUse: (g, me) => crs(me).length > 0, needText: '味方がいない',
      effect(g, me) { const u = strongest(g, me); if (u) { g.attack(me, u); g.attack(me, u); } },
      ai: (g, me, op) => {
        const u = strongest(g, me);
        if (!u) return 0;
        const atk = g.atkOf(me, u);
        const blocked = u.stealth ? 0 : Math.min(2, g.readyGuards(op).length);
        return atk * (2 - blocked) + (u.pierce ? blocked * Math.max(0, atk - 4) : 0) + blocked * 0.5 - 1.5;
      } },
    { id: 'scorch', name: '焦土', type: 'spell', tags: ['attack'], cost: 4, cast: 1.5, icon: '🔥',
      tier: 'weak', arch: ['aggro'], text: '敵本体と、敵の場のもの全て（クリーチャーとレリック）に1ダメージ。',
      effect(g, me, op) { [...op.field].forEach((u) => g._hitUnit(u, 1)); g._cleanup(); g.damagePlayer(op, 1, '焦土'); },
      ai: (g, me, op) => 1 + op.field.filter((u) => u.hp <= 1).length * 2 },
    { id: 'storm', name: '火炎嵐', type: 'spell', tags: ['attack'], cost: 4, cast: 1.8, icon: '🌋',
      tier: 'niche', arch: ['control'], text: '敵クリーチャー全てに3ダメージ、敵本体に2ダメージ。',
      effect(g, me, op) { [...crs(op)].forEach((u) => g._hitUnit(u, 3)); g._cleanup(); g.damagePlayer(op, 2, '火炎嵐'); },
      ai: (g, me, op) => crs(op).reduce((s, u) => s + Math.min(u.hp, 3) + (u.hp <= 3 ? u.atk : 0), 0) - 1, threat: 5 },
    { id: 'underworld', name: '冥府の門', type: 'spell', tags: ['attack'], cost: 3, cast: 2.0, icon: '🌑',
      tier: 'niche', arch: ['grave'], text: '自分の墓地のクリーチャー1体につき、敵本体に3ダメージ（最大12）。',
      effect(g, me, op) { g.damagePlayer(op, Math.min(12, g.graveCreatures(me) * 3), '冥府の門'); },
      ai: (g, me) => Math.min(12, g.graveCreatures(me) * 3) - 3, threat: 6 },
    { id: 'allout', name: '総攻撃', type: 'spell', tags: ['attack'], cost: 7, cast: 3.0, icon: '🎺',
      tier: 'strong', arch: ['swarm'], text: '味方クリーチャー全員が2回ずつ攻撃する。',
      canUse: (g, me) => crs(me).length > 0, needText: '味方がいない',
      effect(g, me) { for (let k = 0; k < 2; k++) [...crs(me)].forEach((u) => g.attack(me, u)); },
      ai: (g, me, op) => expectedFace(g, me, op, 2) * 0.9 - 2, threat: 7 },
    { id: 'inferno', name: '獄炎', type: 'spell', tags: ['attack'], cost: 6, cast: 3.0, icon: '☄️',
      tier: 'niche', arch: ['spell', 'ramp'], text: '敵本体に7ダメージ。',
      effect(g, me, op) { g.damagePlayer(op, 7, '獄炎'); }, ai: () => 7, threat: 7 },

    // ═══════════════════ ドロー ═══════════════════
    { id: 'foresight', name: '予見', type: 'spell', tags: ['draw'], cost: 1, cast: 0.5, icon: '👁️',
      tier: 'weak', arch: ['generic'], text: 'カードを1枚引く。',
      effect(g, me) { g.draw(me, 1); }, ai: (g, me) => (me.hand.length <= 4 ? 2 : 0) },
    { id: 'whisper', name: '墓所の囁き', type: 'spell', tags: ['draw'], cost: 1, cast: 1.0, icon: '🕯️',
      tier: 'niche', arch: ['grave'], text: '山札の上から3枚を墓地へ置き、カードを1枚引く。',
      effect(g, me) { g.mill(me, 3); g.draw(me, 1); }, ai: () => 2.5 },
    { id: 'painpact', name: '苦痛の契約', type: 'spell', tags: ['draw'], cost: 0, hpCost: 3, cast: 1.0, icon: '📕',
      tier: 'strong', arch: ['blood', 'generic'], text: 'カードを2枚引く。',
      effect(g, me) { g.draw(me, 2); }, ai: (g, me) => (me.hand.length <= 5 && me.hp > g.cfg.startHP * 0.4 ? 4 : 0) },
    { id: 'insight', name: '知識の泉', type: 'spell', tags: ['draw'], cost: 1, cast: 1.2, icon: '💧',
      tier: 'niche', arch: ['generic', 'spell'], text: 'カードを2枚引く。',
      effect(g, me) { g.draw(me, 2); }, ai: (g, me) => (me.hand.length <= 3 ? 4 : me.hand.length <= 6 ? 2 : 0) },
    { id: 'echo', name: '魔力の残響', type: 'spell', tags: ['draw'], cost: 2, cast: 1.0, icon: '🔁',
      tier: 'weak', arch: ['spell'], text: 'カードを1枚引く。このフェーズに他の呪文を2枚以上使っていれば、さらに2枚引く。',
      effect(g, me) { g.draw(me, me.spellsThisPhase >= 3 ? 3 : 1); },
      ai: (g, me) => (me.spellsThisPhase >= 2 ? 4 : 1) },
    { id: 'soulreturn', name: '魂の回収', type: 'spell', tags: ['draw'], cost: 2, cast: 1.0, icon: '🪬',
      tier: 'niche', arch: ['grave'], text: '自分の墓地のカード2枚をランダムに手札に戻す。',
      canUse: (g, me) => me.grave.length > 0, needText: '墓地が空',
      effect(g, me) { g.returnFromGrave(me, 2); }, ai: (g, me) => (me.hand.length <= 6 ? Math.min(2, me.grave.length) * 1.6 : 0) },
    { id: 'abyss', name: '深淵の洞察', type: 'spell', tags: ['draw'], cost: 2, cast: 1.5, icon: '🔮',
      tier: 'niche', arch: ['spell', 'generic'], text: 'カードを3枚引き、マナを1得る。',
      effect(g, me) { g.draw(me, 3); g.addMana(me, 1); }, ai: (g, me) => (me.hand.length <= 3 ? 5 : me.hand.length <= 5 ? 3 : 0) },
    { id: 'grimoire', name: '魔導書の開放', type: 'spell', tags: ['draw'], cost: 3, cast: 1.5, icon: '📚',
      tier: 'niche', arch: ['spell'], text: 'カードを2枚引く。次に使う呪文のコスト-2。',
      effect(g, me) { g.draw(me, 2); me.spellDiscount += 2; }, ai: (g, me) => (me.hand.length <= 6 ? 3.5 : 1) },

    // ═══════════════════ リソース ═══════════════════
    { id: 'drop', name: 'マナの雫', type: 'spell', tags: ['mana'], cost: 0, cast: 0.5, icon: '💠',
      tier: 'niche', arch: ['spell', 'ramp'], text: 'マナを2得る。',
      effect(g, me) { g.addMana(me, 2); },
      ai: (g, me) => (me.hand.some((id) => { const c = g.costOf(me, id); return c > me.mana && c <= me.mana + 2; }) ? 4 : 0) },
    { id: 'bloodrite', name: '生贄の儀', type: 'spell', tags: ['mana'], cost: 0, hpCost: 3, cast: 0.5, icon: '🍷',
      tier: 'niche', arch: ['blood'], text: 'マナを最大値まで回復する。',
      effect(g, me) { g.addMana(me, me.maxMana); },
      ai: (g, me) => (me.hp > g.cfg.startHP * 0.33 && me.hand.some((id) => { const c = g.costOf(me, id); return c > me.mana && c <= me.maxMana; }) && me.maxMana - me.mana >= 4 ? 4 : 0) },
    { id: 'resonance', name: '魔力共鳴', type: 'spell', tags: ['mana'], cost: 1, cast: 1.0, icon: '🌀',
      tier: 'niche', arch: ['ramp'], text: 'マナの回復速度を永続的に+15%する。',
      effect(g, me) { g.addManaRate(me, 0.15); },
      ai: (g) => restPhases(g) * 1.0 },
    { id: 'quickcast', name: '瞬唱', type: 'spell', tags: ['mana'], cost: 1, cast: 0, icon: '💫',
      tier: 'strong', arch: ['spell', 'ramp'], text: '【瞬間】次に使うカードの詠唱時間が0になる。カードを1枚引く。',
      canUse: (g, me) => !me.instantNext, needText: '既に効果中',
      effect(g, me) { me.instantNext = true; g.draw(me, 1); },
      ai: (g, me) => (me.hand.some((id) => get(id).cast >= 2 && g.costOf(me, id) <= me.mana - 1) ? 4.5 : 0) },
    { id: 'accel', name: '時間加速', type: 'spell', tags: ['mana'], cost: 1, cast: 1.0, icon: '⏩',
      tier: 'niche', arch: ['spell'], text: '10秒間、自分の詠唱速度が2倍になる。',
      effect(g, me) { me.haste = 10; },
      ai: (g, me) => (me.hand.filter((id) => get(id).cast >= 1.5).length >= 2 ? 3 : 0) },
    { id: 'altar', name: '生贄の祭壇', type: 'spell', tags: ['mana'], cost: 1, cast: 0.5, icon: '🗡️',
      tier: 'niche', arch: ['grave', 'ramp'], text: '味方で最も弱いもの（クリーチャーかレリック）を破壊し、マナを2得てカードを1枚引く。',
      canUse: (g, me) => me.field.length > 0, needText: '味方がいない',
      effect(g, me) { const u = weakest(g, me); if (u) { g.destroyUnit(me, u); g.addMana(me, 2); g.draw(me, 1); } },
      ai: (g, me) => { const u = weakest(g, me); if (!u) return 0; const full = room(g, me) === 0 && me.hand.some((id) => isUnit(get(id))) ? 2 : 0; return full + (get(u.id).onDeath ? 5 : u.token ? 3 : u.atk + u.hp <= 3 ? 2 : 0); } },
    { id: 'earthpulse', name: '大地の脈動', type: 'spell', tags: ['mana'], cost: 3, cast: 1.5, icon: '🌍',
      tier: 'niche', arch: ['ramp'], text: 'マナの回復速度を永続的に+40%する。',
      effect(g, me) { g.addManaRate(me, 0.4); },
      ai: (g) => restPhases(g) * 1.4 },
    { id: 'mimic', name: '秘術の模倣', type: 'spell', tags: ['mana'], cost: 2, cast: 1.0, icon: '🪞',
      tier: 'niche', arch: ['spell'], noCopy: true, text: '直前に自分が使ったコスト2以下の呪文（対象を選ばないもの）の効果を、もう一度発動する。',
      canUse: (g, me) => !!me.lastSpell && get(me.lastSpell).cost <= 2 && !get(me.lastSpell).target, needText: '直前の呪文がコスト3以上か対象を選ぶもの',
      effect(g, me, op) {
        const c = get(me.lastSpell);
        if (c.canUse && !c.canUse(g, me, op)) { g.log('秘術の模倣は不発', 'info', me.index); return; }
        g.log(`秘術の模倣：【${c.name}】を再現`, 'resolve', me.index);
        c.effect(g, me, op);
      },
      ai: (g, me, op) => { if (!me.lastSpell) return 0; const c = get(me.lastSpell); if (c.reactive || (c.canUse && !c.canUse(g, me, op))) return 0; return c.ai ? c.ai(g, me, op) - 0.5 : c.cost; } },

    // ═══════════════════ 妨害 ═══════════════════
    { id: 'seal', name: '封じ手', type: 'spell', tags: ['disrupt'], cost: 2, cast: 0, icon: '✋',
      tier: 'weak', arch: ['control'], reactive: true, text: '【瞬間】相手が詠唱中のコスト2以下のカードを打ち消す。',
      canUse: (g, me, op) => !!op.casting && op.casting.card.cost <= 2, needText: '対象がない',
      effect(g, me, op) { g.cancelCasting(op, me); },
      react: (g, me, op, threat) => (threat >= 2.5 ? threat : 0) },
    { id: 'jam', name: '詠唱妨害', type: 'spell', tags: ['disrupt'], cost: 1, cast: 0, icon: '⏳',
      tier: 'niche', arch: ['control'], reactive: true, text: '【瞬間】相手の詠唱を2.5秒遅らせる。',
      canUse: (g, me, op) => !!op.casting, needText: '相手が詠唱していない',
      effect(g, me, op) { g.delayCasting(op, 2.5); },
      react: (g, me, op, threat, L) => (threat >= L.counterAt - 1 && op.casting.remain < 1.2 ? threat - 1 : 0) },
    { id: 'counter', name: '打ち消しの印', type: 'spell', tags: ['disrupt'], cost: 2, cast: 0, icon: '🚫',
      tier: 'strong', arch: ['control'], reactive: true, text: '【瞬間】相手が詠唱中のカードを打ち消す。その後2秒間、自分もカードを使えない。',
      canUse: (g, me, op) => !!op.casting, needText: '相手が詠唱していない',
      effect(g, me, op) { g.cancelCasting(op, me); g.silence(me, 2); },
      react: (g, me, op, threat, L) => (threat >= L.counterAt ? threat : 0) },
    { id: 'reflect', name: '呪文返し', type: 'spell', tags: ['disrupt'], cost: 3, cast: 0, icon: '🔃',
      tier: 'niche', arch: ['control'], reactive: true, text: '【瞬間】相手が詠唱中のカードを打ち消し、カードを1枚引く。',
      canUse: (g, me, op) => !!op.casting, needText: '相手が詠唱していない',
      effect(g, me, op) { g.cancelCasting(op, me); g.draw(me, 1); },
      react: (g, me, op, threat, L) => (threat >= L.counterAt + 1 ? threat + 0.5 : 0) },
    { id: 'drain', name: 'マナ枯渇', type: 'spell', tags: ['disrupt'], cost: 2, cast: 0.8, icon: '🕳️',
      tier: 'weak', arch: ['control'], text: '相手のマナを3減らし、自分はマナを1得る。',
      effect(g, me, op) { g.addMana(op, -3); g.addMana(me, 1); },
      ai: (g, me, op) => Math.min(op.mana, 3) * 1.1 },
    { id: 'bloodmist', name: '血の霧', type: 'spell', tags: ['disrupt'], cost: 1, hpCost: 2, cast: 0.8, icon: '🌫️',
      tier: 'weak', arch: ['blood', 'control'], text: '相手のマナを2減らす。',
      effect(g, me, op) { g.addMana(op, -2); }, ai: (g, me, op) => (me.hp > g.cfg.startHP * 0.4 ? Math.min(op.mana, 2) : 0) },
    { id: 'forget', name: '記憶消去', type: 'spell', tags: ['disrupt'], cost: 2, cast: 1.5, icon: '🌀',
      tier: 'weak', arch: ['control'], text: '相手の手札をランダムに1枚捨てさせる。',
      canUse: (g, me, op) => op.hand.length > 0, needText: '相手の手札がない',
      effect(g, me, op) { g.discardRandom(op, 1); }, ai: () => 1.8 },
    { id: 'chains', name: '凍てつく鎖', type: 'spell', tags: ['disrupt'], cost: 1, cast: 0.8, icon: '⛓️',
      tier: 'niche', arch: ['control'], text: '相手は5秒間、カードを使えない。',
      effect(g, me, op) { g.silence(op, 5); },
      ai: (g, me, op) => (op.hand.length >= 2 && op.mana >= 2 ? 3 : 1) },
    { id: 'curse', name: '呪いの刻印', type: 'spell', tags: ['disrupt'], cost: 2, cast: 1.0, icon: '💀',
      tier: 'niche', arch: ['control'], text: '15秒間、相手がカードを使うたびに相手に1ダメージ。',
      canUse: (g, me, op) => op.curse === 0, needText: '既に呪われている',
      effect(g, me, op) { g.curse(op, 15); },
      ai: (g, me, op) => 2.5 + Math.min(op.hand.length, 5) * 0.3 },
    { id: 'execute', name: '暗殺命令', type: 'spell', tags: ['removal'], untag: ['disrupt'], cost: 2, cast: 1.5, icon: '🎯',
      tier: 'strong', arch: ['control', 'generic'], text: '敵で最も攻撃力の高いクリーチャーを破壊する。',
      canUse: (g, me, op) => crs(op).length > 0, needText: '敵クリーチャーがいない',
      effect(g, me, op) { const u = strongest(g, op); if (u) g.destroyUnit(op, u); },
      ai: (g, me, op) => { const u = strongest(g, op); return u ? g.atkOf(op, u) + u.hp * 0.5 : 0; } },
    { id: 'mindbreak', name: '精神破壊', type: 'spell', tags: ['disrupt'], cost: 3, cast: 1.5, icon: '🧠',
      tier: 'niche', arch: ['control'], text: '相手の手札をランダムに2枚捨てさせる。',
      canUse: (g, me, op) => op.hand.length > 0, needText: '相手の手札がない',
      effect(g, me, op) { g.discardRandom(op, 2); },
      ai: (g, me, op) => Math.min(op.hand.length, 2) * 1.8 },
    { id: 'timestop', name: '時間停止', type: 'spell', tags: ['disrupt'], cost: 4, cast: 0, icon: '⌛',
      tier: 'strong', arch: ['control'], reactive: true, text: '【瞬間】相手が詠唱中のカードを打ち消し、相手の時間を3秒間止める（カードを使えない）。',
      canUse: (g, me, op) => !!op.casting, needText: '相手が詠唱していない',
      effect(g, me, op) { g.cancelCasting(op, me); g.stunPlayer(op, 3); },
      react: (g, me, op, threat, L) => (threat >= L.counterAt + 1 ? threat + 1 : 0) },

    // ═══════════════════ 回復・防御 ═══════════════════
    { id: 'barrier', counter: true, counterAi: (g, me) => savedValue(g, me, Math.min(6, pendingFace(g, g.opp(me))) - me.shield * 0.5) - 1, name: '防壁', type: 'spell', tags: ['heal'], cost: 2, cast: 0, icon: '🔰',
      tier: 'niche', arch: ['fortress', 'control'], reactive: true, text: '【瞬間】防壁+6（本体へのダメージを先に吸収する。上限10）。',
      effect(g, me) { g.addShield(me, 6); },
      react: (g, me, op, threat) => (threat >= 3 && opCastingIs(op, 'attack', 'creature') ? 3.5 : 0) },
    { id: 'heal', name: '癒しの光', type: 'spell', tags: ['heal'], cost: 2, cast: 1.5, icon: '✨',
      tier: 'niche', arch: ['generic'], text: '体力を4回復する。',
      effect(g, me) { g.heal(me, 4); }, ai: (g, me) => Math.min(missingHp(g, me), 4) - 1 },
    { id: 'growthsong', name: '成長の歌', type: 'spell', tags: ['buff'], untag: ['heal'], cost: 1, cast: 1.0, icon: '🎶',
      tier: 'niche', arch: ['growth', 'swarm'], text: '味方クリーチャー全員+1/+1。',
      canUse: (g, me) => crs(me).length > 0, needText: '味方がいない',
      effect(g, me) { crs(me).forEach((u) => g.buff(u, 1, 1)); }, ai: (g, me) => crs(me).length * 1.3 - 0.5 },
    { id: 'spring', name: '治癒の泉', type: 'spell', tags: ['heal'], cost: 3, cast: 2.0, icon: '⛲',
      tier: 'weak', arch: ['generic'], text: '体力を3回復し、カードを1枚引く。',
      effect(g, me) { g.heal(me, 3); g.draw(me, 1); }, ai: (g, me) => Math.min(missingHp(g, me), 3) * 0.7 + 1 },
    { id: 'siege', name: '籠城', type: 'spell', tags: ['heal'], cost: 3, cast: 1.5, icon: '🏰',
      tier: 'niche', arch: ['fortress'], text: '味方の守護（クリーチャー・レリック）全て+0/+2、体力を2回復。',
      effect(g, me) { guardsOf(me).forEach((u) => g.buff(u, 0, 2)); g.heal(me, 2); },
      ai: (g, me) => guardsOf(me).length * 1.0 + Math.min(missingHp(g, me), 3) * 0.6 },
    { id: 'sanctuary', name: '聖域', type: 'spell', tags: ['heal'], cost: 4, cast: 2.0, icon: '⛪',
      tier: 'weak', arch: ['fortress', 'growth'], text: '体力を5回復し、味方クリーチャー全員+0/+2。',
      effect(g, me) { g.heal(me, 5); crs(me).forEach((u) => g.buff(u, 0, 2)); },
      ai: (g, me) => Math.min(missingHp(g, me), 5) + crs(me).length - 2 },

    // ╔══════════════════ v0.3 追加分 ══════════════════╗

    // ═════ 捨て札（手札を捨てることを力に変える）═════
    { id: 'ashbook', discards: true, name: '灰燼の書', type: 'spell', tags: ['draw'], cost: 1, cast: 0.8, icon: '📔',
      tier: 'niche', arch: ['discard', 'grave'], text: 'カードを2枚引き、手札をランダムに1枚捨てる。',
      effect(g, me) { g.draw(me, 2); g.discardRandom(me, 1); },
      ai: (g, me) => (me.hand.length <= 7 ? 2.5 + madnessInHand(me) : 0) },
    { id: 'impulse', discards: true, name: '衝動', type: 'spell', tags: ['draw'], cost: 1, cast: 0.5, icon: '⚡',
      tier: 'niche', arch: ['discard'], text: '手札をランダムに1枚捨て、カードを2枚引く。',
      canUse: (g, me) => me.hand.length >= 2, needText: '捨てる手札がない',
      effect(g, me) { g.discardRandom(me, 1); g.draw(me, 2); },
      ai: (g, me) => 2 + madnessInHand(me) * 1.5 },
    { id: 'frenzy', discards: true, name: '狂乱の儀', type: 'spell', tags: ['draw'], cost: 2, cast: 1.0, icon: '🌪️',
      tier: 'niche', arch: ['discard'], text: '手札を全て捨て、捨てた枚数+1枚を引く。',
      effect(g, me) { const n = me.hand.length; g.discardRandom(me, n); g.draw(me, n + 1); },
      ai: (g, me) => (me.hand.length <= 2 ? 3 : 0) + madnessInHand(me) * 2.5 },
    { id: 'possessed', discards: true, name: '憑かれた剣士', type: 'creature', cost: 2, cast: 1.0, atk: 3, hp: 3, icon: '👺',
      tier: 'niche', arch: ['discard', 'aggro'], text: '召喚時、手札をランダムに1枚捨てる。',
      onSummon(g, me) { g.discardRandom(me, 1); },
      aiBonus: (g, me) => madnessInHand(me) * 1.5 - (me.hand.length <= 2 ? 1.5 : 0.5) },
    { id: 'cremate', discards: true, name: '火葬', type: 'spell', tags: ['attack'], cost: 1, cast: 1.0, icon: '⚱️',
      tier: 'niche', arch: ['discard'], text: '手札をランダムに1枚捨て、そのカードのコスト+1のダメージを敵本体に。',
      canUse: (g, me) => me.hand.length >= 2, needText: '捨てる手札がない',
      effect(g, me, op) { const [c] = g.discardRandom(me, 1); if (c) g.damagePlayer(op, c.cost + 1, '火葬'); },
      ai: (g, me) => { const others = me.hand.filter((id) => id !== 'cremate').map(get); return others.length ? others.reduce((s, c) => s + c.cost, 0) / others.length + 1 + madnessInHand(me) - 1 : 0; } },
    { id: 'madprophet', name: '狂気の預言者', type: 'creature', cost: 3, cast: 1.5, atk: 2, hp: 3, icon: '🧙‍♂️',
      tier: 'niche', arch: ['discard'], text: '自分がカードを捨てるたび、敵本体に2ダメージ。',
      onAllyDiscard(g, me, op) { g.damagePlayer(op, 2, '狂気の預言者'); },
      aiBonus: (g, me) => me.hand.filter((id) => get(id).discards).length * 1.2 },
    { id: 'fetish', name: '囁く呪物', type: 'creature', cost: 1, cast: 0.8, atk: 1, hp: 1, icon: '🪆',
      tier: 'weak', arch: ['discard'], text: '手札から捨てられた時、カードを1枚引く。',
      onDiscard(g, me) { g.draw(me, 1); } },
    { id: 'ragespirit', name: '荒れ狂う霊', type: 'creature', cost: 4, cast: 1.5, atk: 4, hp: 4, icon: '👹',
      tier: 'niche', arch: ['discard'], text: '手札から捨てられた時、コストなしで召喚される（召喚時の攻撃はしない）。',
      onDiscard(g, me) { g.summonFromGrave(me, 'ragespirit'); } },
    { id: 'flamedemon', name: '炎の魔神', type: 'creature', cost: 7, cast: 3.0, atk: 5, hp: 5, icon: '🔥',
      tier: 'strong', arch: ['discard'], text: '手札から捨てられた時、コストなしで召喚される（召喚時の攻撃はしない）。召喚時、敵クリーチャー全てに2ダメージ。',
      onSummon(g, me, op) { [...crs(op)].forEach((u) => g._hitUnit(u, 2)); g._cleanup(); },
      onDiscard(g, me) { g.summonFromGrave(me, 'flamedemon'); }, threat: 8 },
    { id: 'soulburn', discards: true, name: '魂の焼却', type: 'spell', tags: ['disrupt'], cost: 2, cast: 1.5, icon: '🔥',
      tier: 'weak', arch: ['discard', 'control'], text: '相手の手札をランダムに2枚、自分の手札をランダムに1枚捨てる。',
      canUse: (g, me, op) => op.hand.length > 0, needText: '相手の手札がない',
      effect(g, me, op) { g.discardRandom(op, 2); g.discardRandom(me, 1); },
      ai: (g, me, op) => Math.min(op.hand.length, 2) * 1.5 - 1 + madnessInHand(me) * 1.5 },

    // ═════ 生贄（味方を差し出して大きな力を得る）═════
    { id: 'lamb', name: '生贄の子羊', type: 'creature', cost: 0, cast: 0.5, atk: 0, hp: 1, icon: '🐑',
      noAttack: true, tier: 'weak', arch: ['sacrifice'], text: '倒れた時、敵本体に1ダメージ。',
      onDeath(g, me, op) { g.damagePlayer(op, 1, '生贄の子羊'); }, aiBonus: (g, me) => sacPayoffInHand(me) * 1.5 },
    { id: 'soulvessel', name: '魂の器', type: 'relic', cost: 1, cast: 0.8, atk: 0, hp: 2, icon: '🏺',
      tier: 'weak', arch: ['sacrifice', 'ramp'], text: '壊れた時、マナを2得る。',
      onDeath(g, me) { g.addMana(me, 2); }, aiBonus: (g, me) => sacPayoffInHand(me) * 1.5 },
    { id: 'bloodpriest', name: '血塗れの祭司', type: 'creature', cost: 2, cast: 1.0, atk: 1, hp: 3, icon: '🩸',
      tier: 'niche', arch: ['sacrifice', 'grave'], text: '他の味方が倒れるたび、敵本体に1ダメージ。',
      onAnyDeath(g, me, op, unit, dead, owner) { if (owner === me && dead !== unit) g.damagePlayer(op, 1, '血塗れの祭司'); },
      aiBonus: (g, me) => crs(me).length * 0.6 + sacPayoffInHand(me) },
    { id: 'feast', name: '生贄の宴', type: 'spell', tags: ['draw'], cost: 1, sacCost: 1, cast: 0.8, icon: '🍖',
      tier: 'niche', arch: ['sacrifice'], text: 'カードを2枚引く。',
      effect(g, me) { g.draw(me, 2); }, ai: (g, me) => (me.hand.length <= 6 ? 3.5 : 0) },
    { id: 'offering', name: '群れの捧げ物', type: 'spell', tags: ['mana'], cost: 0, cast: 0.5, icon: '🕯️',
      tier: 'niche', arch: ['sacrifice', 'swarm'], text: '味方のトークンを全て破壊し、1体につきマナを1得る。',
      canUse: (g, me) => crs(me).some((u) => u.token), needText: 'トークンがいない',
      effect(g, me) { const ts = crs(me).filter((u) => u.token); ts.forEach((u) => { u.hp = 0; }); g._cleanup(); g.addMana(me, ts.length); },
      ai: (g, me) => { const n = crs(me).filter((u) => u.token).length; return me.hand.some((id) => { const c = g.costOf(me, id); return c > me.mana && c <= me.mana + n; }) ? n + 1 : 0; } },
    { id: 'deathcaller', name: '死の呼び手', type: 'creature', cost: 3, sacCost: 1, cast: 1.5, atk: 2, hp: 2, icon: '☠️',
      tier: 'niche', arch: ['sacrifice'], text: '召喚時、生贄にしたクリーチャーの攻撃力の2倍のダメージを敵本体に。',
      onSummon(g, me, op) { const dmg = me.lastSacrificed.reduce((s, u) => s + u.atk * 2, 0); if (dmg) g.damagePlayer(op, dmg, '死の呼び手'); },
      aiBonus: (g, me) => { const v = g.sacrificeTargets(me, 1)[0]; return v ? g.atkOf(me, v) * 2 : 0; } },
    { id: 'bonecolossus', name: '骸の巨兵', type: 'creature', cost: 3, sacCost: 2, cast: 1.5, atk: 7, hp: 7, icon: '💀',
      tier: 'niche', arch: ['sacrifice', 'grave'], text: '' },
    { id: 'abysslord', name: '奈落の王', type: 'creature', cost: 4, sacCost: 3, cast: 2.0, atk: 9, hp: 9, icon: '👿',
      pierce: true, tier: 'strong', arch: ['sacrifice'], text: '', threat: 10 },

    // ═════ 条件付き ═════
    { id: 'quietblade', name: '静寂の刃', type: 'spell', tags: ['attack'], cost: 1, cast: 0.8, icon: '🗡️',
      tier: 'niche', arch: ['aggro', 'control'], text: '相手が詠唱していない時のみ使える。敵本体に4ダメージ。',
      canUse: (g, me, op) => !op.casting, needText: '相手が詠唱中',
      effect(g, me, op) { g.damagePlayer(op, 4, '静寂の刃'); }, ai: () => 4.2 },
    { id: 'laststand', counter: true, counterAi: (g, me) => savedValue(g, me, 8) * 0.7, name: '背水の陣', type: 'spell', tags: ['heal'], cost: 2, cast: 0, icon: '🏳️',
      tier: 'niche', arch: ['blood', 'generic'], text: '【瞬間】自分の体力が20以下の時のみ使える。体力を8回復する。',
      canUse: (g, me) => me.hp <= 20, needText: '体力が20より多い',
      effect(g, me) { g.heal(me, 8); }, ai: () => 5 },
    { id: 'comeback', name: '逆転の一撃', type: 'spell', tags: ['attack'], cost: 2, cast: 1.0, icon: '🎯',
      tier: 'niche', arch: ['blood', 'generic'], text: '相手より体力が20以上少ない時のみ使える。敵本体に13ダメージ。',
      canUse: (g, me, op) => me.hp + 20 <= op.hp, needText: '体力差が20未満',
      effect(g, me, op) { g.damagePlayer(op, 13, '逆転の一撃'); }, ai: () => 13 },
    { id: 'moonwolf', name: '月夜の狼', type: 'creature', cost: 3, cast: 1.0, atk: 2, hp: 2, icon: '🌕',
      tier: 'niche', arch: ['swarm'], text: '召喚時、他の味方が3体以上いれば+3/+1。',
      onSummon(g, me, op, unit) { if (crs(me).length - 1 >= 3) g.buff(unit, 3, 1); },
      aiBonus: (g, me) => (crs(me).length >= 3 ? 3.5 : 0) },
    { id: 'lonesword', name: '孤高の剣豪', type: 'creature', cost: 3, cast: 1.0, atk: 3, hp: 3, icon: '🤺',
      tier: 'niche', arch: ['aggro', 'control'], text: '召喚時、他の味方がいなければ+2/+2し、連撃を得る。',
      onSummon(g, me, op, unit) { if (crs(me).length === 1) { g.buff(unit, 2, 2); unit.double = true; } },
      aiBonus: (g, me) => (crs(me).length === 0 ? 7 : -1) },
    { id: 'spellmastery', name: '呪文の極意', type: 'spell', tags: ['attack'], cost: 5, cast: 1.5, icon: '🎇',
      tier: 'niche', arch: ['spell'], text: 'このフェーズに呪文を2枚以上使っていれば、コスト-4。敵本体に5ダメージ。',
      costMod: (g, me) => (me.spellsThisPhase >= 2 ? -4 : 0),
      effect(g, me, op) { g.damagePlayer(op, 5, '呪文の極意'); }, ai: (g, me) => (me.spellsThisPhase >= 2 ? 6 : 3) },
    { id: 'gravelord', name: '墓所の主', type: 'creature', cost: 3, cast: 1.5, atk: 5, hp: 5, icon: '🏚️',
      tier: 'niche', arch: ['grave'], text: '自分の墓地が6枚以上の時のみ使える。',
      canUse: (g, me) => me.grave.length >= 6, needText: '墓地が6枚未満' },
    { id: 'apocalypse', name: '終末の詠唱', type: 'spell', tags: ['attack'], cost: 5, cast: 3.0, icon: '🌘',
      tier: 'niche', arch: ['grave', 'discard'], text: '自分の墓地が11枚以上の時のみ使える。敵本体に12ダメージ。',
      canUse: (g, me) => me.grave.length >= 11, needText: '墓地が11枚未満',
      effect(g, me, op) { g.damagePlayer(op, 12, '終末の詠唱'); }, ai: () => 12, threat: 12 },
    { id: 'finalhour', name: '最後の審判', type: 'spell', tags: ['removal'], untag: ['disrupt'], cost: 4, cast: 2.0, icon: '⚖️',
      tier: 'strong', arch: ['control'], text: '最後の2フェーズの間のみ使える。敵クリーチャーを全て破壊する。',
      canUse: (g, me, op) => g.phase >= g.cfg.maxPhases - 1 && crs(op).length > 0, needText: '最後の2フェーズより前',
      effect(g, me, op) { crs(op).forEach((u) => { u.hp = 0; u.undying = false; }); g.log('最後の審判が下された', 'counter', op.index); g._cleanup(); },
      ai: (g, me, op) => crs(op).reduce((s, u) => s + g.atkOf(op, u) + u.hp * 0.5, 0) - 3, threat: 7 },

    // ═════ メリットとデメリット ═════
    { id: 'manaeater', name: '魔力喰らい', type: 'creature', cost: 1, cast: 0.8, atk: 3, hp: 3, icon: '🐛',
      tier: 'weak', arch: ['aggro'], text: '召喚時、自分のマナを全て失う。',
      onSummon(g, me) { me.mana = 0; }, aiBonus: (g, me) => -(me.mana - 1) * 1.2 },
    { id: 'cursedblade', name: '呪われた剣士', type: 'creature', cost: 2, cast: 0.8, atk: 4, hp: 3, icon: '🗡️',
      tier: 'niche', arch: ['blood', 'aggro'], text: '召喚時、自分の体力を2失う。',
      onSummon(g, me) { g.loseLife(me, 2, '呪われた剣士'); }, aiBonus: (g, me) => (me.hp <= g.cfg.startHP * 0.33 ? -5 : -1) },
    { id: 'bomber', name: '自爆兵', type: 'creature', cost: 2, cast: 1.0, atk: 2, hp: 2, icon: '💣',
      tier: 'niche', arch: ['sacrifice', 'grave'], text: '倒れた時、全てのクリーチャーに2ダメージ。',
      onDeath(g) { g.players.forEach((q) => q.field.forEach((u) => g._hitUnit(u, 2))); g._cleanup(); },
      aiBonus: (g, me, op) => (crs(op).length - crs(me).length) * 0.6 },
    { id: 'colossusseal', name: '封印の巨像', type: 'creature', cost: 2, cast: 1.0, atk: 6, hp: 6, icon: '🗿',
      noAttack: true, tier: 'niche', arch: ['sacrifice', 'fortress'], text: '召喚時、自分は3秒間カードを使えない。',
      onSummon(g, me) { g.silence(me, 3); }, aiBonus: (g, me) => (me.mana >= 3 ? -2 : 0) },
    { id: 'proudgiant', name: '傲慢な巨人', type: 'creature', cost: 4, cast: 2.0, atk: 6, hp: 6, icon: '🧔',
      noAttack: true, tier: 'niche', arch: ['ramp', 'growth'], text: '' },
    { id: 'rampage', name: '暴走ゴーレム', type: 'creature', cost: 3, cast: 1.0, atk: 5, hp: 5, icon: '🤖',
      tier: 'niche', arch: ['aggro', 'blood'], text: 'フェーズ開始時、自分の体力を2失う。',
      onPhase(g, me) { g.loseLife(me, 2, '暴走ゴーレム'); }, aiBonus: (g, me) => (me.hp <= g.cfg.startHP * 0.4 ? -4 : 0) },
    { id: 'tyrant', name: '暴君', type: 'creature', cost: 5, cast: 2.0, atk: 6, hp: 6, icon: '👑',
      tier: 'niche', arch: ['generic', 'grave'], text: '召喚時、他の味方全員に1ダメージ。',
      onSummon(g, me, op, unit) { crs(me).forEach((u) => { if (u !== unit) g._hitUnit(u, 1); }); g._cleanup(); },
      aiBonus: (g, me) => -crs(me).filter((u) => u.hp <= 1).length * 1.5 },
    { id: 'deserter', name: '臆病な傭兵', type: 'creature', cost: 2, cast: 1.0, atk: 3, hp: 3, icon: '😰',
      tier: 'weak', arch: ['generic'], text: '敵クリーチャーが3体以上いると使えない。',
      canUse: (g, me, op) => crs(op).length < 3, needText: '敵が3体以上いる' },
    { id: 'greedy', name: '欲深き商人', type: 'spell', tags: ['draw'], cost: 0, cast: 1.0, icon: '🤑',
      tier: 'niche', arch: ['generic', 'discard'], text: 'カードを3枚引く。相手はカードを2枚引く。',
      effect(g, me, op) { g.draw(me, 3); g.draw(op, 2); }, ai: (g, me, op) => (me.hand.length <= 4 ? 3 : 0) - (op.hand.length >= 8 ? -1 : 0) },
    { id: 'twotongue', name: '二枚舌の商人', type: 'spell', tags: ['draw'], cost: 2, cast: 1.0, icon: '🎭',
      tier: 'weak', arch: ['generic'], text: '自分と相手は、カードを2枚ずつ引く。',
      effect(g, me, op) { g.draw(me, 2); g.draw(op, 2); }, ai: (g, me) => (me.hand.length <= 2 ? 2 : 0) },
    { id: 'forbidden', name: '禁断の知識', type: 'spell', tags: ['draw'], cost: 2, cast: 1.0, icon: '📓',
      tier: 'strong', arch: ['generic', 'spell'], text: 'カードを4枚引く。その後4秒間、時間によるドローが止まる。',
      effect(g, me) { g.draw(me, 4); me.drawPause = Math.max(me.drawPause, 4); },
      ai: (g, me) => (me.hand.length <= 4 ? 4.5 : me.hand.length <= 6 ? 2 : 0) },
    { id: 'manadebt', name: '魔力の前借り', type: 'spell', tags: ['mana'], cost: 0, cast: 0.3, icon: '💸',
      tier: 'niche', arch: ['ramp', 'spell'], text: 'マナを4得る。次のフェーズ開始時、マナを3失う。',
      canUse: (g, me) => me.manaDebt === 0, needText: '返済前',
      effect(g, me) { g.addMana(me, 4); me.manaDebt = 3; },
      ai: (g, me) => (me.hand.some((id) => { const c = g.costOf(me, id); return c > me.mana && c <= me.mana + 4 && c >= 5; }) ? 4.5 : 0) },
    { id: 'lifeprice', discards: true, name: '生命の対価', type: 'spell', tags: ['heal'], cost: 0, cast: 1.0, icon: '💗',
      tier: 'niche', arch: ['discard', 'blood'], text: '体力を6回復する。手札をランダムに2枚捨てる。',
      effect(g, me) { g.heal(me, 6); g.discardRandom(me, 2); },
      ai: (g, me) => Math.min(missingHp(g, me), 6) * 0.8 - 2 + madnessInHand(me) * 2 },
    { id: 'generosity', name: '施しの泉', type: 'spell', tags: ['heal'], cost: 2, cast: 1.5, icon: '🫗',
      tier: 'weak', arch: ['generic'], text: '体力を6回復する。相手の体力も3回復する。',
      effect(g, me, op) { g.heal(me, 6); g.heal(op, 3); }, ai: (g, me) => Math.min(missingHp(g, me), 6) * 0.6 - 1 },
    { id: 'wildmagic', name: '暴走する魔力', type: 'spell', tags: ['attack'], cost: 2, cast: 1.0, icon: '🎲',
      tier: 'weak', arch: ['spell'], text: '敵本体に1〜6のランダムなダメージ。',
      effect(g, me, op) { g.damagePlayer(op, 1 + Math.floor(g.rand() * 6), '暴走する魔力'); }, ai: () => 3 },
    { id: 'tradeoff', name: '等価交換', type: 'spell', tags: ['removal'], untag: ['disrupt'], cost: 2, cast: 1.0, icon: '⚖️',
      tier: 'niche', arch: ['control', 'sacrifice'], text: '敵と味方で、それぞれ最も攻撃力の高いクリーチャーを1体ずつ破壊する。',
      canUse: (g, me, op) => crs(op).length > 0, needText: '敵クリーチャーがいない',
      effect(g, me, op) { const a = strongest(g, op), b = strongest(g, me); if (a) a.hp = 0; if (b) b.hp = 0; g._cleanup(); },
      ai: (g, me, op) => { const a = strongest(g, op), b = strongest(g, me); return (a ? g.atkOf(op, a) + a.hp * 0.5 : 0) - (b ? g.atkOf(me, b) + b.hp * 0.5 - (get(b.id).onDeath ? 3 : 0) : 0); } },
    { id: 'truce', name: '停戦協定', type: 'spell', tags: ['disrupt'], cost: 2, cast: 1.0, icon: '🕊️',
      tier: 'weak', arch: ['control'], text: '自分と相手は、5秒間カードを使えない。',
      effect(g, me, op) { g.silence(op, 5); g.silence(me, 5); },
      ai: (g, me, op) => (me.hp > op.hp + 5 && restPhases(g) < 0.5 ? 4 : 0) },

    // ═════ 強カード ═════
    { id: 'phoenix', name: '不死鳥', type: 'creature', cost: 4, cast: 2.5, atk: 4, hp: 3, icon: '🐦‍🔥',
      undying: true, double: true, tier: 'strong', arch: ['grave', 'generic'], text: '倒れた時、手札に戻る。',
      onDeath(g, me) { const i = me.grave.lastIndexOf('phoenix'); if (i >= 0 && me.hand.length < g.cfg.handLimit) { me.grave.splice(i, 1); me.hand.push('phoenix'); g.log('不死鳥は灰の中から手札に戻った', 'info', me.index); } },
      threat: 6 },
    { id: 'archlich', name: '不死の王', type: 'creature', cost: 6, cast: 3.0, atk: 4, hp: 6, icon: '💀',
      tier: 'strong', arch: ['grave'], text: '召喚時、自分の墓地のクリーチャーを2体ランダムに復活させる。',
      onSummon(g, me) { g.reviveFromGrave(me, 'random'); g.reviveFromGrave(me, 'random'); },
      aiBonus: (g, me) => Math.min(2, g.graveCreatures(me)) * 3, threat: 9 },
    { id: 'dealmaker', name: '悪魔との取引', type: 'spell', tags: ['draw'], cost: 0, hpCost: 5, cast: 0, icon: '😈',
      tier: 'strong', arch: ['blood'], text: '【瞬間】カードを3枚引き、マナを2得る。',
      effect(g, me) { g.draw(me, 3); g.addMana(me, 2); },
      ai: (g, me) => (me.hp > g.cfg.startHP * 0.47 && me.hand.length <= 5 ? 5 : 0) },
    { id: 'warcry', name: '鬨の声', type: 'spell', tags: ['attack'], cost: 6, cast: 2.0, icon: '🗯️',
      tier: 'strong', arch: ['swarm', 'aggro'], text: '味方クリーチャー全員の攻撃力+1。その後、全員が攻撃する。',
      canUse: (g, me) => crs(me).length > 0, needText: '味方がいない',
      effect(g, me) { crs(me).forEach((u) => g.buff(u, 1, 0)); [...crs(me)].forEach((u) => g.attack(me, u)); },
      ai: (g, me, op) => expectedFace(g, me, op) + crs(me).length * 0.8 - 1.5, threat: 5 },
    { id: 'archmage', name: '大魔導師', type: 'creature', cost: 5, cast: 2.5, atk: 4, hp: 5, icon: '🧙‍♀️',
      tier: 'strong', arch: ['spell'], text: '場にいる間、自分の呪文の詠唱時間が半分になる。自分が呪文を使うたび、敵本体に1ダメージ。',
      onAllyPlay(g, me, op, unit, card) { if (isSpell(card)) g.damagePlayer(op, 1, '大魔導師'); },
      auraCast: (g, me, card) => (isSpell(card) ? 0.5 : 1),
      aiBonus: (g, me) => spellIdsInHand(me).length * 0.8, threat: 7 },
    { id: 'reaper', name: '死神', type: 'creature', cost: 3, cast: 2.0, atk: 3, hp: 4, icon: '🌒',
      stealth: true, tier: 'strong', arch: ['control', 'grave'], text: '召喚時、敵で最も体力の低いクリーチャーを破壊する。',
      onSummon(g, me, op) { const u = crs(op).reduce((b, x) => (!b || x.hp < b.hp ? x : b), null); if (u) g.destroyUnit(op, u); },
      aiBonus: (g, me, op) => (crs(op).length ? 2.5 : 0), threat: 6 },

    // ╔══════════════════ v0.4 追加分 ══════════════════╗

    // ═════ 対象を選ぶカード ═════
    { id: 'snipe', counter: true, counterAi: (g, me, op, t) => (t && t.unit.hp + (t.unit.armor || 0) <= 5 ? savedValue(g, me, threatOf(g, t)) * 1.2 + unitValue(g, t) * 0.4 : 0) - 1.5, name: '狙撃', type: 'spell', tags: ['removal'], untag: ['attack'], cost: 2, cast: 1.0, icon: '🎯',
      target: { side: 'enemy', label: '敵クリーチャー' },
      tier: 'niche', arch: ['generic', 'control'], text: '選んだ敵クリーチャーに5ダメージ。',
      effect(g, me, op, ctx) { const t = alive(ctx); if (t) g.damageUnit(t.owner, t.unit, 5); },
      ai: (g, me, op, t) => (t ? killValue(g, t, 5) : 0) },
    { id: 'rewind', name: '時の巻き戻し', type: 'spell', tags: ['disrupt'], cost: 2, cast: 1.0, icon: '⏪',
      target: { side: 'enemy', label: '攻撃予約のある敵クリーチャー', filter: (g, me, u) => g.reservedOf(u.uid) > 0 },
      counter: true, tier: 'niche', arch: ['control', 'generic'], text: '選んだ敵クリーチャーの攻撃予約を全て取り消す。',
      effect(g, me, op, ctx) { const t = alive(ctx); if (t) { const n = g.cancelReservations(t.unit.uid); g.log(`${t.unit.name}の攻撃予約${n}回分が巻き戻された`, 'counter', t.owner.index); } },
      ai: (g, me, op, t) => (t ? threatOf(g, t) - 1.5 : 0),
      counterAi: (g, me, op, t) => (t ? savedValue(g, me, threatOf(g, t)) * 1.1 - 1.5 : 0),
      aiTarget: (g, me, op, cands) => cands.sort((a, b) => threatOf(g, b) - threatOf(g, a))[0] },
    { id: 'banish', name: '追放の光', type: 'spell', tags: ['removal'], untag: ['disrupt'], cost: 2, cast: 1.0, icon: '🌟',
      target: { side: 'enemy', label: '敵クリーチャーかレリック', relics: true },
      tier: 'strong', arch: ['control', 'generic'], text: '選んだ敵クリーチャーかレリックを破壊する。',
      effect(g, me, op, ctx) { const t = alive(ctx); if (t) g.destroyUnit(t.owner, t.unit); },
      ai: (g, me, op, t) => (t ? unitValue(g, t) : 0) },
    { id: 'lure', counter: true, counterAi: (g, me, op, t) => (t ? pendingFace(g, me, { noGuard: t.unit }) - pendingFace(g, me) - 1 : 0), name: '誘い出し', type: 'spell', tags: ['disrupt'], cost: 1, cast: 0.5, icon: '🪝',
      target: { side: 'enemy', label: '敵の守護', relics: true, filter: (g, me, u) => u.guard },
      tier: 'niche', arch: ['aggro', 'swarm'], text: '選んだ敵の守護（クリーチャーかレリック）の守護を失わせる。',
      effect(g, me, op, ctx) { const t = alive(ctx); if (t) { t.unit.guard = false; g.log(`${t.unit.name}は守護を失った`, 'info', t.owner.index); } },
      ai: (g, me, op, t) => (t && crs(me).length ? 2 + crs(me).length * 0.5 : 0) },
    { id: 'charm', name: '魅了', type: 'spell', tags: ['removal'], untag: ['disrupt'], cost: 4, cast: 1.5, icon: '💘',
      target: { side: 'enemy', label: '攻撃力5以下の敵', filter: (g, me, u, owner) => g.atkOf(owner, u) <= 5 },
      tier: 'strong', arch: ['control'], text: '攻撃力5以下の敵クリーチャーを選び、奪って自分のものにする。',
      canUse: (g, me) => room(g, me) > 0, needText: '場が満杯',
      effect(g, me, op, ctx) { const t = alive(ctx); if (t) g.stealUnit(t.owner, me, t.unit); },
      ai: (g, me, op, t) => (t ? unitValue(g, t) * 2 : 0), threat: 7 },
    { id: 'polymorph', name: '変化の呪い', type: 'spell', tags: ['removal'], untag: ['disrupt'], cost: 2, cast: 1.0, icon: '🐸',
      target: { side: 'enemy', label: '敵クリーチャー' },
      tier: 'niche', arch: ['control'], text: '選んだ敵クリーチャーを、能力のないカエル(1/1)に変える。',
      effect(g, me, op, ctx) { const t = alive(ctx); if (t) g.transformUnit(t.owner, t.unit, 't_frog'); },
      ai: (g, me, op, t) => (t ? unitValue(g, t) - 1 : 0) },
    { id: 'silenceunit', name: '沈黙の印', type: 'spell', tags: ['disrupt'], cost: 1, cast: 0.8, icon: '🤐',
      target: { side: 'enemy', label: '敵クリーチャーかレリック', relics: true },
      tier: 'niche', arch: ['control', 'generic'], text: '選んだ敵クリーチャーかレリックの能力（キーワード・誘発・オーラ）を全て消す。',
      effect(g, me, op, ctx) { const t = alive(ctx); if (t) g.muteUnit(t.owner, t.unit); },
      ai: (g, me, op, t) => (t ? abilityValue(t.unit) : 0) },
    { id: 'bounce', counter: true, counterAi: (g, me, op, t) => (t && t.owner === op ? savedValue(g, me, threatOf(g, t)) * 1.1 + (t.unit.token ? 1 : 0) - 1.5 : 0), name: '送還', type: 'spell', tags: ['removal'], untag: ['disrupt'], cost: 1, cast: 0.6, icon: '↩️',
      target: { side: 'any', label: 'クリーチャーかレリック', relics: true },
      tier: 'niche', arch: ['generic', 'control'], text: '選んだクリーチャーかレリックを持ち主の手札に戻す（トークンは消える）。味方を戻せば、召喚時の効果と攻撃をもう一度使える。',
      effect(g, me, op, ctx) { const t = alive(ctx); if (t) g.bounceUnit(t.owner, t.unit); },
      ai: (g, me, op, t) => { if (!t) return 0; if (t.owner === op) return t.unit.token ? unitValue(g, t) + 1 : get(t.unit.id).cost * 0.9; const c = get(t.unit.id); return c.onSummon && !c.sacCost && c.cost <= me.mana ? 3 : 0; },
      aiTarget: (g, me, op, cands) => {
        const mine = cands.filter((x) => x.owner === me && get(x.unit.id).onSummon && !get(x.unit.id).sacCost);
        const theirs = cands.filter((x) => x.owner === op).sort((a, b) => (b.unit.token ? 9 : get(b.unit.id).cost) - (a.unit.token ? 9 : get(a.unit.id).cost));
        return theirs[0] && (theirs[0].unit.token || get(theirs[0].unit.id).cost >= 4) ? theirs[0] : mine[0] || theirs[0];
      } },
    { id: 'lifedrain', counter: true, counterAi: (g, me, op, t) => (t && t.unit.hp + (t.unit.armor || 0) <= 3 ? savedValue(g, me, threatOf(g, t)) * 1.2 + unitValue(g, t) * 0.4 : 0) + Math.min(3, missingHp(g, me)) * 0.3 - 1.5, name: '生命吸収', type: 'spell', tags: ['removal'], untag: ['attack'], cost: 3, cast: 1.5, icon: '🩸',
      target: { side: 'enemy', label: '敵クリーチャー' },
      tier: 'niche', arch: ['blood', 'control'], text: '選んだ敵クリーチャーに3ダメージを与え、自分の体力を3回復する。',
      effect(g, me, op, ctx) { const t = alive(ctx); if (t) g.damageUnit(t.owner, t.unit, 3); g.heal(me, 3); },
      ai: (g, me, op, t) => (t ? killValue(g, t, 3) + Math.min(3, missingHp(g, me)) * 0.5 : 0) },
    { id: 'empower', name: '力の付与', type: 'spell', tags: ['buff'], untag: ['heal'], cost: 1, cast: 0.8, icon: '💪',
      target: { side: 'ally', label: '味方クリーチャー' },
      tier: 'niche', arch: ['growth', 'generic'], text: '選んだ味方クリーチャーを+2/+2する。',
      effect(g, me, op, ctx) { const t = alive(ctx); if (t) g.buff(t.unit, 2, 2); },
      ai: (g, me, op, t) => (t ? 2.5 + (get(t.unit.id).onGrow ? 3 : 0) + (t.unit.auto ? 1 : 0) : 0),
      aiTarget: (g, me, op, cands) => cands.sort((a, b) => growPriority(b.unit) - growPriority(a.unit))[0] },
    { id: 'order', counter: true, counterAi: (g, me, op, t) => { if (!t) return 0; const before = pendingFace(g, me); g.queue.push({ pi: me.index, uid: t.unit.uid }); const after = pendingFace(g, me); g.queue.pop(); return after - before - 1.5; }, name: '突撃指令', type: 'spell', tags: ['attack'], cost: 2, cast: 0.6, icon: '👉',
      target: { side: 'ally', label: '味方クリーチャー' },
      tier: 'niche', arch: ['generic', 'aggro'], text: '選んだ味方クリーチャーが攻撃する。',
      effect(g, me, op, ctx) { const t = alive(ctx); if (t) g.attack(me, t.unit); },
      ai: (g, me, op, t) => (t ? g.atkOf(me, t.unit) * (g.readyGuards(op).length && !t.unit.stealth ? 0.4 : 1) - 0.5 : 0),
      aiTarget: (g, me, op, cands) => cands.sort((a, b) => g.atkOf(me, b.unit) - g.atkOf(me, a.unit))[0] },
    { id: 'sacknife', counter: true, counterAi: (g, me, op, t) => (t && t.unit.id === 'bomber' ? 3 : 0), name: '儀式の短剣', type: 'spell', tags: ['mana'], cost: 0, cast: 0.3, icon: '🔪',
      target: { side: 'ally', label: '味方クリーチャー' },
      tier: 'niche', arch: ['sacrifice', 'grave'], text: '選んだ味方クリーチャーを破壊し、その攻撃力分のマナを得る（最大5）。',
      effect(g, me, op, ctx) { const t = alive(ctx); if (t) { const n = Math.min(5, g.atkOf(me, t.unit)); g.destroyUnit(me, t.unit); g.addMana(me, n); } },
      ai: (g, me, op, t) => (t ? (get(t.unit.id).onDeath ? 3 : 0) + (t.unit.token ? 1 : 0) + (me.hand.some((id) => g.costOf(me, id) > me.mana && g.costOf(me, id) <= me.mana + Math.min(5, t.unit.atk)) ? 2 : -2) : 0),
      aiTarget: (g, me, op, cands) => cands.sort((a, b) => sacPriority(b.unit) - sacPriority(a.unit))[0] },
    { id: 'heroic', counter: true, counterAi: (g, me, op, t) => (t && g.reservedOf(t.unit.uid) && t.unit.hp <= 3 && op.mana >= 2 ? 1.5 : 0), name: '英雄の加護', type: 'spell', tags: ['heal'], cost: 1, cast: 0, icon: '🛡️',
      target: { side: 'ally', label: '味方クリーチャー' }, reactive: true,
      tier: 'niche', arch: ['fortress', 'growth'], text: '【瞬間】選んだ味方クリーチャーを+0/+3し、不屈を与える。',
      effect(g, me, op, ctx) { const t = alive(ctx); if (t) { g.buff(t.unit, 0, 3); t.unit.undying = true; t.unit.usedUndying = false; } },
      react: (g, me, op, threat) => (threat >= 4 && crs(me).length && opCastingIs(op, 'attack', 'removal', 'disrupt') ? 3 : 0),
      aiTarget: (g, me, op, cands) => cands.sort((a, b) => unitValue(g, b) - unitValue(g, a))[0] },
    { id: 'sharpshooter', name: '狙撃手', type: 'creature', cost: 3, cast: 1.5, atk: 3, hp: 2, icon: '🏹',
      target: { side: 'enemy', label: '敵クリーチャー', optional: true },
      tier: 'niche', arch: ['generic', 'aggro'], text: '召喚時、選んだ敵クリーチャーに3ダメージ。',
      onSummon(g, me, op, unit, ctx) { const t = alive(ctx); if (t) g.damageUnit(t.owner, t.unit, 3); },
      aiBonus: (g, me, op) => Math.max(0, ...crs(op).map((u) => (u.hp <= 3 ? unitValue(g, { unit: u, owner: op }) : 0.5))) },
    { id: 'tamer', name: '獣使い', type: 'creature', cost: 3, cast: 1.5, atk: 2, hp: 3, icon: '🧑‍🦯',
      target: { side: 'ally', label: '味方クリーチャー', optional: true },
      tier: 'niche', arch: ['growth', 'swarm'], text: '召喚時、選んだ味方クリーチャーを+2/+2する。',
      onSummon(g, me, op, unit, ctx) { const t = alive(ctx); if (t) g.buff(t.unit, 2, 2); },
      aiBonus: (g, me) => (crs(me).length ? 2.5 : 0),
      aiTarget: (g, me, op, cands) => cands.sort((a, b) => growPriority(b.unit) - growPriority(a.unit))[0] },
    { id: 'archon', name: '断罪の天使', type: 'creature', cost: 5, cast: 2.0, atk: 6, hp: 6, icon: '👼',
      target: { side: 'enemy', label: '敵クリーチャー', optional: true },
      tier: 'strong', arch: ['control', 'generic'], text: '召喚時、選んだ敵クリーチャーを破壊する。',
      onSummon(g, me, op, unit, ctx) { const t = alive(ctx); if (t) g.destroyUnit(t.owner, t.unit); },
      aiBonus: (g, me, op) => Math.max(0, ...crs(op).map((u) => unitValue(g, { unit: u, owner: op }))), threat: 8 },

    // ═════ 効果の途中で選ぶカード ═════
    { id: 'sift', name: '選別', type: 'spell', tags: ['draw'], cost: 1, cast: 0.8, icon: '🔍', discards: true,
      tier: 'niche', arch: ['discard', 'generic'], text: 'カードを2枚引き、手札から1枚を選んで捨てる。',
      effect(g, me) { g.draw(me, 2); g.chooseDiscard(me, 1); },
      ai: (g, me) => (me.hand.length <= 7 ? 2.8 + madnessInHand(me) : 0) },
    { id: 'study', name: '研鑽', type: 'spell', tags: ['draw'], cost: 2, cast: 1.0, icon: '📐', discards: true,
      tier: 'niche', arch: ['discard', 'spell'], text: 'カードを3枚引き、手札から2枚を選んで捨てる。',
      effect(g, me) { g.draw(me, 3); g.chooseDiscard(me, 2); },
      ai: (g, me) => (me.hand.length <= 6 ? 2.5 + madnessInHand(me) * 1.5 : 0) },
    { id: 'pyre', name: '火葬台', type: 'spell', tags: ['attack'], cost: 2, cast: 1.0, icon: '🔥', discards: true,
      tier: 'niche', arch: ['discard', 'ramp'], text: '手札から1枚を選んで捨て、そのカードのコスト×2のダメージを敵本体に（最大12）。',
      canUse: (g, me) => me.hand.length >= 2, needText: '捨てる手札がない',
      effect(g, me, op) { g.chooseDiscard(me, 1, '燃やすカードを選んでください（コスト×2のダメージ）', ([c]) => { if (c) g.damagePlayer(op, Math.min(12, c.cost * 2), '火葬台'); }); },
      ai: (g, me) => { const c = Math.max(0, ...me.hand.filter((id) => id !== 'pyre').map((id) => get(id).cost)); return Math.min(12, c * 2) - 2; } },
    { id: 'tribute', name: '献上', type: 'spell', tags: ['mana'], cost: 0, cast: 0.3, icon: '🎁', discards: true,
      tier: 'niche', arch: ['discard', 'ramp'], text: '手札から1枚を選んで捨て、マナを2得る。',
      canUse: (g, me) => me.hand.length >= 2, needText: '捨てる手札がない',
      effect(g, me) { g.chooseDiscard(me, 1, '献上するカードを選んでください', () => g.addMana(me, 2)); },
      ai: (g, me) => madnessInHand(me) * 3 + (me.hand.some((id) => { const c = g.costOf(me, id); return c > me.mana && c <= me.mana + 2; }) && me.hand.length >= 5 ? 2.5 : 0) },
    { id: 'bargain', name: '取引', type: 'spell', tags: ['draw'], cost: 1, cast: 1.0, icon: '🤝', discards: true,
      tier: 'weak', arch: ['discard'], text: '手札から1枚を選んで捨て、カードを1枚引く。',
      canUse: (g, me) => me.hand.length >= 2, needText: '捨てる手札がない',
      effect(g, me) { g.chooseDiscard(me, 1, null, () => g.draw(me, 1)); },
      ai: (g, me) => madnessInHand(me) * 2.5 + 0.5 },
    { id: 'exhume', name: '発掘', type: 'spell', tags: ['draw'], cost: 2, cast: 1.0, icon: '⛏️',
      tier: 'niche', arch: ['grave', 'discard'], text: '自分の墓地から好きなカードを1枚選んで手札に加える。',
      canUse: (g, me) => me.grave.length > 0, needText: '墓地が空',
      effect(g, me) {
        g.choose(me, { kind: 'pick', options: me.grave.slice(), count: 1, prompt: '手札に加えるカードを選んでください' }, ([i]) => {
          if (i == null || me.hand.length >= g.cfg.handLimit) return;
          const id = me.grave.splice(i, 1)[0];
          me.hand.push(id);
          g.log(`${me.name}：墓地から【${get(id).name}】を手札へ`, 'info', me.index);
        });
      },
      ai: (g, me) => Math.max(0, ...me.grave.map((id) => get(id).cost)) * 0.7 },
    { id: 'foresee', name: '先見の目', type: 'spell', tags: ['draw'], cost: 1, cast: 0.5, icon: '🔭',
      tier: 'niche', arch: ['grave', 'generic'], text: '山札の上から3枚を見て、1枚を選んで手札に加え、残りを墓地へ置く。',
      canUse: (g, me) => me.deck.length > 0, needText: '山札が空',
      effect(g, me) {
        const top = me.deck.splice(Math.max(0, me.deck.length - 3));
        g.choose(me, { kind: 'pick', options: top, count: 1, prompt: '手札に加えるカードを選んでください（残りは墓地へ）' }, ([i]) => {
          top.forEach((id, k) => { if (k === i && me.hand.length < g.cfg.handLimit) me.hand.push(id); else me.grave.push(id); });
          g.log(`${me.name}：先見の目で1枚を手札へ、${top.length - 1}枚を墓地へ`, 'info', me.index);
        });
      },
      ai: (g, me) => (me.hand.length <= 7 ? 2.6 : 0) },
    { id: 'masterplan', name: '完璧な計画', type: 'spell', tags: ['draw'], cost: 2, cast: 1.0, icon: '🗺️',
      tier: 'strong', arch: ['generic', 'ramp'], text: '山札から好きなカードを1枚選んで手札に加え、山札を切り直す。',
      canUse: (g, me) => me.deck.length > 0, needText: '山札が空',
      effect(g, me) {
        const kinds = [...new Set(me.deck)];
        g.choose(me, { kind: 'pick', options: kinds, count: 1, prompt: '山札から手札に加えるカードを選んでください' }, ([i]) => {
          const id = kinds[i];
          me.deck.splice(me.deck.lastIndexOf(id), 1);
          if (me.hand.length < g.cfg.handLimit) me.hand.push(id); else me.grave.push(id);
          g._shuffle(me.deck);
          g.log(`${me.name}：山札から1枚を手札へ`, 'info', me.index);
        });
      },
      ai: (g, me) => (me.hand.length <= 6 ? 3.5 : 0) },
    { id: 'mindthief', name: '記憶の盗人', type: 'spell', tags: ['disrupt'], cost: 2, cast: 1.5, icon: '🕵️',
      tier: 'strong', arch: ['control', 'discard'], text: '相手の手札を見て、1枚を選んで捨てさせる。',
      canUse: (g, me, op) => op.hand.length > 0, needText: '相手の手札がない',
      effect(g, me, op) {
        g.choose(me, { kind: 'oppDiscard', options: op.hand.slice(), count: 1, prompt: '相手に捨てさせるカードを選んでください' }, ([i]) => { if (i != null) g.discard(op, i); });
      },
      ai: (g, me, op) => (op.hand.length ? 3.5 : 0) },

    // ═════ ランダムに選ばれるカード ═════
    { id: 'chainlightning', name: '連鎖する雷', type: 'spell', tags: ['attack'], cost: 2, cast: 1.2, icon: '🌩️',
      tier: 'niche', arch: ['spell', 'aggro'], text: 'ランダムな敵（本体またはクリーチャー）に1ダメージを6回与える。',
      effect(g, me, op) {
        for (let k = 0; k < 6; k++) {
          const n = crs(op).length + 1;
          const r = Math.floor(g.rand() * n);
          if (r === crs(op).length) g.damagePlayer(op, 1, '連鎖する雷'); else { g._hitUnit(crs(op)[r], 1); g._cleanup(); }
        }
      },
      ai: (g, me, op) => 3.5 + crs(op).filter((u) => u.hp <= 1).length },
    { id: 'wildfire', name: '野火', type: 'spell', tags: ['removal'], untag: ['attack'], cost: 2, cast: 1.0, icon: '🔥',
      tier: 'weak', arch: ['aggro'], text: 'ランダムな敵クリーチャー1体に3ダメージ。',
      canUse: (g, me, op) => crs(op).length > 0, needText: '敵クリーチャーがいない',
      effect(g, me, op) { const u = crs(op)[Math.floor(g.rand() * crs(op).length)]; if (u) g.damageUnit(op, u, 3); },
      ai: (g, me, op) => crs(op).filter((u) => u.hp <= 3).length / Math.max(1, crs(op).length) * 3 },
    { id: 'scatter', name: '散弾', type: 'spell', tags: ['removal'], untag: ['attack'], cost: 2, cast: 1.0, icon: '💥',
      tier: 'weak', arch: ['swarm', 'control'], text: 'ランダムな敵クリーチャーに1ダメージを3回与える（同じ相手に当たることもある）。',
      canUse: (g, me, op) => crs(op).length > 0, needText: '敵クリーチャーがいない',
      effect(g, me, op) { for (let k = 0; k < 3 && crs(op).length; k++) { g._hitUnit(crs(op)[Math.floor(g.rand() * crs(op).length)], 1); g._cleanup(); } },
      ai: (g, me, op) => crs(op).filter((u) => u.hp <= 1).length * 1.5 },
    { id: 'roulette', name: '運命の輪', type: 'spell', tags: ['mana'], cost: 1, cast: 0.8, icon: '🎡',
      tier: 'weak', arch: ['generic'], text: 'ランダムに1つ：マナを3得る／カードを2枚引く／体力を4回復する。',
      effect(g, me) { const r = Math.floor(g.rand() * 3); if (r === 0) g.addMana(me, 3); else if (r === 1) g.draw(me, 2); else g.heal(me, 4); },
      ai: () => 2 },
    { id: 'luckycoin', name: '幸運の硬貨', type: 'spell', tags: ['mana'], cost: 0, cast: 0.5, icon: '🪙',
      tier: 'weak', arch: ['generic', 'spell'], text: '半分の確率でマナを2得る。',
      effect(g, me) { if (g.rand() < 0.5) { g.addMana(me, 2); g.log('表！マナを2得た', 'info', me.index); } else g.log('裏…何も起きなかった', 'info', me.index); },
      ai: (g, me) => (me.hand.some((id) => { const c = g.costOf(me, id); return c > me.mana && c <= me.mana + 2; }) ? 2 : 0.8) },
    { id: 'chaosimp', name: '混沌の小悪魔', type: 'creature', cost: 2, cast: 1.0, atk: 2, hp: 2, icon: '👾',
      tier: 'weak', arch: ['aggro', 'grave'], text: '召喚時、ランダムな敵クリーチャーとランダムな味方クリーチャーに1ダメージずつ。',
      onSummon(g, me, op, unit) {
        const e = crs(op)[Math.floor(g.rand() * crs(op).length)];
        const allies = crs(me).filter((u) => u !== unit);
        const a = allies[Math.floor(g.rand() * allies.length)];
        if (e) g._hitUnit(e, 1);
        if (a) g._hitUnit(a, 1);
        g._cleanup();
      } },

    // ═════ 自分の能力で攻撃するクリーチャー ═════
    { id: 'sentry', name: '哨兵', type: 'creature', cost: 2, cast: 1.5, atk: 1, hp: 2, icon: '💂',
      tier: 'weak', arch: ['fortress', 'generic'], text: 'フェーズ開始時、攻撃する。',
      onPhase(g, me, op, unit) { g.attack(me, unit); } },
    { id: 'rustgolem', name: '錆びた自動人形', type: 'creature', cost: 3, cast: 2.0, atk: 2, hp: 3, icon: '⚙️',
      autoAttack: 10, tier: 'weak', arch: ['generic'], text: '' },
    { id: 'watchdog', name: '番犬', type: 'creature', cost: 3, cast: 1.5, atk: 3, hp: 4, icon: '🐕‍🦺',
      autoAttack: 8, tier: 'niche', arch: ['generic', 'growth'], text: '' },
    { id: 'warbeast', name: '戦獣', type: 'creature', cost: 5, cast: 2.5, atk: 5, hp: 5, icon: '🐗',
      autoAttack: 7, tier: 'strong', arch: ['ramp', 'aggro'], text: '', threat: 8 },
    { id: 'skyknight', name: '天空騎士', type: 'creature', cost: 4, cast: 2.5, atk: 3, hp: 4, icon: '🦅',
      autoAttack: 8, stealth: true, tier: 'strong', arch: ['aggro', 'generic'], text: '', threat: 7 },
    { id: 'spellblade', name: '魔法剣士', type: 'creature', cost: 3, cast: 1.5, atk: 2, hp: 3, icon: '🗡️',
      tier: 'niche', arch: ['spell'], text: '自分が呪文を使うたび、このクリーチャーが攻撃する。',
      onAllyPlay(g, me, op, unit, card) { if (isSpell(card)) g.attack(me, unit); },
      aiBonus: (g, me) => spellIdsInHand(me).length * 0.8 },
    { id: 'bloodhound', name: '血の猟犬', type: 'creature', cost: 2, cast: 1.0, atk: 3, hp: 2, icon: '🐺',
      tier: 'niche', arch: ['blood'], text: '代償や自傷で自分の体力を失うたび、このクリーチャーが攻撃する。',
      onLifeLoss(g, me, op, unit, amount, kind) { if (kind === 'self') g.attack(me, unit); },
      aiBonus: (g, me) => me.hand.filter((id) => get(id).hpCost || get(id).id === 'cursedblade').length * 0.8 },
    { id: 'vengeful', name: '復讐の騎士', type: 'creature', cost: 4, cast: 2.0, atk: 3, hp: 4, icon: '⚔️',
      tier: 'niche', arch: ['grave', 'sacrifice'], text: '他の味方が倒れるたび、このクリーチャーが攻撃する。',
      onAnyDeath(g, me, op, unit, dead, owner) { if (owner === me && dead !== unit) g.attack(me, unit); },
      aiBonus: (g, me) => crs(me).length * 0.6 },
    { id: 'harvester', name: '魂刈り', type: 'creature', cost: 5, cast: 2.5, atk: 2, hp: 3, icon: '🌾',
      tier: 'strong', arch: ['grave', 'control'], text: 'いずれかのクリーチャーが倒れるたび、このクリーチャーが攻撃する。',
      onAnyDeath(g, me, op, unit, dead) { if (dead !== unit) g.attack(me, unit); },
      aiBonus: (g, me, op) => (crs(me).length + crs(op).length) * 0.5, threat: 6 },
    { id: 'packhunter', name: '群れの狩人', type: 'creature', cost: 4, cast: 1.5, atk: 2, hp: 2, icon: '🦊',
      tier: 'niche', arch: ['swarm'], text: '他の味方が場に出るたび、このクリーチャーが攻撃する。',
      onAllySummon(g, me, op, unit, other) { if (other !== unit) g.attack(me, unit); },
      aiBonus: (g, me) => me.hand.filter((id) => isUnit(get(id)) || (get(id).tags || []).includes('summon')).length * 0.6 },
    { id: 'madhound', name: '狂犬', type: 'creature', cost: 2, cast: 1.0, atk: 2, hp: 2, icon: '🐶',
      tier: 'niche', arch: ['discard'], text: '自分がカードを捨てるたび、このクリーチャーが攻撃する。',
      onAllyDiscard(g, me, op, unit) { g.attack(me, unit); },
      aiBonus: (g, me) => me.hand.filter((id) => get(id).discards).length * 1.0 },
    { id: 'avenger', name: '反撃の盾', type: 'creature', cost: 4, cast: 2.0, atk: 2, hp: 5, icon: '🛡️',
      guard: true, tier: 'niche', arch: ['fortress'], text: '攻撃を受け止めるたび、このクリーチャーが攻撃する。',
      onBlock(g, me, op, unit) { g.attack(me, unit); }, aiBonus: () => 1.5 },
    { id: 'growbeast', name: '育つ獣', type: 'creature', cost: 3, cast: 1.5, atk: 2, hp: 3, icon: '🦎',
      tier: 'niche', arch: ['growth'], text: '強化されるたび（+X/+Yを得るたび）、このクリーチャーが攻撃する。',
      onGrow(g, me, op, unit) { g.attack(me, unit); }, aiBonus: () => 2.5 },
    { id: 'stormlord', name: '雷霆の主', type: 'creature', cost: 6, cast: 2.5, atk: 3, hp: 5, icon: '🌪️',
      tier: 'strong', arch: ['swarm', 'generic'], text: 'フェーズ開始時、他の味方全員が攻撃する。',
      onPhase(g, me, op, unit) { [...crs(me)].forEach((u) => { if (u !== unit) g.attack(me, u); }); },
      aiBonus: (g, me) => crs(me).length * 1.5, threat: 7 },

    // ═════ テーマをまたぐシナジーの要 ═════
    { id: 'priestess', name: '祝福の巫女', type: 'creature', cost: 3, cast: 1.5, atk: 1, hp: 4, icon: '⛩️',
      tier: 'niche', arch: ['blood', 'fortress'], text: '自分が体力を回復するたび、敵本体に1ダメージ。',
      onHeal(g, me, op) { g.damagePlayer(op, 1, '祝福の巫女'); }, aiBonus: () => 1.5 },
    { id: 'martyr', name: '殉教者', type: 'creature', cost: 1, cast: 0.8, atk: 1, hp: 1, icon: '🕊️',
      tier: 'niche', arch: ['sacrifice', 'growth'], text: '倒れた時、味方全員+1/+1。',
      onDeath(g, me) { crs(me).forEach((u) => g.buff(u, 1, 1)); } },
    { id: 'nightpact', name: '夜の盟主', type: 'creature', cost: 5, cast: 2.5, atk: 1, hp: 4, icon: '🌙',
      auraLifesteal: true, tier: 'niche', arch: ['blood', 'swarm'], text: '場にいる間、他の味方全員が吸血を得る。',
      aiBonus: (g, me) => crs(me).length * 0.8 + Math.min(missingHp(g, me), 10) * 0.2 },
    { id: 'echoer', name: '反響の竪琴弾き', type: 'creature', cost: 2, cast: 1.0, atk: 2, hp: 3, icon: '🪕',
      tier: 'strong', arch: ['generic', 'swarm'], text: '他の味方が場に出るたび、その召喚時の効果をもう一度発動する。',
      onAllySummon(g, me, op, unit, other) {
        const d = get(other.id);
        if (other === unit || !d.onSummon || !crs(me).includes(other)) return;
        // 最初の対象がもういなければ、選べる対象からランダムに選び直す
        let ctx = other.ctx;
        if (d.target && !alive(ctx)) {
          const valid = g.validTargets(me, d);
          ctx = { target: valid.length ? valid[Math.floor(g.rand() * valid.length)] : null };
        }
        g.log(`反響：【${d.name}】の召喚時効果をもう一度`, 'info', me.index);
        d.onSummon(g, me, op, other, ctx);
      },
      aiBonus: (g, me) => me.hand.filter((id) => get(id).onSummon).length * 1.0, threat: 6 },
    { id: 'recycler', name: '再利用', type: 'spell', tags: ['draw'], cost: 1, cast: 1.0, icon: '♻️',
      tier: 'weak', arch: ['grave', 'generic'], text: '自分の墓地のカード4枚をランダムに山札に戻して切り直し、カードを1枚引く。',
      effect(g, me) { for (let k = 0; k < 4 && me.grave.length; k++) me.deck.push(me.grave.splice(Math.floor(g.rand() * me.grave.length), 1)[0]); g._shuffle(me.deck); g.draw(me, 1); },
      ai: (g, me) => (me.deck.length <= 4 ? 4 : 0.5) },
    { id: 'recruitguard', counter: true, counterAi: (g, me, op) => savedValue(g, me, pendingFace(g, op) - pendingFace(g, op, { extraGuard: 2 })) - 0.5, name: '見習い衛兵', type: 'creature', cost: 1, cast: 0.8, atk: 1, hp: 2, icon: '🪖',
      guard: true, noAttack: true, tier: 'weak', arch: ['fortress'], text: '' },

    // ╔══════════════════ v0.5 追加分：汎用カード ══════════════════╗
    // どのデッキにも入るドロー・回復・マナ。「すぐ効く／後から効く／状況で効く／体に付く／まとめて効く」で作り分けている

    // ═════ ドロー ═════
    { id: 'cycle', name: '入れ替え', type: 'spell', tags: ['draw'], cost: 0, cast: 0.3, icon: '🔄',
      tier: 'weak', arch: ['generic'], text: '手札から1枚を選んで山札の一番下に戻し、カードを1枚引く。',
      canUse: (g, me) => me.hand.length >= 2, needText: '戻す手札がない',
      effect(g, me) {
        g.choose(me, { kind: 'discard', options: me.hand.slice(), count: 1, prompt: '山札の下に戻すカードを選んでください' }, ([i]) => {
          if (i != null) { const id = me.hand.splice(i, 1)[0]; me.deck.unshift(id); g.log(`${me.name}は1枚を山札の下に戻した`, 'info', me.index); }
          g.draw(me, 1);
        });
      },
      ai: (g, me) => (me.hand.some((id) => g.costOf(me, id) > me.maxMana) || me.hand.length >= 8 ? 1.5 : 0) },
    { id: 'oldmap', name: '古地図', type: 'spell', tags: ['draw'], cost: 2, cast: 1.5, icon: '🗺️',
      tier: 'weak', arch: ['generic'], text: 'カードを1枚引く。手札が2枚以下なら、さらに1枚引く。',
      effect(g, me) { g.draw(me, me.hand.length <= 2 ? 2 : 1); }, ai: (g, me) => (me.hand.length <= 3 ? 2 : 0.5) },
    { id: 'insightful', name: '閃き', type: 'spell', tags: ['draw'], cost: 1, cast: 0, icon: '💡',
      tier: 'niche', arch: ['generic'], text: '【瞬間】カードを1枚引く。',
      effect(g, me) { g.draw(me, 1); },
      ai: (g, me) => (me.hand.length <= 4 ? 2.2 : 0.6) },
    { id: 'investment', name: '投資', type: 'spell', tags: ['draw'], cost: 1, cast: 1.0, icon: '📈',
      tier: 'niche', arch: ['generic'], text: '次のフェーズ開始時、追加でカードを3枚引く。',
      canUse: (g, me) => me.bonusDraw === 0, needText: '効果が残っている',
      effect(g, me) { me.bonusDraw = 3; },
      ai: (g, me) => (restPhases(g) > 1 && me.hand.length <= 6 ? 3 : 0) },
    { id: 'refill', name: '補充', type: 'spell', tags: ['draw'], cost: 1, cast: 1.0, icon: '📥',
      tier: 'strong', arch: ['generic'], text: '手札が5枚になるまでカードを引く（最大4枚）。',
      canUse: (g, me) => me.hand.length <= 4, needText: '手札が5枚以上',
      effect(g, me) { g.draw(me, Math.min(4, Math.max(0, 5 - me.hand.length))); },
      ai: (g, me) => Math.min(4, 4 - me.hand.length) * 1.4 },
    { id: 'archive', name: '大図書館', type: 'spell', tags: ['draw'], cost: 4, cast: 2.0, icon: '🏛️',
      tier: 'niche', arch: ['generic', 'ramp'], text: 'カードを5枚引く。',
      effect(g, me) { g.draw(me, 5); }, ai: (g, me) => (me.hand.length <= 4 ? 5 : 0), threat: 5 },

    // ═════ 回復 ═════
    { id: 'bandage', name: '包帯', type: 'spell', tags: ['heal'], cost: 0, cast: 1.5, icon: '🩹',
      tier: 'weak', arch: ['generic'], text: '体力を2回復する。',
      effect(g, me) { g.heal(me, 2); }, ai: (g, me) => (missingHp(g, me) >= 2 ? 1.5 : 0) },
    { id: 'potion', counter: true, counterAi: (g, me) => savedValue(g, me, Math.min(3, missingHp(g, me) + pendingFace(g, g.opp(me)))) * 0.6 - 1, name: '回復薬', type: 'spell', tags: ['heal'], cost: 1, cast: 0, icon: '🧪',
      tier: 'niche', arch: ['generic'], text: '【瞬間】体力を3回復する。',
      effect(g, me) { g.heal(me, 3); }, ai: (g, me) => Math.min(missingHp(g, me), 3) - 1.2 },
    { id: 'regenprayer', name: '再生の祈り', type: 'spell', tags: ['heal'], cost: 2, cast: 1.0, icon: '🌿',
      tier: 'niche', arch: ['generic', 'growth'], text: '次の3フェーズの間、フェーズ開始時に体力を3回復する。',
      canUse: (g, me) => me.regen === 0, needText: '効果が残っている',
      effect(g, me) { me.regen = 3; me.regenAmount = 3; },
      ai: (g, me) => (missingHp(g, me) >= 6 && restPhases(g) > 1.5 ? 4 : 0) },
    { id: 'lifewell', name: '命の泉', type: 'spell', tags: ['heal'], cost: 3, cast: 1.5, icon: '⛲',
      tier: 'niche', arch: ['generic'], text: '相手との体力の差の半分だけ、体力を回復する（最低3）。',
      effect(g, me, op) { g.heal(me, Math.max(3, Math.floor((op.hp - me.hp) / 2))); },
      ai: (g, me, op) => Math.min(missingHp(g, me), Math.max(3, Math.floor((op.hp - me.hp) / 2))) - 1 },
    { id: 'greatheal', name: '大いなる癒し', type: 'spell', tags: ['heal'], cost: 5, cast: 2.5, icon: '💖',
      tier: 'niche', arch: ['generic', 'fortress'], text: '体力を10回復する。',
      effect(g, me) { g.heal(me, 10); }, ai: (g, me) => Math.min(missingHp(g, me), 10) * 0.7 - 2 },
    { id: 'healer', name: '癒し手', type: 'creature', cost: 3, cast: 1.5, atk: 2, hp: 3, icon: '🧑‍⚕️',
      tier: 'niche', arch: ['generic', 'fortress'], text: '召喚時、自分の体力を3回復する。',
      onSummon(g, me) { g.heal(me, 3); }, aiBonus: (g, me) => Math.min(missingHp(g, me), 3) * 0.7 },

    // ═════ マナ ═════
    { id: 'channel', name: '魔力の集中', type: 'spell', tags: ['mana'], cost: 0, cast: 0, icon: '🔹',
      tier: 'weak', arch: ['generic'], text: '【瞬間】マナを1得る。',
      effect(g, me) { g.addMana(me, 1); },
      ai: (g, me) => (me.hand.some((id) => g.costOf(me, id) === me.mana + 1) ? 2 : 0) },
    { id: 'manacrystal', name: 'マナ結晶', type: 'spell', tags: ['mana'], cost: 0, cast: 0.5, icon: '💎',
      tier: 'strong', arch: ['generic'], text: 'マナを1得て、カードを1枚引く。',
      effect(g, me) { g.addMana(me, 1); g.draw(me, 1); }, ai: () => 2.5 },
    { id: 'savings', name: '貯蓄', type: 'spell', tags: ['mana'], cost: 1, cast: 1.0, icon: '🐷',
      tier: 'niche', arch: ['generic', 'ramp'], text: '次のフェーズ開始時、マナを3得る。',
      canUse: (g, me) => me.bonusMana === 0, needText: '効果が残っている',
      effect(g, me) { me.bonusMana = 3; },
      ai: (g, me) => (restPhases(g) > 1 && me.maxMana - me.mana >= 4 ? 2.5 : 0) },
    { id: 'efficiency', name: '効率化', type: 'spell', tags: ['mana'], cost: 1, cast: 0.8, icon: '⚙️',
      tier: 'niche', arch: ['generic', 'spell'], text: 'このフェーズ中、自分のコスト1以上のカードのコスト-1（最低1）。',
      canUse: (g, me) => me.phaseDiscount === 0, needText: '効果が残っている',
      effect(g, me) { me.phaseDiscount = 1; },
      ai: (g, me) => (g.step === 'play' && g.stepTimer > 20 ? me.hand.filter((id) => get(id).cost >= 2).length * 0.8 - 0.5 : 0) },
    { id: 'manaspring', name: '魔力の泉', type: 'relic', cost: 2, cast: 1.0, atk: 0, hp: 3, icon: '⛲',
      tier: 'niche', arch: ['generic', 'ramp'], text: '場にいる間、マナの回復速度+30%。',
      auraRegen: 0.3,
      aiBonus: (g) => restPhases(g) * 1.0 },
    { id: 'merchant', name: '行商人', type: 'creature', cost: 2, cast: 1.0, atk: 1, hp: 2, icon: '🧳',
      tier: 'niche', arch: ['generic', 'sacrifice'], text: '倒れた時、カードを1枚引き、マナを1得る。',
      onDeath(g, me) { g.draw(me, 1); g.addMana(me, 1); }, aiBonus: () => 1.5 },
    { id: 'leyline', name: '地脈の掌握', type: 'spell', tags: ['mana'], cost: 3, cast: 2.0, icon: '🌋',
      tier: 'strong', arch: ['generic', 'ramp'], text: '最大マナを1増やし、マナを最大値まで回復する。',
      effect(g, me) { me.maxMana = Math.min(g.cfg.maxManaCap, me.maxMana + 1); g.addMana(me, me.maxMana); },
      ai: (g, me) => (me.hand.length >= 3 ? (me.maxMana - me.mana) * 0.7 - 1 : 0) },

    // ═════ まとめて効く ═════
    { id: 'blessing', name: '天の恵み', type: 'spell', tags: ['heal'], cost: 3, cast: 1.5, icon: '🌈',
      tier: 'strong', arch: ['generic'], text: 'カードを2枚引き、体力を4回復し、マナを1得る。',
      effect(g, me) { g.draw(me, 2); g.heal(me, 4); g.addMana(me, 1); },
      ai: (g, me) => 3 + Math.min(missingHp(g, me), 4) * 0.4 + (me.hand.length <= 5 ? 1 : 0) },
  ];

  // ── トークン（カード効果で生成されるクリーチャー。デッキには入れられない） ──
  const TOKENS = [
    { id: 't_skeleton', name: '骸骨兵', type: 'creature', token: true, cost: 0, cast: 0, atk: 1, hp: 1, icon: '💀', text: '' },
    { id: 't_pup', name: '子狼', type: 'creature', token: true, cost: 0, cast: 0, atk: 1, hp: 1, icon: '🐕', text: '' },
    { id: 't_recruit', name: '新兵', type: 'creature', token: true, cost: 0, cast: 0, atk: 1, hp: 1, icon: '🪖', text: '' },
    { id: 't_frog', name: 'カエル', type: 'creature', token: true, cost: 0, cast: 0, atk: 1, hp: 1, icon: '🐸', text: '' },
  ];

  // ── 検索タグの自動付与：効果の文章とキーワードから判定する ──
  const TAG_RULES = {
    attack: /敵本体に|ダメージを敵本体|が攻撃する|攻撃させ|回攻撃|回ずつ攻撃|全員が攻撃|攻撃を予約/,
    removal: /(敵|選んだ敵|ランダムな敵|敵で最も)[^。]*?(クリーチャー|レリック)[^。]*?(ダメージ|破壊|変える|奪)|全てのクリーチャーに\d|他の全てのクリーチャー|持ち主の手札に戻す|敵の場のもの全て/,
    disrupt: /打ち消(す|し)|遅らせ|相手は[^。]*カードを使えない|自分と相手は[^。]*カードを使えない|相手の手札|相手のマナを|能力[^。]*消す|時間を\d+秒間止め|相手が詠唱を始めるたび|相手がカードを使うたび|相手に1ダメージ|守護を失わせ|攻撃予約を全て取り消/,
    draw: /枚引|カードを引|手札に加え|墓地[^。]*手札に戻す|まで(カードを)?引/,
    mana: /自分はマナを|マナを\d+得|マナを得|マナを最大|マナの回復速度|最大マナを|次に使う[^。]*コスト-|カードのコスト-|コストを払わず|コストなしで発動|マナを\d+得/,
    heal: /体力[^。]*回復|防壁\+|不屈を与え|\+0\/\+\d/,
    summon: /生成|復活|蘇|クリーチャーを召喚|コストなしで召喚|コストを払わず召喚/,
    buff: /\+[1-9]\d*\/\+\d|攻撃力\+\d/,
  };
  function autoTags(c) {
    const text = c.text || '';
    const tags = Object.keys(TAG_RULES).filter((k) => TAG_RULES[k].test(text));
    if (c.guard || c.lifesteal) tags.push('heal');
    if (c.auraAtk) tags.push('buff');
    if (c.auraRegen) tags.push('mana');
    return tags;
  }
  for (const c of LIST) {
    const own = c.tags || [];
    c.tags = [...new Set([...own, ...autoTags(c)])].filter((k) => !(c.untag || []).includes(k) && TAGS[k]);
  }

  const MAP = Object.fromEntries([...LIST, ...TOKENS].map((c) => [c.id, c]));
  function find(id) { return MAP[id]; }
  function get(id) {
    const c = MAP[id];
    if (!c) throw new Error('未知のカードID: ' + id);
    return c;
  }

  // カードの説明文（キーワードも含める）を作る。
  // 「召喚時に1回攻撃」は全クリーチャー共通のルールなので、カード面では省略し long=true の時だけ付ける
  function keywords(c) {
    const kw = [];
    if (c.guard) kw.push('守護');
    if (c.stealth) kw.push('潜伏');
    if (c.lifesteal) kw.push('吸血');
    if (c.double) kw.push('連撃');
    if (c.undying) kw.push('不屈');
    if (c.armor) kw.push('堅牢' + c.armor);
    if (c.pierce) kw.push('貫通');
    if (c.noAttack) kw.push('鈍重');
    if (c.onDiscard) kw.push('狂気');
    if (c.autoAttack) kw.push('自律');
    return kw;
  }
  function fullText(c, long) {
    const parts = [];
    if (c.counter) parts.push('〔カウンター〕');
    if (c.hpCost) parts.push(`《代償：体力${c.hpCost}》`);
    if (c.sacCost) parts.push(`《生贄：味方${c.sacCost}体》`);
    if (isUnit(c)) {
      const kw = keywords(c);
      if (kw.length) parts.push('【' + kw.join('・') + '】');
      if (long) parts.push(c.type === 'relic' ? '攻撃しない。' : c.noAttack ? '召喚時に攻撃しない。' : c.double ? '召喚時に2回攻撃。' : '召喚時に1回攻撃。');
    }
    if (c.text) parts.push(c.text);
    return parts.join(' ');
  }

  const KEYWORD_HELP = {
    カウンター: 'カウンターステップでも使える（その時は詠唱なしで即座に発動。1回のカウンターステップで2枚まで）',
    攻撃: 'クリーチャーの攻撃はその場では起きず「攻撃予約」になり、フェーズの終わりのクロノホールで予約順に実行される',
    守護: '敵クリーチャーの攻撃を本体の代わりに受け止める（1回のクロノホールで1回まで）',
    潜伏: '攻撃時に守護を無視して本体を狙う',
    吸血: '与えたダメージ分、自分の体力を回復',
    連撃: '召喚時に2回攻撃する',
    不屈: '最初に倒れた時、体力1で踏みとどまる',
    堅牢: '受けるダメージを数値分減らす',
    貫通: '守護に受け止められても、余ったダメージは本体に届く',
    代償: 'マナに加えて体力を支払う。体力がその値以下だと使えない',
    生贄: '使うときに味方クリーチャーを指定の数だけ破壊する（弱い順・トークン優先で自動選択）。打ち消されても生贄は戻らない',
    鈍重: '召喚時に攻撃しない',
    狂気: '手札から捨てられた時に効果が発動する',
    レリック: '場に出て効果を発揮し続ける。攻撃はしない。耐久が0になると壊れる。「クリーチャー」を対象にする効果は効かない',
    自律: '毎フェーズ、プレイステップの終わりに自分の力で攻撃を予約する',
    対象: 'カードを使う時に対象を選ぶ。詠唱中は相手にも対象が見え、発動までに対象がいなくなると不発',
  };

  return { TYPES, TAGS, ARCHES, TIERS, LIST, TOKENS, get, find, fullText, keywords, KEYWORD_HELP, isUnit, isSpell };
});
