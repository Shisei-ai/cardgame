/*
 * builder.js — デッキ構築
 *   左：カードの一覧（基本カード／オリジナル）。クリックで1枚追加、右クリックで1枚外す
 *   右：デッキ（40枚ちょうど・同じカードは4枚まで）
 */
(function (root) {
  'use strict';
  const { Parts, Cards, Engine, Store, Decks, UI } = root;
  const { $, esc } = UI;
  const CFG = Engine.CONFIG;

  const S = { tab: 'all', kind: 'all', deckId: null, name: '', cards: {} };

  function pool() {
    const forged = Store.cards();
    let list = S.tab === 'base' ? Cards.BASE : S.tab === 'forged' ? forged : [...forged, ...Cards.BASE];
    if (S.kind !== 'all') list = list.filter((c) => c.kind === S.kind);
    return list.slice().sort((a, b) => a.cost - b.cost || (a.kind === b.kind ? 0 : a.kind === 'creature' ? -1 : 1));
  }

  const total = () => Object.values(S.cards).reduce((s, n) => s + n, 0);

  function add(id, d) {
    const n = (S.cards[id] || 0) + d;
    if (d > 0 && n > CFG.maxCopies) { UI.toast(`同じカードは${CFG.maxCopies}枚まで`); return; }
    if (d > 0 && total() >= CFG.deckSize) { UI.toast(`デッキは${CFG.deckSize}枚まで`); return; }
    if (n <= 0) delete S.cards[id]; else S.cards[id] = n;
    render();
  }

  function render() {
    // タブ
    $('#pool-tabs').innerHTML = [['all', 'すべて'], ['base', '基本カード'], ['forged', `オリジナル（${Store.cards().length}）`]]
      .map(([k, l]) => `<button data-t="${k}" class="${S.tab === k ? 'on' : ''}">${l}</button>`).join('');
    $('#pool-kind').innerHTML = [['all', '全種類'], ['creature', 'クリーチャー'], ['spell', '呪文']]
      .map(([k, l]) => `<button data-k="${k}" class="${S.kind === k ? 'on' : ''}">${l}</button>`).join('');
    // 一覧
    const box = $('#pool');
    box.innerHTML = '';
    const list = pool();
    if (!list.length) box.innerHTML = '<p class="hint pad">オリジナルカードはまだありません。カード工房で作りましょう。</p>';
    for (const c of list) {
      const el = UI.cardEl(c, { count: S.cards[c.id] });
      el.onclick = () => add(c.id, 1);
      el.oncontextmenu = (e) => { e.preventDefault(); add(c.id, -1); };
      box.appendChild(el);
    }
    // デッキ選択
    const sel = $('#deck-select');
    const mine = Store.decks();
    sel.innerHTML = '<option value="">― デッキを読み込む ―</option>'
      + '<optgroup label="見本">' + Decks.STARTERS.map((d) => `<option value="s:${d.id}">${esc(d.name)}</option>`).join('') + '</optgroup>'
      + (mine.length ? '<optgroup label="自分のデッキ">' + mine.map((d) => `<option value="m:${d.id}">${esc(d.name)}</option>`).join('') + '</optgroup>' : '');
    sel.value = S.deckId ? 'm:' + S.deckId : '';
    $('#deck-name').value = S.name;
    const n = total();
    $('#deck-count').innerHTML = `<b class="${n === CFG.deckSize ? 'ok' : ''}">${n}</b> / ${CFG.deckSize}枚`;
    // コストの分布
    const curve = new Array(11).fill(0);
    for (const id in S.cards) { const c = UI.cardById(id); if (c) curve[Math.min(10, c.cost)] += S.cards[id]; }
    const max = Math.max(4, ...curve);
    $('#deck-curve').innerHTML = curve.map((v, i) => i === 0 ? '' : `<div class="bar" title="コスト${i}${i === 10 ? '以上' : ''}：${v}枚"><i style="height:${(v / max) * 100}%"></i><span>${i === 10 ? '10+' : i}</span></div>`).join('');
    // デッキの中身
    const ul = $('#deck-list');
    ul.innerHTML = '';
    Object.keys(S.cards).map((id) => ({ id, c: UI.cardById(id) })).sort((a, b) => (a.c ? a.c.cost : 99) - (b.c ? b.c.cost : 99)).forEach(({ id, c }) => {
      const li = document.createElement('li');
      if (!c) { li.className = 'missing'; li.innerHTML = `<span>（捨てたカード）</span><button data-d="-1">−</button><b>${S.cards[id]}</b>`; }
      else {
        li.style.setProperty('--cc', c.color || (c.kind === 'creature' ? '#5f8f4e' : '#5b6fb5'));
        li.innerHTML = `<span class="dl-cost">${c.cost}</span><span class="dl-name">${esc(c.icon)} ${esc(c.name)}</span>${c.base ? '' : `<span class="dl-grade" style="color:${Parts.GRADES[c.grade].color}">${Parts.GRADES[c.grade].label}</span>`}<button data-d="-1">−</button><b>${S.cards[id]}</b><button data-d="1">＋</button>`;
        UI.bindSpec(li, c);
      }
      li.onclick = (e) => { const d = e.target.dataset.d; if (d) add(id, Number(d)); };
      ul.appendChild(li);
    });
    $('#deck-error').textContent = '';
  }

  function load(value) {
    if (!value) return;
    const [k, id] = value.split(':');
    if (k === 's') {
      const d = Decks.STARTERS.find((x) => x.id === id);
      S.deckId = null; S.name = d.name.replace('見本：', '') + '（改）'; S.cards = { ...d.cards };
    } else {
      const d = Store.decks().find((x) => x.id === id);
      if (!d) return;
      S.deckId = d.id; S.name = d.name; S.cards = { ...d.cards };
    }
    render();
  }

  function save() {
    const name = $('#deck-name').value.trim() || '名前のないデッキ';
    const specs = Decks.toList(S.cards, UI.cardById).list;
    const err = Engine.validateDeck(specs);
    const d = Store.saveDeck({ id: S.deckId, name, cards: { ...S.cards } });
    S.deckId = d.id; S.name = name;
    render();
    if (err.length) $('#deck-error').textContent = '保存しました（このままでは対戦に使えません：' + err.join(' / ') + '）';
    else UI.toast('保存しました');
  }

  function init() {
    $('#pool-tabs').onclick = (e) => { const t = e.target.dataset.t; if (t) { S.tab = t; render(); } };
    $('#pool-kind').onclick = (e) => { const k = e.target.dataset.k; if (k) { S.kind = k; render(); } };
    $('#deck-select').onchange = (e) => load(e.target.value);
    $('#deck-new').onclick = () => { S.deckId = null; S.name = ''; S.cards = {}; render(); };
    $('#deck-clear').onclick = () => { S.cards = {}; render(); };
    $('#deck-name').oninput = (e) => { S.name = e.target.value; };
    $('#deck-save').onclick = save;
    $('#deck-delete').onclick = () => {
      if (!S.deckId) { S.cards = {}; S.name = ''; render(); return; }
      UI.modal('デッキを削除', `<p>「${esc(S.name)}」を削除しますか？</p>`, [
        { label: 'やめる', onClick: UI.closeModal },
        { label: '削除', danger: true, onClick: () => { Store.deleteDeck(S.deckId); S.deckId = null; S.name = ''; S.cards = {}; UI.closeModal(); render(); } },
      ]);
    };
    UI.onScreen('builder', render);
  }

  root.Builder = { init };
})(this);
