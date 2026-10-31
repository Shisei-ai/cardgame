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
    <div class="unit demo${o.res ? ' has-res' : ''}${o.guard ? ' guard' : ''}${o.relic ? ' relic' : ''}${o.spent ? ' spent' : ''}">
      <div class="u-art">${o.icon}</div>
      <div class="u-name">${o.name}</div>
      <div class="u-kw">${o.relic ? '<span class="u-relic">レリック</span>' + (o.kw ? '・' + o.kw : '') : o.kw || ''}</div>
      ${o.relic ? '' : `<div class="u-stat atk"><b>${o.atk}</b></div>`}
      <div class="u-stat ${o.relic ? 'dur' : 'hp'}">${o.hp}</div>
      ${o.res ? `<div class="u-res">⚔${o.res > 1 ? '×' + o.res : ''}</div>` : ''}
    </div>`;
  const manaDemo = (on, frac, max) => {
    let pips = '';
    for (let i = 0; i < max; i++) pips += `<span class="pip ${i < on ? 'on' : i === on ? 'next' : ''}" style="--f:${frac}"></span>`;
    return `<div class="mana big">${pips}<span class="mtext">${on}<small>/${max}</small></span></div>`;
  };
  const chip = (k, v) => `<div class="kw-chip"><b>${k}</b><span>${v}</span></div>`;

  // ステップの帯（対戦画面の中央と同じ見た目）
  const stepsDemo = (on) => `<div class="steps demo">${[['play', 'Ⅰ', 'プレイ'], ['counter', 'Ⅱ', 'カウンター'], ['hall', 'Ⅲ', 'クロノホール']]
    .map(([k, n, l]) => `<span class="st${k === on ? ' on' : ''}" data-step="${k}"><i>${n}</i>${l}</span>`).join('')}</div>`;
  const chipsDemo = (list) => `<div class="chrono-line demo"><div class="cl-chips">${list.map(([side, icon, n]) => `<span class="cl-chip ${side}">${icon}<b>${n}</b></span>`).join('')}</div></div>`;

  const TIPS = [
    {
      id: 'win', icon: '🏆', title: '勝利条件',
      lead: `相手の体力（${CFG.startHP}）を0にすれば勝ち。`,
      body: `<ul>
          <li>試合は最大<b>${CFG.maxPhases}フェーズ</b>。最後のフェーズが終わっても決着がつかなければ、体力が多い方の勝ちです（同じなら引き分け）。</li>
          <li>ターンはありません。プレイステップでは、あなたとCPUが<b>同時に、好きなタイミングで</b>カードを使います。</li>
          <li>本体へのダメージは<b>フェーズの終わりのクロノホール</b>でまとめて顕れます。体力0の決着がつくのもクロノホールだけです。</li>
        </ul>`,
      point: 'まずは「フェーズの流れ」のページで、1フェーズの3つのステップを確認しましょう。',
    },
    {
      id: 'flow', icon: '⏳', title: 'フェーズの流れ',
      lead: '1フェーズは<b>3つのステップ</b>でできている。',
      demo: () => stepsDemo('play'),
      body: `<ol class="flow-list">
          <li><b>Ⅰ プレイステップ</b>（${CFG.playTime}秒）<br>お互いに自由にカードを使う時間。マナが回復し、カードを引きます。クリーチャーの攻撃と本体へのダメージは、その場では起きずに<b>「予約」</b>されます。<br>両者が<b>「準備完了」</b>を押すと早く終わります。時間切れの時に詠唱中のカードがあれば、詠唱が終わるまで延長します（延長中は⚡瞬間のカードだけ使えます）。</li>
          <li><b>Ⅱ カウンターステップ</b>（最大${CFG.counterTime}秒）<br>時間が止まり、相手の予約を見ながら<b>〔カウンター〕のカードだけ</b>を使える時間。両者が「パス」すると終わります。</li>
          <li><b>Ⅲ クロノホール</b><br>このフェーズに溜まった予約が、<b>予約された順に</b>1つずつ顕れます。操作はできません。終わったら次のフェーズへ。</li>
        </ol>`,
      point: 'プレイステップは「仕込み」、カウンターステップは「読み合い」、クロノホールは「答え合わせ」。落ち着いて盤面を見てから動けます。',
    },
    {
      id: 'card', icon: '🃏', title: 'カードの見方',
      lead: 'カードの各部分の意味。',
      demo: () => {
        const wrap = document.createElement('div');
        wrap.className = 'anatomy';
        const holder = document.createElement('div');
        holder.className = 'anatomy-card';
        holder.appendChild(UI.cardEl(Cards.get('snipe')));
        // カードの上に番号の印を置く（位置はカードに対する割合）
        [[1, -6, -4], [2, 110, 4], [3, -9, 8], [4, 110, 26], [5, -9, 44], [6, -9, 53], [7, -9, 68]]
          .forEach(([n, x, y]) => holder.insertAdjacentHTML('beforeend', `<span class="ana-mark" style="left:${x}%;top:${y}%">${n}</span>`));
        wrap.appendChild(holder);
        wrap.insertAdjacentHTML('beforeend', `<ol class="ana-list">
          <li><b>コスト</b>：使うのに必要なマナ。補正で軽くなると緑、重くなると赤になる</li>
          <li><b>詠唱時間</b>：使ってから発動するまでの秒数。「⚡瞬間」は詠唱なし</li>
          <li><b>名前</b></li>
          <li><b>🎯 対象</b>：使うときに対象を選ぶカード</li>
          <li><b>COUNTER の帯</b>：カウンターステップでも使えるカード</li>
          <li><b>種類とキーワード</b>：クリーチャー・レリック・攻撃・妨害など。右は守護・潜伏などのキーワード</li>
          <li><b>効果</b>：マウスを乗せると、大きなカードと詳しい説明が出る</li>
        </ol>`);
        return wrap;
      },
      body: `<p>クリーチャーには下に<b>攻撃力</b>（ひし形）と<b>体力</b>（円）、レリックには<b>耐久</b>（盾形）があります。カードの左上に <span class="tag hp">♥3</span> があれば「代償」（体力も払う）、<span class="tag sac">🔪2</span> があれば「生贄」（味方を差し出す）が必要です。</p>`,
    },
    {
      id: 'mana', icon: '💠', title: 'マナとドロー',
      lead: `マナは<b>${Math.round(1 / CFG.manaRegen)}秒で1</b>回復する。カードは<b>${CFG.drawInterval}秒ごとに1枚</b>引く。`,
      demo: () => manaDemo(6, 0.55, 10),
      body: `<ul>
          <li>試合開始時のマナは<b>${CFG.startMana}</b>、最大は<b>${CFG.baseMaxMana}</b>。光っている◆が今使えるマナで、次の◆が下から満ちていきます。最大まで溜まると回復は止まります。</li>
          <li>回復とドローは<b>プレイステップの間だけ</b>。カウンターステップとクロノホールでは止まります。マナはフェーズをまたいで持ち越します。</li>
          <li>手札は最大${CFG.handLimit}枚（超えて引いたカードは墓地へ）。山札が尽きると、引くたびに${CFG.fatigue}ダメージ。</li>
          <li>カードの効果で、マナを増やす・回復を速くする・相手のマナを減らすことができます。</li>
        </ul>`,
      point: '<b>カウンターステップではマナが回復しない</b>ので、カウンター用のマナはプレイステップのうちに残しておく必要があります。全部使って攻めるか、残して構えるか。',
    },
    {
      id: 'cast', icon: '🔮', title: '詠唱',
      lead: 'カードは<b>すぐには発動しない</b>。',
      demo: () => {
        const d = document.createElement('div');
        d.className = 'cast-demo';
        d.innerHTML = `<div class="pd-ring" style="--p:.62">${UI.runeCircle('pd-circle')}</div><div class="pd-info"><div class="pd-label">相手が詠唱中！</div><div class="pd-left">1.5<small>秒</small></div><div class="pd-note">台座の枠が満ちると発動。発動前なら打ち消せる</div></div>`;
        d.querySelector('.pd-ring').appendChild(UI.cardEl(Cards.get('dragon')));
        return d;
      },
      body: `<ul>
          <li>プレイステップでカードを使うと、<b>詠唱時間</b>のあいだ台座に置かれ、周りの枠が満ちると発動します。</li>
          <li>詠唱中のカードは<b>相手から丸見え</b>です。対象を選ぶカードなら、誰を狙っているかも見えます。</li>
          <li><b>一度に詠唱できるのは1枚だけ</b>。<b>⚡瞬間</b>のカードは詠唱なしですぐ発動し、自分が詠唱中でも使えます。</li>
          <li>カウンターステップで使うカウンターは、詠唱なしで発動します。</li>
        </ul>`,
      point: '相手の大技は見てから【打ち消しの印】で消せる。打ち消しはプレイステップの読み合い、カウンターはフェーズの終わりの読み合いです。',
    },
    {
      id: 'creature', icon: '⚔️', title: 'クリーチャーと攻撃予約',
      lead: 'クリーチャーは召喚すると<b>攻撃を1回予約</b>する。攻撃はクロノホールで行う。',
      demo: () => `<div class="unit-row">${unitDemo({ icon: '🐺', name: '疾風の狼', atk: 3, hp: 2, res: 1 })}${unitDemo({ icon: '🪓', name: '略奪兵', kw: '連撃', atk: 2, hp: 2, res: 2 })}</div>${chipsDemo([['me', '🐺', 3], ['me', '🪓', 2], ['op', '🔥', 3], ['me', '🪓', 2]])}`,
      body: `<ul>
          <li>予約は、クリーチャーの右上の <b>⚔</b> と、画面中央の<b>クロノライン</b>（予約が実行される順の列。青が自分、赤が相手、🔥は本体へのダメージ）に表示されます。</li>
          <li>【突撃命令】などの効果や、「呪文を使うたび」などの能力による攻撃も、すべて予約になります。</li>
          <li>クロノホールまでに<b>予約したクリーチャーが場を離れると、その予約は不発</b>です。除去されたり、生贄にしたりすると攻撃できません。</li>
          <li><b>自律</b>を持つクリーチャーは、毎フェーズ、プレイステップの終わりに自分で攻撃を予約します。</li>
          <li>場に出せるのは<b>${CFG.fieldLimit}つまで</b>（クリーチャーとレリックの合計）。満杯のときに出すと、一番古い味方が場を譲って倒れます。</li>
        </ul>`,
      point: '強いクリーチャーほど、クロノホールまでの間に狙われます。出すのは早いほど予約を積めますが、遅いほど対応されにくくなります。',
    },
    {
      id: 'counter', icon: '⟲', title: 'カウンター',
      lead: 'カウンターステップでは、<b>〔カウンター〕のカードだけ</b>が使える。',
      demo: () => {
        const d = document.createElement('div');
        d.className = 'unit-row';
        ['snipe', 'rewind', 'shieldman', 'barrier'].forEach((id) => d.appendChild(UI.cardEl(Cards.get(id))));
        return d;
      },
      body: `<ul>
          <li>カウンターステップでは時間が止まり、相手の予約をじっくり見てから対応できます。カウンターは<b>詠唱なし</b>ですぐ発動します。</li>
          <li>1回のカウンターステップで使えるのは<b>1人${CFG.counterLimit}枚まで</b>。封印や時間停止の影響は受けません。</li>
          <li>どちらかがカウンターを使うと、相手の「パス」は取り消され、もう一度応じることができます（残り時間は最低${CFG.counterExtend}秒に延びます）。</li>
          <li>カウンターステップで出したクリーチャーは、召喚時の攻撃をしません（守りに間に合わせるためのもの）。</li>
          <li>使えるカウンターがない時は、自動でパスします。</li>
        </ul>
        <table class="key-table narrow">
          <tr><td>守る</td><td>【防壁】【盾持ちの兵】【見習い衛兵】【回復薬】【背水の陣】</td></tr>
          <tr><td>除く</td><td>【狙撃】【生命吸収】【送還】【時の巻き戻し】</td></tr>
          <tr><td>押し通す</td><td>【誘い出し】（守護を外す）【突撃指令】（予約を足す）【英雄の加護】（味方を守る）【儀式の短剣】</td></tr>
        </table>`,
      point: 'カウンターは逆転の切り札。ただしカウンターステップではマナが回復しないので、構えるならプレイステップでマナを残す必要があります。',
    },
    {
      id: 'hall', icon: '🕰️', title: 'クロノホール',
      lead: 'フェーズの終わりに、溜まった予約が<b>予約された順に</b>顕れる。',
      demo: () => stepsDemo('hall') + chipsDemo([['op', '🐀', 2], ['me', '🐺', 3], ['op', '🔥', 3], ['op', '🪓', 2], ['me', '🔥', 1]]),
      body: `<ul>
          <li>クロノラインの左から順に、攻撃と本体へのダメージが1つずつ実行されます。操作はできません。</li>
          <li>クロノホールの中で起きた攻撃（「攻撃を受け止めるたび攻撃する」など）も、予約の最後に加わってそのまま実行されます。</li>
          <li>体力が0になったら、その場で決着です。</li>
          <li><b>最終フェーズ（第${CFG.maxPhases}フェーズ）は決戦</b>：プレイステップの終わりに、場の<b>全てのクリーチャー</b>が攻撃を予約します。</li>
        </ul>`,
      point: '守護は1回のクロノホールで1回しか受け止められません。予約の順番を読んで、どの攻撃が通るかを考えましょう。',
    },
    {
      id: 'guard', icon: '🛡️', title: '守護',
      lead: '守護は、敵クリーチャーの攻撃を本体の代わりに受け止める。',
      demo: () => `<div class="unit-row">${unitDemo({ icon: '🛡️', name: '盾持ちの兵', kw: '守護', atk: 1, hp: 4, guard: true })}${unitDemo({ icon: '🛡️', name: '盾持ちの兵', kw: '守護(済)', atk: 1, hp: 2, guard: true, spent: true })}</div>`,
      body: `<ul>
          <li>受け止められるのは<b>1回のクロノホールで1回まで</b>。使った守護は枠が暗くなり「守護(済)」と表示されます（右）。次のフェーズで回復します。</li>
          <li>受け止めても<b>反撃はしません</b>。受け止めたダメージで体力が減ります。</li>
          <li><b>潜伏</b>は守護を無視して本体を攻撃し、<b>貫通</b>は受け止められても余ったダメージが本体に届きます。</li>
          <li>【盾持ちの兵】【見習い衛兵】はカウンターなので、相手の予約を見てから守りに出せます。</li>
        </ul>`,
      point: '予約の早い順に受け止めるので、安いクリーチャーの予約を先に積んで守護を使わせ、本命を通す…という読み合いもあります。',
    },
    {
      id: 'relic', icon: '🏺', title: 'レリック',
      lead: '場に置いて、効果を発揮し続ける「物」。',
      demo: () => `<div class="unit-row">${unitDemo({ icon: '⛲', name: '魔力の泉', hp: 3, relic: true })}${unitDemo({ icon: '🧱', name: '石壁', kw: '守護', hp: 3, relic: true, guard: true })}</div>`,
      body: `<ul>
          <li>クリーチャーと同じように場に出て、場の枠を使います。<b>攻撃はしません</b>（最終フェーズの決戦でも攻撃しません）。</li>
          <li>体力の代わりに<b>耐久</b>（盾形）があり、0になると壊れます。守護を持つレリックは攻撃を受け止めます。</li>
          <li>「クリーチャー」を対象にする効果は効きません。【追放の光】【送還】【沈黙の印】【焦土】など「レリック」と書かれた効果で対処します。</li>
          <li>生贄にできます。【原初の卵】【魂の器】は、壊すと効果が発動します。</li>
        </ul>`,
    },
    {
      id: 'keywords', icon: '📜', title: 'キーワード',
      lead: 'カードに書かれた【　】の意味。',
      demo: () => `<div class="kw-grid">${[
        ['カウンター', Cards.KEYWORD_HELP['カウンター']],
        ['守護', Cards.KEYWORD_HELP['守護']], ['潜伏', Cards.KEYWORD_HELP['潜伏']], ['貫通', Cards.KEYWORD_HELP['貫通']],
        ['吸血', Cards.KEYWORD_HELP['吸血']], ['連撃', Cards.KEYWORD_HELP['連撃']], ['不屈', Cards.KEYWORD_HELP['不屈']],
        ['堅牢', Cards.KEYWORD_HELP['堅牢']], ['自律', Cards.KEYWORD_HELP['自律']], ['鈍重', Cards.KEYWORD_HELP['鈍重']],
        ['狂気', Cards.KEYWORD_HELP['狂気']], ['代償', Cards.KEYWORD_HELP['代償']], ['生贄', Cards.KEYWORD_HELP['生贄']],
        ['攻撃する', Cards.KEYWORD_HELP['攻撃']],
        ['呪文', 'クリーチャーとレリック以外のカード全般。「呪文を使うたび」などの効果の対象'],
        ['墓地', '使った呪文・倒れたクリーチャー・捨てたカードが行く場所。枚数を参照するカードがある'],
        ['沈黙', '能力（キーワード・誘発・オーラ）を全て失う'],
      ].map(([k, v]) => chip(k, v)).join('')}</div>`,
      body: '',
    },
    {
      id: 'target', icon: '🎯', title: '対象と選択',
      lead: '🎯 のカードは、使うときに対象を選ぶ。',
      body: `<ul>
          <li>カードをクリックすると、選べる対象が光ります。クリック（または表示された数字キー）で決定します。選んでいる間は時間が止まります（最大5秒。右クリック・<kbd>Esc</kbd> でキャンセル）。</li>
          <li>対象は詠唱中に相手にも見えます（🎯の印）。発動までに対象がいなくなると<b>不発</b>です。</li>
          <li>「2枚引いて1枚<b>選んで</b>捨てる」などは選択画面が出ます。${CFG.choiceTime}秒で時間切れになるとランダムに選ばれます。</li>
          <li><b>狂気</b>のカードは捨てられると効果が発動するので、捨てる効果と組み合わせると強力です。</li>
        </ul>`,
      point: '狙われた味方は【送還】で手札に逃がせる。対象が見える仕組みは、守る側の読み合いでもあります。',
    },
    {
      id: 'cond', icon: '⚖️', title: '条件とデメリット',
      lead: '強いカードには、条件や代償があることも。',
      body: `<ul>
          <li>「墓地が6枚以上の時のみ」「体力が20以下の時のみ」「最後の2フェーズの間のみ」など、<b>条件を満たさないと使えない</b>カードがあります。使えない時は手札に理由が出ます。</li>
          <li>自分の体力を失う、マナを前借りする、相手にもカードを引かせる…など、<b>デメリットと引き換えに強い</b>カードもあります。自分で払う体力（代償・自傷）は、予約されずにその場で減ります。</li>
          <li>前借りやドロー停止などの状態は、プレイヤーの帯に表示されます。</li>
        </ul>`,
    },
    {
      id: 'deck', icon: '📚', title: 'デッキ構築',
      lead: `デッキはちょうど<b>${CFG.deckSize}枚</b>。同じカードは<b>${CFG.maxCopies}枚まで</b>。`,
      demo: () => `<div class="arch-grid">${Object.entries(Cards.ARCHES).filter(([k]) => k !== 'generic')
        .map(([, a]) => `<div class="arch-chip"><b>${a.label}</b><span>${a.desc}</span></div>`).join('')}</div>`,
      body: `<p>カードは全${Cards.LIST.length}種（うちカウンター${Cards.LIST.filter((c) => c.counter).length}種）。上のテーマはあくまで目安で、テーマを混ぜても、切り札だけを借りても構いません。対戦準備画面のプリセットが、各テーマと混成デッキの見本になっています。</p>`,
      point: 'カウンターを何枚入れるかがデッキの性格を決めます。攻めるデッキにも【誘い出し】【突撃指令】のような「押し通す」カウンターがあります。',
    },
    {
      id: 'keys', icon: '⌨️', title: '操作',
      lead: 'マウスでもキーボードでも遊べる。',
      body: `<table class="key-table">
          <tr><td><kbd>1</kbd>〜<kbd>9</kbd>, <kbd>0</kbd></td><td>手札のカードを使う（カードの下の数字）</td></tr>
          <tr><td><kbd>Space</kbd> ／ <kbd>Enter</kbd></td><td>準備完了（プレイステップ）／パス（カウンターステップ）</td></tr>
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
