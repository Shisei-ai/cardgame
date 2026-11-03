/*
 * rules.js — 遊び方（項目ごとにページを分ける）
 */
(function (root) {
  'use strict';
  const { Parts, Engine, UI } = root;
  const { $, esc } = UI;
  const CFG = Engine.CONFIG;

  const PAGES = [
    { id: 'win', icon: '🏆', title: '勝ち方', body: () => `
      <ul>
        <li>相手の<b>体力（${CFG.startHP}）</b>を先に0にした方の勝ち。</li>
        <li>山札が0枚の時にカードを引こうとしたら、その人の<b>負け</b>。</li>
        <li>デッキは<b>${CFG.deckSize}枚</b>、同じカードは<b>${CFG.maxCopies}枚まで</b>。基本カードと、カード工房で作ったオリジナルカードを混ぜて組めます。</li>
      </ul>` },
    { id: 'turn', icon: '⏳', title: 'ターンの流れ', body: () => `
      <ol class="flow">
        <li><b>ターン開始</b>：自分のクリーチャーが全てアンタップする</li>
        <li><b>最大マナ＋1</b>（上限${CFG.maxManaCap}）。マナが最大まで回復する</li>
        <li><b>ドロー</b>：1枚引く（先攻の1ターン目は引かない）</li>
        <li><b>メインステップ</b>：マナを払ってクリーチャーを召喚したり、呪文を唱えたりする</li>
        <li><b>アタックステップ</b>：クリーチャーで攻撃する</li>
        <li><b>ターン終了</b></li>
      </ol>
      <p class="hint">初期手札は${CFG.startHand}枚。先攻と後攻はランダムに決まります。</p>` },
    { id: 'creature', icon: '⚔️', title: 'クリーチャーとタップ', body: () => `
      <ul>
        <li>クリーチャーは召喚した<b>次の自分のターンから</b>攻撃できます（【速攻】を除く）。</li>
        <li>攻撃すると<b>タップ</b>（横向き）になります。タップしたクリーチャーは、相手のターンに<b>相手の攻撃対象</b>になります。</li>
        <li><b>アンタップ</b>（縦向き）のクリーチャーは攻撃されません。自分のターンの始めに全てアンタップします。</li>
        <li>攻撃先は「相手本体」か「タップしている相手のクリーチャー」（【狙撃】ならアンタップしていても狙える）。</li>
        <li>場に出せるのは${CFG.fieldLimit}体まで。手札は${CFG.handLimit}枚まで（超えて引いたカードは墓地へ）。</li>
      </ul>
      <p class="point">攻撃すれば相手の体力を削れるが、タップして狙われる。攻めるか、温存するか。</p>` },
    { id: 'ember', icon: '🔥', title: '火種とブロック', body: () => `
      <ul>
        <li>相手のクリーチャーに<b>攻撃されるたび</b>、攻撃が終わった後に<b>火種</b>を${CFG.emberPerAttack}つ得ます（${CFG.emberCap}つまで。ターンをまたいで残る）。</li>
        <li>火種は<b>マナの代わり</b>に使えます（まずマナから払い、足りない分を火種で払う）。相手のターンに迎撃呪文を唱える時にも使えます。</li>
        <li>相手本体への攻撃を、火種を<b>${CFG.emberBlockCost}つ</b>払って、アンタップの自分のクリーチャーで<b>ブロック</b>（受け止める）できます。ブロックしたクリーチャーはタップし、攻撃してきたクリーチャーとバトルします。【隠密】の攻撃はブロックできません。</li>
      </ul>
      <p class="point">攻撃するほど、相手に火種＝マナと守りの手段を与えてしまう。1回目の攻撃は通っても、2回目からはブロックされるかもしれない。どのクリーチャーから、何回攻撃するか。</p>` },
    { id: 'battle', icon: '💥', title: 'バトル', body: () => `
      <ul>
        <li>クリーチャーがクリーチャーを攻撃すると<b>バトル</b>。<b>パワーが大きい方が勝ち</b>、負けた方は破壊されて墓地へ。</li>
        <li>パワーが同じなら<b>両方破壊</b>。</li>
        <li>相手本体を攻撃すると、<b>パワーの分だけ</b>相手の体力が減ります。</li>
        <li>相手に【守護】を持つアンタップのクリーチャーがいると、攻撃はそちらが代わりに受けます（受けた守護はタップする）。</li>
      </ul>` },
    { id: 'spell', icon: '📜', title: '呪文と迎撃', body: () => `
      <ul>
        <li>呪文はマナを払って唱え、効果が発動したら墓地へ行きます。</li>
        <li><b>〔迎撃〕</b>の呪文は、自分のターンには使えません。<b>相手のクリーチャーが攻撃してきた時</b>に、手札から唱えられます。</li>
        <li>相手の効果で「呪文を唱えられない」状態になることもあります（帯に🔒が出ます）。</li>
      </ul>` },
    { id: 'keywords', icon: '🔑', title: 'キーワード効果', body: () => `
      <div class="kw-list">${Object.values(Parts.KEYWORDS).map((k) => `<div class="kw-item${k.pts < 0 ? ' minus' : ''}"><b>${k.label}</b><span>${esc(k.desc)}</span><small>${k.pts > 0 ? `容量 ${k.pts}` : `容量 +${-k.pts}（戻る）`}</small></div>`).join('')}</div>` },
    { id: 'forge', icon: '⚒', title: 'カード工房', body: () => `
      <ul>
        <li>「原石を引く」と、カードの<b>素質</b>がランダムに決まります（${Object.values(Parts.GRADES).map((g) => `${g.label}×${g.mult}`).join('、')}）。引き直しはできません。</li>
        <li><b>容量 ＝（${Parts.CAP.BASE} ＋ ${Parts.CAP.PER_COST} × コスト）× 素質の倍率</b>。コストを高くするほど容量が増えます。</li>
        <li>パワー（${Parts.CAP.POWER_PER_POINT}ごとに1。5000を超える分は1.5倍）、キーワード効果、テキスト効果が容量を使います。合計が容量に収まれば完成です。</li>
        <li>【鈍重】【自壊】などの<b>デメリット</b>を付けると、容量が戻ってきます。</li>
        <li>テキスト効果は「発動の場面」「条件」「代償」「効果」「量」「対象」を選んで組み立てます。強い組み合わせほど容量を使います。</li>
        <li>作ったカードは<b>カードコード</b>（文字列）にして、友達と交換できます。</li>
      </ul>
      <p class="point">素質の高い原石は、軽くて強いカードにするか、重い切り札にするか。原石を見てから決めましょう。</p>` },
    { id: 'keys', icon: '🖱', title: '操作', body: () => `
      <table class="key-table">
        <tr><td>手札のカードをクリック</td><td>カードを使う（メインステップ）</td></tr>
        <tr><td>自分のクリーチャー → 攻撃先</td><td>攻撃する（アタックステップ）</td></tr>
        <tr><td>右クリック ／ Esc</td><td>攻撃先選びをやめる</td></tr>
        <tr><td>マウスを乗せる</td><td>カードの詳しい説明</td></tr>
      </table>` },
  ];

  let current = 'win';
  function show(id) {
    current = id;
    const p = PAGES.find((x) => x.id === id);
    $('#rules-nav').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    $('#rules-page').innerHTML = `<h3><span>${p.icon}</span>${p.title}</h3><div class="rp-body">${p.body()}</div>`;
  }

  function init() {
    $('#rules-nav').innerHTML = PAGES.map((p) => `<button data-id="${p.id}"><span>${p.icon}</span>${p.title}</button>`).join('');
    $('#rules-nav').onclick = (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.id); };
    UI.onScreen('rules', () => show(current));
  }

  root.Rules = { init };
})(this);
