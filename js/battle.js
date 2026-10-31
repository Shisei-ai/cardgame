/*
 * battle.js — 対戦画面
 *
 * 描画の考え方:
 *   ・requestAnimationFrame で毎フレーム game.update(経過秒) を呼ぶ
 *   ・手札や体力など「構造」の描画は、状態が変わったとき（signature が変化したとき）だけ作り直す
 *   ・詠唱の進み具合や時計など「連続的に変わるもの」は毎フレーム値だけ更新する
 *   ・演出（攻撃の光・ダメージ数値など）は、エンジンが出すイベント（onEvent）をきっかけに再生する
 *
 * 選択の操作（どちらも選んでいる間は時間が止まる）:
 *   ・対象選択モード：対象を選ぶカードを使おうとすると入る。光っているクリーチャーをクリック
 *     （または数字キー）で決定、右クリック・Esc でキャンセル。TARGET_TIME 秒で自動キャンセル
 *   ・効果の途中での選択（捨てるカードなど）：エンジンの pending を画面に表示して選ばせる
 */
(function (root) {
  'use strict';
  const { Cards, Engine, AI, UI } = root;
  const { $, esc, fx } = UI;

  const ME = 0, OP = 1;
  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
  const TARGET_TIME = 5; // 対象選択の制限時間（秒）
  const PORTRAITS = ['🧙', '🤖'];

  const B = {
    game: null, ai: null, raf: 0, last: 0, paused: false,
    sig: '', logShown: 0, setup: null,
    unitEls: [new Map(), new Map()], // 場にいるクリーチャーの要素（uid → 要素）
    elByUid: new Map(),              // 倒れて消えていく途中の要素も含む（演出の位置を求めるため）
    targeting: null, // { idx, card, uids, timeLeft } 対象選択モード中
    choiceKey: null, // 表示中の選択画面（同じ選択を作り直さないため）
    picked: [],      // 選択画面で選んだ番号
    castKey: ['', ''], // 台座に表示中の詠唱（同じものを作り直さないため）
  };

  function start(setup) {
    // setup: { myDeck, cpuDeck, level, cpuName }
    stop();
    B.setup = setup;
    B.game = new Engine.Game({ decks: [setup.myDeck, setup.cpuDeck], names: ['あなた', setup.cpuName || 'CPU'] });
    B.ai = new AI.AI(B.game, OP, setup.level);
    B.game.players[ME].human = true; // 効果の途中での選択を画面で行う
    B.game.onEvent = onEvent;
    B.paused = false;
    B.sig = '';
    B.logShown = 0;
    B.unitEls = [new Map(), new Map()];
    B.elByUid = new Map();
    B.targeting = null;
    B.choiceKey = null;
    B.castKey = ['', ''];
    closeChoice();
    ['#log', '#field-0', '#field-1', '#fx', '#cast-0', '#cast-1'].forEach((s) => { $(s).innerHTML = ''; });
    $('#vignette').classList.remove('on');
    UI.closeOverlay();
    UI.showScreen('battle');
    showBanner('BATTLE START', '同時詠唱の決闘、開始');
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
        UI.hidePreview();
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

  function togglePause() {
    if (!B.game || B.game.over) return;
    B.paused = !B.paused;
    if (B.paused) {
      UI.overlay('一時停止', '<p class="result-sub">時間は止まっています</p>', [
        { label: '降参してタイトルへ', onClick: () => { stop(); UI.closeOverlay(); UI.showScreen('title'); } },
        { label: '再開', primary: true, onClick: togglePause },
      ]);
    } else {
      UI.closeOverlay();
      B.last = performance.now();
    }
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
      UI.hidePreview();
    }
    $('#choice-timer').textContent = `残り ${Math.max(0, pd.timeLeft).toFixed(1)} 秒（時間切れならランダム）　${B.picked.length} / ${pd.count}`;
    $('#choice-bar').style.width = Math.max(0, (pd.timeLeft / g.cfg.choiceTime) * 100) + '%';
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

  // ───────────── 演出 ─────────────
  /** 要素が描画された後に処理したいとき用（イベントは描画の前に届くため） */
  const later = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
  const portraitOf = (pi) => $(`#pbar-${pi} .portrait`);
  const unitElOf = (unit) => B.elByUid.get(unit.uid);

  function onEvent(ev) {
    switch (ev.type) {
      case 'damage': {
        const pt = portraitOf(ev.player);
        if (ev.amount > 0) {
          UI.pulseClass($('#side-' + ev.player), 'hit', 350);
          if (pt) { const p = UI.stagePoint(pt); fx.float(p.x + 40, p.y, '-' + ev.amount, 'dmg'); }
          if (ev.player === ME && ev.amount >= 5) UI.pulseClass($('#board'), 'shake', 350);
        } else if (ev.absorbed && pt) {
          const p = UI.stagePoint(pt);
          fx.float(p.x + 40, p.y, '🔰' + ev.absorbed, 'shield');
        }
        break;
      }
      case 'heal': {
        UI.pulseClass($('#side-' + ev.player), 'healed', 450);
        const pt = portraitOf(ev.player);
        if (pt) { const p = UI.stagePoint(pt); fx.float(p.x + 40, p.y, '+' + ev.amount, 'heal'); }
        break;
      }
      case 'unitHit':
        if (ev.amount <= 0) break;
        later(() => {
          const el = unitElOf(ev.unit);
          if (!el) return;
          UI.pulseClass(el, 'hitflash', 300);
          const p = UI.stagePoint(el, 0.35);
          fx.float(p.x, p.y, '-' + ev.amount, 'dmg small');
        });
        break;
      case 'attack':
        later(() => {
          const el = unitElOf(ev.unit);
          if (!el) return;
          UI.pulseClass(el, 'attacking', 320);
          const from = UI.stagePoint(el, 0.4);
          const tgtEl = ev.target ? unitElOf(ev.target) : portraitOf(1 - ev.player);
          if (tgtEl) fx.bolt(from, UI.stagePoint(tgtEl, 0.45), ev.player === ME ? '#8fd0ff' : '#ff9a6b');
        });
        break;
      case 'play': {
        // 使ったカードが手札（相手なら画面上）から台座へ飛んでいく
        const ped = $('#cast-' + ev.player);
        const to = UI.stagePoint(ped);
        to.x -= 50;
        const from = ev.player === ME ? UI.stagePoint($('#hand'), 0.6) : { x: to.x + 40, y: -60 };
        fx.flyCard(ev.card, from, to);
        break;
      }
      case 'counter': {
        const p = UI.stagePoint($('#cast-' + ev.player));
        fx.stamp(p, '打ち消し！', '#ff6b8a');
        UI.toast(ev.player === ME ? `【${ev.card.name}】を打ち消された！` : `【${ev.card.name}】を打ち消した！`);
        break;
      }
      case 'phase':
        showBanner(`PHASE ${ev.phase}`, B.game.cfg.phaseDraw ? `カードを${B.game.cfg.phaseDraw}枚ドロー` : '守護が回復・フェーズ開始時の効果');
        break;
    }
  }

  function showBanner(big, small) {
    const el = $('#phase-banner');
    el.innerHTML = `<b>${esc(big)}</b><span>${esc(small)}</span>`;
    UI.pulseClass(el, 'show', 1200);
  }

  // ───────────── 描画 ─────────────
  function render() {
    const g = B.game;
    // 秒単位の残り時間も signature に含め、表示の数字が変わる時だけ作り直す
    const sig = g.version + '|' + g.players.map((p) => [Math.ceil(p.silence), Math.ceil(p.haste), Math.ceil(p.curse), Math.ceil(p.stun)].join(',')).join('|');
    if (sig !== B.sig) {
      B.sig = sig;
      g.players.forEach((p) => { renderPbar(p); renderField(p); renderCast(p); });
      renderHand();
      renderLog();
      $('#vignette').classList.toggle('on', g.players[ME].hp <= g.cfg.startHP * 0.3 && !g.over);
    }
    renderChoice();
    // 対象選択モードの案内
    const tb = $('#target-banner');
    if (B.targeting) {
      tb.classList.remove('hidden');
      tb.textContent = `🎯【${B.targeting.card.name}】の対象（${B.targeting.card.target.label || 'クリーチャー'}）を選んでください … 残り ${Math.max(0, B.targeting.timeLeft).toFixed(1)} 秒　／　右クリック・Esc でキャンセル`;
    } else {
      tb.classList.add('hidden');
    }
    // 【自律】の次の攻撃までのゲージ
    g.players.forEach((p) => p.field.forEach((u) => {
      if (!u.auto) return;
      const el = B.unitEls[p.index].get(u.uid);
      const f = el && el.querySelector('.u-auto i');
      if (f) f.style.width = (100 * (1 - u.autoT / u.auto)).toFixed(0) + '%';
    }));
    // 詠唱の進み具合
    g.players.forEach((p) => {
      if (!p.casting) return;
      const ring = $(`#cast-${p.index} .pd-ring`);
      if (ring) ring.style.setProperty('--p', (1 - p.casting.remain / p.casting.total).toFixed(3));
      const left = $(`#cast-${p.index} .pd-left`);
      if (left) left.innerHTML = `${(p.casting.remain / (p.haste > 0 ? 2 : 1)).toFixed(1)}<small>秒</small>`;
    });
    // 次に溜まるマナの満ち具合と、次のドローまでのゲージ
    g.players.forEach((p) => {
      const pip = $(`#pbar-${p.index} .pip.next`);
      if (pip) pip.style.setProperty('--f', (p.mana % 1).toFixed(2));
      const dg = $(`#pbar-${p.index} .drawgauge i`);
      if (dg && g.cfg.drawInterval > 0) dg.style.width = (p.drawPause > 0 ? 0 : 100 * (1 - p.drawT / g.cfg.drawInterval)).toFixed(0) + '%';
    });
    // フェーズの時計と試合の残り時間
    const pp = 1 - g.phaseTimer / g.cfg.phaseTime;
    $('#phase-ring').style.setProperty('--p', pp.toFixed(3));
    $('#phase-fill').style.width = (pp * 100) + '%';
    $('#phase-num').textContent = g.phase;
    $('#phase-label').textContent = `次のフェーズまで ${Math.max(0, g.phaseTimer).toFixed(1)} 秒`;
    const rest = Math.max(0, g.cfg.matchTime - g.time);
    const clock = $('#clock');
    clock.textContent = `${Math.floor(rest / 60)}:${String(Math.floor(rest % 60)).padStart(2, '0')}`;
    clock.classList.toggle('low', rest < 30);
  }

  function statusChips(p) {
    const st = [];
    const add = (cls, text) => st.push(`<span class="status ${cls}">${text}</span>`);
    if (p.stun > 0) add('silence', `⌛停止 ${Math.ceil(p.stun)}s`);
    if (p.silence > 0) add('silence', `⛓封印 ${Math.ceil(p.silence)}s`);
    if (p.haste > 0) add('haste', `⏩加速 ${Math.ceil(p.haste)}s`);
    if (p.curse > 0) add('curse', `💀呪い ${Math.ceil(p.curse)}s`);
    if (p.shield > 0) add('shield', `🔰防壁 ${p.shield}`);
    if (p.instantNext) add('haste', '💫次は即時詠唱');
    if (p.spellDiscount) add('haste', `📚次の呪文-${p.spellDiscount}`);
    if (p.manaDebt) add('curse', `💸次 マナ-${p.manaDebt}`);
    if (p.drawPause > 0) add('curse', `📓ドロー停止 ${Math.ceil(p.drawPause)}s`);
    if (p.bonusDraw) add('haste', `📈次 ドロー+${p.bonusDraw}`);
    if (p.bonusMana) add('haste', `🐷次 マナ+${p.bonusMana}`);
    if (p.regen) add('haste', `🌿再生 あと${p.regen}回`);
    if (p.phaseDiscount) add('haste', `⚙️コスト-${p.phaseDiscount}`);
    return st.join('');
  }

  function renderPbar(p) {
    const g = B.game;
    const hpPct = Math.max(0, (p.hp / g.cfg.startHP) * 100);
    const el = $('#pbar-' + p.index);
    // 初回だけ骨組みを作り、以後は中身だけ更新する（体力の「減った分の残像」を動かすため）
    if (!el.firstChild) {
      el.innerHTML = `
        <div class="portrait">${PORTRAITS[p.index]}</div>
        <span class="pname">${esc(p.name)}</span>
        <div class="hpbox"><div class="hptrail"></div><div class="hpfill"></div><div class="hptext"></div></div>
        <div class="mana"></div>
        <div class="pinfo"></div>
        <div class="statuses"></div>`;
    }
    el.querySelector('.hpfill').style.width = hpPct + '%';
    el.querySelector('.hptrail').style.width = hpPct + '%';
    el.querySelector('.hpbox').classList.toggle('low', p.hp <= g.cfg.startHP * 0.3);
    el.querySelector('.hptext').textContent = `♥ ${Math.max(0, p.hp)} / ${g.cfg.startHP}`;
    // マナの宝石：使える分は光り、次に溜まる1つは下から満ちていく（満ち具合は毎フレーム更新）
    let pips = '';
    const whole = Math.floor(p.mana);
    for (let i = 0; i < p.maxMana; i++) pips += `<span class="pip ${i < whole ? 'on' : i === whole ? 'next' : ''}"></span>`;
    el.querySelector('.mana').innerHTML = `${pips}<span class="mtext">${whole}<small>/${p.maxMana}</small></span><span class="mrate" title="マナの回復速度">+${(() => { const r = g.regenOf(p); return r.toFixed(r % 1 ? 2 : 1); })()}/秒</span>`;
    el.querySelector('.pinfo').innerHTML = `<span class="handinfo" title="次のドローまで">🂠 手札 ${p.hand.length}<b class="drawgauge"><i></i></b></span><span>📚 山札 ${p.deck.length}</span><span class="grave" title="${esc(graveTip(p))}">⚰ 墓地 ${p.grave.length}</span>`;
    el.querySelector('.statuses').innerHTML = statusChips(p);
  }

  function graveTip(p) {
    if (!p.grave.length) return '墓地は空';
    const counts = {};
    p.grave.forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
    return `墓地 ${p.grave.length}枚（うちクリーチャー${B.game.graveCreatures(p)}体）\n` +
      Object.entries(counts).map(([id, n]) => `${Cards.get(id).name}${n > 1 ? ' ×' + n : ''}`).join('\n');
  }

  /** 詠唱の台座：詠唱中のカードと、進み具合の枠、対象を表示する */
  function renderCast(p) {
    const el = $('#cast-' + p.index);
    const c = p.casting && p.casting.card;
    const tu = c && p.casting.target != null ? B.game.findUnit(p.casting.target) : null;
    const key = c ? c.id + ':' + p.casting.start + ':' + (tu ? tu.unit.uid : '') : 'none';
    if (B.castKey[p.index] === key) return;
    B.castKey[p.index] = key;
    el.classList.toggle('active', !!c);
    if (!c) {
      el.innerHTML = '<div class="pd-empty">詠唱なし</div>';
      return;
    }
    el.innerHTML = `
      <div class="pd-ring"></div>
      <div class="pd-info">
        <div class="pd-label">${p.index === ME ? '詠唱中' : '相手が詠唱中！'}</div>
        <div class="pd-left"></div>
        ${tu ? `<div class="pd-target">🎯 ${esc(tu.unit.name)}</div>` : ''}
      </div>`;
    el.querySelector('.pd-ring').appendChild(UI.cardEl(c));
  }

  // 場のクリーチャーは uid ごとに要素を使い回す（毎回作り直すと召喚アニメが繰り返されるため）
  function renderField(p) {
    const g = B.game;
    const box = $('#field-' + p.index);
    const map = B.unitEls[p.index];
    const alive = new Set(p.field.map((u) => u.uid));
    for (const [uid, el] of map) {
      if (alive.has(uid)) continue;
      // 倒れたクリーチャーは、消える演出の後で取り除く
      map.delete(uid);
      el.classList.add('dying');
      setTimeout(() => { el.remove(); B.elByUid.delete(uid); }, 450);
    }
    p.field.forEach((u) => {
      let el = map.get(u.uid);
      if (!el) {
        el = document.createElement('div');
        el.className = 'unit';
        const uid = u.uid;
        el.onclick = () => chooseTarget(uid);
        map.set(u.uid, el);
        B.elByUid.set(u.uid, el);
        box.appendChild(el);
      }
      const d = Cards.get(u.id);
      const kw = [
        u.guard && (u.spent ? '守護(済)' : '守護'), u.stealth && '潜伏', g.hasLifesteal(p, u) && '吸血',
        u.pierce && '貫通', u.undying && !u.usedUndying && '不屈', u.armor && '堅牢',
        u.auto && `自律${u.auto}s`, u.muted && '沈黙',
      ].filter(Boolean).join('・');
      const tIdx = B.targeting ? B.targeting.uids.indexOf(u.uid) : -1;
      const aimed = g.players.some((q) => q.casting && q.casting.target === u.uid);
      const atk = g.atkOf(p, u);
      el.classList.toggle('guard', !!u.guard);
      el.classList.toggle('muted', !!u.muted);
      el.classList.toggle('targetable', tIdx >= 0);
      el.classList.toggle('aimed', aimed);
      el.classList.toggle('spent', !!(u.guard && u.spent));
      el.classList.toggle('token', !!u.token);
      el.dataset.cid = u.id;
      el.dataset.now = `場の状態：攻撃力 ${atk} ／ 体力 ${u.hp}${kw ? '　' + kw : ''}${u.guard && u.spent ? '（このフェーズは既に受け止めた）' : ''}`;
      el.innerHTML = `
        <div class="u-art">${u.icon}</div>
        <div class="u-name">${esc(u.name)}${d.text && !u.muted ? ' ✦' : ''}</div>
        <div class="u-kw">${kw}</div>
        <div class="u-stat atk${atk > u.atk ? ' boosted' : ''}"><b>${atk}</b></div>
        <div class="u-stat hp${u.hp < u.maxHp ? ' hurt' : ''}">${u.hp}</div>
        ${u.auto ? '<div class="u-auto"><i></i></div>' : ''}
        ${tIdx >= 0 ? `<div class="u-tnum">${KEYS[tIdx]}</div>` : ''}
        ${aimed ? '<div class="u-aim">🎯</div>' : ''}`;
    });
  }

  /** 手札は扇形に並べる */
  function renderHand() {
    const g = B.game;
    const p = g.players[ME];
    const box = $('#hand');
    box.innerHTML = '';
    const n = p.hand.length;
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
      const off = i - (n - 1) / 2;
      el.style.setProperty('--r', (off * 3.2).toFixed(1) + 'deg');
      el.style.setProperty('--y', (Math.abs(off) ** 1.6 * 3).toFixed(1) + 'px');
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
      d.textContent = l.kind === 'phase' ? `― ${l.text} ―` : l.text;
      box.appendChild(d);
    }
    B.logShown = logs.length;
    while (box.children.length > 120) box.firstChild.remove();
    box.scrollTop = box.scrollHeight;
  }

  function showResult() {
    const g = B.game;
    const [me, op] = g.players;
    const cls = g.winner === ME ? 'win' : g.winner === OP ? 'lose' : 'draw';
    const big = { win: 'VICTORY', lose: 'DEFEAT', draw: 'DRAW' }[cls];
    const jp = { win: '勝利！', lose: '敗北…', draw: '引き分け' }[cls];
    const row = (label, a, b, higherIsBetter = true) => {
      const ba = higherIsBetter ? a > b : a < b;
      return `<tr><td>${label}</td><td class="${ba ? 'best' : ''}">${a}</td><td class="${!ba && a !== b ? 'best' : ''}">${b}</td></tr>`;
    };
    const body = `
      <div class="result-sub">${jp}　${g.endReason}（${Math.floor(g.time / 60)}分${Math.floor(g.time % 60)}秒）</div>
      <table class="result-stats">
        <tr><th></th><th>あなた</th><th>${esc(op.name)}</th></tr>
        ${row('残り体力', Math.max(0, me.hp), Math.max(0, op.hp))}
        ${row('与えたダメージ', me.stats.damageDealt, op.stats.damageDealt)}
        ${row('使ったカード', me.stats.cardsPlayed, op.stats.cardsPlayed)}
        ${row('打ち消した回数', me.stats.countered, op.stats.countered)}
      </table>`;
    $('#vignette').classList.remove('on');
    setTimeout(() => {
      UI.overlay(`<div class="result-title ${cls}">${big}</div>`, body, [
        { label: 'タイトルへ', onClick: () => { UI.closeOverlay(); UI.showScreen('title'); } },
        { label: 'もう一度', primary: true, onClick: () => start(B.setup) },
      ], true);
    }, 700);
  }

  function init() {
    document.addEventListener('keydown', onKey);
    // 右クリックで対象選択をキャンセル
    $('#screen-battle').addEventListener('contextmenu', (e) => { if (B.targeting) { e.preventDefault(); cancelTargeting(); } });
    $('#btn-pause').onclick = togglePause;
  }

  root.Battle = { init, start };
})(this);
