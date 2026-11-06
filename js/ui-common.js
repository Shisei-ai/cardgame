/*
 * ui-common.js — 画面共通の部品
 *   画面の拡大縮小（1280×720の舞台）・画面の切り替え・カードの描画・拡大表示・お知らせ・確認ダイアログ・演出
 */
(function (root) {
  'use strict';
  const { Parts, Cards, Store } = root;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ───────────── 舞台（1280×720）をウィンドウに合わせて拡大縮小 ─────────────
  let scale = 1;
  function fitStage() {
    const st = $('#stage');
    scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    st.style.transform = `translate(-50%, -50%) scale(${scale})`;
  }
  /** 要素の中心（舞台の座標） */
  function stagePoint(el, fy = 0.5) {
    const r = el.getBoundingClientRect();
    const s = $('#stage').getBoundingClientRect();
    return { x: (r.left + r.width / 2 - s.left) / scale, y: (r.top + r.height * fy - s.top) / scale };
  }

  // ───────────── 画面の切り替え ─────────────
  const screenHooks = {};
  function onScreen(name, fn) { (screenHooks[name] = screenHooks[name] || []).push(fn); }
  function showScreen(name) {
    $$('.screen').forEach((el) => el.classList.toggle('active', el.id === 'screen-' + name));
    hidePreview();
    (screenHooks[name] || []).forEach((fn) => fn());
  }

  // ───────────── カード ─────────────
  /** IDからカードを探す（基本カード → オリジナルカード） */
  function cardById(id) {
    return Cards.get(id) || Store.cards().find((c) => c.id === id) || null;
  }

  const KIND_LABEL = { creature: 'クリーチャー', spell: '呪文' };
  const KIND_COLOR = { creature: '#5f8f4e', spell: '#5b6fb5' };
  const specOf = new WeakMap(); // 要素 → カード（拡大表示用）

  /**
   * カード1枚の要素を作る
   *   opts.key   : 下に出す数字（手札のキー操作用）
   *   opts.badge : 中央に出す短い注意書き
   *   opts.count : 右上に出す枚数（デッキ構築用）
   *   opts.power : 今のパワー（場の補正込み）
   */
  function cardEl(spec, opts = {}) {
    const el = document.createElement('div');
    const g = Parts.GRADES[spec.grade] || Parts.GRADES.silver;
    el.className = `card kind-${spec.kind} grade-${spec.grade}${spec.base ? ' is-base' : ' is-forged'}`;
    el.style.setProperty('--cc', spec.color || KIND_COLOR[spec.kind]);
    el.style.setProperty('--gc', g.color);
    const lines = Parts.cardLines(spec);
    const len = lines.join('').length;
    const textCls = len > 170 ? ' micro' : len > 120 ? ' tiny' : len > 70 ? ' small' : '';
    const react = spec.kind === 'spell' && (spec.effects || []).some((e) => e.trig === 'react');
    el.innerHTML = `
      <div class="c-frame">
        <div class="c-head"><span class="c-name${[...spec.name].length > 7 ? ' long' : ''}">${esc(spec.name)}</span></div>
        <div class="c-art"><span class="c-icon">${esc(spec.icon || '❔')}</span>${spec.base ? '' : `<span class="c-grade" title="素質：${g.label}（容量×${g.mult}）">${g.label}</span>`}</div>
        <div class="c-type"><span>${KIND_LABEL[spec.kind]}</span>${react ? '<span class="c-react">迎撃</span>' : ''}</div>
        <div class="c-text${textCls}">${lines.map((l) => `<p${l.startsWith('【') ? ' class="kw"' : ''}>${esc(l)}</p>`).join('') || '<p class="vanilla">（効果なし）</p>'}</div>
      </div>
      <div class="c-cost${opts.cost != null && opts.cost !== spec.cost ? (opts.cost < spec.cost ? ' down' : ' up') : ''}">${opts.cost != null ? opts.cost : spec.cost}</div>
      ${spec.kind === 'creature' ? `<div class="c-power${opts.power != null && opts.power !== spec.power ? (opts.power > spec.power ? ' up' : ' down') : ''}">${opts.power != null ? opts.power : spec.power}</div>` : ''}
      ${opts.key != null ? `<div class="c-key">${opts.key}</div>` : ''}
      ${opts.badge ? `<div class="c-badge">${esc(opts.badge)}</div>` : ''}
      ${opts.count ? `<div class="c-count">×${opts.count}</div>` : ''}`;
    specOf.set(el, spec);
    el.dataset.pv = '1';
    return el;
  }

  /** 任意の要素に、マウスを乗せた時に拡大表示するカードを結び付ける */
  function bindSpec(el, spec) { specOf.set(el, spec); el.dataset.pv = '1'; }

  /** カードの詳しい説明（キーワードの意味など）の行 */
  function cardHelp(spec) {
    const g = Parts.GRADES[spec.grade] || Parts.GRADES.silver;
    const u = Parts.usage(spec);
    const lines = [
      `<b>${esc(spec.name)}</b>（${KIND_LABEL[spec.kind]}）`,
      `コスト ${spec.cost}${spec.kind === 'creature' ? `　／　パワー ${spec.power}` : ''}`,
      spec.base ? '基本カード' : `素質：<b style="color:${g.color}">${g.label}</b>（容量 ×${g.mult}）`,
      `容量 ${u.total} / ${Parts.capacity(spec.cost, spec.grade)}`,
    ];
    for (const k of spec.keywords || []) lines.push(`<b>${Parts.KEYWORDS[k].label}</b>：${esc(Parts.KEYWORDS[k].desc)}`);
    const text = Parts.cardLines(spec).filter((l) => !/^【[^】]*】$/.test(l)); // キーワードだけの行は上に説明があるので除く
    if (text.length) lines.push(`<div class="pv-text">${text.map((l) => `<p>${esc(l)}</p>`).join('')}</div>`);
    return lines;
  }

  // ───────────── 拡大表示（マウスを乗せる） ─────────────
  let pvEl = null, pvFor = null, detailFn = null;
  /** 対戦画面など、拡大表示の代わりに独自の情報パネルを出したい画面が登録する（fn(spec, target) / fn(null) で隠す） */
  function setDetail(fn) { detailFn = fn; }
  function showPreview(target) {
    const spec = specOf.get(target);
    if (!spec) return;
    if (pvFor === target) return;
    pvFor = target;
    if (detailFn && target.closest('#screen-battle')) { if (pvEl) pvEl.classList.remove('show'); detailFn(spec, target); return; }
    if (!pvEl) { pvEl = document.createElement('div'); pvEl.className = 'preview'; $('#stage').appendChild(pvEl); }
    pvEl.innerHTML = '';
    const big = cardEl(spec, { power: target.dataset.power != null ? Number(target.dataset.power) : undefined });
    big.removeAttribute('data-pv');
    pvEl.appendChild(big);
    const help = document.createElement('div');
    help.className = 'pv-help';
    help.innerHTML = cardHelp(spec).map((l) => `<div>${l}</div>`).join('') + (target.dataset.now ? `<div class="now">${esc(target.dataset.now)}</div>` : '');
    pvEl.appendChild(help);
    const p = stagePoint(target);
    const right = p.x < 640;
    pvEl.style.left = (right ? Math.min(p.x + 90, 1280 - 520) : Math.max(10, p.x - 90 - 510)) + 'px';
    pvEl.style.top = Math.max(10, Math.min(720 - 400, p.y - 190)) + 'px';
    pvEl.classList.add('show');
  }
  function hidePreview() { pvFor = null; if (pvEl) pvEl.classList.remove('show'); if (detailFn) detailFn(null); }

  // ───────────── お知らせ・ダイアログ ─────────────
  let toastT = 0;
  function toast(msg, ms = 1600) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), ms);
  }

  /** ダイアログ。buttons: [{ label, primary, onClick }]。閉じる時は closeModal() */
  function modal(title, bodyHtml, buttons = [], cls = '') {
    const m = $('#modal');
    m.className = 'modal show ' + cls;
    m.innerHTML = `<div class="panel ornate"><h3>${title}</h3><div class="m-body">${bodyHtml}</div><div class="m-buttons"></div></div>`;
    const box = $('.m-buttons', m);
    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      btn.textContent = b.label;
      btn.onclick = b.onClick;
      box.appendChild(btn);
    }
    return m;
  }
  function closeModal() { $('#modal').className = 'modal'; $('#modal').innerHTML = ''; }

  // ───────────── 演出 ─────────────
  const fx = {
    float(x, y, text, cls = '') {
      const el = document.createElement('div');
      el.className = 'fx-float ' + cls;
      el.textContent = text;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      $('#fx').appendChild(el);
      setTimeout(() => el.remove(), 1300);
    },
    slash(x, y) {
      const el = document.createElement('div');
      el.className = 'fx-slash';
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      $('#fx').appendChild(el);
      setTimeout(() => el.remove(), 500);
    },
    line(a, b, color) {
      const el = document.createElement('div');
      el.className = 'fx-line';
      const dx = b.x - a.x, dy = b.y - a.y;
      el.style.left = a.x + 'px';
      el.style.top = a.y + 'px';
      el.style.width = Math.hypot(dx, dy) + 'px';
      el.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      el.style.setProperty('--lc', color);
      $('#fx').appendChild(el);
      setTimeout(() => el.remove(), 450);
    },
  };
  function pulse(el, cls, ms = 400) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  function init() {
    fitStage();
    window.addEventListener('resize', fitStage);
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest('[data-pv]');
      if (t) showPreview(t); else hidePreview();
    });
    document.addEventListener('mousedown', hidePreview);
  }

  root.UI = { $, $$, esc, init, bindSpec, fitStage, stagePoint, onScreen, showScreen, cardById, cardEl, cardHelp, hidePreview, setDetail, toast, modal, closeModal, fx, pulse, KIND_LABEL };
})(this);
