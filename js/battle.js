/*
 * battle.js — 対戦画面
 *
 * 描画の考え方:
 *   ・requestAnimationFrame で毎フレーム game.update(経過秒) を呼ぶ
 *   ・手札や体力など「構造」の描画は、状態が変わったとき（signature が変化したとき）だけ作り直す
 *   ・詠唱ゲージや時計など「連続的に変わるもの」は毎フレーム幅や文字だけ更新する
 *
 * 選択の操作（どちらも選んでいる間は時間が止まる）:
 *   ・対象選択モード：対象を選ぶカードを使おうとすると入る。光っているクリーチャーをクリック
 *     （または数字キー）で決定、右クリック・Esc でキャンセル。TARGET_TIME 秒で自動キャンセル
 *   ・効果の途中での選択（捨てるカードなど）：エンジンの pending を画面に表示して選ばせる
 */
(function (root) {
  'use strict';
  const { Cards, Engine, AI, UI } = root;
  const { $, esc } = UI;

  const ME = 0, OP = 1;
  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  const TARGET_TIME = 5; // 対象選択の制限時間（秒）

  const B = {
    game: null, ai: null, raf: 0, last: 0, paused: false,
    sig: '', logShown: 0, setup: null, unitEls: [new Map(), new Map()],
    targeting: null, // { idx, card, uids, timeLeft } 対象選択モード中
    choiceKey: null, // 表示中の選択画面（同じ選択を作り直さないため）
    picked: [],      // 選択画面で選んだ番号
  };

  function start(setup) {
    // setup: { myDeck, cpuDeck, level, cpuName }
    stop();
    B.setup = setup;
    B.game = new Engine.Game({ decks: [setup.myDeck, setup.cpuDeck], names: ['あなた', setup.cpuName || 'CPU'] });
    B.ai = new AI.AI(B.game, OP, setup.level);
    B.game.players[ME].human = true; // 効果の途中での選択を画面で行う
    B.game.onEvent = onEvent;
    B.targeting = null;
    B.choiceKey = null;
    closeChoice();
    B.paused = false;
    B.sig = '';
    B.logShown = 0;
    B.unitEls = [new Map(), new Map()];
    $('#log').innerHTML = '';
    $('#field-0').innerHTML = '';
    $('#field-1').innerHTML = '';
    UI.closeOverlay();
    UI.showScreen('battle');
    UI.toast('バトル開始！');
    B.last = performance.now();
    B.raf = requestAnimationFrame(loop);
  }

  function stop() {
    cancelAnimationFrame(B.raf);
    B.raf = 0;
  }

  function loop(now) {
    // タブ切り替えなどで間が空いても一気に進みすぎないよう、1フレームの最大を0.1秒に制限
    const dt = Math.min(0.1, (now - B.last) / 1000);
    B.last = now;
    const g = B.game;
    if (!B.paused && !g.over) {
      if (B.targeting) {
        // 対象選択中は時間が止まる（制限時間だけ進む）
        B.targeting.timeLeft -= dt;
        if (B.targeting.timeLeft <= 0) cancelTargeting('時間切れ');
      } else {
        g.update(dt); // 選択待ち（g.pending）の間はエンジン側で時間が止まる
        if (!g.pending) B.ai.update(dt);
      }
    }
    render();
    if (g.over) { showResult(); return; }
    B.raf = requestAnimationFrame(loop);
  }

  // ───────────── 入力 ─────────────
  function tryPlay(idx) {
    const g = B.game;
    if (!g || g.over || B.paused || g.pending) return;
    // 対象選択中に同じカードをもう一度押したらキャンセル
    if (B.targeting) { const same = B.targeting.idx === idx; cancelTargeting(); if (same) return; }
    const c = Cards.get(g.players[ME].hand[idx]);
    const chk = g.canPlay(ME, idx);
    if (!chk.ok) { if (chk.reason) UI.toast(chk.reason, 700); return; }
    if (c.target) {
      const valid = g.validTargets(g.players[ME], c);
      if (valid.length) {
        B.targeting = { idx, card: c, uids: valid.map((v) => v.unit.uid), timeLeft: TARGET_TIME };
        B.sig = ''; // 描画を更新して対象を光らせる
        return;
      }
    }
    g.play(ME, idx);
  }

  function chooseTarget(uid) {
    const t = B.targeting;
    if (!t || !t.uids.includes(uid)) return;
    B.targeting = null;
    B.sig = '';
    const r = B.game.play(ME, t.idx, { target: uid });
    if (!r.ok && r.reason) UI.toast(r.reason, 700);
  }

  function cancelTargeting(msg) {
    if (!B.targeting) return;
    B.targeting = null;
    B.sig = '';
    if (msg) UI.toast(msg, 600);
  }

  function onKey(e) {
    if (!$('#screen-battle').classList.contains('active') || !B.game || B.game.over) return;
    const g = B.game;
    const i = KEYS.indexOf(e.key);
    // 効果の途中での選択中は、数字キーで候補を選ぶ
    if (g.pending && g.pending.player === ME && !B.paused) { if (i >= 0) toggleChoice(i); return; }
    if (B.targeting) {
      if (e.key === 'Escape') { cancelTargeting(); return; }
      if (i >= 0 && i < B.targeting.uids.length) chooseTarget(B.targeting.uids[i]);
      return;
    }
    if (e.key === 'Escape') { togglePause(); return; }
    if (i >= 0) tryPlay(i);
  }

  // ───────────── 効果の途中での選択画面 ─────────────
  function renderChoice() {
    const g = B.game;
    const pd = g.pending && g.pending.player === ME ? g.pending : null;
    if (!pd) { if (B.choiceKey) closeChoice(); return; }
    if (B.choiceKey !== pd) {
      B.choiceKey = pd;
      B.picked = [];
      $('#choice-prompt').textContent = pd.prompt || '選んでください';
      const box = $('#choice-cards');
      box.innerHTML = '';
      pd.options.forEach((id, i) => {
        const el = UI.cardEl(Cards.get(id), { key: KEYS[i] });
        el.onclick = () => toggleChoice(i);
        box.appendChild(el);
      });
      $('#choice').classList.remove('hidden');
    }
    $('#choice-timer').textContent = `残り ${Math.max(0, pd.timeLeft).toFixed(1)} 秒（時間切れならランダム）　${B.picked.length} / ${pd.count}`;
  }

  function toggleChoice(i) {
    const pd = B.game.pending;
    if (!pd || i >= pd.options.length) return;
    const k = B.picked.indexOf(i);
    if (k >= 0) B.picked.splice(k, 1); else B.picked.push(i);
    document.querySelectorAll('#choice-cards .card').forEach((el, j) => el.classList.toggle('picked', B.picked.includes(j)));
    if (B.picked.length >= pd.count) {
      const pick = B.picked.slice();
      closeChoice();
      B.game.resolveChoice(pick);
    }
  }

  function closeChoice() {
    B.choiceKey = null;
    B.picked = [];
    $('#choice').classList.add('hidden');
  }

  function togglePause() {
    if (!B.game || B.game.over) return;
    B.paused = !B.paused;
    if (B.paused) {
      UI.overlay('一時停止', '', [
        { label: '降参してタイトルへ', onClick: () => { stop(); UI.closeOverlay(); UI.showScreen('title'); } },
        { label: '再開', primary: true, onClick: togglePause },
      ]);
    } else {
      UI.closeOverlay();
      B.last = performance.now();
    }
  }

  // ───────────── 演出 ─────────────
  function onEvent(ev) {
    switch (ev.type) {
      case 'damage':
        if (ev.amount > 0) { flashSide(ev.player, 'hit'); floatText(ev.player, '-' + ev.amount, 'dmg'); }
        else if (ev.absorbed) floatText(ev.player, '🔰' + ev.absorbed, 'heal');
        break;
      case 'heal':
        flashSide(ev.player, 'healed');
        floatText(ev.player, '+' + ev.amount, 'heal');
        break;
      case 'attack': {
        // 攻撃したユニットを少し前に突き出すアニメーション（描画の後で適用）
        requestAnimationFrame(() => {
          const el = B.unitEls[ev.player].get(ev.unit.uid);
          if (!el) return;
          el.classList.remove('attacking');
          void el.offsetWidth; // アニメーションを再始動させるための定番テクニック
          el.classList.add('attacking');
        });
        break;
      }
      case 'counter':
        UI.toast(ev.player === ME ? `【${ev.card.name}】を打ち消された！` : `【${ev.card.name}】を打ち消した！`);
        break;
      case 'phase':
        UI.toast(`第${ev.phase}フェーズ`, 800);
        break;
    }
  }

  function flashSide(pi, cls) {
    const el = $('#side-' + pi);
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 250);
  }

  function floatText(pi, text, cls) {
    const box = $('#pbar-' + pi + ' .hpbox');
    if (!box) return;
    const r = box.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'float ' + cls;
    el.textContent = text;
    el.style.left = r.right + 8 + Math.random() * 20 + 'px';
    el.style.top = r.top - 6 + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  // ───────────── 描画 ─────────────
  function render() {
    const g = B.game;
    // 秒単位の残り時間も signature に含め、表示の数字が変わる時だけ作り直す
    const sig = g.version + '|' + g.players.map((p) => [Math.ceil(p.silence), Math.ceil(p.haste), Math.ceil(p.curse)].join(',')).join('|');
    if (sig !== B.sig) {
      B.sig = sig;
      g.players.forEach((p) => { renderPbar(p); renderField(p); renderCastHead(p); });
      renderHand();
      renderLog();
    }
    renderChoice();
    // 対象選択モードの案内
    const tb = $('#target-banner');
    if (B.targeting) {
      tb.classList.remove('hidden');
      tb.textContent = `【${B.targeting.card.name}】の対象（${B.targeting.card.target.label || 'クリーチャー'}）を選んでください … 残り ${Math.max(0, B.targeting.timeLeft).toFixed(1)} 秒　／　右クリック・Esc でキャンセル`;
    } else {
      tb.classList.add('hidden');
    }
    // 【自律】の次の攻撃までのゲージ
    g.players.forEach((p) => p.field.forEach((u) => {
      if (!u.auto) return;
      const bar = B.unitEls[p.index].get(u.uid);
      const f = bar && bar.querySelector('.u-auto i');
      if (f) f.style.width = (100 * (1 - u.autoT / u.auto)).toFixed(0) + '%';
    }));
    // 毎フレーム更新するもの
    g.players.forEach((p) => {
      const fill = $('#cast-' + p.index + ' .cb-fill');
      if (fill && p.casting) fill.style.width = (100 * (1 - p.casting.remain / p.casting.total)).toFixed(1) + '%';
      const left = $('#cast-' + p.index + ' .cb-left');
      if (left && p.casting) left.textContent = (p.casting.remain / (p.haste > 0 ? 2 : 1)).toFixed(1) + 's';
    });
    $('#phase-fill').style.width = (100 * (1 - g.phaseTimer / g.cfg.phaseTime)) + '%';
    $('#phase-label').textContent = `第${g.phase}フェーズ　次まで ${Math.max(0, g.phaseTimer).toFixed(1)}s`;
    const rest = Math.max(0, g.cfg.matchTime - g.time);
    const clock = $('#clock');
    clock.textContent = `${Math.floor(rest / 60)}:${String(Math.floor(rest % 60)).padStart(2, '0')}`;
    clock.classList.toggle('low', rest < 30);
  }

  function renderPbar(p) {
    const g = B.game;
    const hpPct = Math.max(0, (p.hp / g.cfg.startHP) * 100);
    let pips = '';
    const n = Math.max(p.maxMana, p.mana);
    for (let i = 0; i < n; i++) pips += `<span class="pip ${i < p.mana ? (i >= p.maxMana ? 'extra' : 'on') : ''}"></span>`;
    const st = [];
    if (p.stun > 0) st.push(`<span class="status silence">⌛停止 ${Math.ceil(p.stun)}s</span>`);
    if (p.silence > 0) st.push(`<span class="status silence">⛓封印 ${Math.ceil(p.silence)}s</span>`);
    if (p.haste > 0) st.push(`<span class="status haste">⏩加速 ${Math.ceil(p.haste)}s</span>`);
    if (p.curse > 0) st.push(`<span class="status curse">💀呪い ${Math.ceil(p.curse)}s</span>`);
    if (p.shield > 0) st.push(`<span class="status shield">🔰防壁 ${p.shield}</span>`);
    if (p.instantNext) st.push('<span class="status haste">💫次は即時詠唱</span>');
    if (p.spellDiscount) st.push(`<span class="status haste">📚次の呪文-${p.spellDiscount}</span>`);
    if (p.manaDebt) st.push(`<span class="status curse">💸次フェーズ マナ-${p.manaDebt}</span>`);
    if (p.skipDraw) st.push(`<span class="status curse">📓次フェーズ ドロー-${p.skipDraw}</span>`);
    if (p.bonusDraw) st.push(`<span class="status haste">📈次フェーズ ドロー+${p.bonusDraw}</span>`);
    if (p.bonusMana) st.push(`<span class="status haste">🐷次フェーズ マナ+${p.bonusMana}</span>`);
    if (p.regen) st.push(`<span class="status haste">🌿再生 あと${p.regen}回</span>`);
    if (p.phaseDiscount) st.push(`<span class="status haste">⚙️このフェーズ コスト-${p.phaseDiscount}</span>`);
    $('#pbar-' + p.index).innerHTML = `
      <span class="pname">${esc(p.name)}</span>
      <div class="hpbox"><div class="hpfill" style="width:${hpPct}%"></div><div class="hptext">♥ ${Math.max(0, p.hp)} / ${g.cfg.startHP}</div></div>
      <div class="mana">${pips}<span class="mtext">${p.mana}/${p.maxMana}</span></div>
      <span class="pinfo">手札 ${p.hand.length}　山札 ${p.deck.length}　<span class="grave" title="${esc(graveTip(p))}">墓地 ${p.grave.length}</span></span>
      ${st.join('')}`;
  }

  const g2 = () => B.game;

  function graveTip(p) {
    if (!p.grave.length) return '墓地は空';
    const counts = {};
    p.grave.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
    const creatures = B.game.graveCreatures(p);
    return `墓地 ${p.grave.length}枚（うちクリーチャー${creatures}体）\n` +
      Object.entries(counts).map(([id, n]) => `${Cards.get(id).name}${n > 1 ? ' ×' + n : ''}`).join('\n');
  }

  function renderCastHead(p) {
    const el = $('#cast-' + p.index);
    const c = p.casting && p.casting.card;
    el.classList.toggle('active', !!c);
    if (!c) {
      el.innerHTML = `<span class="cb-empty">${p.index === ME ? '（詠唱なし）' : '（相手は詠唱していない）'}</span>`;
      return;
    }
    const tu = p.casting.target != null ? B.game.findUnit(p.casting.target) : null;
    el.innerHTML = `
      <span class="cb-name">${c.icon} ${esc(c.name)}</span>
      ${tu ? `<span class="cb-target">→ 対象：${esc(tu.unit.name)}</span>` : ''}
      <span class="cb-text">${c.type === 'creature' ? `⚔${c.atk} ♥${c.hp} ` : ''}${esc(Cards.fullText(c))}</span>
      <div class="cb-gauge"><div class="cb-fill"></div></div>
      <span class="cb-left"></span>`;
  }

  // 場のクリーチャーは uid ごとに要素を使い回す（毎回作り直すと召喚アニメが繰り返されるため）
  function renderField(p) {
    const box = $('#field-' + p.index);
    const map = B.unitEls[p.index];
    const alive = new Set(p.field.map((u) => u.uid));
    for (const [uid, el] of map) if (!alive.has(uid)) { el.remove(); map.delete(uid); }
    p.field.forEach((u) => {
      let el = map.get(u.uid);
      if (!el) {
        el = document.createElement('div');
        el.className = 'unit';
        const uid = u.uid;
        el.onclick = () => chooseTarget(uid);
        map.set(u.uid, el);
        box.appendChild(el);
      }
      const d = Cards.get(u.id);
      const kw = [
        u.guard && (u.spent ? '守護(済)' : '守護'), u.stealth && '潜伏', u.lifesteal && '吸血',
        u.pierce && '貫通', u.undying && !u.usedUndying && '不屈', u.armor && '堅牢',
        u.auto && `自律${u.auto}s`, u.muted && '沈黙',
      ].filter(Boolean).join('・');
      const tIdx = B.targeting ? B.targeting.uids.indexOf(u.uid) : -1;
      el.classList.toggle('guard', !!u.guard);
      el.classList.toggle('muted', !!u.muted);
      el.classList.toggle('targetable', tIdx >= 0);
      // 相手が詠唱中のカードの対象になっていたら印を付ける
      const aimed = g2().players.some((q) => q.casting && q.casting.target === u.uid);
      el.classList.toggle('aimed', aimed);
      const atk = B.game.atkOf(p, u);
      el.classList.toggle('spent', !!(u.guard && u.spent));
      el.classList.toggle('token', !!u.token);
      el.innerHTML = `<div class="u-name">${esc(u.name)}${d.text && !u.muted ? ' ✦' : ''}</div><div class="u-icon">${u.icon}</div>
        <div class="u-kw">${kw}</div><div class="u-stats"><span class="atk${atk > u.atk ? ' boosted' : ''}">⚔${atk}</span><span class="hp">♥${u.hp}</span></div>
        ${u.auto ? '<div class="u-auto"><i></i></div>' : ''}
        ${tIdx >= 0 ? `<div class="u-tnum">${KEYS[tIdx]}</div>` : ''}
        ${aimed ? '<div class="u-aim">🎯</div>' : ''}`;
      el.title = UI.cardTip(d) + (u.guard && u.spent ? '\n（このフェーズは既に攻撃を受け止めた）' : '');
    });
  }

  function renderHand() {
    const g = B.game;
    const p = g.players[ME];
    const box = $('#hand');
    box.innerHTML = '';
    p.hand.forEach((id, i) => {
      const c = Cards.get(id);
      const chk = g.canPlay(ME, i);
      // 場が満杯の時にクリーチャーを出すと、一番古い味方が倒れることを警告
      const full = chk.ok && c.type === 'creature' && !c.sacCost && p.field.length >= g.cfg.fieldLimit;
      // 生贄になる味方を事前に知らせる
      const sac = chk.ok && c.sacCost ? '🔪' + g.sacrificeTargets(p, c.sacCost).map((u) => u.name).join('・') : '';
      const el = UI.cardEl(c, {
        key: KEYS[i], cost: g.costOf(p, id), cast: g.castOf(p, id),
        badge: chk.ok ? (sac || (full ? `⚠${p.field[0].name}と入替` : '')) : chk.reason,
      });
      el.classList.add(chk.ok ? 'playable' : 'disabled');
      if (B.targeting && B.targeting.idx === i) el.classList.add('selecting');
      el.onclick = () => tryPlay(i);
      box.appendChild(el);
    });
  }

  function renderLog() {
    const logs = B.game.logs;
    const box = $('#log');
    // 古いログが削除された場合に備えて、表示済み件数を調整
    if (B.logShown > logs.length) B.logShown = 0;
    for (let i = B.logShown; i < logs.length; i++) {
      const l = logs[i];
      const d = document.createElement('div');
      d.className = `${l.kind} ${l.who != null ? 'who-' + l.who : ''}`;
      d.textContent = l.text;
      box.appendChild(d);
    }
    B.logShown = logs.length;
    while (box.children.length > 120) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
  }

  function showResult() {
    const g = B.game;
    const title = g.winner === ME ? '勝利！' : g.winner === OP ? '敗北…' : '引き分け';
    const [me, op] = g.players;
    const row = (label, a, b) => `<tr><td>${label}</td><td>${a}</td><td>${b}</td></tr>`;
    const body = `
      <p>${g.endReason}（${Math.floor(g.time / 60)}分${Math.floor(g.time % 60)}秒）</p>
      <table class="result-stats">
        <tr><th></th><th>あなた</th><th>${esc(op.name)}</th></tr>
        ${row('残り体力', Math.max(0, me.hp), Math.max(0, op.hp))}
        ${row('与えたダメージ', me.stats.damageDealt, op.stats.damageDealt)}
        ${row('使ったカード', me.stats.cardsPlayed, op.stats.cardsPlayed)}
        ${row('打ち消した回数', me.stats.countered, op.stats.countered)}
      </table>`;
    setTimeout(() => {
      UI.overlay(title, body, [
        { label: 'タイトルへ', onClick: () => { UI.closeOverlay(); UI.showScreen('title'); } },
        { label: 'もう一度', primary: true, onClick: () => start(B.setup) },
      ]);
    }, 600);
  }

  function init() {
    document.addEventListener('keydown', onKey);
    // 右クリックで対象選択をキャンセル
    $('#screen-battle').addEventListener('contextmenu', (e) => { if (B.targeting) { e.preventDefault(); cancelTargeting(); } });
    $('#btn-pause').onclick = togglePause;
  }

  root.Battle = { init, start };
})(this);
