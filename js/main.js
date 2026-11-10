/*
 * main.js — 起動と、タイトル・対戦の準備画面
 */
(function (root) {
  'use strict';
  const { Engine, AI, Store, Decks, UI, Battle, ForgeUI, Builder, Rules, Ambient } = root;
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

  const LEVEL_INFO = {
    easy:   { stars: 1, desc: 'ときどき悪い手を選ぶ。まず遊び方を覚えたい時に' },
    normal: { stars: 2, desc: '堅実に戦う、標準の相手' },
    hard:   { stars: 3, desc: 'ミスをしない。攻めも守りも計算ずく' },
  };

  function renderSetup() {
    const list = deckChoices();
    if (!list.some((d) => d.key === setup.deck && !d.errors.length)) setup.deck = (list.find((d) => !d.errors.length) || {}).key;
    $('#setup-decks').innerHTML = list.map((d) => {
      // デッキの顔：コストの高い順に、違うカードのアイコンを5つ
      const seen = new Set();
      const faces = d.specs.slice().sort((a, b) => b.cost - a.cost).filter((s) => !seen.has(s.id) && seen.add(s.id)).slice(0, 5);
      const nC = d.specs.filter((s) => s.kind === 'creature').length, nF = d.specs.filter((s) => !s.base).length;
      const avg = d.specs.length ? (d.specs.reduce((t, s) => t + s.cost, 0) / d.specs.length).toFixed(1) : '-';
      return `
      <button class="deck-tile${d.key === setup.deck ? ' on' : ''}${d.errors.length ? ' bad' : ''}" data-k="${d.key}" ${d.errors.length ? 'disabled' : ''}>
        <b>${esc(d.name)}</b><span>${d.errors.length ? esc(d.errors[0]) : esc(d.desc)}</span>
        <div class="dt-faces">${faces.map((s) => `<i style="--cc:${s.color || (s.kind === 'creature' ? '#5f8f4e' : '#5b6fb5')}">${esc(s.icon || '❔')}</i>`).join('')}</div>
        <small><em>クリーチャー ${nC}</em><em>呪文 ${d.specs.length - nC}</em><em>平均コスト ${avg}</em>${nF ? `<em class="forged">オリジナル ${nF}</em>` : ''}</small>
      </button>`;
    }).join('') + '<button class="deck-tile add" data-go="builder"><i>＋</i><b>新しいデッキを組む</b><span>デッキ構築へ</span></button>';
    $('#setup-level').innerHTML = Object.entries(AI.LEVELS).map(([k, v]) => {
      const info = LEVEL_INFO[k] || { stars: 2, desc: '' };
      return `<button data-l="${k}" class="level-card${k === setup.level ? ' on' : ''}"><b>${v.label}</b><span class="stars">${'★'.repeat(info.stars)}<i>${'★'.repeat(3 - info.stars)}</i></span><small>${info.desc}</small></button>`;
    }).join('');
  }

  /** タイトルの背景に浮かぶカード（基本カードから毎回ちがう8枚）。near＝手前で大きく、far＝奥で小さく暗い */
  const TITLE_SPOTS = [
    { x: 96, y: 150, r: -14, s: 11, near: 1 }, { x: 206, y: 400, r: 9, s: 8 }, { x: 88, y: 590, r: 11, s: 10, near: 1 }, { x: 290, y: 650, r: -8, s: 7.4 },
    { x: 1186, y: 146, r: 13, s: 11, near: 1 }, { x: 1078, y: 396, r: -9, s: 8 }, { x: 1196, y: 586, r: -12, s: 10, near: 1 }, { x: 994, y: 654, r: 8, s: 7.4 },
  ];
  function renderTitleCards() {
    const box = $('#title-cards');
    if (!box) return;
    box.innerHTML = '';
    const pool = root.Cards.BASE.filter((c) => c.cost >= 3).sort(() => Math.random() - 0.5);
    TITLE_SPOTS.forEach((sp, i) => {
      const el = UI.cardEl(pool[i % pool.length]);
      el.removeAttribute('data-pv');
      el.classList.add(sp.near ? 'near' : 'far');
      el.style.left = sp.x + 'px';
      el.style.top = sp.y + 'px';
      el.style.setProperty('--cs', sp.s + 'px');
      el.style.setProperty('--rot', sp.r + 'deg');
      el.style.setProperty('--dur', (6 + (i % 4) * 1.3) + 's');
      el.style.setProperty('--dly', (-i * 0.9) + 's');
      el.style.setProperty('--in', (0.15 + i * 0.07) + 's');
      box.appendChild(el);
    });
  }

  function init() {
    UI.init();
    Ambient.init();
    Ambient.tilt($('#forge-preview'));
    Battle.init();
    ForgeUI.init();
    Builder.init();
    Rules.init();
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]');
      if (b) UI.showScreen(b.dataset.go);
    });
    $('#setup-decks').onclick = (e) => { const t = e.target.closest('.deck-tile'); if (t && !t.disabled && t.dataset.k) { setup.deck = t.dataset.k; renderSetup(); } };
    $('#setup-level').onclick = (e) => { const b = e.target.closest('[data-l]'); if (b) { setup.level = b.dataset.l; renderSetup(); } };
    $('#btn-start').onclick = () => {
      const d = deckChoices().find((x) => x.key === setup.deck);
      if (!d || d.errors.length) { UI.toast('使えるデッキを選んでください'); return; }
      Battle.start({ myDeck: d.specs, cpuDeck: AI.buildDeck(), level: setup.level });
    };
    UI.onScreen('setup', renderSetup);
    UI.onScreen('title', renderTitleCards);
    renderTitleCards();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(this);
