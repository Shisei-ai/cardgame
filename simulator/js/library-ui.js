/*
 * library-ui.js — カード一覧・カードの登録と編集
 *
 * ・「画像から登録」… 画像（複数可）を選ぶと、reader.js で読み取り、1枚ずつ確認画面を出す
 * ・カード編集      … 名前・文明・コスト・パワー・種族・能力の文章を直せる。
 *                     能力の文章は入力するたびに textparser.js で読み直し、「対戦で動く効果」を右側に表示する
 */
(function (root) {
  'use strict';
  const { UI, Store, Reader, TextParser, SimData } = root;
  const { $, esc } = UI;
  const Library = Store.Library;

  const state = { q: '', civ: '', type: '', onlyNg: false };
  /** 対戦で動かない文の数（ツインパクトは呪文側も数える） */
  function ngCount(c) {
    let n = TextParser.parse(c.text || '', c.type).unparsed.length;
    if (c.spellSide && c.spellSide.name) n += TextParser.parse(c.spellSide.text || '', 'spell').unparsed.length;
    return n;
  }

  function render() {
    const el = $('#lib-grid');
    const q = state.q.trim();
    let cards = Library.allCards();
    cards = cards.filter((c) => {
      if (q && !(c.name.includes(q) || (c.text || '').includes(q) || (c.races || []).some((r) => r.includes(q)) || (c.spellSide && (c.spellSide.name || '').includes(q)))) return false;
      if (state.civ && !(c.civs || []).includes(state.civ)) return false;
      if (state.type && c.type !== state.type) return false;
      if (state.onlyNg && !ngCount(c)) return false;
      return true;
    });
    cards.sort((a, b) => (a.sample ? 1 : 0) - (b.sample ? 1 : 0) || (b.updatedAt || 0) - (a.updatedAt || 0) || a.cost - b.cost);
    const userCount = Library.allCards().filter((c) => !c.sample).length;
    $('#lib-count').textContent = `登録したカード ${userCount}種類 ／ 見本カード ${Library.allCards().length - userCount}種類`;
    el.innerHTML = cards.length ? cards.map((c) => {
      const ng = ngCount(c);
      return `<button class="lib-item" data-id="${esc(c.id)}">${UI.cardHTML(c)}
        <span class="lib-name">${ng ? '<b class="ng" title="対戦で動かない文があります">⚠</b>' : ''}${c.sample ? '<i class="tag">見本</i>' : ''}${esc(c.name)}</span></button>`;
    }).join('') : '<p class="empty">カードがありません。「画像から登録」でカードを追加しましょう。</p>';
  }

  // ───────────── カード編集 ─────────────
  /**
   * カード編集のダイアログを開く。
   * @param draft  カード（新規なら id なし）
   * @param opts   { queue: '2/5' のような進み具合 }
   * @returns 'saved' | 'skip' | 'deleted' | null
   */
  function openEditor(draft, opts = {}) {
    const card = JSON.parse(JSON.stringify(draft));
    if (!card.civs) card.civs = [];
    if (!card.races) card.races = [];
    const twin = card.spellSide && card.spellSide.name ? card.spellSide : null;
    const civChecks = SimData.CIVS.map((c) => `<label class="civ-check" style="--c:${c.color}"><input type="checkbox" value="${c.key}" ${card.civs.includes(c.key) ? 'checked' : ''}><span>${c.name}</span></label>`).join('');
    const twinCivChecks = SimData.CIVS.map((c) => `<label class="civ-check" style="--c:${c.color}"><input type="checkbox" value="${c.key}" ${twin && (twin.civs || []).includes(c.key) ? 'checked' : ''}><span>${c.name}</span></label>`).join('');
    const html = `<div class="editor">
      <div class="ed-left">
        <div class="ed-img" id="ed-img">${card.image ? `<img src="${card.image}" alt="">` : '<p class="hint">画像なし</p>'}</div>
        <div class="ed-img-btns">
          <button class="btn small" id="ed-pick">画像を選ぶ</button>
          <button class="btn small" id="ed-read" ${card.image ? '' : 'disabled'}>この画像から読み取る</button>
          <button class="btn small ghost" id="ed-noimg" ${card.image ? '' : 'disabled'}>画像を外す</button>
        </div>
        <p class="hint" id="ed-read-status"></p>
      </div>
      <div class="ed-form">
        <label class="f">名前<input id="ed-name" value="${esc(card.name || '')}" placeholder="カード名"></label>
        <div class="f-row">
          <label class="f">種類<select id="ed-type">${SimData.TYPES.map((t) => `<option value="${t.key}" ${card.type === t.key ? 'selected' : ''}>${t.name}</option>`).join('')}</select></label>
          <label class="f small">コスト<input id="ed-cost" type="number" min="0" max="99" value="${card.cost != null ? card.cost : ''}"></label>
          <label class="f small" id="ed-power-wrap">パワー<input id="ed-power" type="number" min="0" step="500" value="${card.power != null ? card.power : ''}"></label>
        </div>
        <div class="f">文明<div class="civ-checks" id="ed-civs">${civChecks}</div></div>
        <label class="f">種族（複数は「/」で区切る）<input id="ed-races" value="${esc((card.races || []).join(' / '))}"></label>
        <label class="f">能力の文章（1行に1つの能力。行頭の「■」はあってもなくてもよい）
          <textarea id="ed-text" rows="7" placeholder="■ブロッカー&#10;■このクリーチャーが出た時、カードを1枚引く。">${esc(card.text || '')}</textarea></label>
        <div class="ed-parse" id="ed-parse"></div>
        <label class="chk ed-twin-toggle"><input type="checkbox" id="ed-twin" ${twin ? 'checked' : ''}> ツインパクト（このカードに呪文側もある）</label>
        <div class="ed-twin" id="ed-twin-box" ${twin ? '' : 'hidden'}>
          <div class="f-row">
            <label class="f">呪文側の名前<input id="ed-tw-name" value="${esc(twin ? twin.name : '')}"></label>
            <label class="f small">呪文側のコスト<input id="ed-tw-cost" type="number" min="0" max="99" value="${twin && twin.cost != null ? twin.cost : ''}"></label>
          </div>
          <div class="f">呪文側の文明（空ならクリーチャー側と同じ）<div class="civ-checks" id="ed-tw-civs">${twinCivChecks}</div></div>
          <label class="f">呪文側の能力の文章<textarea id="ed-tw-text" rows="4">${esc(twin ? twin.text : '')}</textarea></label>
          <div class="ed-parse" id="ed-tw-parse"></div>
        </div>
        <details class="ed-help"><summary>対応している言い回しの例</summary><ul>${TextParser.EXAMPLES.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
          <p class="hint">赤い行は「対戦で動かない文」です。上の例に近い言い回しに書き換えると動くようになります（カードの意味が変わらない範囲で）。</p></details>
      </div>
    </div>
    <div class="ed-btns">
      ${opts.queue ? `<span class="queue">確認 ${esc(opts.queue)}</span><button class="btn ghost" data-act="skip">登録しない</button>` : '<button class="btn ghost" data-act="cancel">キャンセル</button>'}
      ${card.id && !card.sample ? '<button class="btn danger" data-act="delete">削除</button>' : ''}
      <button class="btn primary" data-act="save">${opts.queue ? '登録して次へ' : '保存'}</button>
    </div>`;

    return UI.modal({
      title: card.id ? 'カードの編集' : 'カードの登録', html, wide: true, buttons: [], dismissable: false,
      onOpen(m, close) {
        const read = () => {
          card.name = $('#ed-name', m).value.trim();
          card.type = $('#ed-type', m).value;
          card.cost = $('#ed-cost', m).value === '' ? null : Number($('#ed-cost', m).value);
          card.power = card.type === 'spell' || card.type === 'tamaseed' || $('#ed-power', m).value === '' ? null : Number($('#ed-power', m).value);
          card.civs = [...m.querySelectorAll('#ed-civs input:checked')].map((i) => i.value);
          card.races = $('#ed-races', m).value.split(/[\/／、,]/).map((s) => s.trim()).filter(Boolean);
          card.text = $('#ed-text', m).value;
          if ($('#ed-twin', m).checked) {
            card.spellSide = {
              name: $('#ed-tw-name', m).value.trim(),
              cost: $('#ed-tw-cost', m).value === '' ? null : Number($('#ed-tw-cost', m).value),
              civs: [...m.querySelectorAll('#ed-tw-civs input:checked')].map((i) => i.value),
              text: $('#ed-tw-text', m).value,
            };
          } else delete card.spellSide;
        };
        const fill = (c) => {
          $('#ed-name', m).value = c.name || '';
          $('#ed-type', m).value = c.type || 'creature';
          $('#ed-cost', m).value = c.cost != null ? c.cost : '';
          $('#ed-power', m).value = c.power != null ? c.power : '';
          m.querySelectorAll('#ed-civs input').forEach((i) => { i.checked = (c.civs || []).includes(i.value); });
          $('#ed-races', m).value = (c.races || []).join(' / ');
          $('#ed-text', m).value = c.text || '';
          const tw = c.spellSide && c.spellSide.name ? c.spellSide : null;
          $('#ed-twin', m).checked = !!tw;
          $('#ed-tw-name', m).value = tw ? tw.name : '';
          $('#ed-tw-cost', m).value = tw && tw.cost != null ? tw.cost : '';
          m.querySelectorAll('#ed-tw-civs input').forEach((i) => { i.checked = !!tw && (tw.civs || []).includes(i.value); });
          $('#ed-tw-text', m).value = tw ? tw.text || '' : '';
          refresh();
        };
        const refresh = () => {
          read();
          $('#ed-power-wrap', m).style.visibility = card.type === 'spell' || card.type === 'tamaseed' ? 'hidden' : '';
          const show = (box, text, type) => {
            const ab = TextParser.parse(text || '', type);
            const ok = TextParser.describe(ab);
            box.innerHTML = `<h4>対戦で動く効果</h4>
              ${ok.length ? `<ul class="ab-list">${ok.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="hint">（なし）</p>'}
              ${ab.unparsed.length ? `<h4 class="ng">対戦で動かない文</h4><ul class="ab-list ng">${ab.unparsed.map((l) => `<li>⚠ ${esc(l)}</li>`).join('')}</ul>` : ''}`;
          };
          show($('#ed-parse', m), card.text, card.type);
          $('#ed-twin-box', m).hidden = !$('#ed-twin', m).checked;
          if (card.spellSide) show($('#ed-tw-parse', m), card.spellSide.text, 'spell');
        };
        const setImage = (url) => {
          card.image = url;
          $('#ed-img', m).innerHTML = url ? `<img src="${url}" alt="">` : '<p class="hint">画像なし</p>';
          $('#ed-read', m).disabled = !url;
          $('#ed-noimg', m).disabled = !url;
        };
        m.addEventListener('input', refresh);
        m.addEventListener('change', refresh);
        refresh();
        $('#ed-pick', m).onclick = async () => {
          const [f] = await UI.pickFiles('image/*');
          if (!f) return;
          const url = await Reader.fileToDataURL(f);
          card._fullImage = url;
          setImage(await Reader.resize(url, 480));
        };
        $('#ed-noimg', m).onclick = () => setImage(null);
        $('#ed-read', m).onclick = async () => {
          const st = $('#ed-read-status', m);
          st.textContent = '読み取り中…';
          try {
            const res = await Reader.readCards(card._fullImage || card.image, (p) => { st.textContent = `文字を認識中… ${Math.round(p * 100)}%`; });
            if (!res.length) { st.textContent = 'カードが見つかりませんでした'; return; }
            const r = res[0];
            fill(Object.assign({}, card, r, { image: card.image }));
            st.textContent = res.length > 1 ? `${res.length}枚写っていたので、1枚目を入れました` : '読み取りました。内容を確認してください';
          } catch (e) { st.textContent = '読み取りに失敗：' + e.message; }
        };
        m.querySelector('.ed-btns').addEventListener('click', async (e) => {
          const b = e.target.closest('button[data-act]');
          if (!b) return;
          const act = b.dataset.act;
          if (act === 'cancel') return close(null);
          if (act === 'skip') return close('skip');
          if (act === 'delete') {
            if (!(await UI.confirmBox('カードの削除', `「${card.name}」を削除しますか？（このカードを入れたデッキからも外れます）`, '削除する', 'danger'))) return;
            await Library.deleteCard(card.id);
            for (const d of Library.allDecks()) if (!d.sample && d.cards.includes(card.id)) { d.cards = d.cards.filter((x) => x !== card.id); await Library.saveDeck(d); }
            UI.toast('削除しました');
            return close('deleted');
          }
          read();
          if (!card.name) return UI.toast('名前を入力してください', 'bad');
          if (card.cost == null || Number.isNaN(card.cost)) return UI.toast('コストを入力してください', 'bad');
          if (card.type === 'tamaseed') card.power = null;
          else if (card.type !== 'spell' && (card.power == null || Number.isNaN(card.power))) return UI.toast('パワーを入力してください', 'bad');
          if (card.spellSide) {
            if (card.type === 'spell') delete card.spellSide;
            else if (!card.spellSide.name) return UI.toast('ツインパクトの呪文側の名前を入力してください', 'bad');
            else if (card.spellSide.cost == null || Number.isNaN(card.spellSide.cost)) return UI.toast('呪文側のコストを入力してください', 'bad');
          }
          if (!card.civs.length) return UI.toast('文明を1つ以上選んでください', 'bad');
          delete card._fullImage; delete card.ocrRaw; delete card.sample;
          await Library.saveCard(card);
          UI.toast(`「${card.name}」を保存しました`, 'good');
          close('saved');
        });
      },
    });
  }

  // ───────────── 画像から登録 ─────────────
  async function importFromImages() {
    const files = await UI.pickFiles('image/*', true);
    if (!files.length) return;
    const st = Store.Settings.get();
    if (st.reader === 'claude' && !st.apiKey) {
      const go = await UI.modal({
        title: 'API キーが未設定です',
        html: '<p>Claude で読み取るには、設定画面で API キーを入力してください。<br>キーなしで続けると、画像だけ入った状態で編集画面を開くので、手で入力できます（または設定で「文字認識（OCR）」を選ぶと無料で読み取れます）。</p>',
        buttons: [{ label: '設定を開く', value: 'settings' }, { label: '手で入力する', value: 'manual', cls: 'primary' }],
      });
      if (go === 'settings') return UI.showScreen('settings');
      if (go !== 'manual') return;
    }
    const drafts = [];
    const prog = document.createElement('div');
    prog.className = 'progress-pop';
    document.body.appendChild(prog);
    try {
      for (let i = 0; i < files.length; i++) {
        prog.textContent = `画像を読み取っています… ${i + 1} / ${files.length}`;
        const url = await Reader.fileToDataURL(files[i]);
        if (st.reader === 'claude' && !st.apiKey) { drafts.push({ name: '', type: 'creature', civs: [], races: [], text: '', image: await Reader.resize(url, 480), _fullImage: url }); continue; }
        try {
          const cards = await Reader.readCards(url, (p) => { prog.textContent = `文字を認識中… ${i + 1} / ${files.length}（${Math.round(p * 100)}%）`; });
          if (!cards.length) UI.toast(`${files[i].name}：カードが見つかりませんでした`, 'bad');
          for (const c of cards) drafts.push(Object.assign(c, { _fullImage: cards.length === 1 ? url : null }));
        } catch (e) {
          UI.toast(`${files[i].name}：${e.message}`, 'bad');
          drafts.push({ name: '', type: 'creature', civs: [], races: [], text: '', image: await Reader.resize(url, 480), _fullImage: url });
        }
      }
    } finally { prog.remove(); }
    let saved = 0;
    for (let i = 0; i < drafts.length; i++) {
      const r = await openEditor(drafts[i], { queue: `${i + 1} / ${drafts.length}` });
      if (r === 'saved') saved++;
      if (r === null) break;
    }
    if (saved) UI.toast(`${saved}枚のカードを登録しました`, 'good');
    render();
  }

  async function exportLibrary() {
    const data = Library.exportData();
    UI.download(`duel-sim-library-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data));
    UI.toast(`カード${data.cards.length}種類・デッキ${data.decks.length}個を書き出しました`);
  }
  async function importLibrary() {
    const [f] = await UI.pickFiles('application/json,.json');
    if (!f) return;
    try {
      const r = await Library.importData(JSON.parse(await f.text()));
      UI.toast(`カード${r.cards}種類・デッキ${r.decks}個を読み込みました`, 'good');
      render();
    } catch (e) { UI.toast('読み込めませんでした：' + e.message, 'bad'); }
  }

  function init() {
    $('#lib-import').onclick = importFromImages;
    $('#lib-new').onclick = async () => { await openEditor({ name: '', type: 'creature', civs: [], races: [], text: '', cost: null, power: null }); render(); };
    $('#lib-export').onclick = exportLibrary;
    $('#lib-load').onclick = importLibrary;
    $('#lib-q').oninput = (e) => { state.q = e.target.value; render(); };
    $('#lib-civ').innerHTML = '<option value="">すべての文明</option>' + SimData.CIVS.map((c) => `<option value="${c.key}">${c.name}</option>`).join('');
    $('#lib-civ').onchange = (e) => { state.civ = e.target.value; render(); };
    $('#lib-type').innerHTML = '<option value="">すべての種類</option>' + SimData.TYPES.map((t) => `<option value="${t.key}">${t.name}</option>`).join('');
    $('#lib-type').onchange = (e) => { state.type = e.target.value; render(); };
    $('#lib-ng').onchange = (e) => { state.onlyNg = e.target.checked; render(); };
    $('#lib-grid').addEventListener('click', async (e) => {
      const b = e.target.closest('.lib-item');
      if (!b) return;
      const c = Library.card(b.dataset.id);
      if (c.sample) {
        const r = await UI.modal({ title: '見本カード', html: `<div class="detail">${UI.detailHTML(c)}</div><p class="hint">見本カードは編集できません。コピーを作ると、自分のカードとして編集できます。</p>`, wide: true, buttons: [{ label: '閉じる', value: null }, { label: 'コピーして編集', value: 'copy', cls: 'primary' }] });
        if (r === 'copy') { const copy = Object.assign({}, c, { id: null, sample: false, name: c.name + '（コピー）' }); delete copy.id; await openEditor(copy); }
      } else await openEditor(c);
      render();
    });
    UI.onScreen('library', render);
  }

  root.LibraryUI = { init, render, openEditor, importFromImages };
})(typeof self !== 'undefined' ? self : this);
