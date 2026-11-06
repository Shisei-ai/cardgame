/*
 * battle.js — 対戦画面
 *
 * 操作：
 *   メインステップ … 手札のカードをクリックで使う。【起動】効果を持つ自分のクリーチャーはクリックで効果を使う
 *   アタックステップ … 攻撃できる自分のクリーチャーをクリック → 光っている攻撃先（相手の帯・タップした相手クリーチャー）をクリック
 *   右クリック／Esc … 攻撃先選びをやめる
 * CPUの手番は、間を空けて1手ずつ進める（何をしたかは右上の記録に出る）。
 * 効果の対象選び・「〜してもよい」・迎撃呪文などの選択は、エンジンの pending を画面に出して答える。
 *
 * 演出（Anim）：
 *   エンジンは一瞬で処理を終えるので、演出は「順番待ちの列」に並べて少しずつずらして再生する（Anim.schedule）。
 *   ・召喚：手札（CPUは画面上）から場へカードが飛び、着地すると魔法陣の輪が広がる。着地までクリーチャーは隠しておく
 *   ・呪文：カードが中央へ飛び、魔法陣の上に掲げられてから光になって弾ける（迎撃・対抗は色と見出しが変わる）
 *   ・効果の発動：クリーチャーが光り、効果名が浮かび、対象へ光の線が伸びる
 *   ・ドロー：山札から裏向きのカードが飛び、手札に入る時に表に返る
 *   CPUは演出が終わるまで次の行動を待つ。倒れたクリーチャーが消えるのも、その時点の演出が終わってから。
 */
(function (root) {
  'use strict';
  const { Parts, Engine, AI, UI } = root;
  const { $, $$, esc, fx } = UI;
  const ME = 0, OP = 1;
  const AI_DELAY = 800;
  const PORTRAIT = ['🧑‍🔧', '🤖'];

  const B = { game: null, ai: null, setup: null, attackFrom: null, picks: [], pendingShown: null, sig: '', raf: 0, aiT: 0, unitEls: new Map(), feed: [],
    arriving: new Set(),   // 召喚の演出中（まだ着地していない）クリーチャーの uid
    handSeen: new Set(),   // 一度でも表示した手札の iid（新しく来たカードにドローの演出を付ける）
    handReveal: new Map(), // 手札に入る演出の時刻（iid → performance.now() の時刻）
    playFrom: null,        // 直前に使った手札のカードの位置（召喚・呪文の演出の出発点）
  };

  // ───────────── 演出の順番待ち ─────────────
  const Anim = {
    busy: 0,
    /** dur ミリ秒の演出を、前の演出の後に予約する。始まるまでの待ち時間を返す */
    schedule(dur, fn, overlap = 0.25) {
      const now = performance.now();
      const start = Math.max(now, this.busy);
      this.busy = start + dur * (1 - overlap);
      const wait = start - now;
      setTimeout(fn, wait);
      return wait;
    },
    reset() { this.busy = 0; },
    idle() { return performance.now() >= this.busy; },
  };
  const EASE = 'cubic-bezier(.2,.8,.25,1)';
  const fxLayer = () => $('#fx');
  const place = (el, p) => { el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; };
  /** 舞台の上に要素を置いて、from から to へ飛ばす（Web Animations API） */
  function fly(el, from, to, dur, o = {}) {
    el.classList.add('fly');
    place(el, { x: 0, y: 0 });
    fxLayer().appendChild(el);
    const s0 = o.s0 != null ? o.s0 : 1, s1 = o.s1 != null ? o.s1 : 1, r0 = o.r0 || 0, r1 = o.r1 || 0;
    const mid = { x: (from.x + to.x) / 2, y: Math.min(from.y, to.y) - (o.arc || 60) };
    const a = el.animate([
      { transform: `translate(${from.x}px, ${from.y}px) translate(-50%, -50%) scale(${s0}) rotate(${r0}deg)`, opacity: o.o0 != null ? o.o0 : 1 },
      { transform: `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%) scale(${(s0 + s1) / 2 * 1.08}) rotate(${(r0 + r1) / 2}deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${to.x}px, ${to.y}px) translate(-50%, -50%) scale(${s1}) rotate(${r1}deg)`, opacity: o.o1 != null ? o.o1 : 1 },
    ], { duration: dur, easing: EASE, fill: 'forwards' });
    a.onfinish = () => { if (!o.keep) el.remove(); if (o.done) o.done(); };
    return a;
  }
  function cardBack() { const el = document.createElement('div'); el.className = 'card-back'; el.innerHTML = '<i>⚒</i>'; return el; }
  function ring(p, color, size = 150, cls = '') {
    const el = document.createElement('div');
    el.className = 'fx-ring ' + cls;
    el.style.setProperty('--rc', color);
    el.style.width = el.style.height = size + 'px';
    place(el, p);
    fxLayer().appendChild(el);
    setTimeout(() => el.remove(), 900);
  }
  function sparks(p, color, n = 12, spread = 90) {
    for (let i = 0; i < n; i++) {
      const el = document.createElement('i');
      el.className = 'fx-spark';
      el.style.background = color;
      place(el, p);
      fxLayer().appendChild(el);
      const ang = (Math.PI * 2 * i) / n + Math.random() * 0.4, d = spread * (0.5 + Math.random() * 0.6);
      el.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(ang) * d}px), calc(-50% + ${Math.sin(ang) * d}px)) scale(.2)`, opacity: 0 }],
        { duration: 600 + Math.random() * 300, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'forwards' }).onfinish = () => el.remove();
    }
  }
  const sideColor = (pi) => (pi === ME ? '#7fd6ff' : '#ff9a6a');
  const deckPoint = (pi) => { const d = $(`#pbar-${pi} .pb-deck`); return d ? UI.stagePoint(d) : { x: 1100, y: pi === ME ? 460 : 40 }; };
  const opHandPoint = () => { const h = $('#pbar-1 .op-hand'); return h ? UI.stagePoint(h) : { x: 1200, y: 40 }; };
  const handPoint = () => UI.stagePoint($('#hand'), 0.35);

  function start(setup) {
    stop();
    B.setup = setup;
    const g = new Engine.Game({ decks: [setup.myDeck, setup.cpuDeck], names: ['あなた', 'CPU'] });
    B.game = g;
    B.ai = new AI.AI(g, OP, setup.level);
    g.onEvent = onEvent;
    B.attackFrom = null; B.picks = []; B.pendingShown = null; B.sig = ''; B.unitEls = new Map(); B.feed = [];
    B.arriving = new Set(); B.handSeen = new Set(); B.handReveal = new Map(); B.playFrom = null;
    Anim.reset();
    $('#field-0').innerHTML = ''; $('#field-1').innerHTML = ''; $('#fx').innerHTML = ''; $('#feed').innerHTML = '';
    UI.closeModal();
    UI.showScreen('battle');
    g.start();
    banner(g.first === ME ? 'あなたが先攻' : 'CPUが先攻', '先攻の1ターン目はドローしません');
    B.raf = requestAnimationFrame(loop);
  }

  function stop() { cancelAnimationFrame(B.raf); clearTimeout(B.aiT); B.aiT = 0; }

  function loop() {
    const g = B.game;
    render();
    if (B.pendingDirty && Anim.idle()) { B.pendingDirty = false; renderPending(); }
    // CPUの手番：間を空けて1手ずつ
    if (!g.over && !g.pending && g.active === OP && !B.aiT && Anim.idle()) {
      B.aiT = setTimeout(() => { B.aiT = 0; if (B.game === g && !g.over) B.ai.step(); }, AI_DELAY);
    }
    if (g.over && Anim.idle()) { showResult(); return; }
    B.raf = requestAnimationFrame(loop);
  }

  // ───────────── 入力 ─────────────
  function myTurn(step) { const g = B.game; return !g.over && !g.pending && g.active === ME && (!step || g.step === step); }

  function clickHand(iid) {
    const g = B.game;
    if (g.pending) return;
    const chk = g.canPlay(ME, iid);
    if (!chk.ok) { if (chk.reason) UI.toast(chk.reason); return; }
    B.attackFrom = null;
    const el = $(`#hand .card[data-iid="${iid}"]`);
    B.playFrom = el ? UI.stagePoint(el) : null;
    g.play(ME, iid);
  }

  function clickUnit(uid) {
    const g = B.game;
    const pd = g.pending;
    // 効果の対象選び
    if (pd && pd.player === ME && pd.kind === 'targets') {
      if (!pd.options.includes(uid)) return;
      const i = B.picks.indexOf(uid);
      if (i >= 0) B.picks.splice(i, 1); else B.picks.push(uid);
      if (B.picks.length >= pd.max) submitTargets();
      B.sig = '';
      return;
    }
    if (pd) return;
    const u = g.findUnit(uid);
    if (!u) return;
    // アタックステップ：攻撃するクリーチャーを選ぶ → 攻撃先を選ぶ
    if (myTurn('attack')) {
      if (B.attackFrom) {
        if (B.attackFrom === uid) { B.attackFrom = null; B.sig = ''; return; }
        if (g.attackTargets(ME, B.attackFrom).includes(uid)) { const from = B.attackFrom; B.attackFrom = null; g.attack(ME, from, uid); return; }
      }
      if (u.owner === ME) {
        if (g.canAttack(ME, uid)) { B.attackFrom = uid; B.sig = ''; }
        else UI.toast(u.tapped ? 'タップしているので攻撃できない' : u.sick ? '召喚したターンは攻撃できない（速攻を除く）' : '攻撃できない');
      } else if (B.attackFrom) UI.toast('アンタップしている相手のクリーチャーは攻撃できない');
      return;
    }
    // メインステップ：【起動】効果
    if (myTurn('main') && u.owner === ME) {
      const idxs = (u.spec.effects || []).map((e, i) => (e.trig === 'activate' ? i : -1)).filter((i) => i >= 0);
      if (!idxs.length) return;
      const usable = idxs.filter((i) => g.canActivate(ME, uid, i));
      if (!usable.length) { UI.toast(u.silenced ? '能力を消されている' : '今は使えない（コスト・回数・タップの状態を確認）'); return; }
      const m = UI.modal(`【${esc(u.name)}】の起動効果`, `<div class="act-list">${idxs.map((i) => `<button class="act-item" data-i="${i}" ${usable.includes(i) ? '' : 'disabled'}>${esc(Parts.effectText(u.spec, u.spec.effects[i]))}</button>`).join('')}</div><p class="hint">タップするコストがあると、このターンは攻撃できず、相手の攻撃対象になります。</p>`, [
        { label: 'やめる', onClick: UI.closeModal },
      ]);
      m.querySelectorAll('.act-item').forEach((b) => { b.onclick = () => { UI.closeModal(); g.activate(ME, uid, Number(b.dataset.i)); }; });
    }
  }

  function clickPlayer(pi) {
    const g = B.game;
    if (pi === OP && B.attackFrom && myTurn('attack')) {
      const from = B.attackFrom;
      B.attackFrom = null;
      g.attack(ME, from, 'player');
    }
  }

  function submitTargets() {
    const pick = B.picks.slice();
    B.picks = [];
    B.pendingShown = null;
    B.game.answer(pick);
  }

  function onKey(e) {
    if (!$('#screen-battle').classList.contains('active')) return;
    if (e.key === 'Escape') { if (B.attackFrom) { B.attackFrom = null; B.sig = ''; } else openMenu(); }
  }

  function openMenu() {
    UI.modal('メニュー', '<p>対戦を続けますか？</p>', [
      { label: '降参してタイトルへ', danger: true, onClick: () => { stop(); UI.closeModal(); UI.showScreen('title'); } },
      { label: '続ける', primary: true, onClick: UI.closeModal },
    ]);
  }

  // ───────────── 人間の選択（pending）を画面に出す ─────────────
  function renderPending() {
    const g = B.game;
    const pd = g.pending && g.pending.player === ME ? g.pending : null;
    const guide = $('#guide');
    if (!pd) { if (B.pendingShown) { B.pendingShown = null; UI.closeModal(); } guide.className = 'guide'; return; }
    if (pd.kind === 'targets') {
      guide.className = 'guide show';
      guide.innerHTML = `🎯 ${esc(pd.prompt)}　<b>${B.picks.length} / ${pd.max}</b>${pd.max > 1 ? ' <button class="btn small primary" id="tg-ok">決定</button>' : ''}`;
      const ok = $('#tg-ok');
      if (ok) ok.onclick = () => { if (B.picks.length) submitTargets(); };
      return;
    }
    guide.className = 'guide';
    if (B.pendingShown === pd) return;
    B.pendingShown = pd;
    if (pd.kind === 'confirm') {
      UI.modal('確認', `<p>${esc(pd.prompt)}</p><p class="m-effect">${esc(Parts.effectText(pd.spec || { kind: 'creature' }, pd.effect))}</p>`, [
        { label: 'しない', onClick: () => { UI.closeModal(); B.pendingShown = null; g.answer(false); } },
        { label: 'する', primary: true, onClick: () => { UI.closeModal(); B.pendingShown = null; g.answer(true); } },
      ]);
    } else if (pd.kind === 'block') {
      const att = g.findUnit(pd.attacker);
      const m = UI.modal('ブロック', `<p>${esc(pd.prompt)}</p><p class="hint">火種を払って、アンタップの自分のクリーチャーで受け止めます。受け止めたクリーチャーはタップし、攻撃してきたクリーチャーとバトルします（パワーが大きい方が勝ち）。</p><div class="m-cards"></div>`,
        [{ label: 'ブロックしない', onClick: () => { UI.closeModal(); B.pendingShown = null; g.answer([]); } }], 'wide');
      const box = $('.m-cards', m);
      for (const uid of pd.options) {
        const u = g.findUnit(uid);
        if (!u) continue;
        const pw = g.powerOf(u);
        const el = UI.cardEl(u.spec, { power: pw, badge: att ? (pw > g.powerOf(att) ? '勝てる' : pw === g.powerOf(att) ? '相打ち' : '負ける') : '' });
        el.classList.add('pickable');
        el.onclick = () => { UI.closeModal(); B.pendingShown = null; g.answer([uid]); };
        box.appendChild(el);
      }
    } else if (pd.kind === 'discard' || pd.kind === 'react' || pd.kind === 'counter' || pd.kind === 'pickCard') {
      // カードを選ぶ画面（手札を捨てる・迎撃・対抗・サーチや墓地回収など）
      const me = g.players[ME];
      const att = pd.kind === 'react' ? g.findUnit(pd.attacker) : null;
      const title = { discard: '手札を捨てる', react: '迎撃', counter: '対抗', pickCard: 'カードを選ぶ' }[pd.kind];
      const optional = pd.kind === 'react' || pd.kind === 'counter';
      const multi = (pd.max || 1) > 1;
      const picked = [];
      const extra = att ? `<p class="hint">攻撃してきた：${esc(att.name)}（パワー ${g.powerOf(att)}）</p>` : pd.kind === 'counter' ? '<div class="m-spell"></div>' : '';
      const buttons = [];
      if (optional) buttons.push({ label: '使わない', onClick: () => { UI.closeModal(); B.pendingShown = null; g.answer([]); } });
      if (multi) buttons.push({ label: '決定', primary: true, onClick: () => { if (picked.length < (pd.min || 1)) { UI.toast(`${pd.min}枚選んでください`); return; } UI.closeModal(); B.pendingShown = null; g.answer(picked.slice()); } });
      const m = UI.modal(title, `<p>${esc(pd.prompt)}${multi ? `（${pd.max}枚）` : ''}</p>${extra}<div class="m-cards"></div>`, buttons, 'wide');
      if (pd.kind === 'counter' && pd.spell) { const sp = UI.cardEl(pd.spell); $('.m-spell', m).appendChild(sp); }
      const box = $('.m-cards', m);
      pd.options.forEach((iid, k) => {
        const spec = pd.cards ? pd.cards[k] : (me.hand.find((x) => x.iid === iid) || {}).spec;
        if (!spec) return;
        const el = UI.cardEl(spec);
        el.classList.add('pickable');
        el.onclick = () => {
          if (!multi) { UI.closeModal(); B.pendingShown = null; g.answer([iid]); return; }
          const j = picked.indexOf(iid);
          if (j >= 0) picked.splice(j, 1); else if (picked.length < pd.max) picked.push(iid);
          el.classList.toggle('picked', picked.includes(iid));
        };
        box.appendChild(el);
      });
    }
  }

  // ───────────── 演出 ─────────────
  const later = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
  const portrait = (pi) => $(`#pbar-${pi} .portrait`);
  const unitEl = (u) => u && B.unitEls.get(u.uid);

  function log(text, who) {
    B.feed.unshift({ text, who });
    B.feed = B.feed.slice(0, 6);
    $('#feed').innerHTML = B.feed.map((f, i) => `<div class="f-row ${f.who === ME ? 'me' : f.who === OP ? 'op' : ''}" style="opacity:${1 - i * 0.13}">${esc(f.text)}</div>`).join('');
  }

  function onEvent(ev) {
    const g = B.game;
    const nm = (pi) => (pi === ME ? 'あなた' : 'CPU');
    switch (ev.type) {
      case 'turn':
        B.attackFrom = null;
        banner(ev.player === ME ? 'あなたのターン' : 'CPUのターン', `第${Math.ceil(ev.turn / 2)}巡　最大マナ ${g.players[ev.player].maxMana}`);
        break;
      case 'step':
        if (ev.player === ME) UI.toast('アタックステップ：攻撃するクリーチャーを選んでください');
        else log('CPU：アタックステップへ', OP);
        break;
      case 'summon':
        log(`${nm(ev.player)}：【${ev.unit.name}】を${ev.unit.spec.token ? '出した' : '召喚'}`, ev.player);
        summonFx(ev.unit, ev.player);
        break;
      case 'cast':
        log(`${nm(ev.player)}：【${ev.card.name}】を唱えた`, ev.player);
        castFx(ev.card, ev.player);
        break;
      case 'negated':
        Anim.schedule(500, () => { const el = $('#fx .cast-stage'); const p = el ? UI.stagePoint(el) : { x: 640, y: 300 }; stamp(p, '打ち消し！', '#c8a0ff'); });
        break;
      case 'activate':
        log(`${nm(ev.player)}：【${ev.unit.name}】の起動効果`, ev.player);
        B.activating = ev.unit.uid;
        break;
      case 'draw':
        if (ev.player === OP) drawFxOp();
        break;
      case 'attackDeclare':
        log(`${nm(ev.player)}：【${ev.unit.name}】が${ev.target ? `【${ev.target.name}】` : '相手'}に攻撃`, ev.player);
        Anim.schedule(450, () => {
          const a = unitEl(ev.unit);
          const b = ev.target ? unitEl(ev.target) : portrait(1 - ev.player);
          if (a && b) fx.line(UI.stagePoint(a), UI.stagePoint(b), sideColor(ev.player));
          if (a) a.animate([{ transform: 'none' }, { transform: `translateY(${ev.player === ME ? -16 : 16}px) scale(1.08)`, filter: 'brightness(1.5)' }, { transform: 'none' }], { duration: 420, easing: EASE });
        });
        break;
      case 'ember': {
        const pt = portrait(ev.player);
        if (pt) { const p = UI.stagePoint(pt); fx.float(p.x + 360, p.y, '🔥+' + ev.amount, 'ember'); }
        break;
      }
      case 'block':
        log(`${nm(ev.player)}：火種を払い【${ev.unit.name}】でブロック！`, ev.player);
        later(() => UI.pulse(unitEl(ev.unit), 'guarding', 600));
        break;
      case 'guard':
        log(`【${ev.unit.name}】が守護で攻撃を引き受けた`, ev.player);
        later(() => UI.pulse(unitEl(ev.unit), 'guarding', 600));
        break;
      case 'battle':
        later(() => { const d = unitEl(ev.d); if (d) { const p = UI.stagePoint(d); fx.slash(p.x, p.y); } });
        log(`バトル：${ev.a.name}（${ev.pa}） vs ${ev.d.name}（${ev.pd}）`);
        break;
      case 'damage': {
        const pt = portrait(ev.player);
        if (pt) { const p = UI.stagePoint(pt); fx.float(p.x + 60, p.y - 10, '-' + ev.amount, 'dmg'); }
        UI.pulse($('#pbar-' + ev.player), 'hit', 400);
        if (ev.player === ME && ev.amount >= 1500) UI.pulse($('#board'), 'shake', 400);
        break;
      }
      case 'heal': {
        const pt = portrait(ev.player);
        if (pt) { const p = UI.stagePoint(pt); fx.float(p.x + 60, p.y - 10, '+' + ev.amount, 'heal'); }
        break;
      }
      case 'destroy':
        log(`【${ev.unit.name}】は破壊された`, ev.unit.owner);
        break;
      case 'undying':
        log(`【${ev.unit.name}】は不屈で踏みとどまった`, ev.unit.owner);
        break;
      case 'negated':
        log(`【${ev.card.name}】は打ち消された！`, ev.player);
        UI.toast(`【${ev.card.name}】は打ち消された！`);
        break;
      case 'exile':
        log(`【${ev.unit.name}】は除外された`, ev.unit.owner);
        break;
      case 'toDeck':
        log(`【${ev.unit.name}】は山札の一番下へ`, ev.unit.owner);
        break;
      case 'steal':
        log(`${nm(ev.player)}が【${ev.unit.name}】を奪った！`, ev.player);
        break;
      case 'reveal':
        log(`${nm(ev.player)}の山札の一番上は【${ev.card.name}】`, ev.player);
        break;
      case 'protected':
        log(`【${ev.unit.name}】は守られて破壊されなかった`, ev.unit.owner);
        break;
      case 'bounce':
        log(`【${ev.unit.name}】は手札に戻された`, ev.unit.owner);
        break;
      case 'discard':
        log(`${nm(ev.player)}は【${ev.card.name}】を捨てた`, ev.player);
        break;
      case 'burnCard':
        log(`${nm(ev.player)}の手札があふれ、【${ev.card.name}】は墓地へ`, ev.player);
        break;
      case 'effect':
        effectFx(ev);
        break;
    }
  }

  function banner(big, small) {
    const el = document.createElement('div');
    el.className = 'banner';
    el.innerHTML = `<b>${esc(big)}</b><span>${esc(small)}</span>`;
    $('#fx').appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  function stamp(p, text, color) {
    const el = document.createElement('div');
    el.className = 'fx-stamp';
    el.textContent = text;
    el.style.color = color;
    place(el, p);
    fxLayer().appendChild(el);
    el.animate([{ transform: 'translate(-50%,-50%) scale(2.4) rotate(-14deg)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1) rotate(-8deg)', opacity: 1, offset: 0.3 }, { opacity: 1, offset: 0.8 }, { transform: 'translate(-50%,-50%) scale(1) rotate(-8deg)', opacity: 0 }],
      { duration: 1100, easing: EASE, fill: 'forwards' }).onfinish = () => el.remove();
  }

  /** 召喚：手札（CPUは画面上の手札）から場へカードが飛び、着地で輪が広がる。トークンはその場に光から現れる */
  function summonFx(unit, pi) {
    B.arriving.add(unit.uid);
    const from = unit.spec.token ? null : pi === ME ? (B.playFrom || handPoint()) : opHandPoint();
    B.playFrom = null;
    const dur = unit.spec.token ? 420 : 560;
    Anim.schedule(dur + 250, () => {
      const target = unitEl(unit);
      const to = target ? UI.stagePoint(target) : { x: 640, y: pi === ME ? 350 : 150 };
      const land = () => {
        B.arriving.delete(unit.uid);
        const el = unitEl(unit);
        if (el) {
          el.style.visibility = '';
          el.animate([{ transform: 'translateY(-26px) scale(1.25)', filter: 'brightness(2.6)', opacity: 0.2 }, { transform: 'translateY(4px) scale(.96)', filter: 'brightness(1.3)', opacity: 1, offset: 0.6 }, { transform: 'none', filter: 'none', opacity: 1 }],
            { duration: 380, easing: 'cubic-bezier(.3,1.4,.5,1)' });
        }
        ring(to, sideColor(pi), unit.spec.token ? 110 : 170, 'summon');
        sparks(to, sideColor(pi), unit.spec.token ? 8 : 14, unit.spec.token ? 60 : 95);
      };
      if (!from) { sparks(to, '#fff4c0', 10, 40); setTimeout(land, 160); return; }
      const card = UI.cardEl(unit.spec);
      card.classList.add('fly-card');
      fly(card, from, to, dur, { s0: pi === ME ? 0.95 : 0.55, s1: 0.62, r0: pi === ME ? -6 : 180, r1: 0, arc: 70, o1: 0.9, done: land });
    });
  }

  /** 呪文：中央へ飛んで魔法陣の上に掲げられ、光になって弾ける */
  function castFx(spec, pi) {
    const timing = (spec.effects || [])[0] && spec.effects[0].trig;
    const kind = timing === 'react' ? 'react' : timing === 'counter' ? 'counter' : 'cast';
    const from = pi === ME ? (B.playFrom || handPoint()) : opHandPoint();
    B.playFrom = null;
    Anim.schedule(1250, () => {
      const center = { x: 640, y: 296 };
      const stage = document.createElement('div');
      stage.className = `cast-stage ${kind} ${pi === ME ? 'me' : 'op'}`;
      stage.innerHTML = `<div class="cs-circle"></div><div class="cs-glow"></div><div class="cs-label">${{ cast: pi === ME ? 'あなたの呪文' : 'CPUの呪文', react: '迎撃！', counter: '対抗！' }[kind]}</div>`;
      place(stage, center);
      const card = UI.cardEl(spec);
      card.classList.add('fly-card');
      fly(card, from, center, 420, { s0: pi === ME ? 0.95 : 0.5, s1: 1.25, r0: pi === ME ? -6 : 180, arc: 40, keep: true, done: () => {
        fxLayer().appendChild(stage);
        card.remove();
        const big = UI.cardEl(spec);
        big.classList.add('cs-card');
        stage.appendChild(big);
        setTimeout(() => {
          big.animate([{ transform: 'translate(-50%,-50%) scale(1)', filter: 'brightness(1)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(1.12)', filter: 'brightness(3) blur(2px)', opacity: 0 }], { duration: 320, easing: 'ease-in', fill: 'forwards' });
          sparks(center, kind === 'cast' ? '#ffd88a' : kind === 'react' ? '#ff9a6a' : '#c8a0ff', 18, 140);
          ring(center, kind === 'cast' ? '#ffd88a' : kind === 'react' ? '#ff9a6a' : '#c8a0ff', 240);
          stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, delay: 120, fill: 'forwards' }).onfinish = () => stage.remove();
        }, 650);
      } });
    });
  }

  /** 効果の発動：クリーチャー（呪文なら中央）が光り、効果名が浮かび、対象へ光の線が伸びる */
  function effectFx(ev) {
    const e = ev.effect;
    const a = Parts.ACTIONS[e.act];
    if (!a) return;
    const fromUnit = ev.source && ev.card && ev.card.kind === 'creature';
    const activated = fromUnit && B.activating === ev.source.uid;
    if (activated) B.activating = null;
    const label = (activated ? '起動：' : fromUnit ? '' : '') + (Parts.TRIGGERS[e.trig] && Parts.TRIGGERS[e.trig].static ? '' : a.label.replace(/（.*?）/g, ''));
    const harmful = a.side === 'enemy' || ['burn', 'drainLife', 'oppDiscard', 'oppDiscardPick', 'manaBurn', 'emberBurn', 'millOpp'].includes(e.act) || a.meta;
    const color = a.meta ? '#c8a0ff' : harmful ? '#ff8a6a' : '#9fffb0';
    const targets = (ev.targets || []).slice();
    const pi = ev.player;
    Anim.schedule(fromUnit ? 720 : 420, () => {
      let origin;
      if (fromUnit) {
        const el = unitEl(ev.source);
        if (el) {
          origin = UI.stagePoint(el);
          el.animate([{ filter: 'none' }, { filter: `brightness(1.7) drop-shadow(0 0 14px ${color})`, transform: 'scale(1.08)' }, { filter: 'none', transform: 'none' }], { duration: 650, easing: 'ease-out' });
          ring(origin, color, 130, 'effect');
        } else origin = portrait(ev.source.owner) ? UI.stagePoint(portrait(ev.source.owner)) : { x: 640, y: 300 };
        const tag = document.createElement('div');
        tag.className = 'fx-tag';
        tag.style.setProperty('--tc', color);
        tag.textContent = '✦ ' + label;
        place(tag, { x: origin.x, y: origin.y - 70 });
        fxLayer().appendChild(tag);
        tag.animate([{ transform: 'translate(-50%,-30%) scale(.7)', opacity: 0 }, { transform: 'translate(-50%,-60%) scale(1)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%,-90%)', opacity: 1, offset: 0.75 }, { transform: 'translate(-50%,-120%)', opacity: 0 }],
          { duration: 1200, easing: 'ease-out', fill: 'forwards' }).onfinish = () => tag.remove();
      } else origin = { x: 640, y: 296 };
      // 対象への光の線
      setTimeout(() => {
        for (const t of targets) {
          const tel = unitEl(t);
          if (!tel) continue;
          const tp = UI.stagePoint(tel);
          fx.line(origin, tp, color);
          setTimeout(() => { ring(tp, color, 100, 'hit'); sparks(tp, color, 8, 50); }, 260);
        }
        // 対象のない効果：体力・手札などに関わる効果は、その人の帯へ
        if (!targets.length && a.side === 'none') {
          const toPi = harmful ? 1 - pi : pi;
          const pt = portrait(toPi);
          if (pt && fromUnit) { const tp = UI.stagePoint(pt); fx.line(origin, tp, color); setTimeout(() => sparks(tp, color, 8, 50), 260); }
        }
      }, fromUnit ? 220 : 0);
    });
  }

  /** CPUのドロー：山札から画面上の手札へ、裏向きのカードが飛ぶ */
  function drawFxOp() {
    Anim.schedule(260, () => {
      fly(cardBack(), deckPoint(OP), opHandPoint(), 420, { s0: 0.6, s1: 0.45, r0: 0, r1: 12, arc: 30, o1: 0.6 });
    }, 0.6);
  }

  /** 自分のドロー：手札に新しく来たカードを、山札から飛ばしてから表に返す（renderHand から呼ぶ） */
  function drawFxMe(newIids) {
    newIids.forEach((iid) => {
      const wait = Anim.schedule(300, () => {
        const el = $(`#hand .card[data-iid="${iid}"]`);
        const to = el ? UI.stagePoint(el) : handPoint();
        fly(cardBack(), deckPoint(ME), to, 380, { s0: 0.6, s1: 0.95, r0: 0, r1: -4, arc: 50, done: () => { B.sig = ''; } });
      }, 0.55);
      B.handReveal.set(iid, performance.now() + wait + 380);
    });
  }

  // ───────────── 描画 ─────────────
  function render() {
    const g = B.game;
    const sig = g.version + '|' + B.attackFrom + '|' + B.picks.join(',') + '|' + (g.pending ? g.pending.kind : '');
    if (sig === B.sig) return;
    B.sig = sig;
    renderPbar(g.players[ME]);
    renderPbar(g.players[OP]);
    renderField(g.players[ME]);
    renderField(g.players[OP]);
    renderHand();
    renderMid();
    B.pendingDirty = true; // 選択のダイアログは、演出が終わってから出す（loop で）
  }

  function renderPbar(p) {
    const g = B.game;
    const el = $('#pbar-' + p.index);
    const pct = Math.max(0, (p.hp / g.cfg.startHP) * 100);
    const targetable = p.index === OP && B.attackFrom && g.attackTargets(ME, B.attackFrom).includes('player');
    el.classList.toggle('targetable', !!targetable);
    el.classList.toggle('active', g.active === p.index);
    const graveTip = p.grave.length ? p.grave.map((c) => c.spec.name).join('、') : '墓地は空';
    el.innerHTML = `
      <div class="portrait">${PORTRAIT[p.index]}</div>
      <div class="pb-name">${esc(p.name)}</div>
      <div class="hpbar${p.hp <= 1500 ? ' low' : ''}"><i style="width:${pct}%"></i><span>♥ ${Math.max(0, p.hp)} / ${g.cfg.startHP}</span></div>
      <div class="mana" title="マナ（今使える量 / 最大マナ）"><span class="gem">◆</span><b>${p.mana}</b><small>/ ${p.maxMana}</small><span class="mcap">上限${g.cfg.maxManaCap}</span></div>
      <div class="ember${p.ember ? ' on' : ''}" title="火種：攻撃されるたびに1つ得る（${g.cfg.emberCap}つまで）。マナの代わりに使えるほか、${g.cfg.emberBlockCost}つ払って相手の本体への攻撃をブロックできる">🔥<b>${p.ember}</b><small>/${g.cfg.emberCap}</small></div>
      <div class="pb-info">
        <span title="手札">🂠 ${p.hand.length}</span><span title="山札（0枚で引くと負け）" class="pb-deck${p.deck.length <= 5 ? ' warn' : ''}">📚 ${p.deck.length}</span><span title="${esc(graveTip)}">⚰ ${p.grave.length}</span>
        ${g.metaOn(p).map((r) => (Parts.META[r.k] ? `<span class="lock" title="${r.statik ? '相手の場の常在効果' : '相手の次のターンの始めまで'}">🔒${esc(Parts.META[r.k].short(r.n))}${r.statik ? '（常在）' : ''}</span>` : '')).join('')}${p.nextDiscount ? `<span class="buffchip">次のカード-${p.nextDiscount}</span>` : ''}
      </div>
      ${p.index === OP ? `<div class="op-hand">${'<i></i>'.repeat(Math.min(10, p.hand.length))}</div>` : ''}`;
    el.onclick = () => clickPlayer(p.index);
  }

  function renderField(p) {
    const g = B.game;
    const box = $('#field-' + p.index);
    if (!box.firstChild) box.innerHTML = '<div class="slots">' + '<div class="slot"></div>'.repeat(g.cfg.fieldLimit) + '</div><div class="units"></div>';
    const units = $('.units', box);
    const alive = new Set(p.field.map((u) => u.uid));
    for (const [uid, el] of B.unitEls) {
      if (el.dataset.owner !== String(p.index) || alive.has(uid)) continue;
      B.unitEls.delete(uid);
      B.arriving.delete(uid);
      // 今の演出（攻撃や効果の線）が終わってから消える
      const wait = Math.max(0, Anim.busy - performance.now());
      setTimeout(() => { el.style.visibility = ''; el.classList.add('dying'); setTimeout(() => el.remove(), 500); }, wait);
    }
    const pd = g.pending && g.pending.player === ME && g.pending.kind === 'targets' ? g.pending : null;
    const attackTargets = B.attackFrom ? g.attackTargets(ME, B.attackFrom) : [];
    p.field.forEach((u, i) => {
      let el = B.unitEls.get(u.uid);
      if (!el) {
        el = document.createElement('div');
        el.className = 'unit';
        el.dataset.owner = String(p.index);
        el.onclick = () => clickUnit(u.uid);
        if (B.arriving.has(u.uid)) el.style.visibility = 'hidden'; // 召喚の演出で着地するまで隠す
        B.unitEls.set(u.uid, el);
        units.appendChild(el);
      }
      el.style.setProperty('--i', i);
      const pw = g.powerOf(u);
      const kws = Object.keys(Parts.KEYWORDS).filter((k) => g.hasKw(u, k)).map((k) => Parts.KEYWORDS[k].label);
      const canAtt = p.index === ME && g.canAttack(ME, u.uid);
      const canAct = p.index === ME && (u.spec.effects || []).some((e, i) => e.trig === 'activate' && g.canActivate(ME, u.uid, i));
      el.className = 'unit' + (u.tapped ? ' tapped' : '') + (u.sick ? ' sick' : '') + (canAtt ? ' can-attack' : '')
        + (B.attackFrom === u.uid ? ' selected' : '') + (attackTargets.includes(u.uid) ? ' targetable' : '')
        + (pd && pd.options.includes(u.uid) ? ' pickable' : '') + (B.picks.includes(u.uid) ? ' picked' : '')
        + (g.hasKw(u, 'guard') ? ' guard' : '') + (canAct ? ' can-activate' : '') + (u.silenced ? ' silenced' : '') + (u.frozen ? ' frozen' : '');
      el.style.setProperty('--cc', u.spec.color || '#5f8f4e');
      el.dataset.pv = '1';
      el.dataset.power = pw;
      el.dataset.now = `今のパワー ${pw}${u.tapped ? '・タップ中（相手の攻撃対象になる）' : '・アンタップ（攻撃されない）'}${u.sick ? '・召喚したターン' : ''}${u.silenced ? '・能力を消されている' : ''}${u.frozen ? '・凍結（次のターンにアンタップしない）' : ''}${u.protectedBy != null ? '・破壊されない' : ''}${u.returnTo != null ? '・このターンだけ奪われている' : ''}${kws.length ? '　キーワード：' + kws.join('・') : ''}`;
      el.innerHTML = `
        <div class="u-inner">
          <div class="u-cost">${u.spec.cost}</div>
          <div class="u-art">${esc(u.icon || '❔')}</div>
          <div class="u-name">${esc(u.name)}</div>
          <div class="u-kw">${esc(kws.join('・'))}${(u.spec.effects || []).length ? '<span class="u-fx">✦</span>' : ''}</div>
          <div class="u-power${pw > u.power ? ' up' : pw < u.power ? ' down' : ''}">${pw}</div>
          ${u.tapped ? '<div class="u-tap">TAP</div>' : ''}
          ${u.sick && !u.tapped ? '<div class="u-sick" title="召喚したターンは攻撃できない">💤</div>' : ''}
          ${u.frozen ? '<div class="u-frozen" title="凍結">❄</div>' : ''}${u.silenced ? '<div class="u-silenced" title="能力を消されている">🚫</div>' : ''}
        </div>`;
      UI.bindSpec(el, u.spec); // マウスを乗せるとカードを拡大表示
    });
  }

  function renderHand() {
    const g = B.game;
    const me = g.players[ME];
    const box = $('#hand');
    box.innerHTML = '';
    const n = me.hand.length;
    // 新しく手札に来たカード（ドロー・手札に戻る）に演出を付ける
    const fresh = me.hand.filter((c) => !B.handSeen.has(c.iid)).map((c) => c.iid);
    if (fresh.length) { fresh.forEach((iid) => B.handSeen.add(iid)); drawFxMe(fresh); }
    const now = performance.now();
    me.hand.forEach((c, i) => {
      const chk = g.canPlay(ME, c.iid);
      const el = UI.cardEl(c.spec, { badge: !chk.ok && g.active === ME && !g.pending ? chk.reason : '', cost: g.costOf(me, c.spec) });
      const off = i - (n - 1) / 2;
      el.style.setProperty('--r', (off * 3).toFixed(1) + 'deg');
      el.style.setProperty('--y', (Math.abs(off) ** 1.5 * 3).toFixed(1) + 'px');
      el.classList.add(chk.ok ? 'playable' : 'unplayable');
      el.dataset.iid = c.iid;
      const rv = B.handReveal.get(c.iid);
      if (rv != null) {
        // 裏向きのカードが届くまでは隠しておき、届いたら表に返す
        const left = rv - now;
        if (left > -400) { el.classList.add('drawn'); el.style.setProperty('--dly', `${Math.round(left)}ms`); }
        else B.handReveal.delete(c.iid);
        if (left > 0) setTimeout(() => { B.sig = ''; }, left + 420);
      }
      el.onclick = () => clickHand(c.iid);
      box.appendChild(el);
    });
  }

  function renderMid() {
    const g = B.game;
    const mine = g.active === ME;
    const stepLabel = g.step === 'main' ? 'メインステップ' : 'アタックステップ';
    $('#turn-info').innerHTML = `<span class="ti-who ${mine ? 'me' : 'op'}">${mine ? 'あなた' : 'CPU'}のターン</span><span class="ti-steps"><i class="${g.step === 'main' ? 'on' : ''}">メイン</i><i class="${g.step === 'attack' ? 'on' : ''}">アタック</i></span>${mine && g.step === 'attack' ? `<span class="ti-hint">${B.attackFrom ? '攻撃先を選ぶ（右クリック／Escでやめる）' : '攻撃するクリーチャーを選ぶ'}</span>` : mine ? '<span class="ti-hint">カードを使う</span>' : `<span class="ti-hint">${esc(stepLabel)}…</span>`}`;
    $('#btn-attack').disabled = !myTurn('main');
    $('#btn-end').disabled = !myTurn();
  }

  function showResult() {
    const g = B.game;
    stop();
    const win = g.winner === ME;
    const [me, op] = g.players;
    setTimeout(() => {
      UI.modal(`<span class="result ${win ? 'win' : 'lose'}">${win ? 'VICTORY' : 'DEFEAT'}</span>`,
        `<p class="result-sub">${win ? '勝利！' : '敗北…'}　${esc(g.endReason)}（${g.turn}ターン）</p>
        <table class="result-table"><tr><th></th><th>あなた</th><th>CPU</th></tr>
        <tr><td>残り体力</td><td>${Math.max(0, me.hp)}</td><td>${Math.max(0, op.hp)}</td></tr>
        <tr><td>与えたダメージ</td><td>${me.stats.damage}</td><td>${op.stats.damage}</td></tr>
        <tr><td>使ったカード</td><td>${me.stats.played}</td><td>${op.stats.played}</td></tr>
        <tr><td>破壊したクリーチャー</td><td>${me.stats.destroyed}</td><td>${op.stats.destroyed}</td></tr></table>`,
        [
          { label: 'タイトルへ', onClick: () => { UI.closeModal(); UI.showScreen('title'); } },
          { label: 'もう一度', primary: true, onClick: () => { UI.closeModal(); start({ ...B.setup, cpuDeck: AI.buildDeck() }); } },
        ]);
    }, 900);
  }

  function init() {
    document.addEventListener('keydown', onKey);
    $('#screen-battle').addEventListener('contextmenu', (e) => { if (B.attackFrom) { e.preventDefault(); B.attackFrom = null; B.sig = ''; } });
    $('#btn-attack').onclick = () => { if (myTurn('main')) B.game.toAttack(ME); };
    $('#btn-end').onclick = () => {
      if (!myTurn()) return;
      const g = B.game;
      const left = g.players[ME].field.filter((u) => g.canAttack(ME, u.uid) || (g.step === 'main' && !u.tapped && !u.sick && !(u.spec.keywords || []).includes('slow'))).length;
      B.attackFrom = null;
      if (left && g.step === 'main') {
        UI.modal('ターン終了', `<p>まだ攻撃していないクリーチャーが${left}体います。攻撃せずにターンを終えますか？</p>`, [
          { label: 'アタックへ', onClick: () => { UI.closeModal(); g.toAttack(ME); } },
          { label: 'ターン終了', primary: true, onClick: () => { UI.closeModal(); g.endTurn(ME); } },
        ]);
      } else g.endTurn(ME);
    };
    $('#btn-menu').onclick = openMenu;
  }

  root.Battle = { init, start };
})(this);
