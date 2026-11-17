/*
 * battle-ui.js — 対戦画面
 *
 * ■ 仕組み
 *   engine.js の Game が対戦を進め、人間の判断が必要になると HumanAgent.choose() が呼ばれます。
 *   ここでは「今どんな質問をされているか（ui.req）」に合わせて、押せるカードを光らせ、
 *   クリックされたら答えを返します（resolve）。CPUの番はCPUが答えるので、画面は見ているだけです。
 *
 *   エンジンは出来事（召喚・攻撃・ブレイク…）のたびに pace() を呼ぶので、そこで画面を描き直し、
 *   演出（光る・揺れる）を付けて少し待ちます。待つことで、何が起きたのか目で追えるようになります。
 */
(function (root) {
  'use strict';
  const { UI, Engine, CpuAgent, Store, TextParser } = root;
  const { $, esc } = UI;

  let game = null;
  const ui = { req: null, resolve: null, sel: [], attacker: null, speed: 1 };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  class Aborted extends Error {}

  // ───────────── 人間のプレイヤー ─────────────
  class HumanAgent {
    choose(g, pi, req) {
      return new Promise((resolve, reject) => {
        if (g !== game) return reject(new Aborted());
        ui.req = req; ui.sel = []; ui.attacker = null;
        ui.resolve = (v) => {
          ui.req = null; ui.resolve = null; ui.sel = []; ui.attacker = null;
          render();
          resolve(v);
        };
        ui.reject = () => reject(new Aborted());
        render();
        openModalIfNeeded(req);
      });
    }
  }
  const answer = (v) => { if (ui.resolve) ui.resolve(v); };

  // ───────────── 演出の待ち時間 ─────────────
  const DELAY = { turn: 700, summon: 500, cast: 650, trigger: 450, attack: 550, block: 450, battle: 750, destroy: 450, break: 650, draw: 120, charge: 250, direct: 900, bounce: 350, toMana: 350, tap: 300 };
  async function pace(ev) {
    const g = game;
    if (!g) throw new Aborted();
    render();
    fx(ev);
    await sleep((DELAY[ev.kind] || 200) * ui.speed);
    if (g !== game) throw new Aborted();
  }
  function el(uid) { return document.querySelector(`#screen-battle [data-uid="${uid}"]`); }
  function addFx(uid, cls) { const e = el(uid); if (e) { e.classList.remove(cls); void e.offsetWidth; e.classList.add(cls); } }
  function flash(text, cls = '') {
    const f = $('#bt-flash');
    f.className = 'bt-flash show ' + cls;
    f.textContent = text;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => { f.className = 'bt-flash'; }, 900 * Math.max(0.6, ui.speed));
  }
  function fx(ev) {
    const g = game;
    switch (ev.kind) {
      case 'turn': flash(g.active === 0 ? 'あなたのターン' : 'CPUのターン', g.active === 0 ? 'me' : 'op'); break;
      case 'summon': addFx(ev.uid, 'fx-in'); break;
      case 'cast': showCasting(ev.uid); break;
      case 'trigger': addFx(ev.uid, 'fx-trigger'); break;
      case 'attack': addFx(ev.uid, 'fx-attack'); markTarget(ev); break;
      case 'block': addFx(ev.uid, 'fx-block'); flash('ブロック！'); break;
      case 'battle': addFx(ev.a, 'fx-clash'); addFx(ev.b, 'fx-clash'); break;
      case 'destroy': for (const u of ev.uids || []) addFx(u, 'fx-destroy'); break;
      case 'break': flash('シールドブレイク！', 'break'); break;
      case 'skip': flash('ターンの残りをとばす！', 'break'); break;
      case 'direct': flash('ダイレクトアタック！', 'break'); break;
      default:
    }
  }
  function markTarget(ev) {
    const g = game;
    const att = g.card(ev.uid);
    if (ev.target === 'player') {
      const box = att.owner === 0 ? '#bt-opp-shields' : '#bt-my-shields';
      const e = $(box); if (e) { e.classList.remove('fx-target'); void e.offsetWidth; e.classList.add('fx-target'); }
    } else addFx(ev.target, 'fx-target');
  }
  function showCasting(uid) {
    const c = game.card(uid);
    const box = $('#bt-casting');
    const def = Engine.spellView(c.def) || c.def; // ツインパクトは呪文側を見せる
    box.innerHTML = `<div class="casting-label">${c.owner === 0 ? 'あなた' : 'CPU'}の呪文</div>${UI.cardHTML(def)}`;
    box.className = 'bt-casting show';
    clearTimeout(showCasting.t);
    showCasting.t = setTimeout(() => { box.className = 'bt-casting'; }, 1100 * Math.max(0.6, ui.speed));
  }

  // ───────────── 描画 ─────────────
  const PHASE = { setup: '準備', start: 'ターン開始', draw: 'ドロー', charge: 'マナチャージ', main: 'メイン', attack: '攻撃', end: 'ターン終了', over: '対戦終了' };

  /** 今の質問から「押せるもの」と「案内の文・ボタン」を決める */
  function interaction() {
    const g = game, req = ui.req;
    const out = { selectable: new Set(), picked: new Set(ui.sel), prompt: '', buttons: [], playerTarget: false };
    if (!req) {
      out.prompt = g.phase === 'over' ? '' : g.active === 1 ? 'CPUが考えています…' : '処理中…';
      return out;
    }
    switch (req.type) {
      case 'charge':
        req.candidates.forEach((u) => out.selectable.add(u));
        out.prompt = 'マナチャージ：手札から1枚選んで、マナゾーンに置けます';
        out.buttons.push({ label: '置かない', act: 'none' });
        break;
      case 'main': {
        for (const a of req.actions) if (a.uid) out.selectable.add(a.uid);
        const n = req.actions.length - 1;
        const hyper = req.actions.some((a) => a.kind === 'hyper');
        out.prompt = n ? `メイン：光っているカードを使えます（クリックで召喚／呪文${hyper ? '／バトルゾーンのクリーチャーはハイパー化' : ''}）` : 'メイン：今使えるカードはありません';
        out.buttons.push({ label: '攻撃へ進む ▶', act: 'toAttack', cls: 'primary' });
        break;
      }
      case 'attack': {
        const acts = req.actions.filter((a) => a.kind === 'attack');
        if (ui.attacker == null) {
          acts.forEach((a) => out.selectable.add(a.attacker));
          out.prompt = acts.length ? '攻撃：攻撃するクリーチャーを選んでください' : '攻撃できるクリーチャーはいません';
        } else {
          out.picked.add(ui.attacker);
          for (const a of acts) if (a.attacker === ui.attacker) { if (a.target === 'player') out.playerTarget = true; else out.selectable.add(a.target); }
          out.prompt = `「${g.card(ui.attacker).def.name}」の攻撃先を選んでください（相手のシールド＝プレイヤー、またはタップしているクリーチャー）`;
          if (out.playerTarget) out.buttons.push({ label: 'プレイヤーを攻撃', act: 'atkPlayer', cls: 'primary' });
          out.buttons.push({ label: 'やめる', act: 'cancelAtk' });
        }
        out.buttons.push({ label: 'ターン終了', act: 'end', cls: ui.attacker == null ? 'primary' : '' });
        break;
      }
      case 'block': {
        req.candidates.forEach((u) => out.selectable.add(u));
        const att = g.card(req.attacker);
        const tgt = req.target === 'player' ? 'あなた' : `「${g.card(req.target).def.name}」`;
        out.prompt = `「${att.def.name}」（パワー${g.power(att)}）が${tgt}を攻撃！ ブロックするクリーチャーを選べます`;
        out.buttons.push({ label: 'ブロックしない', act: 'none', cls: 'primary' });
        break;
      }
      case 'target':
        if (onBoard(req.candidates)) {
          req.candidates.forEach((u) => out.selectable.add(u));
          out.prompt = `${req.prompt}（${req.min === req.max ? req.max : `${req.min}〜${req.max}`}枚）`;
          if (!(req.min === 1 && req.max === 1)) out.buttons.push({ label: `決定（${ui.sel.length}枚）`, act: 'confirmSel', cls: 'primary', disabled: ui.sel.length < req.min || ui.sel.length > req.max });
          if (req.max > 1) out.buttons.push({ label: 'おまかせ', act: 'autoSel' }); // 裏向きのシールドなど、どれでも同じ時に便利
          if (req.min === 0 && req.max === 1) out.buttons.push({ label: '選ばない', act: 'emptySel' });
        } else out.prompt = req.prompt;
        break;
      default:
        out.prompt = '選んでください';
    }
    return out;
  }
  /** 候補のカードがすべて盤面に見えているか（見えていなければダイアログで選ぶ） */
  function onBoard(uids) {
    return uids.every((u) => {
      const c = game.card(u);
      return c.zone === 'battle' || c.zone === 'shield' || c.zone === 'mana' || (c.zone === 'hand' && c.owner === 0);
    });
  }

  function cardFor(c, it, extra = {}) {
    const cls = [extra.cls || ''];
    if (it.selectable.has(c.uid)) cls.push('sel');
    if (it.picked.has(c.uid)) cls.push('picked');
    if (c.zone === 'battle' && game.isCreature(c) && c.enteredTurn === game.turnNo && c.owner === game.active && !game.kw(c, 'speedAttacker') && c.def.type !== 'evolution') cls.push('sick');
    if (c.zone === 'battle' && !game.isCreature(c)) cls.push('element');
    if (c.jdProtected) cls.push('protected');
    const pw = c.zone === 'battle' && game.isCreature(c) ? game.power(c) : undefined;
    return UI.cardHTML(c.def, { uid: c.uid, tapped: c.tapped, power: pw, under: c.under.length, cls: cls.join(' '), back: extra.back, small: extra.small, hyper: c.hyper });
  }

  function renderZone(sel, cards, it, extra) {
    const e = $(sel);
    if (e) e.innerHTML = cards.map((c) => cardFor(c, it, extra)).join('') || (extra && extra.empty ? `<span class="zone-empty">${extra.empty}</span>` : '');
  }

  function manaSummary(P) {
    const civs = {};
    for (const c of P.mana) for (const k of c.def.civs) civs[k] = (civs[k] || 0) + 1;
    const untapped = P.mana.filter((c) => !c.tapped).length;
    return `<b>${untapped}</b>/${P.mana.length} ${Object.entries(civs).map(([k, n]) => `<span>${UI.civDots([k])}${n}</span>`).join('')}`;
  }
  function infoHTML(P, isMe) {
    return `<div class="pi-name">${esc(P.name)}${game.active === P.idx && game.phase !== 'over' ? '<i class="turn-mark">ターン中</i>' : ''}</div>
      <div class="pi-stats"><span title="山札">山札 <b>${P.deck.length}</b></span><span title="手札">手札 <b>${P.hand.length}</b></span>
      <span title="シールド">盾 <b>${P.shields.length}</b></span><button class="pi-grave" data-grave="${P.idx}" title="墓地を見る">墓地 <b>${P.grave.length}</b></button></div>`;
  }

  let renderPending = false;
  function render() {
    if (!game || renderPending) return;
    renderPending = true;
    // 同じ瞬間の描き直しは1回にまとめる
    Promise.resolve().then(() => { renderPending = false; draw(); });
  }
  function draw() {
    if (!game) return;
    const g = game, me = g.players[0], op = g.players[1];
    const it = interaction();
    $('#bt-opp-info').innerHTML = infoHTML(op, false);
    $('#bt-my-info').innerHTML = infoHTML(me, true);
    $('#bt-phase').innerHTML = `<span class="ph-turn">ターン ${g.turnNo}</span><span class="ph-name ${g.active === 0 ? 'me' : 'op'}">${g.active === 0 ? 'あなた' : 'CPU'}：${PHASE[g.phase] || g.phase}</span>`;
    $('#bt-opp-hand').innerHTML = op.hand.map((c) => cardFor(c, it, { back: true, small: true })).join('');
    renderZone('#bt-opp-shields .zone-cards', op.shields, it, { back: true, small: true, empty: 'シールドなし' });
    renderZone('#bt-my-shields .zone-cards', me.shields, it, { back: true, small: true, empty: 'シールドなし' });
    renderZone('#bt-opp-mana .zone-cards', op.mana, it, { small: true });
    renderZone('#bt-my-mana .zone-cards', me.mana, it, { small: true });
    $('#bt-opp-mana .zone-title').innerHTML = 'マナ ' + manaSummary(op);
    $('#bt-my-mana .zone-title').innerHTML = 'マナ ' + manaSummary(me);
    renderZone('#bt-opp-battle', op.battle, it, { empty: '' });
    renderZone('#bt-my-battle', me.battle, it, { empty: '' });
    renderZone('#bt-my-hand', me.hand, it, {});
    // 手札で、使えないカードは少し暗く
    if (ui.req && ui.req.type === 'main') document.querySelectorAll('#bt-my-hand .card:not(.sel)').forEach((e) => e.classList.add('dim'));
    $('#bt-opp-shields').classList.toggle('sel-target', it.playerTarget);
    $('#bt-prompt').textContent = it.prompt;
    $('#bt-buttons').innerHTML = it.buttons.map((b) => `<button class="btn ${b.cls || ''}" data-act="${b.act}" ${b.disabled ? 'disabled' : ''}>${esc(b.label)}</button>`).join('');
  }

  // ───────────── ダイアログで答える質問 ─────────────
  async function openModalIfNeeded(req) {
    const g = game;
    if (req.type === 'option') {
      const v = await UI.modal({
        title: '選んでください', wide: true, dismissable: false,
        html: `<p>${esc(req.prompt)}</p><div class="opt-list">${req.options.map((o, i) => `<button class="btn opt" data-i="${i}">${esc(o)}</button>`).join('')}</div>`,
        buttons: [],
        onOpen(m, close) { m.addEventListener('click', (e) => { const b = e.target.closest('.opt'); if (b) close(+b.dataset.i); }); },
      });
      if (ui.req === req) answer(v);
    } else if (req.type === 'yesno') {
      const p = req.purpose || {};
      const c = p.uid ? g.card(p.uid) : null;
      const v = await UI.modal({
        title: p.op === 'shieldTrigger' ? 'S・トリガー！' : p.op === 'gStrike' ? 'G・ストライク！' : '確認',
        html: `${c ? `<div class="detail">${UI.detailHTML(c.def)}</div>` : ''}<p>${esc(req.prompt)}</p>`,
        wide: !!c, dismissable: false,
        buttons: [{ label: 'いいえ', value: false }, { label: 'はい', value: true, cls: 'primary' }],
      });
      if (ui.req === req) answer(!!v);
    } else if (req.type === 'number') {
      const btns = [];
      for (let n = req.min; n <= req.max; n++) btns.push({ label: `${n}`, value: n, cls: n === req.max ? 'primary' : '' });
      const v = await UI.modal({ title: '数を選ぶ', html: `<p>${esc(req.prompt)}</p>`, buttons: btns, dismissable: false });
      if (ui.req === req) answer(v);
    } else if (req.type === 'target' && !onBoard(req.candidates)) {
      const picked = new Set();
      const single = req.min === 1 && req.max === 1;
      const v = await UI.modal({
        title: 'カードを選ぶ', wide: true, dismissable: false,
        html: `<p>${esc(req.prompt)}${/（/.test(req.prompt) ? '' : `（${req.min === req.max ? req.max : `${req.min}〜${req.max}`}枚）`}</p>
          <div class="picker">${req.candidates.map((u) => { const c = g.card(u); return `<button class="pick" data-u="${u}">${UI.cardHTML(c.def)}<span>${esc(c.def.name)}</span></button>`; }).join('')}</div>`,
        buttons: single ? [] : [{ label: '決定', value: 'ok', cls: 'primary' }],
        onOpen(m, close) {
          m.addEventListener('click', (e) => {
            const b = e.target.closest('.pick');
            if (!b) return;
            const u = +b.dataset.u;
            if (single) { picked.add(u); close('ok'); return; }
            if (picked.has(u)) picked.delete(u); else if (picked.size < req.max) picked.add(u);
            b.classList.toggle('on', picked.has(u));
          });
          m.addEventListener('mouseover', (e) => { const b = e.target.closest('.pick'); if (b) showDetail(+b.dataset.u); });
        },
      });
      if (ui.req === req && v === 'ok') answer([...picked]);
    }
  }

  // ───────────── クリックの処理 ─────────────
  function onClick(e) {
    if (!game) return;
    const btn = e.target.closest('#bt-buttons button');
    if (btn) return onButton(btn.dataset.act);
    const grave = e.target.closest('[data-grave]');
    if (grave) return showGrave(+grave.dataset.grave);
    if (e.target.closest('#bt-opp-shields') && ui.req && ui.req.type === 'attack' && ui.attacker != null) {
      if (interaction().playerTarget) return answer({ kind: 'attack', attacker: ui.attacker, target: 'player' });
    }
    const cardEl = e.target.closest('.card[data-uid]');
    if (!cardEl) return;
    const uid = +cardEl.dataset.uid;
    const req = ui.req;
    if (!req) return;
    const it = interaction();
    switch (req.type) {
      case 'charge':
        if (it.selectable.has(uid)) answer(uid);
        break;
      case 'main': {
        const acts = req.actions.filter((x) => x.uid === uid);
        if (acts.length === 1) answer(acts[0]);
        else if (acts.length > 1) chooseAction(req, game.card(uid), acts);
        else if (game.card(uid).zone === 'hand' && game.card(uid).owner === 0) UI.toast(whyNot(game.card(uid)), 'bad');
        break;
      }
      case 'attack':
        if (ui.attacker == null) { if (it.selectable.has(uid)) { ui.attacker = uid; render(); } }
        else if (uid === ui.attacker) { ui.attacker = null; render(); }
        else if (it.selectable.has(uid)) answer({ kind: 'attack', attacker: ui.attacker, target: uid });
        else if (req.actions.some((a) => a.attacker === uid)) { ui.attacker = uid; render(); }
        break;
      case 'block':
        if (it.selectable.has(uid)) answer(uid);
        break;
      case 'target':
        if (!it.selectable.has(uid)) break;
        if (req.min === 1 && req.max === 1) { answer([uid]); break; }
        if (req.min === 0 && req.max === 1) { answer([uid]); break; }
        if (ui.sel.includes(uid)) ui.sel = ui.sel.filter((x) => x !== uid);
        else if (ui.sel.length < req.max) ui.sel.push(uid);
        render();
        break;
      default:
    }
  }
  /** 同じカードで複数の使い方がある時（ツインパクトの両面）に選んでもらう */
  async function chooseAction(req, c, acts) {
    const sv = Engine.spellSideDef(c.def);
    const qn = (n) => (/^「.*」$/.test(n) ? n : `「${n}」`);
    const label = (a) => (a.kind === 'cast' ? `呪文側${qn(sv ? sv.name : c.def.name)}を唱える（コスト${(sv || c.def).cost}）` : a.kind === 'hyper' ? 'ハイパー化する' : `${qn(c.def.name)}を召喚する（コスト${c.def.cost}）`);
    const v = await UI.modal({
      title: 'どちらで使いますか？', wide: true,
      html: `<div class="detail">${UI.detailHTML(c.def)}</div>`,
      buttons: [{ label: 'やめる', value: null }, ...acts.map((a, i) => ({ label: label(a), value: i, cls: 'primary' }))],
    });
    if (v != null && ui.req === req) answer(acts[v]);
  }
  function whyNot(c) {
    const P = game.players[0];
    const untapped = P.mana.filter((m) => !m.tapped).length;
    const sv = Engine.spellSideDef(c.def);
    const minCost = Math.min(c.def.cost, sv ? sv.cost : Infinity);
    if (untapped < minCost) return `マナが足りません（コスト${sv ? `${c.def.cost}／呪文側${sv.cost}` : c.def.cost}、使えるマナ${untapped}）`;
    if (c.def.type === 'evolution' && !game.evolutionBases(0, c.def).length) return '進化元になるクリーチャーがいません';
    return `${c.def.civs.map(UI.civName).join('と')}の文明のマナが必要です`;
  }
  function onButton(act) {
    const req = ui.req;
    if (!req) return;
    if (act === 'none') answer(null);
    else if (act === 'toAttack') answer({ kind: 'toAttack' });
    else if (act === 'end') answer({ kind: 'end' });
    else if (act === 'cancelAtk') { ui.attacker = null; render(); }
    else if (act === 'atkPlayer') answer({ kind: 'attack', attacker: ui.attacker, target: 'player' });
    else if (act === 'confirmSel') answer([...ui.sel]);
    else if (act === 'emptySel') answer([]);
    else if (act === 'autoSel') answer(req.candidates.slice(0, req.max));
  }

  function showDetail(uid) {
    const c = game && game.card(uid);
    if (!c) return;
    // 見えないカード（相手の手札・シールド・山札）は表示しない
    if ((c.zone === 'hand' && c.owner !== 0 && !(ui.req && ui.req.candidates && ui.req.candidates.includes(uid))) || c.zone === 'shield' || c.zone === 'deck') return;
    const pw = c.zone === 'battle' && game.isCreature(c) ? game.power(c) : undefined;
    const notes = [];
    if (c.hyper) notes.push('ハイパーモード中（次の自分のターンのはじめまで）');
    if (c.zone === 'battle') {
      if (c.tapped) notes.push('タップしている');
      if (c.enteredTurn === game.turnNo && c.owner === game.active) notes.push('このターンに出た');
      if (c.under.length) notes.push(`下に${c.under.length}枚重なっている（${c.under.map((u) => u.def.name).join('、')}）`);
      if (c.jdProtected) notes.push('ジャストダイバーで守られている');
      if (c.cantAttackTurn === game.turnNo) notes.push('このターン攻撃できない');
    }
    $('#bt-detail').innerHTML = UI.detailHTML(c.def, { power: pw, note: notes.join('・'), hyper: c.hyper });
  }
  function showGrave(pi) {
    const P = game.players[pi];
    UI.modal({
      title: `${P.name}の墓地（${P.grave.length}枚）`, wide: true,
      html: P.grave.length ? `<div class="picker">${[...P.grave].reverse().map((c) => `<div class="pick" data-u="${c.uid}">${UI.cardHTML(c.def)}<span>${esc(c.def.name)}</span></div>`).join('')}</div>` : '<p>墓地にカードはありません。</p>',
      onOpen(m) { m.addEventListener('mouseover', (e) => { const b = e.target.closest('.pick'); if (b) showDetail(+b.dataset.u); }); },
    });
  }

  function addLog(ev) {
    const box = $('#bt-log');
    const line = document.createElement('div');
    line.className = 'log-line ' + (ev.player === 0 ? 'me' : ev.player === 1 ? 'op' : 'sys');
    if (/^──/.test(ev.text)) line.classList.add('turn');
    line.textContent = ev.text;
    box.appendChild(line);
    while (box.children.length > 300) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
  }

  // ───────────── 対戦の開始と終了 ─────────────
  async function start(myDeck, cpuDeck, opts = {}) {
    stop();
    const st = Store.Settings.get();
    ui.speed = opts.speed || 1;
    const g = new Engine.Game({
      decks: [myDeck, cpuDeck],
      agents: [new HumanAgent(), new CpuAgent({ wait: Math.round((st.cpuWait || 450) * ui.speed) })],
      names: ['あなた', 'CPU'],
      first: opts.first,
      pace,
    });
    game = g;
    $('#bt-log').innerHTML = '';
    $('#bt-detail').innerHTML = '<p class="hint">カードにマウスを乗せると、ここに詳しく表示されます。</p>';
    g.on((ev) => {
      if (g !== game) return;
      if (ev.kind === 'log') addLog(ev);
      if (ev.kind === 'shieldTrigger') { flash('S・トリガー！', 'trigger'); }
      if (ev.kind === 'hyper') flash('ハイパー化！', 'trigger');
      if (ev.kind === 'move' || ev.kind === 'tap' || ev.kind === 'pay' || ev.kind === 'turn' || ev.kind === 'hyper') render();
    });
    UI.showScreen('battle');
    try {
      const res = await g.run();
      if (g !== game) return;
      render();
      await sleep(400);
      showResult(res);
    } catch (e) {
      if (!(e instanceof Aborted)) { console.error(e); UI.toast('エラーが起きました：' + e.message, 'bad'); }
    }
  }
  function stop() {
    if (ui.reject) { const r = ui.reject; ui.reject = null; ui.resolve = null; ui.req = null; game = null; r(); }
    game = null;
    document.querySelectorAll('#modals .modal-wrap').forEach((m) => m.remove());
  }
  async function showResult(res) {
    const win = res.winner === 0;
    const v = await UI.modal({
      title: res.winner < 0 ? '引き分け' : win ? 'あなたの勝ち！' : 'あなたの負け…',
      html: `<p class="result ${res.winner < 0 ? '' : win ? 'win' : 'lose'}">${esc(res.reason)}</p><p class="hint">${res.turns}ターン</p>`,
      buttons: [{ label: '盤面を見る', value: 'stay' }, { label: 'メニューへ', value: 'menu' }, { label: 'もう一度', value: 'again', cls: 'primary' }],
    });
    if (v === 'again') root.Main.rematch();
    else if (v === 'menu') { stop(); UI.showScreen('home'); }
  }

  function init() {
    const scr = $('#screen-battle');
    scr.addEventListener('click', onClick);
    scr.addEventListener('mouseover', (e) => {
      const c = e.target.closest('.card[data-uid]');
      if (c && !c.classList.contains('back')) showDetail(+c.dataset.uid);
    });
    $('#bt-quit').onclick = async () => {
      if (game && game.phase !== 'over' && !(await UI.confirmBox('対戦をやめる', '降参してメニューに戻りますか？', '降参する', 'danger'))) return;
      stop();
      UI.showScreen('home');
    };
    $('#bt-speed').onchange = (e) => { ui.speed = Number(e.target.value); };
    document.addEventListener('keydown', (e) => {
      if (!game || document.body.dataset.screen !== 'battle' || document.querySelector('#modals .modal-wrap')) return;
      if (e.key === 'Enter' || e.key === ' ') { const b = $('#bt-buttons .btn.primary'); if (b && !b.disabled) { e.preventDefault(); b.click(); } }
      if (e.key === 'Escape' && ui.attacker != null) { ui.attacker = null; render(); }
    });
  }

  root.BattleUI = { init, start, stop, get game() { return game; } };
})(typeof self !== 'undefined' ? self : this);
