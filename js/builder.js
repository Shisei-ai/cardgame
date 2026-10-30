/*
 * builder.js — デッキ構築画面
 */
(function (root) {
  'use strict';
  const { Cards, Engine, Presets, Storage2, UI } = root;
  const { $, esc } = UI;
  const CFG = Engine.CONFIG;

  const state = {
    filter: 'all',
    arch: 'all',
    deckId: null,   // 編集中の自作デッキID（未保存の新規なら null）
    name: '',
    cards: {},      // { カードID: 枚数 }
  };

  function init() {
    // 種類フィルター
    const tabs = $('#pool-filter');
    const types = [['all', 'すべて'], ...Object.entries(Cards.TYPES).map(([k, v]) => [k, v.label])];
    tabs.innerHTML = types.map(([k, label]) => `<button data-f="${k}">${label}</button>`).join('');
    tabs.onclick = (e) => {
      const f = e.target.dataset.f;
      if (!f) return;
      state.filter = f;
      render();
    };

    // テーマの絞り込み
    const archTabs = $('#pool-arch');
    archTabs.innerHTML = [['all', 'すべて'], ...Object.entries(Cards.ARCHES).map(([k, v]) => [k, v.label])]
      .map(([k, label]) => `<button data-a="${k}">${label}</button>`).join('');
    archTabs.onclick = (e) => {
      const a = e.target.dataset.a;
      if (!a) return;
      state.arch = a;
      render();
    };

    $('#deck-select').onchange = (e) => load(e.target.value);
    $('#deck-new').onclick = () => { state.deckId = null; state.name = ''; state.cards = {}; render(); };
    $('#deck-clear').onclick = () => { state.cards = {}; render(); };
    $('#deck-name').oninput = (e) => { state.name = e.target.value; };
    $('#deck-save').onclick = save;
    $('#deck-delete').onclick = remove;
  }

  function load(value) {
    if (!value) return;
    const [kind, key] = value.split(':');
    if (kind === 'preset') {
      const d = Presets.DECKS.find((x) => x.key === key);
      // プリセットは直接書き換えず、コピーとして編集を始める
      state.deckId = null;
      state.name = d.name + '（改）';
      state.cards = { ...d.cards };
    } else {
      const d = Storage2.loadDecks().find((x) => x.id === key);
      if (!d) return;
      state.deckId = d.id;
      state.name = d.name;
      state.cards = { ...d.cards };
    }
    render();
  }

  function add(id, n) {
    const cur = state.cards[id] || 0;
    const total = UI.countOf(state.cards);
    const next = Math.max(0, Math.min(CFG.maxCopies, cur + n));
    if (n > 0 && total >= CFG.deckSize) { $('#deck-error').textContent = `デッキは${CFG.deckSize}枚までです`; return; }
    if (next === 0) delete state.cards[id]; else state.cards[id] = next;
    render();
  }

  function save() {
    const list = Presets.toList(state.cards);
    const errors = Engine.validateDeck(list);
    const name = state.name.trim() || '名称未設定デッキ';
    if (errors.length) {
      $('#deck-error').textContent = '保存できません:\n' + errors.join('\n');
      return;
    }
    const decks = Storage2.loadDecks();
    if (state.deckId) {
      const d = decks.find((x) => x.id === state.deckId);
      if (d) { d.name = name; d.cards = { ...state.cards }; }
    } else {
      state.deckId = 'd' + Date.now().toString(36);
      decks.push({ id: state.deckId, name, cards: { ...state.cards } });
    }
    state.name = name;
    const ok = Storage2.saveDecks(decks);
    $('#deck-error').textContent = ok ? '' : 'このブラウザでは保存できませんでした（プライベートモード等）';
    render();
    if (ok) flash('保存しました');
  }

  function remove() {
    if (!state.deckId) { state.cards = {}; state.name = ''; render(); return; }
    if (!confirm(`「${state.name}」を削除しますか？`)) return;
    Storage2.saveDecks(Storage2.loadDecks().filter((x) => x.id !== state.deckId));
    state.deckId = null; state.name = ''; state.cards = {};
    render();
  }

  function flash(text) {
    const el = $('#deck-count');
    const prev = el.textContent;
    el.textContent = text;
    setTimeout(() => { el.textContent = prev; }, 900);
  }

  function render() {
    // フィルターのボタン状態
    document.querySelectorAll('#pool-filter button').forEach((b) => b.classList.toggle('on', b.dataset.f === state.filter));
    document.querySelectorAll('#pool-arch button').forEach((b) => b.classList.toggle('on', b.dataset.a === state.arch));
    $('#arch-desc').textContent = state.arch === 'all'
      ? 'クリックで追加 ／ 右クリックで削除 ／ マウスを乗せると詳しい説明'
      : `【${Cards.ARCHES[state.arch].label}】${Cards.ARCHES[state.arch].desc}`;

    // カード一覧（種類→コスト順）
    const typeOrder = Object.keys(Cards.TYPES);
    const pool = $('#pool');
    pool.innerHTML = '';
    Cards.LIST
      .filter((c) => state.filter === 'all' || c.type === state.filter)
      .filter((c) => state.arch === 'all' || (c.arch || []).includes(state.arch))
      .sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type) || a.cost - b.cost)
      .forEach((c) => {
        const el = UI.cardEl(c, { owned: state.cards[c.id] });
        el.onclick = () => add(c.id, 1);
        el.oncontextmenu = (e) => { e.preventDefault(); add(c.id, -1); };
        pool.appendChild(el);
      });

    // デッキ選択
    const sel = $('#deck-select');
    const mine = Storage2.loadDecks();
    sel.innerHTML = '<option value="">― デッキを読み込む ―</option>'
      + '<optgroup label="プリセット">' + Presets.DECKS.map((d) => `<option value="preset:${d.key}">${esc(d.name)}</option>`).join('') + '</optgroup>'
      + (mine.length ? '<optgroup label="自作デッキ">' + mine.map((d) => `<option value="mine:${d.id}">${esc(d.name)}</option>`).join('') + '</optgroup>' : '');
    sel.value = state.deckId ? 'mine:' + state.deckId : '';

    $('#deck-name').value = state.name;

    // 枚数
    const total = UI.countOf(state.cards);
    const cnt = $('#deck-count');
    cnt.textContent = `${total} / ${CFG.deckSize}枚`;
    cnt.classList.toggle('ok', total === CFG.deckSize);

    // マナカーブ（コスト別枚数のグラフ）
    const curve = new Array(9).fill(0);
    for (const id in state.cards) curve[Math.min(8, Cards.get(id).cost)] += state.cards[id];
    const max = Math.max(4, ...curve);
    $('#deck-curve').innerHTML = curve
      .map((n, i) => `<div class="bar" style="height:${(n / max) * 100}%" title="コスト${i}${i === 8 ? '以上' : ''}: ${n}枚"><span>${i === 8 ? '8+' : i}</span></div>`)
      .join('');

    // デッキの中身
    const list = $('#deck-list');
    list.innerHTML = '';
    Object.keys(state.cards)
      .map(Cards.get)
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'ja'))
      .forEach((c) => {
        const li = document.createElement('li');
        li.style.setProperty('--tc', Cards.TYPES[c.type].color);
        li.innerHTML = `<span class="dl-cost">${c.cost}</span><span class="dl-name">${c.icon} ${esc(c.name)}</span>
          <button data-d="-1">−</button><b>${state.cards[c.id]}</b><button data-d="1">＋</button>`;
        li.dataset.cid = c.id; // マウスを乗せると拡大表示
        li.onclick = (e) => { const d = e.target.dataset.d; if (d) add(c.id, Number(d)); };
        list.appendChild(li);
      });

    if (total < CFG.deckSize) $('#deck-error').textContent = '';
  }

  UI.onScreen('builder', render);
  root.Builder = { init };
})(this);
