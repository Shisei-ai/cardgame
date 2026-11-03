/*
 * main.js — 起動と、対戦の準備画面
 */
(function (root) {
  'use strict';
  const { Engine, AI, Store, Decks, UI, Battle, ForgeUI, Builder, Rules } = root;
  const { $, esc } = UI;

  const setup = { deck: 'starter_fire', level: 'normal' };

  /** 対戦に使えるデッキの一覧 [{ key, name, desc, specs, errors }] */
  function deckChoices() {
    const out = [];
    for (const d of Store.decks()) {
      const r = Decks.toList(d.cards, UI.cardById);
      out.push({ key: d.id, name: d.name, desc: '自分のデッキ', specs: r.list, errors: Engine.validateDeck(r.list) });
    }
    for (const d of Decks.STARTERS) {
      const r = Decks.toList(d.cards, UI.cardById);
      out.push({ key: d.id, name: d.name, desc: d.desc, specs: r.list, errors: Engine.validateDeck(r.list) });
    }
    return out;
  }

  function renderSetup() {
    const list = deckChoices();
    if (!list.some((d) => d.key === setup.deck && !d.errors.length)) setup.deck = (list.find((d) => !d.errors.length) || {}).key;
    $('#setup-decks').innerHTML = list.map((d) => `
      <button class="deck-tile${d.key === setup.deck ? ' on' : ''}${d.errors.length ? ' bad' : ''}" data-k="${d.key}" ${d.errors.length ? 'disabled' : ''}>
        <b>${esc(d.name)}</b><span>${d.errors.length ? esc(d.errors[0]) : esc(d.desc)}</span>
        <small>${d.specs.filter((s) => !s.base).length ? `オリジナル ${d.specs.filter((s) => !s.base).length}枚` : '基本カードのみ'}</small>
      </button>`).join('');
    $('#setup-level').innerHTML = Object.entries(AI.LEVELS).map(([k, v]) => `<button data-l="${k}" class="${k === setup.level ? 'on' : ''}">${v.label}</button>`).join('');
  }

  function init() {
    UI.init();
    Battle.init();
    ForgeUI.init();
    Builder.init();
    Rules.init();
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]');
      if (b) UI.showScreen(b.dataset.go);
    });
    $('#setup-decks').onclick = (e) => { const t = e.target.closest('.deck-tile'); if (t && !t.disabled) { setup.deck = t.dataset.k; renderSetup(); } };
    $('#setup-level').onclick = (e) => { const l = e.target.dataset.l; if (l) { setup.level = l; renderSetup(); } };
    $('#btn-start').onclick = () => {
      const d = deckChoices().find((x) => x.key === setup.deck);
      if (!d || d.errors.length) { UI.toast('使えるデッキを選んでください'); return; }
      Battle.start({ myDeck: d.specs, cpuDeck: AI.buildDeck(), level: setup.level });
    };
    UI.onScreen('setup', renderSetup);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(this);
