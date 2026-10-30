/*
 * main.js — 起動処理と、タイトル・対戦準備画面
 */
(function (root) {
  'use strict';
  const { AI, Engine, Presets, Storage2, UI, Builder, Battle } = root;
  const { $, esc } = UI;

  // data-go="画面名" を持つボタンで画面を切り替える
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]');
    if (go) UI.showScreen(go.dataset.go);
  });

  // ───── 対戦準備画面 ─────
  UI.onScreen('setup', () => {
    const decks = UI.allDecks();
    const s = Storage2.loadSettings();
    const opts = decks.map((d) => `<option value="${esc(d.value)}">${esc(d.name)}（${UI.countOf(d.cards)}枚）</option>`).join('');
    $('#setup-my-deck').innerHTML = opts;
    $('#setup-cpu-deck').innerHTML = '<option value="random">ランダム</option>' + opts;
    $('#setup-level').innerHTML = Object.entries(AI.LEVELS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
    // 前回の選択を復元
    if (s.myDeck && decks.some((d) => d.value === s.myDeck)) $('#setup-my-deck').value = s.myDeck;
    if (s.cpuDeck) $('#setup-cpu-deck').value = s.cpuDeck;
    $('#setup-level').value = s.level || 'normal';
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

  Builder.init();
  Battle.init();
})(this);
