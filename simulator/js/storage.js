/*
 * storage.js — 登録したカード・デッキ・設定の保存（ブラウザの中だけに保存されます）
 *
 * ・カードとデッキ … IndexedDB（ブラウザの中のデータベース。画像のような大きなデータも入る）
 * ・設定（APIキーなど）… localStorage
 *
 * どちらも「このブラウザ」の中にだけ保存され、どこかに送られることはありません。
 * ブラウザのデータを消すと消えるので、大事なカードは「書き出し」でファイルに保存しておくと安心です。
 */
(function (root) {
  'use strict';
  const DB_NAME = 'duel-sim';
  const DB_VER = 1;
  let db = null;
  let memory = null; // IndexedDB が使えない時（プライベートモードなど）の代わり

  function open() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains('cards')) d.createObjectStore('cards', { keyPath: 'id' });
          if (!d.objectStoreNames.contains('decks')) d.createObjectStore('decks', { keyPath: 'id' });
        };
        req.onsuccess = () => { db = req.result; resolve(true); };
        req.onerror = () => { memory = { cards: new Map(), decks: new Map() }; resolve(false); };
      } catch (e) {
        memory = { cards: new Map(), decks: new Map() };
        resolve(false);
      }
    });
  }
  function tx(store, mode, fn) {
    if (memory) return Promise.resolve(fn(null));
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const r = fn(s);
      t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }
  const DB = {
    open,
    get persistent() { return !memory; },
    all: (store) => (memory ? Promise.resolve([...memory[store].values()]) : tx(store, 'readonly', (s) => s.getAll())),
    put: (store, obj) => (memory ? Promise.resolve(memory[store].set(obj.id, obj)) : tx(store, 'readwrite', (s) => s.put(obj))),
    del: (store, id) => (memory ? Promise.resolve(memory[store].delete(id)) : tx(store, 'readwrite', (s) => s.delete(id))),
  };

  // ───────────── 設定 ─────────────
  const SETTINGS_KEY = 'duel-sim-settings';
  const DEFAULT_SETTINGS = { apiKey: '', model: 'claude-opus-5-5', reader: 'claude', cpuWait: 450 };
  const Settings = {
    get() {
      try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
      catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
    },
    set(patch) {
      const next = Object.assign(Settings.get(), patch);
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (e) { /* 保存できなくても動作は続ける */ }
      return next;
    },
  };

  // ───────────── カードとデッキの一覧（見本＋登録したもの） ─────────────
  const Library = {
    cards: new Map(),
    decks: new Map(),
    async load() {
      await open();
      this.cards.clear(); this.decks.clear();
      for (const c of root.SampleCards.CARDS) this.cards.set(c.id, c);
      for (const d of root.SampleCards.DECKS) this.decks.set(d.id, d);
      for (const c of await DB.all('cards')) this.cards.set(c.id, c);
      for (const d of await DB.all('decks')) this.decks.set(d.id, d);
      await this.preload(root.PRELOAD_LIBRARY);
    },
    /**
     * 最初から入れておくカードとデッキ（公開ページなどで、別のファイルから渡されたもの）。
     * data.id ごとに一度だけ保存する（あとで消しても、もう入れない）。
     * 同じ id のものがすでにある時は、前に自動で入れたまま手を加えていないものだけ新しい内容にする
     * （data.replaceBefore より前に保存されたもの＝目印が付く前に自動で入れたものも、手を加えていないとみなす）。
     */
    async preload(data) {
      if (!data || data.format !== 'duel-sim-library' || !data.id) return;
      const done = Settings.get().preloaded || [];
      if (done.includes(data.id)) return;
      const untouched = (ex) => !ex || (ex.preloadAt != null ? ex.preloadAt === ex.updatedAt : !ex.sample && (ex.updatedAt || 0) <= (data.replaceBefore || 0));
      for (const [list, map, save, store] of [[data.cards, this.cards, 'saveCard', 'cards'], [data.decks, this.decks, 'saveDeck', 'decks']]) {
        for (const x of list || []) {
          if (!untouched(map.get(x.id))) continue;
          const copy = await this[save](Object.assign({}, x));
          copy.preloadAt = copy.updatedAt;
          if (DB.put) await DB.put(store, copy);
        }
      }
      Settings.set({ preloaded: [...done, data.id] });
    },
    card(id) { return this.cards.get(id); },
    allCards() { return [...this.cards.values()]; },
    allDecks() { return [...this.decks.values()]; },
    newId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
    async saveCard(def) {
      if (!def.id) def.id = this.newId('c_');
      def.updatedAt = Date.now();
      this.cards.set(def.id, def);
      await DB.put('cards', def);
      return def;
    },
    async deleteCard(id) { this.cards.delete(id); await DB.del('cards', id); },
    async saveDeck(deck) {
      if (!deck.id) deck.id = this.newId('d_');
      deck.updatedAt = Date.now();
      this.decks.set(deck.id, deck);
      await DB.put('decks', deck);
      return deck;
    },
    async deleteDeck(id) { this.decks.delete(id); await DB.del('decks', id); },
    /** デッキのカードID一覧を、カード定義の配列にする（見つからないカードは除く） */
    deckDefs(deck) { return deck.cards.map((id) => this.cards.get(id)).filter(Boolean); },
    /** 書き出し用のデータ（登録したカードとデッキ） */
    exportData() {
      return {
        format: 'duel-sim-library', version: 1, exportedAt: new Date().toISOString(),
        cards: this.allCards().filter((c) => !c.sample),
        decks: this.allDecks().filter((d) => !d.sample),
      };
    },
    async importData(data) {
      if (!data || data.format !== 'duel-sim-library') throw new Error('このツールで書き出したファイルではありません');
      for (const c of data.cards || []) await this.saveCard(c);
      for (const d of data.decks || []) await this.saveDeck(d);
      return { cards: (data.cards || []).length, decks: (data.decks || []).length };
    },
  };

  root.Store = { DB, Settings, Library };
})(typeof self !== 'undefined' ? self : this);
