/*
 * ambient.js — 画面全体の「空気」を作る演出
 *
 *   ・火の粉：鍛冶場の火の粉が、背景でゆっくり舞い上がる（<canvas id="embers">、全画面の一番奥）
 *   ・火花：ボタンを押した時や、工房で原石を打った時などに飛び散る（<canvas id="sparks">、全画面の一番手前）
 *   ・傾き：マウスに合わせてカードが立体的に傾き、光が走る（工房の見本カード）
 *
 * どれも飾りなので、ルールや他の画面の処理には関わらない。
 * 「視差効果を減らす」設定（prefers-reduced-motion）の時は、火の粉を止めて火花を出さない。
 * 画面が隠れている間（別のタブなど）は描画を止める。
 */
(function (root) {
  'use strict';
  const W = 1280, H = 720;
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  let back = null, front = null;     // 2枚のキャンバスの描画先
  let embers = [], sparks = [];
  let density = 1;                   // 火の粉の量（画面ごとに変える）
  let last = 0, running = false, dirty = false;

  const rnd = (a, b) => a + Math.random() * (b - a);

  function newEmber(anywhere) {
    return {
      x: rnd(0, W), y: anywhere ? rnd(0, H) : H + rnd(0, 40),
      vy: -rnd(12, 46), vx: rnd(-8, 8), r: rnd(0.8, 2.6), life: rnd(0, 1),
      sway: rnd(0.6, 1.8), phase: rnd(0, 6.28), hue: rnd(18, 42),
    };
  }

  /** 火花を飛ばす（舞台の座標）。color は '#rrggbb'、n は数、power は飛ぶ強さ */
  function burst(x, y, color = '#ffb04a', n = 14, power = 1) {
    if (reduced || !front) return;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2), v = rnd(60, 260) * power;
      sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60 * power, r: rnd(1, 2.8), life: 1, decay: rnd(1.2, 2.4), color });
    }
    if (sparks.length > 600) sparks.splice(0, sparks.length - 600);
  }
  /** 要素の中心から火花を飛ばす */
  function burstAt(el, color, n, power) {
    if (!el) return;
    const p = root.UI.stagePoint(el);
    burst(p.x, p.y, color, n, power);
  }

  function frame(t) {
    if (!running) return;
    const dt = Math.min(0.05, (t - last) / 1000 || 0);
    last = t;
    // 奥：火の粉
    back.clearRect(0, 0, W, H);
    const want = Math.round(70 * density);
    while (embers.length < want) embers.push(newEmber(false));
    if (embers.length > want) embers.length = want;
    back.globalCompositeOperation = 'lighter';
    for (const e of embers) {
      e.y += e.vy * dt;
      e.phase += e.sway * dt;
      e.x += (e.vx + Math.sin(e.phase) * 14) * dt;
      e.life += dt * 0.5;
      if (e.y < -20 || e.x < -20 || e.x > W + 20) Object.assign(e, newEmber(false));
      const flick = 0.55 + 0.45 * Math.sin(e.life * 6 + e.phase);
      const fade = Math.min(1, e.y / (H * 0.55)); // 上へ行くほど消える
      const a = Math.max(0, flick * fade * 0.8);
      back.fillStyle = `hsla(${e.hue}, 100%, 62%, ${a})`;
      back.beginPath(); back.arc(e.x, e.y, e.r, 0, 6.2832); back.fill();
      back.fillStyle = `hsla(${e.hue}, 100%, 60%, ${a * 0.22})`;
      back.beginPath(); back.arc(e.x, e.y, e.r * 3.4, 0, 6.2832); back.fill();
    }
    // 手前：火花（何もない時は、消す作業もしない）
    if (sparks.length || dirty) front.clearRect(0, 0, W, H);
    dirty = sparks.length > 0;
    if (sparks.length) {
      front.globalCompositeOperation = 'lighter';
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= s.decay * dt;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        s.vy += 420 * dt; // 重力
        s.vx *= 0.985;
        const px = s.x, py = s.y;
        s.x += s.vx * dt; s.y += s.vy * dt;
        front.globalAlpha = Math.min(1, s.life * 1.4);
        front.strokeStyle = s.color;
        front.lineWidth = s.r;
        front.lineCap = 'round';
        front.beginPath(); front.moveTo(px, py); front.lineTo(s.x, s.y); front.stroke();
      }
      front.globalAlpha = 1;
    }
    requestAnimationFrame(frame);
  }

  function setDensity(d) { density = d; }

  /** box の中のカード（最初の .card）を、マウスに合わせて立体的に傾ける */
  function tilt(box) {
    if (reduced || !box) return;
    box.addEventListener('mousemove', (e) => {
      const card = box.querySelector('.card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty('--tx', (nx * 16).toFixed(2) + 'deg');
      card.style.setProperty('--ty', (-ny * 16).toFixed(2) + 'deg');
      card.style.setProperty('--gx', ((nx + 0.5) * 100).toFixed(1) + '%');
      card.style.setProperty('--gy', ((ny + 0.5) * 100).toFixed(1) + '%');
      card.classList.add('tilting');
    });
    box.addEventListener('mouseleave', () => {
      const card = box.querySelector('.card');
      if (card) { card.classList.remove('tilting'); card.style.setProperty('--tx', '0deg'); card.style.setProperty('--ty', '0deg'); }
    });
  }

  function init() {
    const stage = document.getElementById('stage');
    if (!stage) return;
    const mk = (id) => { const c = document.createElement('canvas'); c.id = id; c.width = W; c.height = H; return c; };
    const b = mk('embers'), f = mk('sparks');
    stage.insertBefore(b, stage.firstChild);
    stage.appendChild(f);
    back = b.getContext('2d'); front = f.getContext('2d');
    if (reduced) {
      // 動かさない：火の粉を1度だけ描いておく
      for (let i = 0; i < 40; i++) { const e = newEmber(true); back.fillStyle = `hsla(${e.hue}, 100%, 62%, .35)`; back.beginPath(); back.arc(e.x, e.y, e.r, 0, 6.2832); back.fill(); }
      return;
    }
    for (let i = 0; i < 70; i++) embers.push(newEmber(true));
    const go = () => { if (!running && !document.hidden) { running = true; last = performance.now(); requestAnimationFrame(frame); } };
    document.addEventListener('visibilitychange', () => { if (document.hidden) running = false; else go(); });
    go();
    // ボタンを押した時の小さな火花
    document.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest && e.target.closest('.btn.primary, .turn-end, .menu-item');
      if (!btn || btn.disabled) return;
      const s = stage.getBoundingClientRect(), k = s.width / W;
      burst((e.clientX - s.left) / k, (e.clientY - s.top) / k, '#ffd88a', 8, 0.6);
    });
  }

  root.Ambient = { init, burst, burstAt, setDensity, tilt, reduced };
})(this);
