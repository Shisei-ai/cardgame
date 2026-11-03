/*
 * battle.js — 対戦画面
 *
 * 操作：
 *   メインステップ … 手札のカードをクリックで使う。【起動】効果を持つ自分のクリーチャーはクリックで効果を使う
 *   アタックステップ … 攻撃できる自分のクリーチャーをクリック → 光っている攻撃先（相手の帯・タップした相手クリーチャー）をクリック
 *   右クリック／Esc … 攻撃先選びをやめる
 * CPUの手番は、間を空けて1手ずつ進める（何をしたかは右上の記録に出る）。
 * 効果の対象選び・「〜してもよい」・迎撃呪文などの選択は、エンジンの pending を画面に出して答える。
 */
(function (root) {
  'use strict';
  const { Parts, Engine, AI, UI } = root;
  const { $, $$, esc, fx } = UI;
  const ME = 0, OP = 1;
  const AI_DELAY = 800;
  const PORTRAIT = ['🧑‍🔧', '🤖'];

  const B = { game: null, ai: null, setup: null, attackFrom: null, picks: [], pendingShown: null, sig: '', raf: 0, aiT: 0, unitEls: new Map(), feed: [] };

  function start(setup) {
    stop();
    B.setup = setup;
    const g = new Engine.Game({ decks: [setup.myDeck, setup.cpuDeck], names: ['あなた', 'CPU'] });
    B.game = g;
    B.ai = new AI.AI(g, OP, setup.level);
    g.onEvent = onEvent;
    B.attackFrom = null; B.picks = []; B.pendingShown = null; B.sig = ''; B.unitEls = new Map(); B.feed = [];
    $('#field-0').innerHTML = ''; $('#field-1').innerHTML = ''; $('#fx').innerHTML = ''; $('#feed').innerHTML = '';
    UI.closeModal();
    UI.showScreen('battle');
    g.start();
    banner(g.first === ME ? 'あなたが先攻' : 'CPUが先攻', '先攻の1ターン目はドローしません');
    B.raf = requestAnimationFrame(loop);
  }

  function stop() { cancelAnimationFrame(B.raf); clearTimeout(B.aiT); B.aiT = 0; }

  function loop() {
    const g = B.game;
    render();
    // CPUの手番：間を空けて1手ずつ
    if (!g.over && !g.pending && g.active === OP && !B.aiT) {
      B.aiT = setTimeout(() => { B.aiT = 0; if (B.game === g && !g.over) B.ai.step(); }, AI_DELAY);
    }
    if (g.over) { showResult(); return; }
    B.raf = requestAnimationFrame(loop);
  }

  // ───────────── 入力 ─────────────
  function myTurn(step) { const g = B.game; return !g.over && !g.pending && g.active === ME && (!step || g.step === step); }

  function clickHand(iid) {
    const g = B.game;
    if (g.pending) return;
    const chk = g.canPlay(ME, iid);
    if (!chk.ok) { if (chk.reason) UI.toast(chk.reason); return; }
    B.attackFrom = null;
    g.play(ME, iid);
  }

  function clickUnit(uid) {
    const g = B.game;
    const pd = g.pending;
    // 効果の対象選び
    if (pd && pd.player === ME && pd.kind === 'targets') {
      if (!pd.options.includes(uid)) return;
      const i = B.picks.indexOf(uid);
      if (i >= 0) B.picks.splice(i, 1); else B.picks.push(uid);
      if (B.picks.length >= pd.max) submitTargets();
      B.sig = '';
      return;
    }
    if (pd) return;
    const u = g.findUnit(uid);
    if (!u) return;
    // アタックステップ：攻撃するクリーチャーを選ぶ → 攻撃先を選ぶ
    if (myTurn('attack')) {
      if (B.attackFrom) {
        if (B.attackFrom === uid) { B.attackFrom = null; B.sig = ''; return; }
        if (g.attackTargets(ME, B.attackFrom).includes(uid)) { const from = B.attackFrom; B.attackFrom = null; g.attack(ME, from, uid); return; }
      }
      if (u.owner === ME) {
        if (g.canAttack(ME, uid)) { B.attackFrom = uid; B.sig = ''; }
        else UI.toast(u.tapped ? 'タップしているので攻撃できない' : u.sick ? '召喚したターンは攻撃できない（速攻を除く）' : '攻撃できない');
      } else if (B.attackFrom) UI.toast('アンタップしている相手のクリーチャーは攻撃できない');
      return;
    }
    // メインステップ：【起動】効果
    if (myTurn('main') && u.owner === ME) {
      const idxs = (u.spec.effects || []).map((e, i) => (e.trig === 'activate' ? i : -1)).filter((i) => i >= 0);
      if (!idxs.length) return;
      const usable = idxs.filter((i) => g.canActivate(ME, uid, i));
      if (!usable.length) { UI.toast(u.silenced ? '能力を消されている' : '今は使えない（コスト・回数・タップの状態を確認）'); return; }
      const m = UI.modal(`【${esc(u.name)}】の起動効果`, `<div class="act-list">${idxs.map((i) => `<button class="act-item" data-i="${i}" ${usable.includes(i) ? '' : 'disabled'}>${esc(Parts.effectText(u.spec, u.spec.effects[i]))}</button>`).join('')}</div><p class="hint">タップするコストがあると、このターンは攻撃できず、相手の攻撃対象になります。</p>`, [
        { label: 'やめる', onClick: UI.closeModal },
      ]);
      m.querySelectorAll('.act-item').forEach((b) => { b.onclick = () => { UI.closeModal(); g.activate(ME, uid, Number(b.dataset.i)); }; });
    }
  }

  function clickPlayer(pi) {
    const g = B.game;
    if (pi === OP && B.attackFrom && myTurn('attack')) {
      const from = B.attackFrom;
      B.attackFrom = null;
      g.attack(ME, from, 'player');
    }
  }

  function submitTargets() {
    const pick = B.picks.slice();
    B.picks = [];
    B.pendingShown = null;
    B.game.answer(pick);
  }

  function onKey(e) {
    if (!$('#screen-battle').classList.contains('active')) return;
    if (e.key === 'Escape') { if (B.attackFrom) { B.attackFrom = null; B.sig = ''; } else openMenu(); }
  }

  function openMenu() {
    UI.modal('メニュー', '<p>対戦を続けますか？</p>', [
      { label: '降参してタイトルへ', danger: true, onClick: () => { stop(); UI.closeModal(); UI.showScreen('title'); } },
      { label: '続ける', primary: true, onClick: UI.closeModal },
    ]);
  }

  // ───────────── 人間の選択（pending）を画面に出す ─────────────
  function renderPending() {
    const g = B.game;
    const pd = g.pending && g.pending.player === ME ? g.pending : null;
    const guide = $('#guide');
    if (!pd) { if (B.pendingShown) { B.pendingShown = null; UI.closeModal(); } guide.className = 'guide'; return; }
    if (pd.kind === 'targets') {
      guide.className = 'guide show';
      guide.innerHTML = `🎯 ${esc(pd.prompt)}　<b>${B.picks.length} / ${pd.max}</b>${pd.max > 1 ? ' <button class="btn small primary" id="tg-ok">決定</button>' : ''}`;
      const ok = $('#tg-ok');
      if (ok) ok.onclick = () => { if (B.picks.length) submitTargets(); };
      return;
    }
    guide.className = 'guide';
    if (B.pendingShown === pd) return;
    B.pendingShown = pd;
    if (pd.kind === 'confirm') {
      UI.modal('確認', `<p>${esc(pd.prompt)}</p><p class="m-effect">${esc(Parts.effectText(pd.spec || { kind: 'creature' }, pd.effect))}</p>`, [
        { label: 'しない', onClick: () => { UI.closeModal(); B.pendingShown = null; g.answer(false); } },
        { label: 'する', primary: true, onClick: () => { UI.closeModal(); B.pendingShown = null; g.answer(true); } },
      ]);
    } else if (pd.kind === 'block') {
      const att = g.findUnit(pd.attacker);
      const m = UI.modal('ブロック', `<p>${esc(pd.prompt)}</p><p class="hint">火種を払って、アンタップの自分のクリーチャーで受け止めます。受け止めたクリーチャーはタップし、攻撃してきたクリーチャーとバトルします（パワーが大きい方が勝ち）。</p><div class="m-cards"></div>`,
        [{ label: 'ブロックしない', onClick: () => { UI.closeModal(); B.pendingShown = null; g.answer([]); } }], 'wide');
      const box = $('.m-cards', m);
      for (const uid of pd.options) {
        const u = g.findUnit(uid);
        if (!u) continue;
        const pw = g.powerOf(u);
        const el = UI.cardEl(u.spec, { power: pw, badge: att ? (pw > g.powerOf(att) ? '勝てる' : pw === g.powerOf(att) ? '相打ち' : '負ける') : '' });
        el.classList.add('pickable');
        el.onclick = () => { UI.closeModal(); B.pendingShown = null; g.answer([uid]); };
        box.appendChild(el);
      }
    } else if (pd.kind === 'discard' || pd.kind === 'react' || pd.kind === 'counter' || pd.kind === 'pickCard') {
      // カードを選ぶ画面（手札を捨てる・迎撃・対抗・サーチや墓地回収など）
      const me = g.players[ME];
      const att = pd.kind === 'react' ? g.findUnit(pd.attacker) : null;
      const title = { discard: '手札を捨てる', react: '迎撃', counter: '対抗', pickCard: 'カードを選ぶ' }[pd.kind];
      const optional = pd.kind === 'react' || pd.kind === 'counter';
      const multi = (pd.max || 1) > 1;
      const picked = [];
      const extra = att ? `<p class="hint">攻撃してきた：${esc(att.name)}（パワー ${g.powerOf(att)}）</p>` : pd.kind === 'counter' ? '<div class="m-spell"></div>' : '';
      const buttons = [];
      if (optional) buttons.push({ label: '使わない', onClick: () => { UI.closeModal(); B.pendingShown = null; g.answer([]); } });
      if (multi) buttons.push({ label: '決定', primary: true, onClick: () => { if (picked.length < (pd.min || 1)) { UI.toast(`${pd.min}枚選んでください`); return; } UI.closeModal(); B.pendingShown = null; g.answer(picked.slice()); } });
      const m = UI.modal(title, `<p>${esc(pd.prompt)}${multi ? `（${pd.max}枚）` : ''}</p>${extra}<div class="m-cards"></div>`, buttons, 'wide');
      if (pd.kind === 'counter' && pd.spell) { const sp = UI.cardEl(pd.spell); $('.m-spell', m).appendChild(sp); }
      const box = $('.m-cards', m);
      pd.options.forEach((iid, k) => {
        const spec = pd.cards ? pd.cards[k] : (me.hand.find((x) => x.iid === iid) || {}).spec;
        if (!spec) return;
        const el = UI.cardEl(spec);
        el.classList.add('pickable');
        el.onclick = () => {
          if (!multi) { UI.closeModal(); B.pendingShown = null; g.answer([iid]); return; }
          const j = picked.indexOf(iid);
          if (j >= 0) picked.splice(j, 1); else if (picked.length < pd.max) picked.push(iid);
          el.classList.toggle('picked', picked.includes(iid));
        };
        box.appendChild(el);
      });
    }
  }

  // ───────────── 演出 ─────────────
  const later = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
  const portrait = (pi) => $(`#pbar-${pi} .portrait`);
  const unitEl = (u) => u && B.unitEls.get(u.uid);

  function log(text, who) {
    B.feed.unshift({ text, who });
    B.feed = B.feed.slice(0, 6);
    $('#feed').innerHTML = B.feed.map((f, i) => `<div class="f-row ${f.who === ME ? 'me' : f.who === OP ? 'op' : ''}" style="opacity:${1 - i * 0.13}">${esc(f.text)}</div>`).join('');
  }

  function onEvent(ev) {
    const g = B.game;
    const nm = (pi) => (pi === ME ? 'あなた' : 'CPU');
    switch (ev.type) {
      case 'turn':
        B.attackFrom = null;
        banner(ev.player === ME ? 'あなたのターン' : 'CPUのターン', `第${Math.ceil(ev.turn / 2)}巡　最大マナ ${g.players[ev.player].maxMana}`);
        break;
      case 'step':
        if (ev.player === ME) UI.toast('アタックステップ：攻撃するクリーチャーを選んでください');
        else log('CPU：アタックステップへ', OP);
        break;
      case 'summon':
        log(`${nm(ev.player)}：【${ev.unit.name}】を召喚`, ev.player);
        later(() => UI.pulse(unitEl(ev.unit), 'summoned', 600));
        break;
      case 'cast':
        log(`${nm(ev.player)}：【${ev.card.name}】を唱えた`, ev.player);
        castShow(ev.card, ev.player);
        break;
      case 'activate':
        log(`${nm(ev.player)}：【${ev.unit.name}】の効果`, ev.player);
        break;
      case 'attackDeclare':
        log(`${nm(ev.player)}：【${ev.unit.name}】が${ev.target ? `【${ev.target.name}】` : '相手'}に攻撃`, ev.player);
        later(() => {
          const a = unitEl(ev.unit);
          const b = ev.target ? unitEl(ev.target) : portrait(1 - ev.player);
          if (a && b) fx.line(UI.stagePoint(a), UI.stagePoint(b), ev.player === ME ? '#7fd6ff' : '#ff8a6a');
          UI.pulse(a, 'attacking', 450);
        });
        break;
      case 'ember': {
        const pt = portrait(ev.player);
        if (pt) { const p = UI.stagePoint(pt); fx.float(p.x + 360, p.y, '🔥+' + ev.amount, 'ember'); }
        break;
      }
      case 'block':
        log(`${nm(ev.player)}：火種を払い【${ev.unit.name}】でブロック！`, ev.player);
        later(() => UI.pulse(unitEl(ev.unit), 'guarding', 600));
        break;
      case 'guard':
        log(`【${ev.unit.name}】が守護で攻撃を引き受けた`, ev.player);
        later(() => UI.pulse(unitEl(ev.unit), 'guarding', 600));
        break;
      case 'battle':
        later(() => { const d = unitEl(ev.d); if (d) { const p = UI.stagePoint(d); fx.slash(p.x, p.y); } });
        log(`バトル：${ev.a.name}（${ev.pa}） vs ${ev.d.name}（${ev.pd}）`);
        break;
      case 'damage': {
        const pt = portrait(ev.player);
        if (pt) { const p = UI.stagePoint(pt); fx.float(p.x + 60, p.y - 10, '-' + ev.amount, 'dmg'); }
        UI.pulse($('#pbar-' + ev.player), 'hit', 400);
        if (ev.player === ME && ev.amount >= 1500) UI.pulse($('#board'), 'shake', 400);
        break;
      }
      case 'heal': {
        const pt = portrait(ev.player);
        if (pt) { const p = UI.stagePoint(pt); fx.float(p.x + 60, p.y - 10, '+' + ev.amount, 'heal'); }
        break;
      }
      case 'destroy':
        log(`【${ev.unit.name}】は破壊された`, ev.unit.owner);
        break;
      case 'undying':
        log(`【${ev.unit.name}】は不屈で踏みとどまった`, ev.unit.owner);
        break;
      case 'negated':
        log(`【${ev.card.name}】は打ち消された！`, ev.player);
        UI.toast(`【${ev.card.name}】は打ち消された！`);
        break;
      case 'exile':
        log(`【${ev.unit.name}】は除外された`, ev.unit.owner);
        break;
      case 'toDeck':
        log(`【${ev.unit.name}】は山札の一番下へ`, ev.unit.owner);
        break;
      case 'steal':
        log(`${nm(ev.player)}が【${ev.unit.name}】を奪った！`, ev.player);
        break;
      case 'reveal':
        log(`${nm(ev.player)}の山札の一番上は【${ev.card.name}】`, ev.player);
        break;
      case 'protected':
        log(`【${ev.unit.name}】は守られて破壊されなかった`, ev.unit.owner);
        break;
      case 'bounce':
        log(`【${ev.unit.name}】は手札に戻された`, ev.unit.owner);
        break;
      case 'discard':
        log(`${nm(ev.player)}は【${ev.card.name}】を捨てた`, ev.player);
        break;
      case 'burnCard':
        log(`${nm(ev.player)}の手札があふれ、【${ev.card.name}】は墓地へ`, ev.player);
        break;
      case 'effect':
        if (ev.card && ev.card.kind === 'creature') later(() => UI.pulse(unitEl(ev.source), 'effecting', 500));
        break;
    }
  }

  function banner(big, small) {
    const el = document.createElement('div');
    el.className = 'banner';
    el.innerHTML = `<b>${esc(big)}</b><span>${esc(small)}</span>`;
    $('#fx').appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  function castShow(spec, pi) {
    const el = document.createElement('div');
    el.className = 'cast-show ' + (pi === ME ? 'me' : 'op');
    el.appendChild(UI.cardEl(spec));
    $('#fx').appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  // ───────────── 描画 ─────────────
  function render() {
    const g = B.game;
    const sig = g.version + '|' + B.attackFrom + '|' + B.picks.join(',') + '|' + (g.pending ? g.pending.kind : '');
    if (sig === B.sig) return;
    B.sig = sig;
    renderPbar(g.players[ME]);
    renderPbar(g.players[OP]);
    renderField(g.players[ME]);
    renderField(g.players[OP]);
    renderHand();
    renderMid();
    renderPending();
  }

  function renderPbar(p) {
    const g = B.game;
    const el = $('#pbar-' + p.index);
    const pct = Math.max(0, (p.hp / g.cfg.startHP) * 100);
    const targetable = p.index === OP && B.attackFrom && g.attackTargets(ME, B.attackFrom).includes('player');
    el.classList.toggle('targetable', !!targetable);
    el.classList.toggle('active', g.active === p.index);
    const graveTip = p.grave.length ? p.grave.map((c) => c.spec.name).join('、') : '墓地は空';
    el.innerHTML = `
      <div class="portrait">${PORTRAIT[p.index]}</div>
      <div class="pb-name">${esc(p.name)}</div>
      <div class="hpbar${p.hp <= 1500 ? ' low' : ''}"><i style="width:${pct}%"></i><span>♥ ${Math.max(0, p.hp)} / ${g.cfg.startHP}</span></div>
      <div class="mana" title="マナ（今使える量 / 最大マナ）"><span class="gem">◆</span><b>${p.mana}</b><small>/ ${p.maxMana}</small><span class="mcap">上限${g.cfg.maxManaCap}</span></div>
      <div class="ember${p.ember ? ' on' : ''}" title="火種：攻撃されるたびに1つ得る（${g.cfg.emberCap}つまで）。マナの代わりに使えるほか、${g.cfg.emberBlockCost}つ払って相手の本体への攻撃をブロックできる">🔥<b>${p.ember}</b><small>/${g.cfg.emberCap}</small></div>
      <div class="pb-info">
        <span title="手札">🂠 ${p.hand.length}</span><span title="山札（0枚で引くと負け）" class="${p.deck.length <= 5 ? 'warn' : ''}">📚 ${p.deck.length}</span><span title="${esc(graveTip)}">⚰ ${p.grave.length}</span>
        ${p.locks.spell != null ? '<span class="lock">🔒呪文封じ</span>' : ''}${p.locks.summon != null ? '<span class="lock">🔒召喚封じ</span>' : ''}${p.locks.attack != null ? '<span class="lock">🔒攻撃封じ</span>' : ''}${p.nextDiscount ? `<span class="buffchip">次のカード-${p.nextDiscount}</span>` : ''}
      </div>
      ${p.index === OP ? `<div class="op-hand">${'<i></i>'.repeat(Math.min(10, p.hand.length))}</div>` : ''}`;
    el.onclick = () => clickPlayer(p.index);
  }

  function renderField(p) {
    const g = B.game;
    const box = $('#field-' + p.index);
    if (!box.firstChild) box.innerHTML = '<div class="slots">' + '<div class="slot"></div>'.repeat(g.cfg.fieldLimit) + '</div><div class="units"></div>';
    const units = $('.units', box);
    const alive = new Set(p.field.map((u) => u.uid));
    for (const [uid, el] of B.unitEls) {
      if (el.dataset.owner !== String(p.index) || alive.has(uid)) continue;
      B.unitEls.delete(uid);
      el.classList.add('dying');
      setTimeout(() => el.remove(), 500);
    }
    const pd = g.pending && g.pending.player === ME && g.pending.kind === 'targets' ? g.pending : null;
    const attackTargets = B.attackFrom ? g.attackTargets(ME, B.attackFrom) : [];
    p.field.forEach((u, i) => {
      let el = B.unitEls.get(u.uid);
      if (!el) {
        el = document.createElement('div');
        el.className = 'unit';
        el.dataset.owner = String(p.index);
        el.onclick = () => clickUnit(u.uid);
        B.unitEls.set(u.uid, el);
        units.appendChild(el);
      }
      el.style.setProperty('--i', i);
      const pw = g.powerOf(u);
      const kws = Object.keys(Parts.KEYWORDS).filter((k) => g.hasKw(u, k)).map((k) => Parts.KEYWORDS[k].label);
      const canAtt = p.index === ME && g.canAttack(ME, u.uid);
      const canAct = p.index === ME && (u.spec.effects || []).some((e, i) => e.trig === 'activate' && g.canActivate(ME, u.uid, i));
      el.className = 'unit' + (u.tapped ? ' tapped' : '') + (u.sick ? ' sick' : '') + (canAtt ? ' can-attack' : '')
        + (B.attackFrom === u.uid ? ' selected' : '') + (attackTargets.includes(u.uid) ? ' targetable' : '')
        + (pd && pd.options.includes(u.uid) ? ' pickable' : '') + (B.picks.includes(u.uid) ? ' picked' : '')
        + (g.hasKw(u, 'guard') ? ' guard' : '') + (canAct ? ' can-activate' : '') + (u.silenced ? ' silenced' : '') + (u.frozen ? ' frozen' : '');
      el.style.setProperty('--cc', u.spec.color || '#5f8f4e');
      el.dataset.pv = '1';
      el.dataset.power = pw;
      el.dataset.now = `今のパワー ${pw}${u.tapped ? '・タップ中（相手の攻撃対象になる）' : '・アンタップ（攻撃されない）'}${u.sick ? '・召喚したターン' : ''}${u.silenced ? '・能力を消されている' : ''}${u.frozen ? '・凍結（次のターンにアンタップしない）' : ''}${u.protectedBy != null ? '・破壊されない' : ''}${u.returnTo != null ? '・このターンだけ奪われている' : ''}${kws.length ? '　キーワード：' + kws.join('・') : ''}`;
      el.innerHTML = `
        <div class="u-inner">
          <div class="u-cost">${u.spec.cost}</div>
          <div class="u-art">${esc(u.icon || '❔')}</div>
          <div class="u-name">${esc(u.name)}</div>
          <div class="u-kw">${esc(kws.join('・'))}${(u.spec.effects || []).length ? '<span class="u-fx">✦</span>' : ''}</div>
          <div class="u-power${pw > u.power ? ' up' : pw < u.power ? ' down' : ''}">${pw}</div>
          ${u.tapped ? '<div class="u-tap">TAP</div>' : ''}
          ${u.sick && !u.tapped ? '<div class="u-sick" title="召喚したターンは攻撃できない">💤</div>' : ''}
          ${u.frozen ? '<div class="u-frozen" title="凍結">❄</div>' : ''}${u.silenced ? '<div class="u-silenced" title="能力を消されている">🚫</div>' : ''}
        </div>`;
      UI.bindSpec(el, u.spec); // マウスを乗せるとカードを拡大表示
    });
  }

  function renderHand() {
    const g = B.game;
    const me = g.players[ME];
    const box = $('#hand');
    box.innerHTML = '';
    const n = me.hand.length;
    me.hand.forEach((c, i) => {
      const chk = g.canPlay(ME, c.iid);
      const el = UI.cardEl(c.spec, { badge: !chk.ok && g.active === ME && !g.pending ? chk.reason : '', cost: g.costOf(me, c.spec) });
      const off = i - (n - 1) / 2;
      el.style.setProperty('--r', (off * 3).toFixed(1) + 'deg');
      el.style.setProperty('--y', (Math.abs(off) ** 1.5 * 3).toFixed(1) + 'px');
      el.classList.add(chk.ok ? 'playable' : 'unplayable');
      el.onclick = () => clickHand(c.iid);
      box.appendChild(el);
    });
  }

  function renderMid() {
    const g = B.game;
    const mine = g.active === ME;
    const stepLabel = g.step === 'main' ? 'メインステップ' : 'アタックステップ';
    $('#turn-info').innerHTML = `<span class="ti-who ${mine ? 'me' : 'op'}">${mine ? 'あなた' : 'CPU'}のターン</span><span class="ti-steps"><i class="${g.step === 'main' ? 'on' : ''}">メイン</i><i class="${g.step === 'attack' ? 'on' : ''}">アタック</i></span>${mine && g.step === 'attack' ? `<span class="ti-hint">${B.attackFrom ? '攻撃先を選ぶ（右クリック／Escでやめる）' : '攻撃するクリーチャーを選ぶ'}</span>` : mine ? '<span class="ti-hint">カードを使う</span>' : `<span class="ti-hint">${esc(stepLabel)}…</span>`}`;
    $('#btn-attack').disabled = !myTurn('main');
    $('#btn-end').disabled = !myTurn();
  }

  function showResult() {
    const g = B.game;
    stop();
    const win = g.winner === ME;
    const [me, op] = g.players;
    setTimeout(() => {
      UI.modal(`<span class="result ${win ? 'win' : 'lose'}">${win ? 'VICTORY' : 'DEFEAT'}</span>`,
        `<p class="result-sub">${win ? '勝利！' : '敗北…'}　${esc(g.endReason)}（${g.turn}ターン）</p>
        <table class="result-table"><tr><th></th><th>あなた</th><th>CPU</th></tr>
        <tr><td>残り体力</td><td>${Math.max(0, me.hp)}</td><td>${Math.max(0, op.hp)}</td></tr>
        <tr><td>与えたダメージ</td><td>${me.stats.damage}</td><td>${op.stats.damage}</td></tr>
        <tr><td>使ったカード</td><td>${me.stats.played}</td><td>${op.stats.played}</td></tr>
        <tr><td>破壊したクリーチャー</td><td>${me.stats.destroyed}</td><td>${op.stats.destroyed}</td></tr></table>`,
        [
          { label: 'タイトルへ', onClick: () => { UI.closeModal(); UI.showScreen('title'); } },
          { label: 'もう一度', primary: true, onClick: () => { UI.closeModal(); start({ ...B.setup, cpuDeck: AI.buildDeck() }); } },
        ]);
    }, 900);
  }

  function init() {
    document.addEventListener('keydown', onKey);
    $('#screen-battle').addEventListener('contextmenu', (e) => { if (B.attackFrom) { e.preventDefault(); B.attackFrom = null; B.sig = ''; } });
    $('#btn-attack').onclick = () => { if (myTurn('main')) B.game.toAttack(ME); };
    $('#btn-end').onclick = () => {
      if (!myTurn()) return;
      const g = B.game;
      const left = g.players[ME].field.filter((u) => g.canAttack(ME, u.uid) || (g.step === 'main' && !u.tapped && !u.sick && !(u.spec.keywords || []).includes('slow'))).length;
      B.attackFrom = null;
      if (left && g.step === 'main') {
        UI.modal('ターン終了', `<p>まだ攻撃していないクリーチャーが${left}体います。攻撃せずにターンを終えますか？</p>`, [
          { label: 'アタックへ', onClick: () => { UI.closeModal(); g.toAttack(ME); } },
          { label: 'ターン終了', primary: true, onClick: () => { UI.closeModal(); g.endTurn(ME); } },
        ]);
      } else g.endTurn(ME);
    };
    $('#btn-menu').onclick = openMenu;
  }

  root.Battle = { init, start };
})(this);
