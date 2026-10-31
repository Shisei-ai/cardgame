/*
 * main.js — 起動処理と、タイトル・対戦準備画面
 */
(function (root) {
  'use strict';
  const { AI, Cards, Engine, Presets, Storage2, UI, Builder, Battle } = root;
  const { $, esc } = UI;

  // data-go="画面名" を持つボタンで画面を切り替える
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) UI.showScreen(go.dataset.go);
  });

  // ───── 対戦準備画面 ─────
  // デッキはタイルで選ぶ。選んだ値は隠した <select> に入れておき、開始時にそこから読む

  /** デッキを代表するカード3枚のアイコン（枚数が多く、コストが高い順） */
  function deckIcons(cards) {
    return Object.entries(cards)
      .map(([id, n]) => ({ c: Cards.get(id), n }))
      .sort((a, b) => b.n - a.n || b.c.cost - a.c.cost)
      .slice(0, 3).map((x) => x.c.icon).join('');
  }

  function renderTiles(boxSel, selectSel, decks, withRandom) {
    const box = $(boxSel);
    const sel = $(selectSel);
    const items = (withRandom ? [{ value: 'random', name: 'ランダム', desc: 'プリセットからランダムに選ぶ', icons: '❔', preset: true }] : [])
      .concat(decks.map((d) => ({ ...d, icons: deckIcons(d.cards) })));
    sel.innerHTML = items.map((d) => `<option value="${esc(d.value)}"></option>`).join('');
    box.innerHTML = '';
    items.forEach((d) => {
      const t = document.createElement('button');
      t.className = 'deck-tile';
      t.dataset.value = d.value;
      t.innerHTML = `<div class="dt-icons">${d.icons}</div>
        <div><div class="dt-name">${esc(d.name)}</div><div class="dt-desc">${esc(d.desc || '')}</div></div>
        ${d.preset ? '' : '<span class="dt-badge">自作</span>'}`;
      t.onclick = () => { sel.value = d.value; syncTiles(box, sel); };
      box.appendChild(t);
    });
  }
  function syncTiles(box, sel) {
    box.querySelectorAll('.deck-tile').forEach((t) => t.classList.toggle('on', t.dataset.value === sel.value));
  }

  UI.onScreen('setup', () => {
    const decks = UI.allDecks();
    const s = Storage2.loadSettings();
    renderTiles('#tiles-me', '#setup-my-deck', decks, false);
    renderTiles('#tiles-cpu', '#setup-cpu-deck', decks, true);
    // CPUの強さ
    const lv = $('#setup-level');
    lv.innerHTML = Object.keys(AI.LEVELS).map((k) => `<option value="${k}"></option>`).join('');
    lv.value = s.level || 'normal';
    const pick = $('#level-pick');
    pick.innerHTML = '<span>CPUの強さ</span>' + Object.entries(AI.LEVELS).map(([k, v]) => `<button data-lv="${k}">${v.label}</button>`).join('');
    const syncLv = () => pick.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.lv === lv.value));
    pick.onclick = (e) => { const k = e.target.dataset.lv; if (k) { lv.value = k; syncLv(); } };
    syncLv();
    // 前回の選択を復元
    if (s.myDeck && decks.some((d) => d.value === s.myDeck)) $('#setup-my-deck').value = s.myDeck;
    if (s.cpuDeck) $('#setup-cpu-deck').value = s.cpuDeck;
    if (!$('#setup-cpu-deck').value) $('#setup-cpu-deck').value = 'random';
    syncTiles($('#tiles-me'), $('#setup-my-deck'));
    syncTiles($('#tiles-cpu'), $('#setup-cpu-deck'));
    $('#setup-error').textContent = '';
  });

  $('#btn-start').onclick = () => {
    const decks = UI.allDecks();
    const myVal = $('#setup-my-deck').value;
    let cpuVal = $('#setup-cpu-deck').value;
    const level = $('#setup-level').value;
    Storage2.saveSettings({ myDeck: myVal, cpuDeck: cpuVal, level });

    // CPUの「ランダム」はプリセットから選ぶ
    if (cpuVal === 'random') {
      const ps = Presets.DECKS;
      cpuVal = 'preset:' + ps[Math.floor(Math.random() * ps.length)].key;
    }
    const mine = decks.find((d) => d.value === myVal);
    const cpu = decks.find((d) => d.value === cpuVal);
    const myList = Presets.toList(mine.cards);
    const cpuList = Presets.toList(cpu.cards);
    const errors = [...Engine.validateDeck(myList), ...Engine.validateDeck(cpuList)];
    if (errors.length) { $('#setup-error').textContent = errors.join('\n'); return; }

    Battle.start({ myDeck: myList, cpuDeck: cpuList, level, cpuName: 'CPU' });
  };

  // タイトルの紋章の後ろに魔法陣を重ねる
  $('.logo-emblem').insertAdjacentHTML('afterbegin', UI.runeCircle('title-circle'));

  Builder.init();
  Battle.init();
  root.Tips.init();
})(this);
