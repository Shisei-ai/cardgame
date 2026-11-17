/*
 * deck-ui.js — デッキの作成・編集・画像からの読み込み
 *
 * ・左：デッキの一覧　・中央：カード（クリックでデッキに1枚追加）　・右：デッキの中身（−で1枚減らす）
 * ・「画像から作る」… デッキリストの画像を読み取り、名前を登録済みのカードと照らし合わせる
 * ・「文字から作る」… 「4 カード名」のような一覧を貼り付けて作る
 */
(function (root) {
  'use strict';
  const { UI, Store, Reader, Engine, SimData, TextParser } = root;
  const { $, esc } = UI;
  const Library = Store.Library;
  let current = null; // 編集中のデッキ
  const pool = { q: '', civ: '' };

  function deckSummary(d) {
    const defs = Library.deckDefs(d);
    const errs = Engine.validateDeck(defs);
    const missing = d.cards.length - defs.length;
    if (missing) errs.unshift(`登録されていないカードが${missing}枚あります`);
    return { defs, errs };
  }

  function renderList() {
    const decks = Library.allDecks().sort((a, b) => (a.sample ? 1 : 0) - (b.sample ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0));
    $('#deck-list').innerHTML = decks.map((d) => {
      const { errs } = deckSummary(d);
      return `<button class="deck-item ${current && current.id === d.id ? 'on' : ''}" data-id="${esc(d.id)}">
        <b>${d.sample ? '<i class="tag">見本</i>' : ''}${esc(d.name)}</b><small>${d.cards.length}枚 ${errs.length ? '<span class="ng">⚠ 未完成</span>' : '<span class="ok">✓ 対戦OK</span>'}</small></button>`;
    }).join('');
  }

  function renderPool() {
    const q = pool.q.trim();
    const cards = Library.allCards().filter((c) => (!q || c.name.includes(q) || (c.text || '').includes(q)) && (!pool.civ || (c.civs || []).includes(pool.civ)))
      .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'ja'));
    const count = {};
    if (current) for (const id of current.cards) count[id] = (count[id] || 0) + 1;
    $('#deck-pool').innerHTML = cards.map((c) => `<button class="pool-item" data-id="${esc(c.id)}" title="クリックでデッキに追加">
      ${UI.cardHTML(c, { small: true })}${count[c.id] ? `<span class="cnt">${count[c.id]}</span>` : ''}<span class="pool-name">${esc(c.name)}</span></button>`).join('');
  }

  function renderDeck() {
    const box = $('#deck-body');
    if (!current) { box.innerHTML = '<p class="empty">左の一覧からデッキを選ぶか、新しく作ってください。</p>'; return; }
    const { defs, errs } = deckSummary(current);
    const groups = {};
    for (const id of current.cards) groups[id] = (groups[id] || 0) + 1;
    const rows = Object.entries(groups).map(([id, n]) => ({ id, n, def: Library.card(id) }))
      .sort((a, b) => ((a.def && a.def.cost) || 0) - ((b.def && b.def.cost) || 0));
    // コストごとの枚数（グラフ）
    const curve = Array(9).fill(0);
    for (const d of defs) curve[Math.min(8, d.cost || 0)]++;
    const maxC = Math.max(1, ...curve);
    const civCount = {};
    for (const d of defs) for (const k of d.civs || []) civCount[k] = (civCount[k] || 0) + 1;
    const triggers = defs.filter((d) => TextParser.parse(d.text || '', d.type).keywords.shieldTrigger).length;
    box.innerHTML = `
      <div class="deck-head">
        <input id="deck-name" value="${esc(current.name)}" ${current.sample ? 'disabled' : ''} aria-label="デッキ名">
        <span class="deck-total ${current.cards.length === SimData.RULES.deckSize ? 'ok' : 'ng'}">${current.cards.length} / ${SimData.RULES.deckSize}枚</span>
      </div>
      ${current.sample ? '<p class="hint">見本デッキは編集できません。「コピー」で自分のデッキにできます。</p>' : ''}
      ${errs.length ? `<ul class="errs">${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : '<p class="ok">✓ このデッキで対戦できます</p>'}
      <div class="deck-stats">
        <div class="curve" title="コストごとの枚数">${curve.map((n, i) => `<div><i style="height:${(n / maxC) * 100}%"></i><span>${i === 8 ? '8+' : i}</span></div>`).join('')}</div>
        <div class="civmix">${Object.entries(civCount).map(([k, n]) => `<span>${UI.civDots([k])}${UI.civName(k)} ${n}</span>`).join('')}<span>S・トリガー ${triggers}</span></div>
      </div>
      <ul class="deck-rows">${rows.map((r) => `<li data-id="${esc(r.id)}" class="${r.def ? '' : 'missing'}">
        <span class="dr-cost">${r.def ? r.def.cost : '?'}</span>${r.def ? UI.civDots(r.def.civs) : ''}<span class="dr-name">${esc(r.def ? r.def.name : '（未登録のカード）')}</span>
        <span class="dr-n">×${r.n}</span>${current.sample ? '' : `<button class="btn tiny" data-act="minus" aria-label="1枚減らす">−</button><button class="btn tiny" data-act="plus" aria-label="1枚増やす">＋</button>`}</li>`).join('')}</ul>`;
    const nm = $('#deck-name');
    if (nm) nm.onchange = async () => { current.name = nm.value.trim() || '名前のないデッキ'; await Library.saveDeck(current); renderList(); };
  }

  function renderAll() { renderList(); renderPool(); renderDeck(); }

  async function addCard(id, delta) {
    if (!current || current.sample) { UI.toast(current ? '見本デッキは編集できません（コピーしてください）' : '先にデッキを選んでください', 'bad'); return; }
    if (delta > 0) {
      const def = Library.card(id);
      const same = current.cards.filter((x) => { const d = Library.card(x); return d && def && d.name === def.name; }).length;
      if (same >= SimData.RULES.maxCopies) return UI.toast(`同じ名前のカードは${SimData.RULES.maxCopies}枚までです`, 'bad');
      current.cards.push(id);
    } else {
      const i = current.cards.lastIndexOf(id);
      if (i >= 0) current.cards.splice(i, 1);
    }
    await Library.saveDeck(current);
    renderAll();
  }

  async function newDeck(name = '新しいデッキ', cards = []) {
    current = await Library.saveDeck({ name, cards });
    renderAll();
  }

  /** 読み取った「名前と枚数」を登録済みのカードと照らし合わせ、確認してからデッキにする */
  async function reviewImport(entries, defaultName) {
    const cards = Library.allCards();
    const rows = entries.map((e) => ({ name: e.name, count: e.count, match: Reader.matchCard(e.name, cards) }));
    const options = (sel) => `<option value="">（未登録・入れない）</option>` + cards.slice().sort((a, b) => a.name.localeCompare(b.name, 'ja'))
      .map((c) => `<option value="${esc(c.id)}" ${sel && sel.id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const unmatched = rows.filter((r) => !r.match).length;
    const html = `<label class="f">デッキ名<input id="imp-name" value="${esc(defaultName)}"></label>
      <p class="hint">読み取った名前に一番近い登録済みのカードを選んであります。違っていたら直してください。${unmatched ? `<br><b class="ng">${unmatched}件</b>は登録済みのカードに見つかりませんでした。先に「カード」画面で画像から登録すると、デッキに入れられます。` : ''}</p>
      <table class="imp-table"><thead><tr><th>読み取った名前</th><th>枚数</th><th>使うカード</th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr class="${r.match ? '' : 'ng'}"><td>${esc(r.name)}</td><td><input type="number" min="0" max="40" value="${r.count}" data-i="${i}" class="imp-n"></td><td><select data-i="${i}" class="imp-sel">${options(r.match)}</select></td></tr>`).join('')}
      </tbody></table><p class="hint" id="imp-total"></p>`;
    let name = defaultName;
    const ok = await UI.modal({
      title: '読み取り結果の確認', html, wide: true,
      buttons: [{ label: 'キャンセル', value: false }, { label: 'デッキを作る', value: true, cls: 'primary' }],
      onOpen(m) {
        const upd = () => {
          m.querySelectorAll('.imp-n').forEach((inp) => { rows[+inp.dataset.i].count = Number(inp.value) || 0; });
          m.querySelectorAll('.imp-sel').forEach((s) => { rows[+s.dataset.i].match = Library.card(s.value) || null; });
          name = $('#imp-name', m).value;
          const total = rows.filter((r) => r.match).reduce((n, r) => n + r.count, 0);
          $('#imp-total', m).textContent = `デッキに入る枚数：${total}枚`;
        };
        m.addEventListener('input', upd); m.addEventListener('change', upd); upd();
      },
    });
    if (!ok) return;
    const list = rows.filter((r) => r.match && r.count > 0).flatMap((r) => Array(r.count).fill(r.match.id));
    await newDeck(name.trim() || '読み込んだデッキ', list);
    UI.toast(`デッキを作りました（${list.length}枚）`, 'good');
  }

  async function importFromImage() {
    const st = Store.Settings.get();
    if (st.reader === 'claude' && !st.apiKey) {
      const r = await UI.modal({ title: 'API キーが未設定です', html: '<p>画像からデッキを読み取るには、設定画面で Claude の API キーを入力するか、「文字認識（OCR）」を選んでください。</p>', buttons: [{ label: '閉じる', value: null }, { label: '設定を開く', value: 'go', cls: 'primary' }] });
      if (r === 'go') UI.showScreen('settings');
      return;
    }
    const [f] = await UI.pickFiles('image/*');
    if (!f) return;
    const prog = document.createElement('div');
    prog.className = 'progress-pop'; prog.textContent = 'デッキの画像を読み取っています…';
    document.body.appendChild(prog);
    let entries;
    try { entries = await Reader.readDeck(await Reader.fileToDataURL(f)); }
    catch (e) { UI.toast('読み取りに失敗：' + e.message, 'bad'); return; }
    finally { prog.remove(); }
    if (!entries.length) return UI.toast('カード名が見つかりませんでした', 'bad');
    await reviewImport(entries, f.name.replace(/\.[^.]+$/, ''));
  }

  async function importFromText() {
    let text = '';
    const ok = await UI.modal({
      title: '文字からデッキを作る', wide: true,
      html: '<p class="hint">1行に1種類ずつ、「4 カード名」「カード名 ×4」「カード名 4枚」のように書いてください。</p><textarea id="imp-text" rows="12" style="width:100%" placeholder="4 白翼の見張り番アルバ&#10;天光の守護者セラフィナ ×4"></textarea>',
      buttons: [{ label: 'キャンセル', value: false }, { label: '次へ', value: true, cls: 'primary' }],
      onOpen(m) { const t = $('#imp-text', m); t.oninput = () => { text = t.value; }; t.focus(); },
    });
    if (!ok) return;
    const entries = Reader.parseDeckText(text);
    if (!entries.length) return UI.toast('カード名が見つかりませんでした', 'bad');
    await reviewImport(entries, '文字から作ったデッキ');
  }

  function init() {
    $('#deck-new').onclick = () => newDeck();
    $('#deck-from-image').onclick = importFromImage;
    $('#deck-from-text').onclick = importFromText;
    $('#deck-copy').onclick = async () => { if (!current) return; await newDeck(current.name.replace(/^見本：/, '') + '（コピー）', [...current.cards]); UI.toast('コピーしました'); };
    $('#deck-del').onclick = async () => {
      if (!current || current.sample) return UI.toast('見本デッキは削除できません', 'bad');
      if (!(await UI.confirmBox('デッキの削除', `「${current.name}」を削除しますか？`, '削除する', 'danger'))) return;
      await Library.deleteDeck(current.id); current = null; renderAll();
    };
    $('#deck-list').addEventListener('click', (e) => { const b = e.target.closest('.deck-item'); if (!b) return; current = Library.decks.get(b.dataset.id); renderAll(); });
    $('#deck-pool').addEventListener('click', (e) => { const b = e.target.closest('.pool-item'); if (b) addCard(b.dataset.id, +1); });
    $('#deck-pool').addEventListener('contextmenu', (e) => { const b = e.target.closest('.pool-item'); if (b) { e.preventDefault(); addCard(b.dataset.id, -1); } });
    $('#deck-body').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]');
      const li = e.target.closest('li[data-id]');
      if (b && li) addCard(li.dataset.id, b.dataset.act === 'plus' ? +1 : -1);
      else if (li) { const def = Library.card(li.dataset.id); if (def) UI.modal({ title: def.name, html: `<div class="detail">${UI.detailHTML(def)}</div>`, wide: true }); }
    });
    $('#deck-q').oninput = (e) => { pool.q = e.target.value; renderPool(); };
    $('#deck-civ').innerHTML = '<option value="">すべての文明</option>' + SimData.CIVS.map((c) => `<option value="${c.key}">${c.name}</option>`).join('');
    $('#deck-civ').onchange = (e) => { pool.civ = e.target.value; renderPool(); };
    UI.onScreen('decks', () => { if (current && !Library.decks.has(current.id)) current = null; renderAll(); });
  }

  root.DeckUI = { init, deckSummary };
})(typeof self !== 'undefined' ? self : this);
