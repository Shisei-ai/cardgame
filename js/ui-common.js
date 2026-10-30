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

  /** カード1枚分のDOM要素を作る */
  function cardEl(card, opts = {}) {
    const el = document.createElement('div');
    el.className = 'card';
    el.style.setProperty('--tc', Cards.TYPES[card.type].color);
    const castLabel = card.cast > 0 ? `⏱${card.cast}s` : '⚡瞬間';
    const stats = card.type === 'creature'
      ? `<div class="c-stats"><span class="atk">⚔${card.atk}</span><span class="hp">♥${card.hp}</span></div>` : '';
    el.innerHTML = `
      <div class="c-cost">${card.cost}</div>
      <div class="c-cast">${castLabel}</div>
      <div class="c-name">${esc(card.name)}</div>
      <div class="c-icon">${card.icon}</div>
      <div class="c-type">${Cards.TYPES[card.type].label}</div>
      <div class="c-text">${esc(Cards.fullText(card))}</div>
      ${stats}
      ${opts.key != null ? `<div class="c-key">${opts.key}</div>` : ''}
      ${opts.badge ? `<div class="c-badge">${esc(opts.badge)}</div>` : ''}
      ${opts.owned ? `<div class="c-owned">×${opts.owned}</div>` : ''}
    `;
    el.title = `${card.name}（${Cards.TYPES[card.type].label}）\nコスト${card.cost} / ${castLabel}\n${Cards.fullText(card, true)}`;
    return el;
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

  root.UI = { $, esc, showScreen, onScreen, cardEl, allDecks, countOf, toast, overlay, closeOverlay };
})(this);
