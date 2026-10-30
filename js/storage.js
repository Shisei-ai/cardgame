/*
 * storage.js — 自作デッキの保存（ブラウザの localStorage を使用）
 * 保存形式: [{ id, name, cards: { カードID: 枚数 } }, ...]
 *
 * itch.io の埋め込み表示やプライベートウィンドウでは保存できない場合があるので、
 * 読み書きは必ず try/catch で囲み、失敗してもゲームは動くようにしています。
 */
(function (root) {
  'use strict';
  const KEY = 'chronoDuel.decks.v1';
  const SETTINGS_KEY = 'chronoDuel.settings.v1';

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  root.Storage2 = {
    loadDecks: () => read(KEY, []),
    saveDecks: (decks) => write(KEY, decks),
    loadSettings: () => read(SETTINGS_KEY, {}),
    saveSettings: (s) => write(SETTINGS_KEY, s),
  };
})(this);
