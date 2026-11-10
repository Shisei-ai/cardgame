/*
 * battle.js — 対戦画面
 *
 * 画面の配置（index.html）：
 *   上＝相手（中央に顔と体力、右上にマナと枚数、左上に手札の裏）、下＝自分（左下にマナ、その右に顔と体力、右下に手札）
 *   中央の闘技場に、お互いの場（6体まで）が向かい合う。右にターン終了・山札・墓地。
 *   マナの円の周りの5つの穴は火種（光っている数が今の火種）。
 *
 * 操作：
 *   手札 … クリックするか、上（場の方）へドラッグして使う
 *   攻撃 … 攻撃できる自分のクリーチャーを、攻撃先（相手の顔・タップした相手クリーチャー）へドラッグする
 *          （クリック → 攻撃先をクリック、でもよい）。メインステップ中に攻撃すると、自動でアタックステップへ移る
 *   【起動】効果 … 自分のクリーチャーをクリック
 *   右クリック／Esc … 攻撃先選びをやめる
 *   カードにマウスを乗せると、詳しい説明が情報パネルに出る
 *
 * 演出（Anim）：
 *   エンジンは一瞬で処理を終えるので、演出は「順番待ちの列」に並べて少しずつずらして再生する（Anim.schedule）。
 *   ・召喚：手札（CPUは左上の手札）から場へカードが飛び、着地すると光の輪が広がる。着地までクリーチャーは隠しておく
 *   ・呪文：カードが中央へ飛び、魔法陣の上に掲げられてから光になって弾ける（迎撃・対抗は色と見出しが変わる）
 *   ・効果の発動：クリーチャーが光り、効果名が浮かび、対象へ光の線が伸びる
 *   ・ドロー：山札から裏向きのカードが飛び、手札に入る時に表に返る
 *   ・攻撃：攻撃するクリーチャーが浮き上がり、狙いの矢印が伸びる。本体への攻撃は相手の顔へ突進して衝撃・画面の揺れ
 *   ・バトル：お互いのパワーが浮かび、激突。勝った方の数字が輝き、負けた方の数字が砕ける
 *   ・破壊：白く光ってひびが入り、破片になって飛び散る。魂の光が墓地へ飛ぶ
 *   ・体力：ダメージの数字が大きく出てから、体力の帯が減る（表示上の体力 hpShown を演出に合わせて動かす）
 *   CPUは演出が終わるまで次の行動を待つ。選択のダイアログや勝敗の画面も、演出が終わってから出す。
 */
(function (root) {
  'use strict';
  const { Parts, Engine, AI, UI } = root;
  const { $, $$, esc, fx } = UI;
  const ME = 0, OP = 1;
  const AI_DELAY = 800;
  const INTRO_MS = 2300; // 対戦開始の演出（VS）の長さ
  const PORTRAIT = ['🧑‍🔧', '🤖'];
  const KW_ICON = { guard: '🛡', assassin: '🗡', haste: '⚡', double: '⚔', pierce: '➹', stealth: '👁', undying: '✚', sniper: '🎯', drain: '🩸', ward: '🔰', slow: '🐢', fleeting: '⌛' };

  const B = { game: null, ai: null, setup: null, attackFrom: null, picks: [], pendingShown: null, sig: '', raf: 0, aiT: 0, unitEls: new Map(), feed: [],
    arriving: new Set(),   // 召喚の演出中（まだ着地していない）クリーチャーの uid
    handSeen: new Set(),   // 一度でも表示した手札の iid（新しく来たカードにドローの演出を付ける）
    handReveal: new Map(), // 手札に入る演出の時刻（iid → performance.now() の時刻）
    playFrom: null,        // 直前に使った手札のカードの位置（召喚・呪文の演出の出発点）
    hpShown: [0, 0],       // 画面に出している体力（ダメージの演出に合わせて減らす）
    drag: null,            // ドラッグ中の情報
    noClickUntil: 0,       // ドラッグの直後に「クリック」が重ねて起きないようにする
    lockUntil: 0,          // 対戦開始の演出が終わるまで操作を受け付けない
    pendingDirty: false, activating: null,
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

  const color = (pi) => (pi === ME ? '#7fd6ff' : '#ff9a6a');
  const pilePoint = (pi, kind) => { const el = $(`#piles-${pi} .pile.${kind}`); return el ? UI.stagePoint(el) : { x: 1180, y: pi === ME ? 500 : 170 }; };
  const deckPoint = (pi) => pilePoint(pi, 'deck');
  const gravePoint = (pi) => pilePoint(pi, 'grave');
  const opHandPoint = () => { const h = $('#op-hand'); return h ? UI.stagePoint(h, 0.7) : { x: 150, y: 20 }; };
  const handPoint = () => UI.stagePoint($('#hand'), 0.4);
  const portrait = (pi) => $(`#pbar-${pi} .portrait`);
  const unitEl = (u) => u && B.unitEls.get(u.uid);
  const alive = (el) => el && el.isConnected;
  /** 画面上の要素の四角形（舞台の座標） */
  function stageRect(el) {
    const r = el.getBoundingClientRect(), s = $('#stage').getBoundingClientRect(), k = s.width / 1280;
    return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k };
  }
  /** マウスの位置（舞台の座標） */
  function toStage(e) { const s = $('#stage').getBoundingClientRect(), k = s.width / 1280; return { x: (e.clientX - s.left) / k, y: (e.clientY - s.top) / k }; }

  function start(setup) {
    stop();
    B.setup = setup;
    const g = new Engine.Game({ decks: [setup.myDeck, setup.cpuDeck], names: ['あなた', 'CPU'] });
    B.game = g;
    B.ai = new AI.AI(g, OP, setup.level);
    g.onEvent = onEvent;
    B.attackFrom = null; B.picks = []; B.pendingShown = null; B.sig = ''; B.unitEls = new Map(); B.feed = [];
    B.arriving = new Set(); B.handSeen = new Set(); B.handReveal = new Map(); B.playFrom = null; B.drag = null;
    B.hpShown = [g.cfg.startHP, g.cfg.startHP];
    Anim.reset();
    for (const id of ['#field-0', '#field-1', '#fx', '#feed', '#hand', '#op-hand']) $(id).innerHTML = '';
    $('#board').classList.remove('danger');
    $$('#board .portrait.ko').forEach((x) => x.classList.remove('ko'));
    UI.setDetail(showDetail);
    UI.closeModal();
    UI.showScreen('battle');
    // 開始の演出（VS）の時間を先に確保してから始める。最初のターンの演出やドローは、その後に並ぶ
    Anim.schedule(INTRO_MS, () => {}, 0);
    B.lockUntil = performance.now() + INTRO_MS;
    setTimeout(() => { B.sig = ''; }, INTRO_MS + 30);
    g.start();
    introFx(g.first);
    B.raf = requestAnimationFrame(loop);
  }

  /** 対戦開始：左右から顔が滑り込み、中央で VS がぶつかり、先攻を告げる（見た目は motion.css の .intro） */
  function introFx(first) {
    const el = document.createElement('div');
    el.className = 'intro';
    el.innerHTML = `
      <div class="in-side me"><div class="in-face">${PORTRAIT[ME]}</div><b>あなた</b></div>
      <div class="in-side op"><div class="in-face">${PORTRAIT[OP]}</div><b>CPU</b></div>
      <div class="in-vs">VS</div>
      <div class="in-first"><b>${first === ME ? 'あなたが先攻' : 'CPUが先攻'}</b><small>先攻の1ターン目はドローしません</small></div>`;
    $('#fx').appendChild(el);
    setTimeout(() => { if (!el.isConnected) return; impact({ x: 640, y: 330 }, '#ffd86a', true); shake($('#board'), 10, 400); if (root.Ambient) root.Ambient.burst(640, 330, '#ffd88a', 40, 1.5); }, 620);
    setTimeout(() => el.remove(), INTRO_MS + 250);
  }

  function stop() { cancelAnimationFrame(B.raf); clearTimeout(B.aiT); B.aiT = 0; }

  function loop() {
    const g = B.game;
    // 演出がすべて終わったのに表示の体力がずれていたら合わせる（念のため）
    if (Anim.idle() && (B.hpShown[0] !== g.players[0].hp || B.hpShown[1] !== g.players[1].hp)) { B.hpShown = [g.players[0].hp, g.players[1].hp]; B.sig = ''; }
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
  function myTurn(step) { const g = B.game; return !g.over && !g.pending && g.active === ME && (!step || g.step === step) && performance.now() >= B.lockUntil; }
  /** メインステップ中でも「攻撃しようとすれば攻撃できるか」 */
  const couldAttack = (uid) => B.game.canAttack(ME, uid, true);
  const targetsOf = (uid) => B.game.attackTargets(ME, uid, true);
  const clickBlocked = () => performance.now() < B.noClickUntil;

  /** 攻撃する。メインステップ中なら、先にアタックステップへ移る */
  function doAttack(from, target) {
    const g = B.game;
    B.attackFrom = null; B.sig = '';
    if (!targetsOf(from).includes(target)) return false;
    if (g.step === 'main') g.toAttack(ME);
    return g.attack(ME, from, target);
  }

  function clickHand(iid, from) {
    const g = B.game;
    if (g.pending) return;
    const chk = g.canPlay(ME, iid);
    if (!chk.ok) { if (chk.reason) UI.toast(chk.reason); return; }
    B.attackFrom = null;
    const el = $(`#hand .card[data-iid="${iid}"]`);
    B.playFrom = from || (el ? UI.stagePoint(el) : null);
    UI.hidePreview();
    g.play(ME, iid);
  }

  function clickUnit(uid) {
    if (clickBlocked()) return;
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
    if (pd || !myTurn()) return;
    const u = g.findUnit(uid);
    if (!u) return;
    // 攻撃先を選んでいる途中
    if (B.attackFrom != null) {
      if (B.attackFrom === uid) { B.attackFrom = null; B.sig = ''; return; }
      if (targetsOf(B.attackFrom).includes(uid)) { doAttack(B.attackFrom, uid); return; }
      if (u.owner !== ME) { UI.toast('アンタップしている相手のクリーチャーは攻撃できない（狙撃を除く）'); return; }
    }
    if (u.owner !== ME) return;
    const idxs = g.step === 'main' ? (u.spec.effects || []).map((e, i) => (e.trig === 'activate' ? i : -1)).filter((i) => i >= 0) : [];
    const canAtk = couldAttack(uid);
    if (idxs.length) { openActivate(u, idxs, canAtk); return; }
    if (canAtk) { B.attackFrom = uid; B.sig = ''; return; }
    UI.toast(u.tapped ? 'タップしているので攻撃できない' : u.sick ? '召喚したターンは攻撃できない（速攻を除く）' : g.hasKw(u, 'slow') ? '鈍重：攻撃できない' : '今は攻撃できない');
  }

  /** 【起動】効果を持つクリーチャーをクリックした時のメニュー（攻撃もここから選べる） */
  function openActivate(u, idxs, canAtk) {
    const g = B.game;
    const usable = idxs.filter((i) => g.canActivate(ME, u.uid, i));
    const buttons = [{ label: 'やめる', onClick: UI.closeModal }];
    if (canAtk) buttons.push({ label: '⚔ 攻撃する', primary: true, onClick: () => { UI.closeModal(); B.attackFrom = u.uid; B.sig = ''; } });
    const m = UI.modal(`【${esc(u.name)}】`, `<div class="act-list">${idxs.map((i) => `<button class="act-item" data-i="${i}" ${usable.includes(i) ? '' : 'disabled'}>${esc(Parts.effectText(u.spec, u.spec.effects[i]))}</button>`).join('')}</div><p class="hint">${usable.length ? '' : (u.silenced ? '能力を消されている。' : '今は使えない（コスト・回数・タップの状態を確認）。')}タップするコストがあると、このターンは攻撃できず、相手の攻撃対象になります。${canAtk ? '<br>攻撃は、このクリーチャーを攻撃先へドラッグしてもできます。' : ''}</p>`, buttons);
    m.querySelectorAll('.act-item').forEach((b) => { b.onclick = () => { UI.closeModal(); g.activate(ME, u.uid, Number(b.dataset.i)); }; });
  }

  function clickPlayer(pi) {
    if (clickBlocked()) return;
    if (pi === OP && B.attackFrom != null && myTurn()) doAttack(B.attackFrom, 'player');
  }

  function submitTargets() {
    const pick = B.picks.slice();
    B.picks = [];
    B.pendingShown = null;
    B.game.answer(pick);
  }

  // ── ドラッグ（手札を場へ／クリーチャーを攻撃先へ） ──
  function onPointerDown(e) {
    if (e.button !== 0 || !B.game || !myTurn()) return;
    const card = e.target.closest('#hand .card');
    const unit = e.target.closest('.unit');
    if (card) B.drag = { kind: 'hand', iid: Number(card.dataset.iid), el: card, p0: toStage(e), moved: false };
    else if (unit && unit._uid != null && unit.dataset.owner === String(ME) && couldAttack(unit._uid)) B.drag = { kind: 'unit', uid: unit._uid, el: unit, p0: toStage(e), moved: false };
  }
  function onPointerMove(e) {
    const d = B.drag;
    if (!d) return;
    const p = toStage(e);
    if (!d.moved) {
      if (Math.hypot(p.x - d.p0.x, p.y - d.p0.y) < 10) return;
      d.moved = true;
      UI.hidePreview();
      if (d.kind === 'unit') { B.attackFrom = d.uid; B.sig = ''; }
      else d.el.classList.add('dragging');
    }
    if (d.kind === 'hand') {
      d.el.style.translate = `${p.x - d.p0.x}px ${p.y - d.p0.y}px`;
      d.el.classList.toggle('will-play', p.y < 500);
    } else {
      const a = UI.stagePoint(d.el);
      const line = $('#aim line');
      line.setAttribute('x1', a.x); line.setAttribute('y1', a.y); line.setAttribute('x2', p.x); line.setAttribute('y2', p.y);
      $('#aim').classList.add('show');
      const t = dropTarget(e, d.uid);
      $$('.aimed').forEach((x) => x.classList.remove('aimed'));
      if (t != null) (t === 'player' ? $('#pbar-1') : B.unitEls.get(t)).classList.add('aimed');
      $('#aim').classList.toggle('locked', t != null);
    }
  }
  function onPointerUp(e) {
    const d = B.drag;
    if (!d) return;
    B.drag = null;
    if (!d.moved) return; // ただのクリック（click の処理に任せる）
    B.noClickUntil = performance.now() + 80;
    $('#aim').classList.remove('show', 'locked');
    $$('.aimed').forEach((x) => x.classList.remove('aimed'));
    const p = toStage(e);
    if (d.kind === 'hand') {
      d.el.classList.remove('dragging', 'will-play');
      if (p.y < 500) { clickHand(d.iid, p); B.sig = ''; return; }
      d.el.style.translate = '';
      return;
    }
    const t = dropTarget(e, d.uid);
    if (t != null) doAttack(d.uid, t);
    else { B.attackFrom = null; B.sig = ''; }
  }
  /** ドラッグを離した所にある攻撃先（なければ null） */
  function dropTarget(e, uid) {
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (!hit) return null;
    const list = targetsOf(uid);
    const u = hit.closest('.unit');
    if (u && u._uid != null && list.includes(u._uid)) return u._uid;
    if (hit.closest('#pbar-1') && list.includes('player')) return 'player';
    return null;
  }

  function onKey(e) {
    if (!$('#screen-battle').classList.contains('active')) return;
    if (e.key === 'Escape') { if (B.attackFrom != null) { B.attackFrom = null; B.sig = ''; } else openMenu(); }
  }

  function openMenu() {
    UI.modal('メニュー', '<p>対戦を続けますか？</p>', [
      { label: '降参してタイトルへ', danger: true, onClick: () => { stop(); UI.closeModal(); UI.showScreen('title'); } },
      { label: '続ける', primary: true, onClick: UI.closeModal },
    ]);
  }

  /** 墓地の中身を見る */
  function openGrave(pi) {
    const p = B.game.players[pi];
    const m = UI.modal(`${pi === ME ? 'あなた' : 'CPU'}の墓地（${p.grave.length}枚）`, p.grave.length ? '<div class="m-cards"></div>' : '<p class="hint">墓地は空です。</p>', [{ label: '閉じる', primary: true, onClick: UI.closeModal }], 'wide');
    const box = $('.m-cards', m);
    if (box) p.grave.slice().reverse().forEach((c) => box.appendChild(UI.cardEl(c.spec)));
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
  function log(text, who) {
    B.feed.unshift({ text, who });
    B.feed = B.feed.slice(0, 6);
    $('#feed').innerHTML = B.feed.map((f, i) => `<div class="f-row ${f.who === ME ? 'me' : f.who === OP ? 'op' : ''}" style="opacity:${1 - i * 0.12}">${esc(f.text)}</div>`).join('');
  }

  function onEvent(ev) {
    const g = B.game;
    const nm = (pi) => (pi === ME ? 'あなた' : 'CPU');
    switch (ev.type) {
      case 'turn':
        B.attackFrom = null;
        Anim.schedule(950, () => turnBanner(ev.player, Math.ceil(ev.turn / 2), g.players[ev.player].maxMana), 0.45);
        break;
      case 'step':
        if (ev.player === ME) UI.toast('アタックステップへ（このターンはもうカードを使えない）');
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
        log(`【${ev.card.name}】は打ち消された！`, ev.player);
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
        attackFx(unitEl(ev.unit), ev.target ? unitEl(ev.target) : $(`#pbar-${1 - ev.player}`), ev.player);
        break;
      case 'block':
        log(`${nm(ev.player)}：火種を払い【${ev.unit.name}】でブロック！`, ev.player);
        blockFx(unitEl(ev.unit), unitEl(ev.attacker), 'ブロック！');
        break;
      case 'guard':
        log(`【${ev.unit.name}】が守護で攻撃を引き受けた`, ev.player);
        blockFx(unitEl(ev.unit), null, '守護！');
        break;
      case 'battle':
        log(`バトル：${ev.a.name}（${ev.pa}） vs ${ev.d.name}（${ev.pd}）`);
        battleFx(unitEl(ev.a), unitEl(ev.d), ev.pa, ev.pd, ev.a.owner);
        break;
      case 'hitPlayer':
        hitFx(unitEl(ev.unit), ev.player);
        break;
      case 'damage':
        hpFx(ev.player, -ev.amount, g.players[ev.player].hp, !!ev.self);
        break;
      case 'heal':
        hpFx(ev.player, ev.amount, g.players[ev.player].hp);
        break;
      case 'ember':
        Anim.schedule(300, () => {
          const d = $(`#dial-${ev.player}`);
          if (d) { const p = UI.stagePoint(d); fx.float(p.x + (ev.player === ME ? 70 : -70), p.y, '🔥+' + ev.amount, 'ember'); }
          B.sig = '';
        }, 0.8);
        break;
      case 'destroy':
        log(`【${ev.unit.name}】は破壊された`, ev.unit.owner);
        shatterFx(unitEl(ev.unit), ev.unit.owner);
        break;
      case 'undying':
        log(`【${ev.unit.name}】は不屈で踏みとどまった`, ev.unit.owner);
        surviveFx(unitEl(ev.unit), '不屈！', '#ffd86a');
        break;
      case 'protected':
        log(`【${ev.unit.name}】は守られて破壊されなかった`, ev.unit.owner);
        surviveFx(unitEl(ev.unit), '守られた！', '#7fd6ff');
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

  /** ターンの始まり：その人の色の帯が横から走り、「あなたのターン」が出る。自分の番なら「ターン終了」も一度光る */
  function turnBanner(pi, round, maxMana) {
    const el = document.createElement('div');
    el.className = 'turn-banner ' + (pi === ME ? 'me' : 'op');
    el.innerHTML = `<i></i><b>${pi === ME ? 'あなたのターン' : 'CPUのターン'}</b><span>第${round}巡<em>◆</em>最大マナ ${maxMana}</span>`;
    $('#fx').appendChild(el);
    setTimeout(() => el.remove(), 1500);
    UI.pulse($('#dial-' + pi), 'refill', 700);
    if (pi === ME) UI.pulse($('#btn-end'), 'wake', 800);
  }

  /** 一時的な要素を舞台に置いて、終わったら消す */
  function spawn(cls, p, html = '', css = {}) {
    const el = document.createElement('div');
    el.className = cls;
    if (html) el.innerHTML = html;
    Object.assign(el.style, css);
    place(el, p);
    fxLayer().appendChild(el);
    return el;
  }
  /** 衝撃：白い閃光・十字の斬撃・輪・火花 */
  function impact(p, c, big = false) {
    const s = big ? 1.5 : 1;
    const flash = spawn('fx-impact', p);
    flash.style.width = flash.style.height = 160 * s + 'px';
    flash.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(1.3)', opacity: 0 }], { duration: 420, easing: 'ease-out', fill: 'forwards' }).onfinish = () => flash.remove();
    for (const r of [-35, 40]) {
      const sl = spawn('fx-cut', p);
      sl.style.setProperty('--lc', c);
      sl.style.width = 220 * s + 'px';
      sl.animate([{ transform: `translate(-50%,-50%) rotate(${r}deg) scaleX(0)`, opacity: 1 }, { transform: `translate(-50%,-50%) rotate(${r}deg) scaleX(1)`, opacity: 1, offset: 0.4 }, { transform: `translate(-50%,-50%) rotate(${r}deg) scaleX(1.1) scaleY(.2)`, opacity: 0 }], { duration: 460, easing: 'ease-out', fill: 'forwards' }).onfinish = () => sl.remove();
    }
    ring(p, c, 180 * s, 'hit');
    sparks(p, c, big ? 22 : 14, 120 * s);
    sparks(p, '#fff2c0', 8, 70 * s);
  }
  function shake(el, power = 8, dur = 380) {
    if (!el) return;
    const k = [];
    for (let i = 0; i <= 6; i++) { const f = (1 - i / 6) * power; k.push({ transform: i === 6 ? 'none' : `translate(${(Math.random() * 2 - 1) * f}px, ${(Math.random() * 2 - 1) * f}px)` }); }
    el.animate(k, { duration: dur, easing: 'linear' });
  }
  /** 狙いの矢印（攻撃の宣言・ブロックの向き） */
  function aimFx(a, b, c, dur = 600) {
    const el = spawn('fx-aim', a);
    el.style.setProperty('--lc', c);
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    el.style.width = len + 'px';
    el.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    el.animate([{ clipPath: 'inset(0 100% 0 0)', opacity: 1 }, { clipPath: 'inset(0 0 0 0)', opacity: 1, offset: 0.45 }, { clipPath: 'inset(0 0 0 0)', opacity: 0 }], { duration: dur, easing: 'ease-out', fill: 'forwards' }).onfinish = () => el.remove();
  }
  /** クリーチャーを目標へ突進させ、当たる瞬間に hit() を呼ぶ */
  function dash(el, to, k, dur, hit) {
    const a = UI.stagePoint(el);
    const dx = (to.x - a.x) * k, dy = (to.y - a.y) * k;
    el.style.zIndex = 30;
    const an = el.animate([
      { transform: 'none' },
      { transform: `translate(${-dx * 0.1}px, ${-dy * 0.1}px) scale(1.12)`, offset: 0.3 },
      { transform: `translate(${dx}px, ${dy}px) scale(1.18)`, offset: 0.52, easing: 'cubic-bezier(.5,0,.2,1)' },
      { transform: `translate(${dx * 0.92}px, ${dy * 0.92}px) scale(1.1)`, offset: 0.62 },
      { transform: 'none' },
    ], { duration: dur, easing: 'ease-in-out' });
    an.onfinish = () => { el.style.zIndex = ''; };
    if (hit) setTimeout(() => hit({ x: a.x + dx, y: a.y + dy }), dur * 0.52);
  }

  /** 攻撃の宣言：浮き上がって光り、攻撃先へ矢印が伸びる */
  function attackFx(aEl, tEl, pi) {
    Anim.schedule(620, () => {
      if (!alive(aEl)) return;
      const a = UI.stagePoint(aEl);
      const up = pi === ME ? -16 : 16;
      aEl.animate([{ transform: 'none', filter: 'none' }, { transform: `translateY(${up}px) scale(1.14)`, filter: `brightness(1.6) drop-shadow(0 0 14px ${color(pi)})`, offset: 0.4 }, { transform: 'none', filter: 'none' }], { duration: 620, easing: EASE });
      ring(a, color(pi), 130, 'effect');
      if (alive(tEl)) aimFx(a, UI.stagePoint(tEl), pi === ME ? '#ffd86a' : '#ff7a5a');
    }, 0.15);
  }
  /** 守護・ブロック：盾の紋章が現れ、攻撃を受け止める向きに線が伸びる */
  function blockFx(bEl, aEl, label) {
    Anim.schedule(700, () => {
      if (!alive(bEl)) return;
      const b = UI.stagePoint(bEl);
      bEl.animate([{ transform: 'none' }, { transform: 'translateY(-10px) scale(1.12)', filter: 'brightness(1.5) drop-shadow(0 0 16px #7ad0ea)', offset: 0.35 }, { transform: 'none', filter: 'none' }], { duration: 650, easing: EASE });
      const sh = spawn('fx-shield', b, '<i>🛡</i>');
      sh.animate([{ transform: 'translate(-50%,-50%) scale(2.2)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.3 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.75 }, { transform: 'translate(-50%,-50%) scale(1.3)', opacity: 0 }], { duration: 800, easing: EASE, fill: 'forwards' }).onfinish = () => sh.remove();
      ring(b, '#7ad0ea', 150, 'summon');
      tagAt({ x: b.x, y: b.y - 78 }, label, '#9fe6ff');
      if (alive(aEl)) aimFx(UI.stagePoint(aEl), b, '#7ad0ea', 500);
    }, 0.1);
  }
  function tagAt(p, text, c) {
    const tag = spawn('fx-tag', p);
    tag.style.setProperty('--tc', c);
    tag.textContent = text;
    tag.animate([{ transform: 'translate(-50%,-30%) scale(.7)', opacity: 0 }, { transform: 'translate(-50%,-60%) scale(1.1)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%,-80%)', opacity: 1, offset: 0.75 }, { transform: 'translate(-50%,-110%)', opacity: 0 }], { duration: 1000, easing: 'ease-out', fill: 'forwards' }).onfinish = () => tag.remove();
  }

  /** バトル：パワーの数字が浮かび、お互いが突進して激突。勝った方の数字が輝き、負けた方の数字が砕ける */
  function battleFx(aEl, dEl, pa, pd, ownerA) {
    Anim.schedule(1250, () => {
      if (!alive(aEl) || !alive(dEl)) return;
      const a = UI.stagePoint(aEl), d = UI.stagePoint(dEl);
      const mid = { x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 };
      const off = (p) => ({ x: p.x, y: p.y + (p.y < 282 ? -72 : 74) });
      const la = spawn('fx-pow', off(a), String(pa)), ld = spawn('fx-pow', off(d), String(pd));
      la.style.setProperty('--pc', color(ownerA)); ld.style.setProperty('--pc', color(1 - ownerA));
      for (const l of [la, ld]) l.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 1, offset: 0.6 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }], { duration: 300, easing: EASE, fill: 'forwards' });
      const vs = spawn('fx-vs', mid, 'VS');
      vs.animate([{ transform: 'translate(-50%,-50%) scale(3)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.35 }, { opacity: 1, offset: 0.7 }, { transform: 'translate(-50%,-50%) scale(1.4)', opacity: 0 }], { duration: 700, easing: EASE, fill: 'forwards' }).onfinish = () => vs.remove();
      setTimeout(() => {
        dash(aEl, d, 0.42, 620, () => {
          impact(mid, '#fff0b0', true);
          shake($('#board'), 7, 320);
          // 結果：勝った方は輝き、負けた方（同じなら両方）は砕ける
          setTimeout(() => {
            for (const [l, r] of [[la, pa > pd ? 'win' : 'lose'], [ld, pd > pa ? 'win' : 'lose']]) {
              if (r === 'win') l.animate([{ transform: 'translate(-50%,-50%) scale(1)', filter: 'brightness(1)' }, { transform: 'translate(-50%,-50%) scale(1.45)', filter: 'brightness(1.8)', offset: 0.4 }, { transform: 'translate(-50%,-60%) scale(1.3)', opacity: 0 }], { duration: 700, easing: EASE, fill: 'forwards' }).onfinish = () => l.remove();
              else { l.classList.add('lose'); l.animate([{ transform: 'translate(-50%,-50%) rotate(0deg)', opacity: 1 }, { transform: 'translate(-46%,-50%) rotate(-8deg)', offset: 0.2 }, { transform: 'translate(-54%,-50%) rotate(6deg)', offset: 0.4 }, { transform: 'translate(-50%,-20%) rotate(14deg) scale(.8)', opacity: 0 }], { duration: 700, easing: 'ease-in', fill: 'forwards' }).onfinish = () => l.remove(); }
            }
          }, 120);
        });
        dash(dEl, a, 0.35, 620);
      }, 260);
    }, 0.12);
  }

  /** 本体への攻撃：相手の顔へ突進して衝撃 */
  function hitFx(aEl, pi) {
    Anim.schedule(720, () => {
      const pt = portrait(1 - pi);
      if (!pt) return;
      const t = UI.stagePoint(pt);
      const onHit = () => {
        impact(t, pi === ME ? '#ffd86a' : '#ff7a5a', true);
        shake($('#board'), 12, 420);
        const av = $(`#pbar-${1 - pi}`);
        if (av) av.animate([{ filter: 'none' }, { filter: 'brightness(2) saturate(2) hue-rotate(-20deg)', offset: 0.15 }, { filter: 'none' }], { duration: 500 });
        flashScreen(1 - pi === ME ? '#ff2a1a' : '#ffb04a');
      };
      if (alive(aEl)) dash(aEl, t, 0.86, 640, onHit); else onHit();
    }, 0.3);
  }
  /** 画面のふちが一瞬赤く光る（自分が殴られた時は赤、相手を殴った時は金） */
  function flashScreen(c) {
    const el = spawn('fx-vignette', { x: 0, y: 0 });
    el.style.setProperty('--vc', c);
    el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], { duration: 600, fill: 'forwards' }).onfinish = () => el.remove();
  }

  /** 体力の増減：大きな数字が出てから、体力の帯が動く */
  function hpFx(pi, delta, hpAfter, self = false) {
    Anim.schedule(delta < 0 ? 520 : 420, () => {
      B.hpShown[pi] = hpAfter;
      B.sig = '';
      const pt = portrait(pi);
      if (!pt) return;
      const p = UI.stagePoint(pt);
      const big = Math.abs(delta) >= 2000;
      const el = spawn('fx-num ' + (delta < 0 ? 'dmg' : 'heal') + (big ? ' big' : ''), { x: p.x + 120, y: p.y + (pi === OP ? 70 : -76) }, (delta < 0 ? '−' : '+') + Math.abs(delta));
      el.animate([{ transform: 'translate(-50%,-50%) scale(2.4)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.18 }, { transform: 'translate(-50%,-60%) scale(1)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%,-140%) scale(.9)', opacity: 0 }], { duration: 1200, easing: 'ease-out', fill: 'forwards' }).onfinish = () => el.remove();
      if (delta < 0) {
        shake($(`#pbar-${pi}`), big ? 10 : 6, 400);
        if (self) sparks(p, '#ff6b5a', 8, 50);
      } else { ring(p, '#7fe89a', 110, 'effect'); sparks(p, '#9fffb0', 10, 60); }
    }, 0.45);
  }

  /** 破壊：白く光ってひびが入り、破片になって飛び散る。魂の光が墓地へ */
  function shatterFx(el, owner) {
    if (!el) return;
    el.dataset.dead = '1';
    Anim.schedule(820, () => {
      if (!alive(el)) return;
      const r = stageRect(el);
      const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      el.animate([{ filter: 'none' }, { filter: 'brightness(3) saturate(0)' }], { duration: 160, fill: 'forwards' });
      const crack = spawn('fx-crack', c);
      crack.style.width = r.w + 'px'; crack.style.height = r.h + 'px';
      setTimeout(() => {
        crack.remove();
        if (!alive(el)) return;
        el.dataset.shattered = '1';
        el.style.visibility = 'hidden';
        // 破片：中心から周りの8点へ三角形に切り分ける
        const cx = 45 + Math.random() * 10, cy = 45 + Math.random() * 10;
        const rim = [[0, 0], [45 + Math.random() * 10, 0], [100, 0], [100, 40 + Math.random() * 20], [100, 100], [45 + Math.random() * 10, 100], [0, 100], [0, 40 + Math.random() * 20]];
        rim.forEach((p0, i) => {
          const p1 = rim[(i + 1) % rim.length];
          const sh = el.cloneNode(true);
          sh.classList.add('shard');
          sh.style.cssText = `position:absolute;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;margin:0;visibility:visible;z-index:62;clip-path:polygon(${cx}% ${cy}%, ${p0[0]}% ${p0[1]}%, ${p1[0]}% ${p1[1]}%)`;
          fxLayer().appendChild(sh);
          const mx = (cx + p0[0] + p1[0]) / 3 - 50, my = (cy + p0[1] + p1[1]) / 3 - 50;
          const len = Math.hypot(mx, my) || 1, dist = 70 + Math.random() * 90;
          const tx = (mx / len) * dist, ty = (my / len) * dist;
          sh.animate([
            { transform: 'translate(0,0) rotate(0deg)', opacity: 1, filter: 'brightness(2)' },
            { transform: `translate(${tx * 0.6}px, ${ty * 0.6 - 20}px) rotate(${(Math.random() * 2 - 1) * 50}deg)`, opacity: 1, filter: 'brightness(1)', offset: 0.45 },
            { transform: `translate(${tx}px, ${ty + 60}px) rotate(${(Math.random() * 2 - 1) * 120}deg) scale(.7)`, opacity: 0, filter: 'brightness(.6) grayscale(1)' },
          ], { duration: 650 + Math.random() * 300, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' }).onfinish = () => sh.remove();
        });
        ring(c, '#ffffff', 150, 'hit');
        sparks(c, '#d8c8b0', 14, 110);
        sparks(c, color(owner), 8, 80);
        // 魂の光が墓地へ
        const soul = document.createElement('div');
        soul.className = 'fx-soul';
        soul.style.setProperty('--sc', color(owner));
        fly(soul, c, gravePoint(owner), 700, { s0: 1, s1: 0.5, arc: 80, o1: 0.6, done: () => { const gp = $(`#piles-${owner} .pile.grave`); if (gp) gp.animate([{ filter: 'brightness(2.2)', transform: 'scale(1.12)' }, { filter: 'none', transform: 'none' }], { duration: 400 }); } });
      }, 200);
    }, 0.4);
  }
  /** パワーの増減：クリーチャーの上に「+500」「−1000」が浮かび、緑／赤に光る */
  function powerFx(el, delta) {
    Anim.schedule(280, () => {
      if (!alive(el) || el.dataset.dead) return;
      const p = UI.stagePoint(el);
      const up = delta > 0;
      const c = up ? '#9fffb0' : '#ff8a7a';
      const tag = spawn('fx-pw ' + (up ? 'up' : 'down'), { x: p.x, y: p.y + 40 }, (up ? '+' : '−') + Math.abs(delta));
      tag.animate([{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 }, { transform: 'translate(-50%,-90%) scale(1.25)', opacity: 1, offset: 0.25 }, { transform: 'translate(-50%,-130%) scale(1)', opacity: 1, offset: 0.7 }, { transform: `translate(-50%,${up ? -190 : -90}%) scale(.9)`, opacity: 0 }],
        { duration: 1000, easing: 'ease-out', fill: 'forwards' }).onfinish = () => tag.remove();
      el.animate([{ filter: 'none' }, { filter: `brightness(1.6) drop-shadow(0 0 12px ${c})`, transform: up ? 'scale(1.07)' : 'scale(.95)', offset: 0.3 }, { filter: 'none', transform: 'none' }], { duration: 520, easing: 'ease-out' });
    }, 0.85);
  }

  /** 破壊されずに耐えた（不屈・守られた） */
  function surviveFx(el, text, c) {
    Anim.schedule(700, () => {
      if (!alive(el)) return;
      const p = UI.stagePoint(el);
      el.animate([{ filter: 'brightness(3) saturate(0)' }, { filter: `brightness(1.4) drop-shadow(0 0 16px ${c})`, offset: 0.4 }, { filter: 'none' }], { duration: 700 });
      ring(p, c, 160, 'summon');
      stamp({ x: p.x, y: p.y - 10 }, text, c);
    }, 0.2);
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
    const sig = g.version + '|' + B.attackFrom + '|' + B.picks.join(',') + '|' + (g.pending ? g.pending.kind : '') + '|' + B.hpShown.join(',');
    if (sig === B.sig) return;
    B.sig = sig;
    renderSide(g.players[ME]);
    renderSide(g.players[OP]);
    renderField(g.players[ME]);
    renderField(g.players[OP]);
    renderHand();
    renderMid();
    B.pendingDirty = true; // 選択のダイアログは、演出が終わってから出す（loop で）
    if (!(g.pending && g.pending.player === ME)) $('#guide').className = 'guide'; // 隠すのはすぐ
    $('#board').classList.toggle('danger', !g.over && B.hpShown[ME] <= 2500); // 体力が少ない時は、画面のふちが赤く脈打つ
  }

  /** 顔と体力・枚数・マナと火種・山札と墓地 */
  function renderSide(p) {
    const g = B.game;
    const pi = p.index;
    const hp = Math.max(0, B.hpShown[pi]);
    const pct = Math.max(0, (hp / g.cfg.startHP) * 100);
    // 顔と体力（相手の顔は、本体への攻撃先）
    const av = $('#pbar-' + pi);
    const targetable = pi === OP && B.attackFrom != null && targetsOf(B.attackFrom).includes('player');
    av.classList.toggle('targetable', !!targetable);
    av.classList.toggle('active', g.active === pi);
    const locks = g.metaOn(p).map((r) => (Parts.META[r.k] ? `<span class="lock" title="${r.statik ? '相手の場の常在効果' : '相手の次のターンの始めまで'}">🔒${esc(Parts.META[r.k].short(r.n))}${r.statik ? '（常在）' : ''}</span>` : '')).join('') + (p.nextDiscount ? `<span class="buffchip">次のカード-${p.nextDiscount}</span>` : '');
    // 要素は最初に1度だけ作り、あとは中身だけ書き換える（体力の帯やマナの輪がなめらかに動くように）
    if (!av.firstChild) {
      av.innerHTML = `
        <div class="portrait">${PORTRAIT[pi]}</div>
        <div class="av-body">
          <div class="av-name"><span class="av-n"></span><span class="av-turn">ターン中</span><span class="av-think"><i></i><i></i><i></i></span></div>
          <div class="hpbar"><em></em><i></i><span></span></div>
          <div class="av-status"></div>
        </div>`;
      av.onclick = () => clickPlayer(pi);
    }
    $('.av-n', av).textContent = p.name;
    const bar = $('.hpbar', av);
    bar.classList.toggle('low', hp <= 2000);
    $('i', bar).style.width = pct + '%';
    $('em', bar).style.width = pct + '%'; // 遅れて縮む白い帯（どれだけ減ったかが見える）
    $('span', bar).textContent = '♥ ' + hp;
    const st = $('.av-status', av);
    if (st.innerHTML !== locks) st.innerHTML = locks;
    st.style.display = locks ? '' : 'none';
    // 枚数
    $('#counts-' + pi).innerHTML = `<span class="ct-label">カード枚数</span><span title="山札（0枚で引くと負け）" class="${p.deck.length <= 5 ? 'warn' : ''}">📚<b>${p.deck.length}</b></span><span title="手札">🂠<b>${p.hand.length}</b></span><span title="墓地">⚰<b>${p.grave.length}</b></span>`;
    // マナと火種
    const capLock = g.metaOn(p).find((r) => r.k === 'manaCap');
    const dial = $('#dial-' + pi);
    if (!dial.firstChild) {
      const angles = pi === ME ? [-60, -30, 0, 30, 60] : [165, 197, 229, 261, 293];
      dial.innerHTML = `
        <div class="dial-ring"></div>
        <div class="dial-core" title="マナ（今使える量 / 最大マナ。最大マナは毎ターン1増え、${g.cfg.maxManaCap}まで）"><b></b><i></i><small></small></div>
        <div class="dial-label">MANA</div>
        <div class="dial-lock" title="このターン使えるマナの上限"></div>
        ${angles.slice(0, g.cfg.emberCap).map((a) => `<i class="sock" style="--a:${a}deg" title="火種（上限${g.cfg.emberCap}）：攻撃されるたびに1つ得る。マナの代わりに使えるほか、${g.cfg.emberBlockCost}つ払って本体への攻撃をブロックできる"></i>`).join('')}`;
    }
    $('.dial-ring', dial).style.setProperty('--p', p.maxMana ? p.mana / p.maxMana : 0);
    const mb = $('.dial-core b', dial), ms = $('.dial-core small', dial);
    if (mb.textContent !== String(p.mana)) { mb.textContent = p.mana; UI.pulse(mb, 'pop', 350); }       // 数字が変わったら弾む
    if (ms.textContent !== String(p.maxMana)) { ms.textContent = p.maxMana; UI.pulse(ms, 'pop', 350); }
    const lk = $('.dial-lock', dial);
    lk.textContent = capLock ? '🔒' + capLock.n : '';
    lk.style.display = capLock ? '' : 'none';
    $$('.sock', dial).forEach((s, k) => {
      const on = k < p.ember;
      if (on && !s.classList.contains('on')) UI.pulse(s, 'ignite', 600); // 火種が灯る
      s.classList.toggle('on', on);
    });
    // 山札と墓地
    const top = p.grave[p.grave.length - 1];
    const piles = $('#piles-' + pi);
    piles.innerHTML = `
      <div class="pile deck" title="山札（0枚で引くと負け）"><div class="stack" style="--h:${Math.min(8, Math.ceil(p.deck.length / 5))}"><i>⚒</i></div><b>${p.deck.length}</b><span>山札</span></div>
      <div class="pile grave" title="墓地（クリックで中を見る）"><div class="stack g" style="--h:${Math.min(8, Math.ceil(p.grave.length / 5))}">${top ? `<i>${esc(top.spec.icon || '❔')}</i>` : ''}</div><b>${p.grave.length}</b><span>墓地</span></div>`;
    $('.pile.grave', piles).onclick = () => openGrave(pi);
    // 相手の手札（裏向き）
    if (pi === OP) {
      const n = Math.min(10, p.hand.length);
      $('#op-hand').innerHTML = Array.from({ length: n }, (_, k) => `<i style="--k:${k - (n - 1) / 2}"></i>`).join('');
    }
  }

  function renderField(p) {
    const g = B.game;
    const box = $('#field-' + p.index);
    if (!box.firstChild) box.innerHTML = '<div class="slots">' + '<div class="slot"></div>'.repeat(g.cfg.fieldLimit) + '</div><div class="units"></div>';
    const units = $('.units', box);
    const live = new Set(p.field.map((u) => u.uid));
    for (const [uid, el] of B.unitEls) {
      if (el.dataset.owner !== String(p.index) || live.has(uid)) continue;
      B.unitEls.delete(uid);
      B.arriving.delete(uid);
      // 今の演出（攻撃や破壊）が終わってから消える。砕けたものはそのまま、手札に戻るなどは薄れて消える
      const wait = Math.max(0, Anim.busy - performance.now());
      setTimeout(() => {
        if (el.dataset.shattered || el.dataset.dead) { el.remove(); return; }
        el.style.visibility = ''; el.classList.add('dying'); setTimeout(() => el.remove(), 500);
      }, wait + (el.dataset.dead ? 400 : 0));
    }
    const pd = g.pending && g.pending.player === ME && g.pending.kind === 'targets' ? g.pending : null;
    const attackTargets = B.attackFrom != null ? targetsOf(B.attackFrom) : [];
    p.field.forEach((u, i) => {
      let el = B.unitEls.get(u.uid);
      if (!el) {
        el = document.createElement('div');
        el.className = 'unit';
        el.dataset.owner = String(p.index);
        el._uid = u.uid;
        el.onclick = () => clickUnit(u.uid);
        if (B.arriving.has(u.uid)) el.style.visibility = 'hidden'; // 召喚の演出で着地するまで隠す
        B.unitEls.set(u.uid, el);
        units.appendChild(el);
      }
      el.style.setProperty('--i', i);
      const pw = g.powerOf(u);
      const kwKeys = Object.keys(Parts.KEYWORDS).filter((k) => g.hasKw(u, k));
      const kws = kwKeys.map((k) => Parts.KEYWORDS[k].label);
      const canAtt = p.index === ME && myTurn() && couldAttack(u.uid);
      const canAct = p.index === ME && myTurn('main') && (u.spec.effects || []).some((e, k) => e.trig === 'activate' && g.canActivate(ME, u.uid, k));
      el.className = 'unit' + (u.tapped ? ' tapped' : '') + (u.sick ? ' sick' : '') + (canAtt ? ' can-attack' : '')
        + (B.attackFrom === u.uid ? ' selected' : '') + (attackTargets.includes(u.uid) ? ' targetable' : '')
        + (pd && pd.options.includes(u.uid) ? ' pickable' : '') + (B.picks.includes(u.uid) ? ' picked' : '')
        + (g.hasKw(u, 'guard') ? ' guard' : '') + (canAct ? ' can-activate' : '') + (u.silenced ? ' silenced' : '') + (u.frozen ? ' frozen' : '');
      el.style.setProperty('--cc', u.spec.color || '#5f8f4e');
      if (el._pw != null && el._pw !== pw && !B.arriving.has(u.uid)) powerFx(el, pw - el._pw); // パワーが変わったら数字を出す
      el._pw = pw;
      el.dataset.power = pw;
      el.dataset.now = `今のパワー ${pw}${u.tapped ? '・タップ中（相手の攻撃対象になる）' : '・アンタップ（攻撃されない）'}${u.sick ? '・召喚したターン' : ''}${u.silenced ? '・能力を消されている' : ''}${u.frozen ? '・凍結（次のターンにアンタップしない）' : ''}${u.protectedBy != null ? '・破壊されない' : ''}${u.returnTo != null ? '・このターンだけ奪われている' : ''}${kws.length ? '　キーワード：' + kws.join('・') : ''}`;
      el.innerHTML = `
        <div class="u-inner">
          <div class="u-art">${esc(u.icon || '❔')}</div>
          <div class="u-name">${esc(u.name)}</div>
          <div class="u-cost">${u.spec.cost}</div>
          <div class="u-kws">${kwKeys.map((k) => `<i title="${esc(Parts.KEYWORDS[k].label)}">${KW_ICON[k] || '◆'}</i>`).join('')}${(u.spec.effects || []).length ? '<i class="fxmark" title="テキスト効果あり">✦</i>' : ''}</div>
          <div class="u-power${pw > u.power ? ' up' : pw < u.power ? ' down' : ''}">${pw}</div>
          ${u.tapped ? '<div class="u-tap">TAP</div>' : ''}
          ${u.sick && !u.tapped ? '<div class="u-sick" title="召喚したターンは攻撃できない">💤</div>' : ''}
          ${u.frozen ? '<div class="u-frozen" title="凍結">❄</div>' : ''}${u.silenced ? '<div class="u-silenced" title="能力を消されている">🚫</div>' : ''}
        </div>`;
      UI.bindSpec(el, u.spec); // マウスを乗せると情報パネルに説明
    });
  }

  function renderHand() {
    const g = B.game;
    const me = g.players[ME];
    const box = $('#hand');
    if (B.drag && B.drag.kind === 'hand') return; // ドラッグ中は並べ直さない
    box.innerHTML = '';
    const n = me.hand.length;
    // 新しく手札に来たカード（ドロー・手札に戻る）に演出を付ける
    const fresh = me.hand.filter((c) => !B.handSeen.has(c.iid)).map((c) => c.iid);
    if (fresh.length) { fresh.forEach((iid) => B.handSeen.add(iid)); drawFxMe(fresh); }
    const now = performance.now();
    // 手札の幅に収まるように重ねる（カードの幅 125px）
    const W = box.clientWidth || 600, CW = 125;
    const step = n > 1 ? Math.min(CW + 6, (W - CW) / (n - 1)) : 0;
    me.hand.forEach((c, i) => {
      const chk = g.canPlay(ME, c.iid);
      // 使えない理由は短いもの（マナ不足など）だけカードの上に出す。長い理由は、クリックした時にお知らせで出る
      const why = !chk.ok && g.active === ME && !g.pending && chk.reason && [...chk.reason].length <= 7 ? chk.reason : '';
      const el = UI.cardEl(c.spec, { badge: why, cost: g.costOf(me, c.spec) });
      const off = i - (n - 1) / 2;
      el.style.setProperty('--r', (off * 2.2).toFixed(1) + 'deg');
      el.style.setProperty('--y', (Math.abs(off) ** 1.6 * 2.2).toFixed(1) + 'px');
      if (i > 0) el.style.marginLeft = (step - CW).toFixed(1) + 'px';
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
      el.onclick = () => { if (!clickBlocked()) clickHand(c.iid); };
      box.appendChild(el);
    });
  }

  function renderMid() {
    const g = B.game;
    const mine = g.active === ME;
    const hint = !mine ? 'CPUが考えています…' : B.attackFrom != null ? '攻撃先を選ぶ（右クリック／Escでやめる）' : g.step === 'main' ? 'カードを使う・クリーチャーをドラッグして攻撃' : '攻撃するクリーチャーをドラッグ';
    $('#turn-info').innerHTML = `<span class="ti-who ${mine ? 'me' : 'op'}">${mine ? 'あなた' : 'CPU'}のターン</span><span class="ti-steps"><i class="${g.step === 'main' ? 'on' : ''}">メイン</i><i class="${g.step === 'attack' ? 'on' : ''}">アタック</i></span><span class="ti-hint">${esc(hint)}</span>`;
    const end = $('#btn-end');
    end.disabled = !myTurn();
    end.classList.toggle('ready', myTurn() && !g.players[ME].hand.some((c) => g.canPlay(ME, c.iid).ok) && !g.players[ME].field.some((u) => couldAttack(u.uid)));
    end.innerHTML = myTurn() ? '<b>ターン</b><b>終了</b>' : '<small>相手の</small><b>ターン</b>';
  }

  /** 情報パネル：マウスを乗せたカードの説明（場のカードの右寄りなら左に出す） */
  function showDetail(spec, target) {
    const el = $('#detail');
    if (!spec) { el.classList.remove('show'); return; }
    const p = UI.stagePoint(target);
    el.classList.toggle('left', p.x > 700);
    const lines = UI.cardHelp(spec);
    const pw = target.dataset.power != null ? Number(target.dataset.power) : spec.power;
    el.innerHTML = `<div class="dt-head"><span class="dt-cost">${spec.cost}</span><span class="dt-icon">${esc(spec.icon || '❔')}</span><b>${esc(spec.name)}</b>${spec.kind === 'creature' ? `<span class="dt-pow">${pw}</span>` : `<span class="dt-kind">${UI.KIND_LABEL[spec.kind]}</span>`}</div>
      <div class="dt-body">${lines.slice(2).map((l) => `<div>${l}</div>`).join('')}${target.dataset.now ? `<div class="now">${esc(target.dataset.now)}</div>` : ''}</div>`;
    el.classList.add('show');
  }

  function showResult() {
    const g = B.game;
    stop();
    UI.setDetail(null);
    const win = g.winner === ME;
    const [me, op] = g.players;
    $('#board').classList.remove('danger');
    // 決着の演出：負けた側の顔が砕け、大きな文字が叩きつけられる。勝った時は火花が上がる
    const pt = portrait(win ? OP : ME);
    if (pt) { impact(UI.stagePoint(pt), win ? '#ffd86a' : '#ff5a3a', true); pt.classList.add('ko'); }
    shake($('#board'), 14, 600);
    const fin = document.createElement('div');
    fin.className = 'finish ' + (win ? 'win' : 'lose');
    fin.innerHTML = `<div class="fin-rays"></div><b>${win ? 'VICTORY' : 'DEFEAT'}</b><span>${win ? '勝利！' : '敗北…'}</span>`;
    $('#fx').appendChild(fin);
    if (win && root.Ambient) for (let i = 0; i < 6; i++) setTimeout(() => root.Ambient.burst(200 + Math.random() * 880, 160 + Math.random() * 300, i % 2 ? '#ffd88a' : '#ff9a4a', 30, 1.3), 350 + i * 230);
    setTimeout(() => {
      fin.remove();
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
        ], 'result-modal');
    }, 2100);
  }

  function init() {
    document.addEventListener('keydown', onKey);
    const scr = $('#screen-battle');
    scr.addEventListener('contextmenu', (e) => { if (B.attackFrom != null) { e.preventDefault(); B.attackFrom = null; B.sig = ''; } });
    scr.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    $('#btn-end').onclick = () => {
      if (!myTurn()) return;
      const g = B.game;
      const left = g.players[ME].field.filter((u) => couldAttack(u.uid)).length;
      B.attackFrom = null;
      if (left) {
        UI.modal('ターン終了', `<p>まだ攻撃できるクリーチャーが${left}体います。攻撃せずにターンを終えますか？</p>`, [
          { label: 'やめる', onClick: UI.closeModal },
          { label: 'ターン終了', primary: true, onClick: () => { UI.closeModal(); g.endTurn(ME); } },
        ]);
      } else g.endTurn(ME);
    };
    $('#btn-menu').onclick = openMenu;
  }

  root.Battle = { init, start };
})(this);
