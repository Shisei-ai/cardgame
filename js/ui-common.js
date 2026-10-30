/*
 * ui-common.js — 画面切り替えやカード表示など、複数の画面で使う部品
 */
(function (root) {
  'use strict';
  const { Cards, Presets, Storage2 } = root;

  const $ = (sel) => document.querySelector(sel);

  // HTMLに埋め込む文字列のエスケープ（デッキ名などユーザー入力を安全に表示するため）
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const screenHooks = {};
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
    $('#screen-' + name).classList.add('active');
    if (screenHooks[name]) screenHooks[name]();
  }
  function onScreen(name, fn) { screenHooks[name] = fn; }

  /**
   * カード1枚分のDOM要素を作る
   * opts.cost / opts.cast : 補正後の実際のコスト・詠唱時間（手札表示用）。元の値と違えば色を変える
   */
  function cardEl(card, opts = {}) {
    const el = document.createElement('div');
    el.className = 'card';
    el.style.setProperty('--tc', Cards.TYPES[card.type].color);
    const cost = opts.cost != null ? opts.cost : card.cost;
    const cast = opts.cast != null ? opts.cast : card.cast;
    const castLabel = cast > 0 ? `⏱${cast}s` : card.cast > 0 ? '⚡即時' : '⚡瞬間';
    const costCls = cost < card.cost ? ' down' : cost > card.cost ? ' up' : '';
    const castCls = cast < card.cast ? ' down' : '';
    const stats = card.type === 'creature'
      ? `<div class="c-stats"><span class="atk">⚔${card.atk}</span><span class="hp">♥${card.hp}</span></div>` : '';
    el.innerHTML = `
      <div class="c-cost${costCls}">${cost}</div>
      ${card.hpCost ? `<div class="c-hpcost" title="代償：体力${card.hpCost}">♥${card.hpCost}</div>` : ''}
      <div class="c-cast${castCls}">${castLabel}</div>
      <div class="c-name">${esc(card.name)}</div>
      <div class="c-icon">${card.icon}</div>
      <div class="c-type">${Cards.TYPES[card.type].label}</div>
      <div class="c-text">${esc(Cards.fullText(card))}</div>
      ${stats}
      ${opts.key != null ? `<div class="c-key">${opts.key}</div>` : ''}
      ${opts.badge ? `<div class="c-badge">${esc(opts.badge)}</div>` : ''}
      ${opts.owned ? `<div class="c-owned">×${opts.owned}</div>` : ''}
    `;
    el.title = cardTip(card);
    return el;
  }

  /** マウスを乗せたときの詳しい説明（キーワードの意味やテーマも載せる） */
  function cardTip(card) {
    const castLabel = card.cast > 0 ? `詠唱${card.cast}秒` : '瞬間';
    const lines = [`${card.name}（${Cards.TYPES[card.type].label}）`, `コスト${card.cost}${card.hpCost ? `＋体力${card.hpCost}` : ''} / ${castLabel}`];
    if (card.type === 'creature') lines.push(`攻撃力${card.atk} / 体力${card.hp}`);
    lines.push(Cards.fullText(card, true));
    const kws = Cards.keywords(card).map((k) => k.replace(/\d+$/, ''));
    if (card.hpCost) kws.push('代償');
    kws.forEach((k) => { if (Cards.KEYWORD_HELP[k]) lines.push(`・${k}：${Cards.KEYWORD_HELP[k]}`); });
    if (card.arch) lines.push('テーマ：' + card.arch.map((a) => Cards.ARCHES[a].label).join('・'));
    return lines.join('\n');
  }

  /** プリセット＋自作デッキの一覧。対戦準備画面の選択肢に使う */
  function allDecks() {
    const presets = Presets.DECKS.map((d) => ({ value: 'preset:' + d.key, name: '★ ' + d.name, cards: d.cards }));
    const mine = Storage2.loadDecks().map((d) => ({ value: 'mine:' + d.id, name: d.name, cards: d.cards }));
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

  /** 一時停止や結果表示に使う汎用ダイアログ */
  function overlay(title, bodyHtml, buttons) {
    $('#overlay-title').textContent = title;
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

  root.UI = { $, esc, showScreen, onScreen, cardEl, cardTip, allDecks, countOf, toast, overlay, closeOverlay };
})(this);
