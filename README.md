# CHRONO DUEL（仮題）

**同時詠唱デッキ構築カードバトル** — itch.io 向け HTML5 ゲームのプロトタイプです。

- ターン制ではなく、あなたとCPUが**同時に**カードを使うリアルタイム制
- カードには**詠唱時間**があり、発動までの数秒間は相手から丸見え。打ち消し・遅延・防壁で**後出しの対応**ができる
- 全100種のカード、9つのテーマ（速攻・群れ・妨害・墓地・呪文連鎖・血の契約・城塞・成長・巨獣）。40枚・同名4枚までで自由に組める
- 制限時間3分。相手の体力（30）を0にするか、時間切れ時に体力が多い方が勝ち

ルールの詳細はゲーム内の「遊び方」、設計の考え方とバランス調整の記録は [docs/DESIGN.md](docs/DESIGN.md)、カードの一覧は [docs/CARDS.md](docs/CARDS.md) を参照してください。

---

## 遊んでみる（ローカル）

ビルド作業は不要です。`index.html` をブラウザで開くだけで動きます。

ローカルサーバー経由で開きたい場合（itch.io の環境により近くなります）は、たとえば Python があれば:

```bash
python3 -m http.server 8000
```

を実行して、ブラウザで `http://localhost:8000` を開きます。

## itch.io に公開する

1. ZIPファイルを作ります。

   ```bash
   ./tools/package.sh
   ```

   `dist/chrono-duel.zip` ができます。`zip` コマンドがない環境（Windowsなど）では、`index.html`・`css` フォルダ・`js` フォルダの3つを選んで右クリック →「圧縮」でも構いません。**ZIPを開いたときに `index.html` が一番上の階層にある**ことが重要です。

2. itch.io で「Create new project」を開き、次のように設定します。
   - **Kind of project**: `HTML`
   - **Uploads**: 作ったZIPをアップロードし、「This file will be played in the browser」にチェック
   - **Embed options → Viewport dimensions**: `1280 × 720`
   - 「Fullscreen button」にチェックを入れておくと遊びやすくなります

3. 「Save & view page」で表示を確認し、問題なければ公開設定（Visibility）を `Public` にします。

## ファイル構成

```
index.html          画面のHTML（全画面をここに記述し、表示を切り替える）
css/style.css       見た目
js/cards.js         ★カードの定義。カードの追加・数値調整はここ
js/engine.js        ★ルール処理（時間進行・詠唱・攻撃・勝敗）。CONFIG にゲーム全体の数値
js/ai.js            CPUの思考（強さ3段階）
js/presets.js       最初から用意されたデッキ
js/storage.js       自作デッキの保存（ブラウザ内）
js/ui-common.js     画面共通の部品（カード表示など）
js/builder.js       デッキ構築画面
js/battle.js        対戦画面
js/main.js          起動処理・対戦準備画面
tools/simulate.js   バランス検証：プリセット同士の対戦表を作る
tools/cardpower.js  バランス検証：カード1枚ごとの強さを測る
tools/cardlist.js   カード一覧（docs/CARDS.md）の自動生成
tools/lib.js        検証ツールの共通部品
tools/package.sh    itch.io用ZIPの作成
docs/DESIGN.md      ゲームデザインとバランス調整の記録
docs/CARDS.md       カード一覧（自動生成）
```

`cards.js`・`engine.js`・`ai.js`・`presets.js` は画面（DOM）に一切依存していないため、ブラウザでも Node.js でも動きます。これがバランス検証ツールを可能にしている仕組みです。

## バランス検証ツール

[Node.js](https://nodejs.org/) が入っていれば、AI同士を高速に対戦させて勝率を調べられます。

### デッキ同士の対戦表

```bash
node tools/simulate.js
```

9つのプリセット同士を総当たりで戦わせ、対戦表（行のデッキから見た勝率）を表示します。既定の設定で約10秒です。

| オプション | 意味 |
|---|---|
| `--games N` | 組み合わせごとの試合数（既定 100） |
| `--level easy/normal/hard` | AIの強さ（既定 hard） |
| `--cards` | カードごとの使用回数と「そのカードを使った側の勝率」も表示 |

### カード1枚ごとの強さ

```bash
node tools/cardpower.js
```

全カードについて「汎用力」（平凡なデッキに入れたら勝率が何%上がるか）と「テーマ内貢献」（そのカードを使うプリセットから抜いたら勝率が何%下がるか）を測り、格付け（強／局所／弱）ごとに並べます。約30秒かかります。`--only bolt,raider` で一部のカードだけを測れます。

### ルールの数値を一時的に変えて比較する

環境変数 `CFG` で `engine.js` の `CONFIG` を上書きできます。ファイルを書き換えずに「もしこうしたら」を試せます。

```bash
CFG='{"phaseTime":8,"startHP":25}' node tools/simulate.js
```

### カード一覧の更新

```bash
node tools/cardlist.js > docs/CARDS.md
```

カードの数値を変えたら、ツールで勝率がどう動くかを確認する、というサイクルで調整していくのがおすすめです。
