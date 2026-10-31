/*
 * tips.js — ホーム画面の「TIPS」（ゲームの仕組みの解説）
 *
 * 項目ごとにページを分けている。左の一覧から選ぶと、右にそのページを表示する。
 * 説明文を直したいときは、下の TIPS 配列の中身を書き換えればよい。
 *   icon  : 一覧に出すアイコン
 *   title : 見出し
 *   lead  : ページの冒頭に大きく出す一言
 *   demo  : 図の部分を作る関数（省略可）。実際のゲームの部品（カード・マナの◆・場のクリーチャー）を使う
 *   body  : 本文（HTML）
 *   point : ページの下に出す「ポイント」（省略可）
 */
(function (root) {
  'use strict';
  const { Cards, Engine, UI } = root;
  const { $ } = UI;
  const CFG = Engine.CONFIG;

  // ── 図を作るための小道具 ──
  const unitDemo = (o) => `
    <div class="unit demo${o.guard ? ' guard' : ''}${o.relic ? ' relic' : ''}${o.spent ? ' spent' : ''}">
      <div class="u-art">${o.icon}</div>
      <div class="u-name">${o.name}</div>
      <div class="u-kw">${o.relic ? '<span class="u-relic">レリック</span>' + (o.kw ? '・' + o.kw : '') : o.kw || ''}</div>
      ${o.relic ? '' : `<div class="u-stat atk"><b>${o.atk}</b></div>`}
      <div class="u-stat ${o.relic ? 'dur' : 'hp'}">${o.hp}</div>
    </div>`;
  const manaDemo = (on, frac, max) => {
    let pips = '';
    for (let i = 0; i < max; i++) pips += `<span class="pip ${i < on ? 'on' : i === on ? 'next' : ''}" style="--f:${frac}"></span>`;
    return `<div class="mana big">${pips}<span class="mtext">${on}<small>/${max}</small></span></div>`;
  };
  const chip = (k, v) => `<div class="kw-chip"><b>${k}</b><span>${v}</span></div>`;

  const TIPS = [
    {
      id: 'win', icon: '🏆', title: '勝利条件',
      lead: `相手の体力（${CFG.startHP}）を0にすれば勝ち。`,
      body: `<p>試合は<b>${CFG.matchTime / 60}分</b>。時間切れになったら、体力が多い方の勝ちです（同じなら引き分け）。</p>
        <p>ターンはありません。あなたとCPUは<b>同時に、好きなタイミングで</b>カードを使います。速さも大事ですが、相手の動きを<b>見てから</b>対応できるかが勝負を分けます。</p>`,
      point: '体力を削る基本は、クリーチャーの攻撃です。クリーチャーは召喚した瞬間に1回攻撃します。',
    },
    {
      id: 'card', icon: '🃏', title: 'カードの見方',
      lead: 'カードの各部分の意味。',
      demo: () => {
        const wrap = document.createElement('div');
        wrap.className = 'anatomy';
        const holder = document.createElement('div');
        holder.className = 'anatomy-card';
        holder.appendChild(UI.cardEl(Cards.get('sharpshooter')));
        // カードの上に番号の印を置く（位置はカードに対する割合）
        [[1, -6, -4], [2, 110, 4], [3, -9, 8], [4, 110, 26], [5, -9, 46], [6, -9, 62], [7, -12, 92], [8, 112, 92]]
          .forEach(([n, x, y]) => holder.insertAdjacentHTML('beforeend', `<span class="ana-mark" style="left:${x}%;top:${y}%">${n}</span>`));
        wrap.appendChild(holder);
        wrap.insertAdjacentHTML('beforeend', `<ol class="ana-list">
          <li><b>コスト</b>：使うのに必要なマナ。補正で軽くなると緑、重くなると赤になる</li>
          <li><b>詠唱時間</b>：使ってから発動するまでの秒数。「⚡瞬間」は詠唱なし</li>
          <li><b>名前</b></li>
          <li><b>🎯 対象</b>：使うときに対象を選ぶカード</li>
          <li><b>種類とキーワード</b>：クリーチャー・レリック・攻撃・妨害など。右は守護・潜伏などのキーワード</li>
          <li><b>効果</b>：マウスを乗せると、大きなカードと詳しい説明が出る</li>
          <li><b>攻撃力</b>（ひし形）</li>
          <li><b>体力</b>（円）。レリックは<b>耐久</b>（盾形）</li>
        </ol>`);
        return wrap;
      },
      body: `<p>カードの左上に <span class="tag hp">♥3</span> があれば「代償」（体力も払う）、<span class="tag sac">🔪2</span> があれば「生贄」（味方を差し出す）が必要です。</p>`,
    },
    {
      id: 'mana', icon: '💠', title: 'マナ',
      lead: `マナは<b>毎秒1ずつ</b>回復する。最大は${CFG.baseMaxMana}。`,
      demo: () => manaDemo(6, 0.55, 10),
      body: `<ul>
          <li>試合開始時は<b>${CFG.startMana}</b>。光っている◆が今使えるマナで、次の◆が下から満ちていきます。</li>
          <li>最大まで溜まると回復は止まります。<b>待ちすぎると回復が無駄</b>になります。</li>
          <li>フェーズが変わっても、マナはそのまま持ち越されます。</li>
          <li>カードの効果で、マナを増やす・回復を速くする・相手のマナを減らすことができます（最大を超えた分は切り捨て）。</li>
        </ul>`,
      point: '今あるマナで安いカードを使い切るか、少し待って高コストの大技を出すか。時間の使い方が腕の見せ所です。',
    },
    {
      id: 'draw', icon: '🂠', title: 'ドローとフェーズ',
      lead: `カードは<b>${CFG.drawInterval}秒ごとに1枚</b>引く。`,
      body: `<ul>
          <li>手札の枚数の横にある小さなゲージが溜まると、1枚引きます。手札は最大${CFG.handLimit}枚で、それを超えて引いたカードは墓地へ行きます。</li>
          <li>山札が尽きると、引こうとするたびに${CFG.fatigue}ダメージを受けます。</li>
          <li><b>${CFG.phaseTime}秒ごとにフェーズ</b>が切り替わります。フェーズの区切りでは、守護が再び攻撃を受け止められるようになり、「フェーズ開始時」の効果が発動します。</li>
        </ul>`,
    },
    {
      id: 'cast', icon: '🔮', title: '詠唱',
      lead: 'このゲームの核心。カードは<b>すぐには発動しない</b>。',
      demo: () => {
        const d = document.createElement('div');
        d.className = 'cast-demo';
        d.innerHTML = `<div class="pd-ring" style="--p:.62">${UI.runeCircle('pd-circle')}</div><div class="pd-info"><div class="pd-label">相手が詠唱中！</div><div class="pd-left">1.5<small>秒</small></div><div class="pd-note">台座の枠が満ちると発動。発動前なら打ち消せる</div></div>`;
        d.querySelector('.pd-ring').appendChild(UI.cardEl(Cards.get('dragon')));
        return d;
      },
      body: `<ul>
          <li>カードを使うと、<b>詠唱時間</b>のあいだ台座に置かれ、周りの枠が満ちると発動します。</li>
          <li>詠唱中のカードは<b>相手から丸見え</b>です。対象を選ぶカードなら、誰を狙っているかも見えます。</li>
          <li><b>一度に詠唱できるのは1枚だけ</b>。詠唱中は、次の（詠唱が必要な）カードを使えません。</li>
          <li><b>⚡瞬間</b>のカードは詠唱なしですぐ発動し、自分が詠唱中でも使えます。打ち消しや防壁など、相手への<b>対応</b>に使います。</li>
        </ul>`,
      point: '相手の大技は見てから【打ち消しの印】で消せる。逆に、安いカードで打ち消しを使わせてから本命を通す、という読み合いも。',
    },
    {
      id: 'creature', icon: '⚔️', title: 'クリーチャー',
      lead: 'クリーチャーは<b>召喚した瞬間に1回</b>相手本体を攻撃する。',
      demo: () => `<div class="unit-row">${unitDemo({ icon: '🐺', name: '疾風の狼', atk: 3, hp: 2 })}${unitDemo({ icon: '🐕‍🦺', name: '番犬', kw: '自律8s', atk: 2, hp: 3 })}</div>`,
      body: `<ul>
          <li>その後は場に残り、【突撃命令】【一騎討ち】などの効果で、また攻撃できます。</li>
          <li><b>自律</b>を持つクリーチャーは、決まった秒数ごとに自分で攻撃します。ほかにも「呪文を使うたび」「味方が倒れるたび」などに攻撃するものがいます。</li>
          <li>場に出せるのは<b>${CFG.fieldLimit}つまで</b>（クリーチャーとレリックの合計）。満杯のときに出すと、<b>一番古い味方が場を譲って倒れます</b>。</li>
          <li>カードの効果で生まれる<b>トークン</b>（点線の枠）は、出たときに攻撃せず、倒れても墓地に行きません。</li>
        </ul>`,
    },
    {
      id: 'guard', icon: '🛡️', title: '守護',
      lead: '守護は、敵クリーチャーの攻撃を本体の代わりに受け止める。',
      demo: () => `<div class="unit-row">${unitDemo({ icon: '🛡️', name: '盾持ちの兵', kw: '守護', atk: 1, hp: 4, guard: true })}${unitDemo({ icon: '🛡️', name: '盾持ちの兵', kw: '守護(済)', atk: 1, hp: 2, guard: true, spent: true })}</div>`,
      body: `<ul>
          <li>受け止められるのは<b>1フェーズに1回まで</b>。使った守護は枠が暗くなり「守護(済)」と表示されます（右）。</li>
          <li>受け止めても<b>反撃はしません</b>。受け止めたダメージで体力が減ります。</li>
          <li><b>潜伏</b>は守護を無視して本体を攻撃し、<b>貫通</b>は受け止められても余ったダメージが本体に届きます。</li>
        </ul>`,
      point: '安いクリーチャーで守護を使わせてから本命を通す。全員で一斉に攻撃して、守護の数を上回る。',
    },
    {
      id: 'relic', icon: '🏺', title: 'レリック',
      lead: '場に置いて、効果を発揮し続ける「物」。',
      demo: () => `<div class="unit-row">${unitDemo({ icon: '⛲', name: '魔力の泉', hp: 3, relic: true })}${unitDemo({ icon: '🧱', name: '石壁', kw: '守護', hp: 3, relic: true, guard: true })}</div>`,
      body: `<ul>
          <li>クリーチャーと同じように場に出て、場の枠を使います。<b>攻撃はしません</b>。</li>
          <li>体力の代わりに<b>耐久</b>（盾形）があり、0になると壊れます。守護を持つレリックは攻撃を受け止めます。</li>
          <li>「クリーチャー」を対象にする効果は効きません。【追放の光】【送還】【沈黙の印】【焦土】など「レリック」と書かれた効果で対処します。</li>
          <li>生贄にできます。【原初の卵】【魂の器】は、壊すと効果が発動します。</li>
        </ul>`,
    },
    {
      id: 'keywords', icon: '📜', title: 'キーワード',
      lead: 'カードに書かれた【　】の意味。',
      demo: () => `<div class="kw-grid">${[
        ['守護', Cards.KEYWORD_HELP['守護']], ['潜伏', Cards.KEYWORD_HELP['潜伏']], ['貫通', Cards.KEYWORD_HELP['貫通']],
        ['吸血', Cards.KEYWORD_HELP['吸血']], ['連撃', Cards.KEYWORD_HELP['連撃']], ['不屈', Cards.KEYWORD_HELP['不屈']],
        ['堅牢', Cards.KEYWORD_HELP['堅牢']], ['自律', Cards.KEYWORD_HELP['自律']], ['鈍重', Cards.KEYWORD_HELP['鈍重']],
        ['狂気', Cards.KEYWORD_HELP['狂気']], ['代償', Cards.KEYWORD_HELP['代償']], ['生贄', Cards.KEYWORD_HELP['生贄']],
        ['呪文', 'クリーチャーとレリック以外のカード全般。「呪文を使うたび」などの効果の対象'],
        ['墓地', '使った呪文・倒れたクリーチャー・捨てたカードが行く場所。枚数を参照するカードがある'],
        ['沈黙', '能力（キーワード・誘発・オーラ）を全て失う'],
        ['送還', '持ち主の手札に戻す。自分のクリーチャーなら、召喚時の効果と攻撃をもう一度使える'],
      ].map(([k, v]) => chip(k, v)).join('')}</div>`,
      body: '',
    },
    {
      id: 'target', icon: '🎯', title: '対象を選ぶ',
      lead: '🎯 のカードは、使うときに対象を選ぶ。',
      body: `<ul>
          <li>カードをクリックすると、選べる対象が光ります。クリック（または表示された数字キー）で決定します。</li>
          <li><b>選んでいる間は時間が止まります</b>（最大5秒。右クリック・<kbd>Esc</kbd> でキャンセル）。</li>
          <li>対象は詠唱中に相手にも見えます（🎯の印）。発動までに対象がいなくなると<b>不発</b>です。</li>
        </ul>`,
      point: '狙われた味方は【送還】で手札に逃がせる。対象が見える仕組みは、守る側の読み合いでもあります。',
    },
    {
      id: 'choice', icon: '✋', title: '効果の途中で選ぶ',
      lead: '「2枚引いて1枚<b>選んで</b>捨てる」など。',
      body: `<ul>
          <li>選択画面が出ます。選んでいる間は時間が止まり、${CFG.choiceTime}秒で時間切れになるとランダムに選ばれます。</li>
          <li>「ランダムに捨てる」と書かれたカードは、選べない代わりに安い・枚数が多いなどの見返りがあります。</li>
          <li><b>狂気</b>のカードは捨てられると効果が発動するので、捨てる効果と組み合わせると強力です。</li>
        </ul>`,
    },
    {
      id: 'cond', icon: '⚖️', title: '条件とデメリット',
      lead: '強いカードには、条件や代償があることも。',
      body: `<ul>
          <li>「墓地が8枚以上の時のみ」「体力が16以下の時のみ」「残り60秒以下の時のみ」など、<b>条件を満たさないと使えない</b>カードがあります。使えない時は手札に理由が出ます。</li>
          <li>自分の体力を失う、マナを前借りする、相手にもカードを引かせる…など、<b>デメリットと引き換えに強い</b>カードもあります。</li>
          <li>前借りやドロー停止などの状態は、プレイヤーの帯に表示されます。</li>
        </ul>`,
    },
    {
      id: 'deck', icon: '📚', title: 'デッキ構築',
      lead: `デッキはちょうど<b>${CFG.deckSize}枚</b>。同じカードは<b>${CFG.maxCopies}枚まで</b>。`,
      demo: () => `<div class="arch-grid">${Object.entries(Cards.ARCHES).filter(([k]) => k !== 'generic')
        .map(([, a]) => `<div class="arch-chip"><b>${a.label}</b><span>${a.desc}</span></div>`).join('')}</div>`,
      body: `<p>カードは全${Cards.LIST.length}種。上のテーマはあくまで目安で、テーマを混ぜても、切り札だけを借りても構いません。対戦準備画面のプリセットが、各テーマと混成デッキの見本になっています。</p>`,
      point: '「体力を失うたび」「味方が倒れるたび」など、テーマをまたいで噛み合うカードを探すのが、デッキ構築の醍醐味です。',
    },
    {
      id: 'keys', icon: '⌨️', title: '操作',
      lead: 'マウスでもキーボードでも遊べる。',
      body: `<table class="key-table">
          <tr><td><kbd>1</kbd>〜<kbd>9</kbd>, <kbd>0</kbd></td><td>手札のカードを使う（カードの下の数字）</td></tr>
          <tr><td>数字キー（対象選択中）</td><td>光っている対象を選ぶ</td></tr>
          <tr><td>右クリック ／ <kbd>Esc</kbd></td><td>対象選択をキャンセル</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>一時停止</td></tr>
          <tr><td>マウスを乗せる</td><td>カードや場のクリーチャーの詳しい説明</td></tr>
        </table>`,
    },
  ];

  let current = TIPS[0].id;

  function show(id) {
    current = id;
    const t = TIPS.find((x) => x.id === id);
    document.querySelectorAll('#tips-nav button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    const page = $('#tips-page');
    page.innerHTML = `
      <div class="tp-head"><span class="tp-icon">${t.icon}</span><h3>${t.title}</h3></div>
      <p class="tp-lead">${t.lead}</p>
      <div class="tp-demo"></div>
      <div class="tp-body">${t.body}</div>
      ${t.point ? `<div class="tp-point"><b>ポイント</b>${t.point}</div>` : ''}`;
    const demo = page.querySelector('.tp-demo');
    if (t.demo) {
      const d = t.demo();
      if (typeof d === 'string') demo.innerHTML = d; else demo.appendChild(d);
    } else {
      demo.remove();
    }
    page.scrollTop = 0;
  }

  function init() {
    const nav = $('#tips-nav');
    nav.innerHTML = TIPS.map((t, i) => `<button data-id="${t.id}"><span class="tn-num">${String(i + 1).padStart(2, '0')}</span><span class="tn-icon">${t.icon}</span>${t.title}</button>`).join('');
    nav.onclick = (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.id); };
    UI.onScreen('tips', () => show(current));
  }

  root.Tips = { init };
})(this);
