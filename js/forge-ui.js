/*
 * forge-ui.js — カード工房（オリジナルカードの作成）
 *
 * 流れ：
 *   1. 「原石を引く」で素質（容量の倍率）がランダムに決まる。引き直しはできない（気に入らなければ作らずに新しく引く）
 *   2. 名前・アイコン・色・種類・コストを決める（コストが高いほど容量が大きい）
 *   3. パワー・キーワード効果・テキスト効果を、容量のメーターを見ながら選ぶ
 *   4. 容量に収まっていれば「工房に保存」。保存したカードはデッキ構築で使える
 * 保存したカードは、素質はそのままで作り直せる。カードコードで友達と交換もできる。
 */
(function (root) {
  'use strict';
  const { Parts, Store, UI } = root;
  const { $, esc } = UI;

  const ICONS = ['🐺', '🦊', '🦉', '🐍', '🦂', '🐙', '🦇', '🐲', '🦄', '🦅', '🐢', '🦈', '🐗', '🦁', '🐻', '🦌', '🕷️', '🦋', '👻', '💀', '🤖', '🧙', '🧝', '🧛', '🧞', '🧜', '🥷', '🛡️', '⚔️', '🏹', '🔮', '📜', '🗝️', '💎', '🔥', '❄️', '⚡', '🌊', '🌪️', '🌋', '🌙', '☀️', '⭐', '🍄', '🌵', '🌹', '🍎', '🎭', '⚙️', '🪄'];
  const COLORS = ['#5f8f4e', '#5b6fb5', '#b5523f', '#8a5ab8', '#c9952b', '#3f9aa3', '#8a8f98', '#b85a8a'];

  const F = { draft: null, editing: false };

  const blankEffect = (kind) => Parts.normalizeEffect({ kind }, { trig: kind === 'spell' ? 'cast' : 'summon', act: 'draw', n: 1, conds: [], pay: { k: 'none', n: 0 }, per: 'none' });

  function newDraft(grade) {
    return { name: '', icon: ICONS[Math.floor(Math.random() * ICONS.length)], color: COLORS[0], kind: 'creature', cost: 3, grade, power: 1000, keywords: [], effects: [] };
  }

  // ───────────── 作ったカードの一覧 ─────────────
  function renderList() {
    const list = Store.cards();
    $('#forge-count').textContent = `${list.length}枚`;
    const box = $('#forge-list');
    box.innerHTML = list.length ? '' : '<p class="hint">まだありません。右の「原石を引く」から作りましょう。</p>';
    for (const c of list.slice().reverse()) {
      const row = document.createElement('div');
      const bad = Parts.validate(c).length > 0;
      row.className = 'mini' + (F.draft && F.draft.id === c.id ? ' on' : '') + (bad ? ' bad' : '');
      if (bad) row.title = '規則の変更で容量に収まらなくなりました。作り直してください（このままでも対戦には使えます）';
      const g = Parts.GRADES[c.grade];
      row.innerHTML = `<span class="mi-cost">${c.cost}</span><span class="mi-icon">${esc(c.icon)}</span><span class="mi-name">${esc(c.name)}</span><span class="mi-grade" style="color:${g.color}">${g.label}</span>
        <span class="mi-acts"><button data-a="edit" title="作り直す">✎</button><button data-a="code" title="カードコード">⧉</button><button data-a="del" title="捨てる">✕</button></span>`;
      UI.bindSpec(row, c);
      row.onclick = (e) => {
        const a = e.target.dataset.a;
        if (a === 'del') {
          UI.modal('カードを捨てる', `<p>【${esc(c.name)}】を捨てますか？ 元には戻せません。<br>このカードを入れたデッキからも外れます。</p>`, [
            { label: 'やめる', onClick: UI.closeModal },
            { label: '捨てる', danger: true, onClick: () => { Store.deleteCard(c.id); if (F.draft && F.draft.id === c.id) F.draft = null; UI.closeModal(); render(); } },
          ]);
        } else if (a === 'code') {
          const code = Parts.toCode(c);
          UI.modal('カードコード', `<p>この文字列を友達に送ると、同じカードを工房に読み込めます。</p><textarea class="code" readonly>${esc(code)}</textarea>`, [
            { label: 'コピー', primary: true, onClick: () => { copy(code); UI.toast('コピーしました'); } },
            { label: '閉じる', onClick: UI.closeModal },
          ]);
          const ta = $('#modal textarea'); if (ta) ta.select();
        } else {
          F.draft = JSON.parse(JSON.stringify(c));
          F.editing = true;
          render();
        }
      };
      box.appendChild(row);
    }
  }

  function copy(text) {
    try { navigator.clipboard.writeText(text); } catch (e) { /* 何もしない */ }
    const ta = $('#modal textarea'); if (ta) { ta.select(); try { document.execCommand('copy'); } catch (e) { /* 何もしない */ } }
  }

  function importCode() {
    UI.modal('カードコードを読み込む', '<p>友達からもらったカードコードを貼り付けてください。</p><textarea class="code" id="code-in" placeholder="AF1.…"></textarea>', [
      { label: 'やめる', onClick: UI.closeModal },
      { label: '読み込む', primary: true, onClick: () => {
        const r = Parts.fromCode($('#code-in').value);
        if (r.error) { UI.toast(r.error, 2500); return; }
        Store.saveCard(r.spec);
        UI.closeModal();
        UI.toast(`【${r.spec.name}】を工房に加えました`);
        render();
      } },
    ]);
  }

  // ───────────── 作成画面 ─────────────
  function renderMain() {
    const m = $('#forge-main');
    if (!F.draft) {
      const rows = Object.values(Parts.GRADES).map((g) => `<tr><td style="color:${g.color}">${g.label}</td><td>×${g.mult}</td><td>${g.weight}%</td></tr>`).join('');
      m.innerHTML = `
        <div class="roll">
          <div class="ore">💠</div>
          <h3>原石を引く</h3>
          <p>カードの元になる「原石」を引きます。原石の<b>素質</b>で、カードの<b>容量</b>（強さの上限）の倍率が決まります。</p>
          <table class="grade-table"><tr><th>素質</th><th>容量</th><th>出やすさ</th></tr>${rows}</table>
          <p class="hint">容量 ＝（${Parts.CAP.BASE} ＋ ${Parts.CAP.PER_COST} × コスト）× 素質の倍率。引き直しはできません。</p>
          <button class="btn primary big" id="btn-roll">原石を引く</button>
        </div>`;
      $('#btn-roll').onclick = roll;
      return;
    }
    const d = F.draft;
    const g = Parts.GRADES[d.grade];
    const opt = Parts.optionsFor(d.kind);
    const cap = Parts.capacity(d.cost, d.grade);
    const u = Parts.usage(d);
    m.innerHTML = `
      <div class="f-sec f-basic">
        <div class="f-grade" style="--gc:${g.color}">素質 <b>${g.label}</b><small>容量×${g.mult}</small></div>
        <label class="f-name">名前 <input id="f-name" maxlength="12" value="${esc(d.name)}" placeholder="カードの名前"></label>
        <button class="f-iconbtn" id="f-icon" title="アイコンを選ぶ">${esc(d.icon)}</button>
        <div class="f-colors">${COLORS.map((c) => `<i data-c="${c}" class="${c === d.color ? 'on' : ''}" style="background:${c}"></i>`).join('')}</div>
      </div>
      <div class="f-sec f-row2">
        <div class="seg" id="f-kind"><button data-k="creature" class="${d.kind === 'creature' ? 'on' : ''}">クリーチャー</button><button data-k="spell" class="${d.kind === 'spell' ? 'on' : ''}">呪文</button></div>
        <label class="f-slider">コスト <b>${d.cost}</b><input type="range" id="f-cost" min="${Parts.COST_MIN}" max="${Parts.COST_MAX}" value="${d.cost}"><span class="f-cap">容量 ${cap}</span></label>
      </div>
      ${d.kind === 'creature' ? `
      <div class="f-sec">
        <label class="f-slider">パワー <b>${d.power}</b><input type="range" id="f-power" min="${Parts.POWER_MIN}" max="${Parts.POWER_MAX}" step="${Parts.POWER_STEP}" value="${d.power}"><span class="f-pts">${Math.round(u.power)}pt</span></label>
      </div>
      <div class="f-sec">
        <h4>キーワード効果 <small>${d.keywords.length} / ${Parts.MAX_KEYWORDS}</small></h4>
        <div class="kw-chips">${opt.keywords.map((k) => `<button data-kw="${k.id}" class="${d.keywords.includes(k.id) ? 'on' : ''}${k.pts < 0 ? ' minus' : ''}" title="${esc(k.desc)}">${k.label}<small>${k.pts > 0 ? k.pts : '+' + -k.pts}</small></button>`).join('')}</div>
      </div>` : ''}
      <div class="f-sec">
        <h4>テキスト効果 <small>${d.effects.length} / ${Parts.MAX_EFFECTS}</small></h4>
        <div id="f-effects"></div>
        ${d.effects.length < Parts.MAX_EFFECTS ? '<button class="btn small" id="f-add">＋ テキスト効果を追加</button>' : ''}
      </div>`;
    const effBox = $('#f-effects');
    d.effects.forEach((e, i) => effBox.appendChild(effectEditor(d, e, i)));

    $('#f-name').oninput = (ev) => { d.name = ev.target.value; renderSide(); };
    $('#f-icon').onclick = pickIcon;
    m.querySelectorAll('.f-colors i').forEach((el) => { el.onclick = () => { d.color = el.dataset.c; render(); }; });
    m.querySelectorAll('#f-kind button').forEach((b) => {
      b.onclick = () => {
        if (d.kind === b.dataset.k) return;
        d.kind = b.dataset.k;
        d.keywords = [];
        d.effects = d.kind === 'spell' ? [blankEffect('spell')] : [];
        if (d.kind === 'spell') delete d.power; else d.power = 1000;
        render();
      };
    });
    $('#f-cost').oninput = (ev) => { d.cost = Number(ev.target.value); render(); };
    const pw = $('#f-power');
    if (pw) pw.oninput = (ev) => { d.power = Number(ev.target.value); render(); };
    m.querySelectorAll('.kw-chips button').forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.kw;
        const i = d.keywords.indexOf(k);
        if (i >= 0) d.keywords.splice(i, 1);
        else if (d.keywords.length < Parts.MAX_KEYWORDS) d.keywords.push(k);
        else UI.toast(`キーワード効果は${Parts.MAX_KEYWORDS}つまで`);
        render();
      };
    });
    const add = $('#f-add');
    if (add) add.onclick = () => {
      const e = blankEffect(d.kind);
      if (d.kind === 'spell' && d.effects.length) e.trig = d.effects[0].trig;
      d.effects.push(e);
      render();
    };
  }

  /** 量の表示 */
  function amountLabel(act, n) {
    if (['searchCreature', 'searchSpell', 'reanimate', 'cheatHand'].includes(act)) return n >= 99 ? 'コスト制限なし' : `コスト${n}以下`;
    if (['draw', 'loot', 'discardSelf', 'oppDiscard', 'oppDiscardPick', 'regrow', 'regrowAny', 'millSelf', 'millOpp'].includes(act)) return `${n}枚`;
    if (act === 'lookTop') return `上から${n}枚`;
    if (act === 'token') return `${n}体`;
    if (['emberGain', 'emberBurn'].includes(act)) return `${n}つ`;
    return String(n);
  }
  const condLabel = (k, n) => (Parts.CONDS[k].label.includes('◯') ? Parts.CONDS[k].label.replace('◯', n) : Parts.CONDS[k].label);
  const costLabel = (k, n) => (Parts.COSTS[k].label.includes('◯') ? Parts.COSTS[k].label.replace('◯', n) : Parts.COSTS[k].label);

  /** <select> を作る。items は [{ id, label, grp }]（grp があれば optgroup にまとめる） */
  function sel(key, items, cur, opts = {}) {
    let html = '';
    let grp = null;
    for (const x of items) {
      if (x.grp !== grp) { if (grp != null) html += '</optgroup>'; grp = x.grp; if (grp != null) html += `<optgroup label="${esc(grp)}">`; }
      html += `<option value="${esc(String(x.id))}"${String(x.id) === String(cur) ? ' selected' : ''}>${esc(x.label)}</option>`;
    }
    if (grp != null) html += '</optgroup>';
    return `<select data-k="${key}"${opts.disabled ? ' disabled' : ''}>${html}</select>`;
  }
  const field = (label, html, cls = '') => `<label class="ef ${cls}"><span>${label}</span>${html}</label>`;

  /** テキスト効果1つの編集欄 */
  function effectEditor(d, e, i) {
    Parts.normalizeEffect(d, e);
    const t = Parts.TRIGGERS[e.trig];
    const a = Parts.ACTIONS[e.act];
    const opt = Parts.optionsFor(d.kind);
    const lockTrig = d.kind === 'spell' && i > 0;
    const box = document.createElement('div');
    box.className = 'eff';
    const pts = Parts.effectPoints(e);

    // ① 発動
    let row1 = field('発動の場面', sel('trig', opt.triggers.map((x) => ({ id: x.id, label: x.label, grp: x.grp })), e.trig, { disabled: lockTrig }), 'wide');
    if (t.rep && !t.static) row1 += field('回数', sel('lim', Object.entries(Parts.LIMITS).map(([k, v]) => ({ id: k, label: v.label })), e.lim));
    if (t.activated) {
      row1 += field('起動のコスト', sel('payk', opt.costs.map((c) => ({ id: c.id, label: c.id === 'none' ? 'なし（タップだけ）' : c.label })), e.pay.k));
      if (Parts.COSTS[e.pay.k].ns.length > 1) row1 += field('コストの量', sel('payn', Parts.COSTS[e.pay.k].ns.map((n) => ({ id: n, label: costLabel(e.pay.k, n) })), e.pay.n));
      if (e.pay.k !== 'tapSelf' && d.kind === 'creature') row1 += `<label class="ef chk"><input type="checkbox" data-k="tapToo"${e.tapToo ? ' checked' : ''}><span>タップも必要</span></label>`;
    }
    // ② 条件と代償
    let row2 = '';
    if (!t.static) {
      for (let c = 0; c < Parts.MAX_CONDS; c++) {
        const cd = e.conds[c];
        if (c > 0 && !e.conds[c - 1]) break;
        row2 += field(`条件${c + 1}`, sel(`cond${c}`, [{ id: 'none', label: 'なし' }].concat(opt.conds.map((x) => ({ id: x.id, label: x.label.replace('◯', '○') }))), cd ? cd.k : 'none'));
        if (cd && Parts.CONDS[cd.k].ns.length > 1) row2 += field('値', sel(`condn${c}`, Parts.CONDS[cd.k].ns.map((n) => ({ id: n, label: condLabel(cd.k, n) })), cd.n));
      }
      if (!t.activated) {
        row2 += field('代償（〜してもよい）', sel('payk', opt.costs.map((c) => ({ id: c.id, label: c.label.replace('◯', '○') })), e.pay.k));
        if (Parts.COSTS[e.pay.k].ns.length > 1) row2 += field('代償の量', sel('payn', Parts.COSTS[e.pay.k].ns.map((n) => ({ id: n, label: costLabel(e.pay.k, n) })), e.pay.n));
      }
    }
    // ③ 効果
    const acts = Parts.actionsFor(d, e.trig).map((k) => ({ id: k, label: Parts.ACTIONS[k].label + (Parts.ACTIONS[k].minCost ? `【メタ・コスト${Parts.ACTIONS[k].minCost}以上】` : ''), grp: Parts.ACTIONS[k].cat }));
    let row3 = field('効果', sel('act', acts, e.act), 'wide');
    if (a.ns && a.ns.length > 1) row3 += field('量', sel('n', a.ns.map((n) => ({ id: n, label: amountLabel(e.act, n) })), e.n));
    if (e.act === 'token') {
      row3 += field('トークンのパワー', sel('tp', [500, 1000, 1500, 2000, 3000].map((n) => ({ id: n, label: String(n) })), e.tp));
      row3 += field('トークンのキーワード', sel('kw', [{ id: '', label: 'なし' }].concat(Object.entries(Parts.KEYWORDS).filter(([, k]) => k.pts > 0).map(([id, k]) => ({ id, label: k.label }))), e.kw || ''));
    }
    if (e.act === 'grantKw') row3 += field('与えるキーワード', sel('kw', Object.entries(Parts.KEYWORDS).filter(([, k]) => k.pts > 0).map(([id, k]) => ({ id, label: k.label })), e.kw));
    if (a.dur && !t.static) row3 += field('期間', sel('dur', Object.entries(Parts.DURATIONS).filter(([k]) => !a.durs || a.durs.includes(k)).map(([k, v]) => ({ id: k, label: v.label })), e.dur));
    if (a.per) row3 += field('〜につき（倍化）', sel('per', Object.entries(Parts.PERS).filter(([, v]) => !v.kind || v.kind === d.kind).map(([k, v]) => ({ id: k, label: v.label })), e.per));
    // ④ 対象
    let row4 = '';
    if (Parts.unitAction(a)) {
      const tg = e.tgt;
      row4 += field('誰を', sel('who', Parts.whosFor(d, e).map((w) => ({ id: w.id, label: w.label })), tg.who));
      if (!Parts.WHO[tg.who].self) {
        const counts = Object.keys(Parts.COUNTS).filter((k) => (!a.counts || a.counts.includes(k)) && (!t.static || k === 'all'));
        row4 += field('何体', sel('count', counts.map((k) => ({ id: k, label: Parts.COUNTS[k].label })), tg.count));
        if (tg.count !== 'all') row4 += field('どう選ぶ', sel('how', Object.entries(Parts.HOWS).map(([k, v]) => ({ id: k, label: v.label })), tg.how));
        const fs = Object.entries(Parts.FILTERS).filter(([k]) => !t.static || !['powerLE', 'powerGE'].includes(k));
        row4 += field('絞り込み', sel('f', fs.map(([k, v]) => ({ id: k, label: v.label.replace('◯', '○') })), tg.f));
        const F2 = Parts.FILTERS[tg.f];
        if (F2.ns.length > 1) row4 += field('絞り込みの値', sel('fn', F2.ns.map((n) => ({ id: n, label: tg.f === 'hasKw' ? Parts.KEYWORDS[n].label : F2.label.replace('◯', n) })), tg.fn));
      }
    }
    box.innerHTML = `
      <div class="eff-head"><b>効果${i + 1}</b><span class="eff-pts">${pts < 0 ? `容量 +${-pts}（デメリット）` : `${pts}pt`}</span><button class="eff-del" title="この効果を外す">✕</button></div>
      <div class="eff-rows">
        <div class="eff-row"><i class="eff-tag">発動</i>${row1}</div>
        ${row2 ? `<div class="eff-row"><i class="eff-tag">条件</i>${row2}</div>` : ''}
        <div class="eff-row"><i class="eff-tag">効果</i>${row3}</div>
        ${row4 ? `<div class="eff-row"><i class="eff-tag">対象</i>${row4}</div>` : ''}
      </div>
      <p class="eff-text">${esc(Parts.effectText(d, e))}</p>
      ${Parts.effectErrors(d, e).map((m) => `<p class="eff-err">⚠ ${esc(m)}</p>`).join('')}`;

    const num = (v) => (v === '' ? '' : isNaN(Number(v)) ? v : Number(v));
    box.querySelectorAll('select, input[type=checkbox]').forEach((el) => {
      el.onchange = () => {
        const k = el.dataset.k;
        const v = el.type === 'checkbox' ? el.checked : num(el.value);
        if (k === 'trig') { e.trig = v; if (d.kind === 'spell') d.effects.forEach((x) => { x.trig = v; Parts.normalizeEffect(d, x); }); }
        else if (k === 'payk') e.pay = { k: v, n: Parts.COSTS[v].ns[0] };
        else if (k === 'payn') e.pay.n = v;
        else if (/^cond\d$/.test(k)) { const c = Number(k[4]); if (v === 'none') e.conds.splice(c); else e.conds[c] = { k: v, n: Parts.CONDS[v].ns[0] }; }
        else if (/^condn\d$/.test(k)) e.conds[Number(k[5])].n = v;
        else if (['who', 'count', 'how', 'f', 'fn'].includes(k)) { e.tgt[k] = k === 'count' && v !== 'all' ? Number(v) : v; if (k === 'f') e.tgt.fn = Parts.FILTERS[v].ns[0]; }
        else if (k === 'kw') { if (v) e.kw = v; else delete e.kw; }
        else e[k] = v;
        Parts.normalizeEffect(d, e);
        render();
      };
    });
    box.querySelector('.eff-del').onclick = () => {
      if (d.kind === 'spell' && d.effects.length === 1) { UI.toast('呪文にはテキスト効果が1つ以上必要'); return; }
      d.effects.splice(i, 1);
      render();
    };
    return box;
  }

  function pickIcon() {
    const m = UI.modal('アイコンを選ぶ', `<div class="icon-grid">${ICONS.map((ic) => `<button>${ic}</button>`).join('')}</div><label class="hint">好きな絵文字を入力することもできます <input id="icon-free" maxlength="4"></label>`, [
      { label: '閉じる', onClick: UI.closeModal },
    ]);
    m.querySelectorAll('.icon-grid button').forEach((b) => { b.onclick = () => { F.draft.icon = b.textContent; UI.closeModal(); render(); }; });
    $('#icon-free').onchange = (e) => { if (e.target.value.trim()) { F.draft.icon = e.target.value.trim(); UI.closeModal(); render(); } };
  }

  // ───────────── 右側：見本・容量のメーター・保存 ─────────────
  function renderSide() {
    const prev = $('#forge-preview'), meter = $('#forge-meter'), errs = $('#forge-errors');
    prev.innerHTML = ''; meter.innerHTML = ''; errs.innerHTML = '';
    $('#forge-save').disabled = !F.draft;
    if (!F.draft) { prev.innerHTML = '<div class="card-ghost">？</div>'; return; }
    const d = F.draft;
    const shown = { ...d, name: d.name || '（名前）' };
    prev.appendChild(UI.cardEl(shown));
    const cap = Parts.capacity(d.cost, d.grade);
    const u = Parts.usage(d);
    const seg = (v, cls, label) => (v > 0 ? `<i class="${cls}" style="width:${Math.min(100, (v / Math.max(cap, u.total)) * 100)}%" title="${label} ${Math.round(v)}"></i>` : '');
    const effTotal = u.effects.reduce((s, x) => s + x, 0);
    const over = u.total > cap;
    meter.innerHTML = `
      <div class="m-label"><span>容量</span><b class="${over ? 'over' : ''}">${u.total} / ${cap}</b></div>
      <div class="m-bar${over ? ' over' : ''}">${seg(u.power, 'p', 'パワー')}${seg(Math.max(0, u.keywords), 'k', 'キーワード')}${seg(effTotal, 'e', 'テキスト効果')}<span class="m-cap" style="left:${Math.min(100, (cap / Math.max(cap, u.total)) * 100)}%"></span></div>
      <div class="m-legend"><span class="p">パワー ${Math.round(u.power)}</span><span class="k">キーワード ${u.keywords}</span><span class="e">テキスト ${effTotal}</span><span>残り ${cap - u.total}</span></div>`;
    const e = Parts.validate(d);
    const lines = Parts.cardLines(shown);
    errs.innerHTML = (lines.length ? `<div class="full-text">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>` : '') + e.map((m) => `<p>⚠ ${esc(m)}</p>`).join('');
    $('#forge-save').disabled = e.length > 0;
    $('#forge-save').textContent = F.editing ? '作り直して保存' : '工房に保存';
  }

  function render() { renderList(); renderMain(); renderSide(); }

  function roll() {
    const grade = Parts.rollGrade();
    const g = Parts.GRADES[grade];
    F.draft = newDraft(grade);
    F.editing = false;
    const m = UI.modal('原石の素質', `<div class="reveal grade-${grade}" style="--gc:${g.color}"><div class="rv-ore">💠</div><b>${g.label}</b><span>容量 ×${g.mult}</span><p>${grade === 'star' ? '伝説級の原石！' : grade === 'platinum' ? 'とても良い原石だ' : grade === 'gold' ? '良い原石だ' : grade === 'silver' ? '標準的な原石' : '少し頼りない原石…'}</p></div>`, [
      { label: '作り始める', primary: true, onClick: () => { UI.closeModal(); render(); } },
    ], 'reveal-modal');
    void m;
    render();
  }

  function save() {
    const d = F.draft;
    if (!d || Parts.validate(d).length) return;
    d.name = d.name.trim();
    const saved = Store.saveCard(JSON.parse(JSON.stringify(d)));
    UI.toast(`【${saved.name}】を工房に保存しました`);
    F.draft = null;
    F.editing = false;
    render();
  }

  function init() {
    $('#forge-save').onclick = save;
    $('#forge-new').onclick = () => {
      if (F.draft && !F.editing) {
        UI.modal('作りかけのカード', '<p>作りかけのカードを捨てて、新しい原石を引きますか？</p>', [
          { label: 'やめる', onClick: UI.closeModal },
          { label: '新しく引く', primary: true, onClick: () => { UI.closeModal(); F.draft = null; roll(); } },
        ]);
      } else { F.draft = null; F.editing = false; render(); }
    };
    $('#forge-import').onclick = importCode;
    UI.onScreen('forge', render);
  }

  root.ForgeUI = { init };
})(this);
