/*
 * reader.js — 画像からカード・デッキの情報を読み取る
 *
 * 読み取りの方法は2つあり、設定画面で選べます。
 *
 * ① Claude（おすすめ・高精度）
 *    Anthropic の Claude API に画像を送り、「カード名・文明・コスト・パワー・種族・能力の文章」を
 *    決まった形（JSON）で返してもらいます。日本語の小さな文字や、1枚の画像に何枚も写っている場合にも強いです。
 *    ・自分の API キー（https://platform.claude.com で作成）が必要で、読み取るたびに少額の料金がかかります
 *    ・キーはこのブラウザの中にだけ保存され、画像とキーは Anthropic の API にだけ送られます
 *
 * ② 文字認識（OCR・無料）
 *    Tesseract.js（ブラウザの中で動く文字認識）で画像の文字を読み、文章から推測して項目を埋めます。
 *    無料でキーも不要ですが、カードのデザインによっては読み間違いが多くなります（必ず手で確認してください）。
 *
 * どちらの場合も、読み取った結果はカード編集画面に入るだけなので、保存する前に直せます。
 */
(function (root) {
  'use strict';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';

  // ───────────── 画像の下ごしらえ ─────────────
  /** ファイルを <img> として読み込む */
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('画像を読み込めませんでした'));
      img.src = src;
    });
  }
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }
  /**
   * 画像を、長い辺が maxSide 以下になるよう縮小して JPEG の dataURL にする。
   * ・保存用（小さく）と、読み取り用（文字が潰れない程度に大きく）で使い分ける
   */
  async function resize(src, maxSide, quality = 0.85) {
    const img = await loadImage(src);
    const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * s), h = Math.round(img.naturalHeight * s);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return cv.toDataURL('image/jpeg', quality);
  }
  /** 画像の一部（x,y,w,h は 0〜1 の割合）を切り出す。1枚の画像に写った複数のカードを分ける時に使う */
  async function crop(src, box, maxSide = 600) {
    const img = await loadImage(src);
    const W = img.naturalWidth, H = img.naturalHeight;
    const sx = Math.max(0, box.x * W), sy = Math.max(0, box.y * H);
    const sw = Math.min(W - sx, box.w * W), sh = Math.min(H - sy, box.h * H);
    if (sw < 8 || sh < 8) return null;
    const s = Math.min(1, maxSide / Math.max(sw, sh));
    const cv = document.createElement('canvas');
    cv.width = Math.round(sw * s); cv.height = Math.round(sh * s);
    cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/jpeg', 0.85);
  }
  const splitDataURL = (url) => {
    const m = url.match(/^data:([^;]+);base64,(.*)$/);
    return { mediaType: m[1], data: m[2] };
  };

  // ───────────── ① Claude で読む ─────────────
  let sdkPromise = null;
  function loadSdk() {
    if (!sdkPromise) sdkPromise = import(SDK_URL).then((m) => m.default || m.Anthropic);
    return sdkPromise;
  }

  // 返してほしいデータの形（JSON Schema）。この形以外の答えは返ってこない
  const CARD_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'type', 'civs', 'cost', 'power', 'races', 'text', 'box'],
    properties: {
      name: { type: 'string', description: 'カード名' },
      type: { type: 'string', enum: ['creature', 'evolution', 'spell'] },
      civs: { type: 'array', items: { type: 'string', enum: ['light', 'water', 'darkness', 'fire', 'nature', 'zero'] } },
      cost: { type: 'integer' },
      power: { type: 'integer', description: '呪文は0' },
      races: { type: 'array', items: { type: 'string' } },
      text: { type: 'string', description: '能力の文章。能力ごとに改行し、行頭に■を付ける' },
      box: {
        type: 'object', additionalProperties: false, required: ['x', 'y', 'w', 'h'],
        description: '画像の中でそのカードが写っている範囲（左上が0,0、右下が1,1の割合）',
        properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
      },
    },
  };
  const CARDS_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['cards'],
    properties: { cards: { type: 'array', items: CARD_SCHEMA } },
  };
  const DECK_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['cards'],
    properties: {
      cards: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, required: ['name', 'count'], properties: { name: { type: 'string' }, count: { type: 'integer' } } },
      },
    },
  };

  const CARD_PROMPT = `この画像には、日本のトレーディングカードゲームのカードが1枚以上写っています。
写っているカードを1枚ずつ（同じカードが複数枚写っていても1件にまとめずに、写っている枚数だけ）読み取り、指定の形式で返してください。

各項目の決まり：
- name：カード名を正確に。
- type：クリーチャーは "creature"、進化クリーチャーは "evolution"、呪文は "spell"。
- civs：文明。光="light"（黄色）、水="water"（青）、闇="darkness"（黒・紫）、火="fire"（赤）、自然="nature"（緑）、無色="zero"。多色カードはすべて入れる。
- cost：左上などに書かれたコストの数字。
- power：パワーの数字（例：5000）。呪文や読めない場合は0。
- races：種族名の配列（カードに書かれている表記のまま）。無ければ空の配列。
- text：能力の文章を、カードに書かれている通りに書き写す。能力ごとに改行し、各行の先頭に「■」を付ける。
  「ブロッカー」「W・ブレイカー」「S・トリガー」などのキーワード能力も1行ずつ書く。
  キーワードの後ろにある（ ）の注釈文は省略してよい。フレーバーテキスト（物語の文）やイラストレーター名、カード番号は含めない。
- box：画像の中でそのカードが写っている範囲を、画像全体を幅1・高さ1とした割合で（x,y は左上）。
読めない文字は推測せず、読める範囲で書いてください。カードが写っていなければ cards を空にしてください。`;

  const DECK_PROMPT = `この画像は、トレーディングカードゲームのデッキ（デッキリストの画面・紙のリスト、または並べたカードの写真）です。
デッキに入っているカードの名前と枚数を読み取り、指定の形式で返してください。
- 同じ名前のカードは1件にまとめ、count に枚数を入れる（並べたカードの写真なら、写っている枚数を数える）。
- name はカード名を正確に（読めない部分は推測しない）。
- カード以外の文字（見出し・ボタン・合計枚数など）は含めない。`;

  async function askClaude(imageDataURL, prompt, schema) {
    const st = root.Store.Settings.get();
    if (!st.apiKey) throw new Error('Claude の API キーが設定されていません（設定画面で入力してください）');
    const Anthropic = await loadSdk();
    // ブラウザから直接呼ぶので dangerouslyAllowBrowser を付ける（キーは自分のブラウザの中だけにある前提）
    const client = new Anthropic({ apiKey: st.apiKey, dangerouslyAllowBrowser: true });
    const { mediaType, data } = splitDataURL(imageDataURL);
    const res = await client.beta.messages.create({
      model: st.model || 'claude-opus-5-5',
      max_tokens: 16000,
      // 安全のための判定で断られた時、別のモデルで自動的にやり直す（サーバー側の仕組み）
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
          { type: 'text', text: prompt },
        ],
      }],
    });
    if (res.stop_reason === 'refusal') throw new Error('この画像は読み取りを断られました');
    if (res.stop_reason === 'max_tokens') throw new Error('読み取り結果が長すぎて途中で切れました（画像を分けてください）');
    const block = res.content.find((b) => b.type === 'text');
    if (!block) throw new Error('読み取り結果が空でした');
    return JSON.parse(block.text);
  }

  /** API キーが正しく使えるかを確かめる（ごく短い問い合わせ） */
  async function testClaude() {
    const st = root.Store.Settings.get();
    if (!st.apiKey) throw new Error('API キーが入力されていません');
    const Anthropic = await loadSdk();
    const client = new Anthropic({ apiKey: st.apiKey, dangerouslyAllowBrowser: true });
    const res = await client.messages.create({
      model: st.model || 'claude-opus-5-5',
      max_tokens: 64,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: '「OK」とだけ答えてください。' }],
    });
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  }

  // ───────────── ② 文字認識（OCR）で読む ─────────────
  let tessPromise = null;
  function loadTesseract() {
    if (!tessPromise) {
      tessPromise = new Promise((resolve, reject) => {
        if (root.Tesseract) return resolve(root.Tesseract);
        const s = document.createElement('script');
        s.src = TESSERACT_URL;
        s.onload = () => resolve(root.Tesseract);
        s.onerror = () => { tessPromise = null; reject(new Error('文字認識の部品を読み込めませんでした（ネット接続を確認してください）')); };
        document.head.appendChild(s);
      });
    }
    return tessPromise;
  }
  async function ocrText(imageDataURL, onProgress) {
    const T = await loadTesseract();
    const r = await T.recognize(imageDataURL, 'jpn', {
      logger: (m) => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); },
    });
    return r.data.text || '';
  }
  /** OCR の文字から、カードの項目をできるだけ推測する（あくまで下書き） */
  function guessCardFromText(raw) {
    const text = raw.replace(/[ \t　]+/g, '');
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const card = { name: '', type: 'creature', civs: [], cost: 0, power: 0, races: [], text: '' };
    const abilityLines = [];
    for (const l of lines) {
      if (/^[■▪●]/.test(l) || /ブロッカー|ブレイカー|トリガー|時、|する。|できない/.test(l)) abilityLines.push(l.replace(/^[▪●]/, '■'));
    }
    card.text = abilityLines.map((l) => (l.startsWith('■') ? l : '■' + l)).join('\n');
    if (/呪文/.test(text)) card.type = 'spell';
    if (/進化/.test(text)) card.type = 'evolution';
    const powers = [...text.matchAll(/(\d{3,5})(?!\d)/g)].map((m) => +m[1]).filter((n) => n >= 500 && n % 500 === 0);
    if (powers.length && card.type !== 'spell') card.power = powers[powers.length - 1];
    const small = lines.slice(0, 4).join(' ').match(/(?:^|\D)(\d{1,2})(?:\D|$)/);
    if (small) card.cost = +small[1];
    const nameLine = lines.slice(0, 5).filter((l) => !/^[■\d]/.test(l) && l.length >= 2).sort((a, b) => b.length - a.length)[0];
    card.name = nameLine || '';
    for (const [k, w] of [['light', '光'], ['water', '水'], ['darkness', '闇'], ['fire', '火'], ['nature', '自然']]) {
      if (new RegExp(w + '文明').test(text)) card.civs.push(k);
    }
    card.ocrRaw = raw;
    return card;
  }

  // ───────────── 外から使う関数 ─────────────
  /**
   * 画像からカードを読み取る。1枚の画像に複数のカードが写っていれば複数返す。
   * 返り値：[{ name, type, civs, cost, power, races, text, image }]（image はカード部分を切り出した画像）
   */
  async function readCards(imageDataURL, onProgress) {
    const method = root.Store.Settings.get().reader;
    if (method === 'ocr') {
      const raw = await ocrText(await resize(imageDataURL, 1600), onProgress);
      const c = guessCardFromText(raw);
      c.image = await resize(imageDataURL, 480);
      return [c];
    }
    const big = await resize(imageDataURL, 1568, 0.9); // Claude は長い辺1568pxまでが効率がよい
    const out = await askClaude(big, CARD_PROMPT, CARDS_SCHEMA);
    const cards = out.cards || [];
    for (const c of cards) {
      if (c.type === 'spell' || !c.power) c.power = c.type === 'spell' ? null : c.power || 0;
      // 1枚だけなら画像全体、複数なら写っている範囲を切り出してカードの画像にする
      c.image = cards.length === 1 ? await resize(imageDataURL, 480) : (c.box && (await crop(imageDataURL, c.box, 480))) || null;
      delete c.box;
    }
    return cards;
  }

  /** 画像からデッキのカード名と枚数を読み取る。返り値：[{ name, count }] */
  async function readDeck(imageDataURL) {
    const method = root.Store.Settings.get().reader;
    if (method === 'ocr') {
      const raw = await ocrText(await resize(imageDataURL, 2000));
      return parseDeckText(raw);
    }
    const out = await askClaude(await resize(imageDataURL, 1568, 0.9), DECK_PROMPT, DECK_SCHEMA);
    return (out.cards || []).filter((c) => c.name && c.count > 0);
  }

  /**
   * デッキリストの文字から「名前と枚数」を取り出す。次のような書き方に対応：
   *   4 カード名 / 4x カード名 / カード名 x4 / カード名 ×4 / カード名 4枚
   */
  function parseDeckText(text) {
    const out = [];
    for (let line of String(text).split(/\r?\n/)) {
      line = line.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).trim();
      if (!line) continue;
      let m = line.match(/^(\d{1,2})\s*(?:[x×X枚]\s*)?(.+)$/) || null;
      let name, count;
      if (m) { count = +m[1]; name = m[2]; }
      else if ((m = line.match(/^(.+?)\s*[x×X]\s*(\d{1,2})$/)) || (m = line.match(/^(.+?)\s*(\d{1,2})\s*枚$/))) { name = m[1]; count = +m[2]; }
      else { name = line; count = 1; }
      name = name.replace(/^[・\-*]\s*/, '').trim();
      if (name) out.push({ name, count });
    }
    return out;
  }

  /** 名前の「近さ」（読み間違いを許して照らし合わせるため。小さいほど近い） */
  function distance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
    }
    return dp[a.length][b.length];
  }
  const normName = (s) => String(s).replace(/[\s　・･「」『』《》<>]/g, '').replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).toLowerCase();
  /** 読み取った名前に一番近い、登録済みのカードを探す（見つからなければ null） */
  function matchCard(name, cards) {
    const n = normName(name);
    let best = null, bestD = Infinity;
    for (const c of cards) {
      const m = normName(c.name);
      if (m === n) return c;
      const d = distance(n, m);
      const contains = m.includes(n) || n.includes(m);
      const score = contains ? Math.min(d, 1) : d;
      if (score < bestD) { bestD = score; best = c; }
    }
    return bestD <= Math.max(1, Math.floor(n.length / 5)) ? best : null;
  }

  root.Reader = { fileToDataURL, resize, readCards, readDeck, parseDeckText, matchCard, testClaude, guessCardFromText };
})(typeof self !== 'undefined' ? self : this);
