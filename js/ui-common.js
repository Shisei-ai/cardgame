/*
 * ui-common.js — 画面切り替えやカード表示など、複数の画面で使う部品
 *
 *  ・舞台の拡大縮小：1280×720 の #stage をウィンドウに収まる大きさに拡大縮小する
 *  ・カードの描画：cardEl()
 *  ・カードの拡大表示：data-cid（カードID）を持つ要素にマウスを乗せると、大きなカードと説明を出す
 *  ・演出：fx.float（浮かぶ数字）、fx.bolt（攻撃の光）、fx.stamp（大きな文字）など
 */
(function (root) {
  'use strict';
  const { Cards, Presets, Storage2 } = root;

  const $ = (sel) => document.querySelector(sel);
  const STAGE_W = 1280, STAGE_H = 720;

  // HTMLに埋め込む文字列のエスケープ（デッキ名などユーザー入力を安全に表示するため）
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // ───────────── 舞台の拡大縮小 ─────────────
  let scale = 1;
  function fitStage() {
    scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    $('#stage').style.setProperty('--scale', scale);
  }
  window.addEventListener('resize', fitStage);

  /** 画面上の要素の中心を、舞台の座標（1280×720 基準）で返す */
  function stagePoint(el, fy = 0.5) {
    const s = $('#stage').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.width / 2 - s.left) / scale, y: (r.top + r.height * fy - s.top) / scale };
  }

  const screenHooks = {};
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    $('#screen-' + name).classList.add('active');
    hidePreview();
    if (screenHooks[name]) screenHooks[name]();
  }
  function onScreen(name, fn) { screenHooks[name] = fn; }

  // ───────────── カードの描画 ─────────────
  // 種類の帯に付ける記号
  const TYPE_GLYPH = { creature: '⚔', relic: '◈', summon: '✧', attack: '✹', draw: '❖', resource: '◆', disrupt: '✖', heal: '✚' };
  /**
   * カード1枚分のDOM要素を作る
   *   opts.cost / opts.cast : 補正後の実際のコスト・詠唱時間（手札表示用）。元の値と違えば色を変える
   *   opts.key   : 下に出す操作キー
   *   opts.badge : 中央に出す帯（使えない理由など）
   *   opts.owned : デッキに入っている枚数
   */
  function cardEl(card, opts = {}) {
    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.cid = card.id;
    el.style.setProperty('--tc', Cards.TYPES[card.type].color);
    const cost = opts.cost != null ? opts.cost : card.cost;
    const cast = opts.cast != null ? opts.cast : card.cast;
    const castLabel = cast > 0 ? `⏱${cast}` : card.cast > 0 ? '⚡即時' : '⚡瞬間';
    const castCls = cast <= 0 ? ' instant' : cast < card.cast ? ' down' : '';
    const costCls = cost < card.cost ? ' down' : cost > card.cost ? ' up' : '';
    const kw = Cards.keywords(card);
    const nameLen = [...card.name].length;
    const nameCls = nameLen >= 8 ? ' xxlong' : nameLen >= 7 ? ' xlong' : nameLen >= 6 ? ' long' : '';
    const stats = card.type === 'creature'
      ? `<div class="c-stat atk"><b>${card.atk}</b></div><div class="c-stat hp"><b>${card.hp}</b></div>`
      : card.type === 'relic' ? `<div class="c-stat dur" title="耐久"><b>${card.hp}</b></div>` : '';
    const side = [
      card.hpCost ? `<span class="c-hpcost">♥${card.hpCost}</span>` : '',
      card.sacCost ? `<span class="c-saccost">🔪${card.sacCost}</span>` : '',
    ].join('');
    el.innerHTML = `
      <div class="c-frame">
        <div class="c-head"><span class="c-name${nameCls}">${esc(card.name)}</span></div>
        <div class="c-art"><span class="c-icon">${card.icon}</span></div>
        <div class="c-typeline"><span><i class="c-glyph">${TYPE_GLYPH[card.type] || ''}</i>${Cards.TYPES[card.type].label}</span>${kw.length ? `<span class="c-kw">${kw.join('・')}</span>` : ''}</div>
        <div class="c-text">${esc(card.text || '')}</div>
      </div>
      <div class="c-cost${costCls}">${cost}</div>
      <div class="c-cast${castCls}">${castLabel}</div>
      ${side ? `<div class="c-side">${side}</div>` : ''}
      ${card.target ? '<div class="c-target">🎯</div>' : ''}
      ${card.counter ? '<div class="c-counter" title="カウンターステップでも使える"><span>COUNTER</span></div>' : ''}
      ${stats}
      ${opts.key != null ? `<div class="c-key">${opts.key}</div>` : ''}
      ${opts.badge ? `<div class="c-badge">${esc(opts.badge)}</div>` : ''}
      ${opts.owned ? `<div class="c-owned">×${opts.owned}</div>` : ''}
    `;
    return el;
  }

  /** カードの詳しい説明（キーワードの意味やテーマ）を行の配列で返す */
  function cardHelp(card) {
    const castLabel = card.cast > 0 ? `詠唱 ${card.cast}秒` : '瞬間（詠唱なし）';
    const extra = (card.hpCost ? ` ＋ 体力${card.hpCost}` : '') + (card.sacCost ? ` ＋ 生贄${card.sacCost}体` : '');
    const lines = [`<b>${esc(card.name)}</b>（${Cards.TYPES[card.type].label}）`, `コスト ${card.cost}${extra}　/　${castLabel}`];
    if (card.counter) lines.push(`<b>カウンター</b>：${Cards.KEYWORD_HELP['カウンター']}`);
    if (card.type === 'creature') lines.push(card.noAttack ? '召喚時に攻撃しない' : card.double ? '召喚時に2回攻撃を予約する' : '召喚時に1回攻撃を予約する（クロノホールで攻撃）');
    if (card.type === 'relic') lines.push(`耐久 ${card.hp}`, `<b>レリック</b>：${Cards.KEYWORD_HELP['レリック']}`);
    const kws = Cards.keywords(card).map((k) => k.replace(/\d+$/, ''));
    if (card.target) kws.push('対象');
    if (card.hpCost) kws.push('代償');
    if (card.sacCost) kws.push('生贄');
    kws.forEach((k) => { if (Cards.KEYWORD_HELP[k]) lines.push(`<b>${k}</b>：${Cards.KEYWORD_HELP[k]}`); });
    return lines;
  }

  /** 文字だけの説明（title 属性など、HTMLを使えない場所用） */
  function cardTip(card) {
    return cardHelp(card).map((l) => l.replace(/<[^>]+>/g, '')).join('\n');
  }

  // ───────────── カードの拡大表示 ─────────────
  // 表示中の対象に「今の状態」（場のクリーチャーの現在値など）を足したい場合は、
  // 要素に data-now を付ける
  let pvTarget = null;
  function showPreview(el) {
    const card = Cards.find(el.dataset.cid);
    if (!card) return;
    pvTarget = el;
    const pv = $('#card-preview');
    pv.innerHTML = '';
    const big = cardEl(card);
    big.querySelector('.c-text').textContent = Cards.fullText(card, false);
    pv.appendChild(big);
    const help = document.createElement('div');
    help.className = 'pv-help';
    const rows = cardHelp(card).map((l) => `<div class="pv-row">${l}</div>`);
    if (el.dataset.now) rows.splice(1, 0, `<div class="pv-row pv-now">${esc(el.dataset.now)}</div>`);
    if (card.arch) rows.push(`<div class="pv-arch">テーマ：${card.arch.map((a) => Cards.ARCHES[a].label).join('・')}</div>`);
    help.innerHTML = rows.join('');
    pv.appendChild(help);
    pv.classList.remove('hidden');
    // 要素の左右、空いている側に出す
    const p = stagePoint(el);
    const w = 217 + 10 + 230, h = 304;
    const r = el.getBoundingClientRect();
    const halfW = r.width / scale / 2;
    let x = p.x + halfW + 14;
    if (x + w > STAGE_W - 8) x = p.x - halfW - 14 - w;
    let y = Math.max(8, Math.min(STAGE_H - h - 8, p.y - h / 2));
    pv.style.left = Math.max(8, x) + 'px';
    pv.style.top = y + 'px';
  }
  function hidePreview() {
    pvTarget = null;
    const pv = $('#card-preview');
    if (pv) pv.classList.add('hidden');
  }
  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest && e.target.closest('[data-cid]');
    if (!el || el.closest('#card-preview')) { if (!el) hidePreview(); return; }
    if (el !== pvTarget) showPreview(el);
  });
  document.addEventListener('mousedown', hidePreview);

  // ───────────── 魔法陣（詠唱の台座や盤面の飾り） ─────────────
  /** 時計の目盛りと六芒星を組み合わせた魔法陣の SVG（色は currentColor） */
  function runeCircle(cls = '') {
    return `<svg class="rune-circle ${cls}" viewBox="0 0 200 200" aria-hidden="true">
      <g fill="none" stroke="currentColor">
        <circle cx="100" cy="100" r="96" stroke-width="1.4"/>
        <circle cx="100" cy="100" r="90" stroke-width=".7"/>
        <circle cx="100" cy="100" r="82" stroke-width="5" stroke-dasharray="1.4 20.07" opacity=".8"/>
        <circle cx="100" cy="100" r="70" stroke-width="1"/>
        <polygon points="100,30 160.6,135 39.4,135" stroke-width="1"/>
        <polygon points="100,170 39.4,65 160.6,65" stroke-width="1"/>
        <circle cx="100" cy="100" r="38" stroke-width=".8" stroke-dasharray="3 3"/>
      </g>
      <g fill="currentColor">
        <circle cx="100" cy="30" r="3"/><circle cx="160.6" cy="135" r="3"/><circle cx="39.4" cy="135" r="3"/>
        <circle cx="100" cy="170" r="3"/><circle cx="39.4" cy="65" r="3"/><circle cx="160.6" cy="65" r="3"/>
      </g>
    </svg>`;
  }

  // ───────────── 演出 ─────────────
  const fx = {
    layer: () => $('#fx'),
    /** 浮かび上がる文字（ダメージ数値など） */
    float(x, y, text, cls = 'dmg') {
      const el = document.createElement('div');
      el.className = 'float ' + cls;
      el.textContent = text;
      el.style.left = x + (Math.random() * 16 - 8) + 'px';
      el.style.top = y + 'px';
      fx.layer().appendChild(el);
      setTimeout(() => el.remove(), 1000);
    },
    /** 光の弾を from から to へ飛ばし、着弾したら弾ける */
    bolt(from, to, color = '#ffd36b', ms = 260) {
      const b = document.createElement('div');
      b.className = 'bolt';
      b.style.setProperty('--bc', color);
      fx.layer().appendChild(b);
      const anim = b.animate([
        { left: from.x + 'px', top: from.y + 'px', transform: 'scale(.6)' },
        { left: to.x + 'px', top: to.y + 'px', transform: 'scale(1.2)' },
      ], { duration: ms, easing: 'cubic-bezier(.5,0,.9,.5)' });
      anim.onfinish = () => { b.remove(); fx.burst(to, color); };
    },
    burst(p, color = '#ffd36b') {
      const el = document.createElement('div');
      el.className = 'burst';
      el.style.setProperty('--bc', color);
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      fx.layer().appendChild(el);
      setTimeout(() => el.remove(), 420);
    },
    /** 大きなはんこ風の文字（打ち消しなど） */
    stamp(p, text, color) {
      const el = document.createElement('div');
      el.className = 'stamp';
      el.textContent = text;
      if (color) el.style.color = color;
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      fx.layer().appendChild(el);
      setTimeout(() => el.remove(), 950);
    },
    /** カードが from から to へ飛んでいく */
    flyCard(card, from, to) {
      const wrap = document.createElement('div');
      wrap.className = 'flycard';
      wrap.appendChild(cardEl(card));
      fx.layer().appendChild(wrap);
      const w = 103, h = 144; // --cs:9px のカードの大きさ
      const anim = wrap.animate([
        { left: from.x - w / 2 + 'px', top: from.y - h / 2 + 'px', transform: 'scale(1.1) rotate(-4deg)', opacity: 1 },
        { left: to.x - w / 2 + 'px', top: to.y - h / 2 + 'px', transform: 'scale(.6) rotate(0)', opacity: 0.2 },
      ], { duration: 320, easing: 'cubic-bezier(.3,.7,.4,1)' });
      anim.onfinish = () => wrap.remove();
    },
  };

  /** 要素に一瞬だけ class を付けて、アニメーションをやり直す */
  function pulseClass(el, cls, ms) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // アニメーションを最初から再生させるための定番の書き方
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), ms);
  }

  // ───────────── デッキ一覧・小物 ─────────────
  /** プリセット＋自作デッキの一覧。対戦準備画面の選択肢に使う */
  function allDecks() {
    const presets = Presets.DECKS.map((d) => ({ value: 'preset:' + d.key, name: d.name, desc: d.desc, cards: d.cards, preset: true }));
    const mine = Storage2.loadDecks().map((d) => ({ value: 'mine:' + d.id, name: d.name, desc: '自作デッキ', cards: d.cards, preset: false }));
    return [...presets, ...mine];
  }

  function countOf(cards) { return Object.values(cards).reduce((a, b) => a + b, 0); }

  let toastTimer = null;
  function toast(text, ms = 1200) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  /** 一時停止や結果表示に使う汎用ダイアログ。title に HTML を使う場合は titleHtml を true に */
  function overlay(title, bodyHtml, buttons, titleHtml) {
    const t = $('#overlay-title');
    if (titleHtml) t.innerHTML = title; else t.textContent = title;
    $('#overlay-body').innerHTML = bodyHtml;
    const box = $('#overlay-buttons');
    box.innerHTML = '';
    buttons.forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'btn' + (b.primary ? ' primary' : '');
      btn.textContent = b.label;
      btn.onclick = b.onClick;
      box.appendChild(btn);
    });
    $('#overlay').classList.remove('hidden');
  }
  function closeOverlay() { $('#overlay').classList.add('hidden'); }

  fitStage();
  root.UI = {
    $, esc, showScreen, onScreen, cardEl, cardTip, cardHelp, allDecks, countOf, toast, overlay, closeOverlay,
    stagePoint, fx, pulseClass, hidePreview, getScale: () => scale, runeCircle,
  };
})(this);
