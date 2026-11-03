/*
 * storage.js — 作ったカードとデッキの保存（ブラウザの localStorage）
 *
 * 読み書きは必ず try/catch で囲み、保存できない環境（プライベートモードなど）でもゲームは動くようにする。
 * カードは spec（parts.js の形）をそのまま保存し、デッキはカードIDの配列で保存する。
 */
(function (root) {
  'use strict';
  const KEY_CARDS = 'arcanaForge.cards.v1';
  const KEY_DECKS = 'arcanaForge.decks.v1';
  const memory = {}; // 保存できない環境では、ここに置く（ページを閉じると消える）

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return memory[key] || fallback;
    }
  }
  function write(key, value) {
    memory[key] = value;
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  const newId = (prefix) => prefix + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

  const Store = {
    // ── オリジナルカード ──
    cards() { return read(KEY_CARDS, []); },
    saveCard(spec) {
      const list = Store.cards();
      if (!spec.id) spec.id = newId('f_');
      const i = list.findIndex((c) => c.id === spec.id);
      if (i >= 0) list[i] = spec; else list.push(spec);
      write(KEY_CARDS, list);
      return spec;
    },
    deleteCard(id) { write(KEY_CARDS, Store.cards().filter((c) => c.id !== id)); },

    // ── デッキ ──
    decks() { return read(KEY_DECKS, []); },
    saveDeck(deck) {
      const list = Store.decks();
      if (!deck.id) deck.id = newId('d_');
      const i = list.findIndex((d) => d.id === deck.id);
      if (i >= 0) list[i] = deck; else list.push(deck);
      write(KEY_DECKS, list);
      return deck;
    },
    deleteDeck(id) { write(KEY_DECKS, Store.decks().filter((d) => d.id !== id)); },
  };

  root.Store = Store;
})(this);
