/*
 * main.js — 起動・メニュー・対戦の準備・設定
 */
(function (root) {
  'use strict';
  const { UI, Store, Reader, DeckUI } = root;
  const { $, esc } = UI;
  const Library = Store.Library;
  let last = null; // 「もう一度」用に、前の対戦の条件を覚えておく

  // ───────────── 対戦の準備 ─────────────
  function renderSetup() {
    const decks = Library.allDecks();
    const opt = (d) => {
      const { errs } = DeckUI.deckSummary(d);
      return `<option value="${esc(d.id)}" ${errs.length ? 'disabled' : ''}>${esc(d.name)}${errs.length ? '（未完成）' : ''}</option>`;
    };
    const valid = decks.filter((d) => !DeckUI.deckSummary(d).errs.length);
    $('#setup-my').innerHTML = decks.map(opt).join('');
    $('#setup-cpu').innerHTML = '<option value="random">ランダム（対戦できるデッキから）</option>' + decks.map(opt).join('');
    const prefer = valid.find((d) => !d.sample) || valid[0];
    if (last && Library.decks.has(last.my)) $('#setup-my').value = last.my;
    else if (prefer) $('#setup-my').value = prefer.id;
    $('#setup-note').textContent = valid.length ? '' : '対戦できるデッキがありません。デッキ画面で40枚のデッキを作ってください。';
  }
  function startFromSetup() {
    const my = Library.decks.get($('#setup-my').value);
    if (!my) return UI.toast('デッキを選んでください', 'bad');
    let cpuId = $('#setup-cpu').value;
    const valid = Library.allDecks().filter((d) => !DeckUI.deckSummary(d).errs.length);
    if (cpuId === 'random') {
      const others = valid.filter((d) => d.id !== my.id);
      cpuId = (others.length ? others : valid)[Math.floor(Math.random() * (others.length || valid.length))].id;
    }
    const first = { random: undefined, me: 0, cpu: 1 }[$('#setup-first').value];
    last = { my: my.id, cpu: $('#setup-cpu').value, first, speed: Number($('#setup-speed').value) };
    run(my.id, cpuId);
  }
  function run(myId, cpuId) {
    const my = Library.decks.get(myId), cpu = Library.decks.get(cpuId);
    $('#bt-speed').value = String(last.speed);
    UI.toast(`相手のデッキ：${cpu.name}`);
    root.BattleUI.start(Library.deckDefs(my), Library.deckDefs(cpu), { first: last.first, speed: last.speed });
  }
  function rematch() {
    if (!last) return UI.showScreen('setup');
    let cpuId = last.cpu;
    if (cpuId === 'random' || !Library.decks.has(cpuId)) {
      const valid = Library.allDecks().filter((d) => !DeckUI.deckSummary(d).errs.length && d.id !== last.my);
      cpuId = (valid[Math.floor(Math.random() * valid.length)] || Library.decks.get(last.my)).id;
    }
    run(last.my, cpuId);
  }

  // ───────────── 設定 ─────────────
  function renderSettings() {
    const st = Store.Settings.get();
    document.querySelectorAll('input[name="reader"]').forEach((r) => { r.checked = r.value === st.reader; });
    $('#set-key').value = st.apiKey || '';
    $('#set-model').value = st.model;
    $('#set-wait').value = st.cpuWait;
    $('#set-storage').textContent = Store.DB.persistent ? 'カードとデッキは、このブラウザの中に保存されます。' : '⚠ このブラウザでは保存ができません（プライベートモードなど）。画面を閉じると消えるので「書き出し」を使ってください。';
  }
  function initSettings() {
    const save = () => {
      Store.Settings.set({
        reader: (document.querySelector('input[name="reader"]:checked') || {}).value || 'claude',
        apiKey: $('#set-key').value.trim(),
        model: $('#set-model').value,
        cpuWait: Number($('#set-wait').value),
      });
    };
    $('#screen-settings').addEventListener('change', save);
    $('#set-key').addEventListener('input', save);
    $('#set-show').onclick = () => { const k = $('#set-key'); k.type = k.type === 'password' ? 'text' : 'password'; };
    $('#set-test').onclick = async () => {
      save();
      const out = $('#set-test-result');
      out.textContent = '確認中…';
      try { const t = await Reader.testClaude(); out.textContent = `✓ つながりました（返事：${t.trim()}）`; out.className = 'ok'; }
      catch (e) { out.textContent = '✗ ' + (e.message || e); out.className = 'ng'; }
    };
    $('#set-clear').onclick = async () => {
      if (!(await UI.confirmBox('API キーを消す', 'このブラウザに保存した API キーを消しますか？', '消す', 'danger'))) return;
      Store.Settings.set({ apiKey: '' }); renderSettings(); UI.toast('API キーを消しました');
    };
  }

  async function boot() {
    await Library.load();
    root.LibraryUI.init();
    DeckUI.init();
    root.BattleUI.init();
    initSettings();
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (!go) return;
      if (document.body.dataset.screen === 'battle' && root.BattleUI.game && root.BattleUI.game.phase !== 'over') return;
      if (go.dataset.go !== 'battle') root.BattleUI.stop();
      UI.showScreen(go.dataset.go);
    });
    UI.onScreen('setup', renderSetup);
    UI.onScreen('settings', renderSettings);
    $('#setup-start').onclick = startFromSetup;
    UI.showScreen('home');
  }

  root.Main = { rematch };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof self !== 'undefined' ? self : this);
