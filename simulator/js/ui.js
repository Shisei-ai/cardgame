/*
 * ui.js — 画面共通の部品
 *   画面の切り替え・カードの描画・拡大表示・お知らせ（トースト）・ダイアログ
 */
(function (root) {
  'use strict';
  const { SimData, TextParser } = root;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ───────────── 画面の切り替え ─────────────
  const hooks = {};
  function onScreen(name, fn) { (hooks[name] = hooks[name] || []).push(fn); }
  function showScreen(name) {
    $$('.screen').forEach((el) => el.classList.toggle('active', el.id === 'screen-' + name));
    document.body.dataset.screen = name;
    window.scrollTo(0, 0);
    (hooks[name] || []).forEach((fn) => fn());
  }

  // ───────────── 文明の色 ─────────────
  const civColor = (k) => (SimData.CIV_BY_KEY[k] || SimData.CIV_BY_KEY.zero).color;
  const civName = (k) => (SimData.CIV_BY_KEY[k] || { name: '?' }).name;
  /** 文明の色でカードの背景を作る（多色なら色を並べる） */
  function civBackground(civs) {
    const cs = (civs && civs.length ? civs : ['zero']).map(civColor);
    if (cs.length === 1) return cs[0];
    const step = 100 / cs.length;
    return `linear-gradient(135deg, ${cs.map((c, i) => `${c} ${i * step}%, ${c} ${(i + 1) * step}%`).join(', ')})`;
  }
  function civDots(civs) {
    return (civs || []).map((k) => `<i class="civdot" style="background:${civColor(k)}" title="${esc(civName(k))}"></i>`).join('');
  }

  // ───────────── カードの描画 ─────────────
  /** キーワード能力を短い文字にする（画像がないカードの表面に出す） */
  function shortKeywords(def) {
    const ab = TextParser.parse(def.text || '', def.type);
    const k = ab.keywords;
    const out = [];
    if (k.shieldTrigger) out.push('S・トリガー');
    if (k.blocker) out.push('ブロッカー');
    if (k.speedAttacker) out.push('SA');
    if (k.breaker) out.push({ 2: 'W・ブレイカー', 3: 'T・ブレイカー', 4: 'Q・ブレイカー', 99: 'ワールド' }[k.breaker]);
    if (k.slayer) out.push('スレイヤー');
    if (k.gStrike) out.push('G・ストライク');
    if (ab.triggers.length) out.push('能力あり');
    if (ab.spell.length && !k.shieldTrigger) out.push('呪文');
    return out;
  }

  /**
   * カード1枚のHTML。
   * @param def   カード定義
   * @param opts  { uid, power（今のパワー）, tapped, cls（追加のクラス）, back（裏向き）, small }
   */
  function cardHTML(def, opts = {}) {
    const attrs = `${opts.uid != null ? ` data-uid="${opts.uid}"` : ''}${def && def.id ? ` data-id="${esc(def.id)}"` : ''}`;
    const cls = ['card', opts.cls || '', opts.tapped ? 'tapped' : '', opts.small ? 'small' : ''].join(' ');
    if (opts.back || !def) return `<div class="${cls} back"${attrs}><div class="back-face"></div></div>`;
    const pw = opts.power != null ? opts.power : def.power;
    const pwCls = opts.power != null && def.power != null && opts.power !== def.power ? (opts.power > def.power ? ' up' : ' down') : '';
    const badges = `${opts.under ? `<span class="under-badge" title="下に重なっているカード">+${opts.under}</span>` : ''}`;
    if (def.image) {
      return `<div class="${cls} has-img"${attrs}><img src="${def.image}" alt="${esc(def.name)}" draggable="false">
        ${def.type !== 'spell' && pwCls ? `<span class="pw-badge${pwCls}">${pw}</span>` : ''}${badges}</div>`;
    }
    return `<div class="${cls}"${attrs} style="--civ:${civBackground(def.civs)}">
      <div class="cf">
        <div class="cf-top"><span class="cost">${def.cost != null ? def.cost : '?'}</span><span class="nm">${esc(def.name)}</span></div>
        <div class="cf-type">${esc(SimData.TYPE_BY_KEY[def.type] ? SimData.TYPE_BY_KEY[def.type].name : '')}${def.races && def.races.length ? ' / ' + esc(def.races.join('・')) : ''}</div>
        <div class="cf-kw">${shortKeywords(def).map((k) => `<span>${esc(k)}</span>`).join('')}</div>
        ${def.type !== 'spell' ? `<div class="pw${pwCls}">${pw != null ? pw : ''}</div>` : '<div class="pw spell">呪文</div>'}
      </div>${badges}</div>`;
  }

  /** カードの詳しい情報（拡大表示・確認用） */
  function detailHTML(def, extra = {}) {
    if (!def) return '';
    const ab = TextParser.parse(def.text || '', def.type);
    const lines = TextParser.describe(ab);
    return `<div class="detail-card">${cardHTML(def, { power: extra.power })}</div>
      <div class="detail-info">
        <h3>${esc(def.name)}</h3>
        <p class="meta">${civDots(def.civs)} ${esc((def.civs || []).map(civName).join('/'))}　コスト${def.cost}　${esc((SimData.TYPE_BY_KEY[def.type] || {}).name || '')}
          ${def.type !== 'spell' ? `　パワー${extra.power != null && extra.power !== def.power ? `<b class="${extra.power > def.power ? 'up' : 'down'}">${extra.power}</b>（元${def.power}）` : def.power}` : ''}</p>
        ${def.races && def.races.length ? `<p class="meta">種族：${esc(def.races.join(' / '))}</p>` : ''}
        ${lines.length ? `<ul class="ab-list">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="hint">能力なし</p>'}
        ${ab.unparsed.length ? `<ul class="ab-list ng">${ab.unparsed.map((l) => `<li title="この行は対戦で動きません">⚠ ${esc(l)}</li>`).join('')}</ul>` : ''}
        ${extra.note ? `<p class="hint">${esc(extra.note)}</p>` : ''}
      </div>`;
  }

  // ───────────── お知らせ・ダイアログ ─────────────
  function toast(msg, kind = '') {
    const box = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3100);
  }

  /**
   * ダイアログを開く。buttons の value が resolve される（背景クリック・Esc は null）。
   * @param {object} o { title, html, buttons: [{label, value, cls}], wide, onOpen(el, close) }
   */
  function modal(o) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = `<div class="modal ${o.wide ? 'wide' : ''}" role="dialog" aria-modal="true">
        ${o.title ? `<h3 class="modal-title">${esc(o.title)}</h3>` : ''}
        <div class="modal-body">${o.html || ''}</div>
        <div class="modal-btns">${(o.buttons || [{ label: '閉じる', value: null }]).map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>
      </div>`;
      const close = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape' && o.dismissable !== false) close(null); };
      wrap.addEventListener('click', (e) => {
        if (e.target === wrap && o.dismissable !== false) close(null);
        const b = e.target.closest('.modal-btns button');
        if (b) close((o.buttons || [{ value: null }])[+b.dataset.i].value);
      });
      document.addEventListener('keydown', onKey);
      $('#modals').appendChild(wrap);
      if (o.onOpen) o.onOpen(wrap.querySelector('.modal'), close);
      const first = wrap.querySelector('.modal-btns .primary') || wrap.querySelector('.modal-btns button');
      if (first) first.focus();
    });
  }
  const confirmBox = (title, text, okLabel = 'はい', cls = 'primary') =>
    modal({ title, html: `<p>${esc(text)}</p>`, buttons: [{ label: 'キャンセル', value: false }, { label: okLabel, value: true, cls }] });

  /** ファイルを選ぶ（画像・JSON など） */
  function pickFiles(accept, multiple = false) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept; inp.multiple = multiple;
      inp.onchange = () => resolve([...inp.files]);
      inp.click();
    });
  }
  function download(filename, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  root.UI = { $, $$, esc, onScreen, showScreen, civColor, civName, civBackground, civDots, cardHTML, detailHTML, toast, modal, confirmBox, pickFiles, download };
})(typeof self !== 'undefined' ? self : this);
