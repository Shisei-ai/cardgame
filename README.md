# ARCANA FORGE（仮題）

**札を鍛え、魂を刻め** — 自分だけのカードを作って戦う、ターン制のカードバトル（itch.io 向け HTML5 ゲームの試作）。

- **カード工房**：「原石」を引くと、カードの**素質**（容量の倍率）がランダムに決まる。コストを決めると**容量**（強さの上限）が決まり、その中でパワー・キーワード効果・テキスト効果を自由に組み合わせてカードを作る
- **テキスト効果**：発動の場面（29）・回数・条件（19）・代償（9）・効果（49）・対象（誰を／何体／選び方／絞り込み）・期間・「〜につき」を選んで組み立てる。起動効果・常在効果・トークン・蘇生・サーチ・打ち消し・コントロール奪取なども作れる
- **対戦**：CPUとのターン制バトル。体力10000を先に0にした方の勝ち。クリーチャーは攻撃すると**タップ**して、相手の攻撃対象になる
- **火種**：攻撃されるたびに得る資源。マナの代わりに使えるほか、相手本体への攻撃を**ブロック**できる。攻撃するほど相手に守りの手段を与えてしまう
- 基本カード57種＋作ったオリジナルカードで、40枚（同じカードは4枚まで）のデッキを組む
- 作ったカードは**カードコード**（文字列）にして、友達と交換できる
- CPUも毎回その場でオリジナルカードを鍛えてデッキを組むので、毎回ちがう相手と戦える

ルールの詳細はゲーム内の「遊び方」、設計の考え方は [docs/DESIGN.md](docs/DESIGN.md) を参照してください。

---

## 遊んでみる（ローカル）

ビルド作業は不要です。`index.html` をブラウザで開くだけで動きます。

## itch.io への公開

### 自動アップロード（GitHub Actions）

`.github/workflows/itch-deploy.yml` が、ゲームのファイル（`index.html`・`css/`・`js/`）の変更がプッシュされるたびに、itch.io 公式のアップロードツール **butler** でゲームページを更新します。

最初に一度だけ、GitHub のリポジトリの **Settings → Secrets and variables → Actions** で次を登録します。
- **Secrets**：`BUTLER_API_KEY`（itch.io の https://itch.io/user/settings/api-keys で作った API キー）
- **Variables**：`ITCH_TARGET`（`itch.io のユーザー名/ゲームのURL名`）

### 手動でアップロードする場合

```bash
./tools/package.sh
```

`dist/arcana-forge.zip` ができます。itch.io の「Kind of project」を `HTML` にしてアップロードし、「This file will be played in the browser」にチェック、Viewport は `1280 × 720` にします。

## ファイル構成

```
index.html          画面のHTML（全画面をここに記述し、表示を切り替える）
css/style.css       見た目
js/parts.js         ★カードを作る規則：容量・素質・キーワード効果・テキスト効果の部品・文章の自動生成・カードコード
js/cards.js         基本カード（parts.js の規則で作っている）
js/engine.js        ★対戦のルール処理（ターン・攻撃・バトル・効果）
js/ai.js            CPU（対戦での行動、カードの生成、デッキ作り）
js/storage.js       作ったカードとデッキの保存（ブラウザ内）
js/decks.js         見本のデッキ
js/ui-common.js     画面共通の部品（カードの描画など）
js/battle.js        対戦画面
js/forge-ui.js      カード工房
js/builder.js       デッキ構築
js/rules.js         遊び方
js/main.js          起動と対戦の準備画面
tools/check.js      基本カードが規則を満たしているかの確認
tools/simulate.js   CPU同士を大量に対戦させて、動作とバランスを確かめる
tools/fuzz.js       ランダムに作ったカードだけで対戦させ、全ての効果がエラー・無限ループなしで動くか確かめる
tools/package.sh    itch.io 用ZIPの作成
docs/DESIGN.md      設計の考え方
```

## 確認用のコマンド

```bash
node tools/check.js
```

```bash
node tools/simulate.js --games 500
```

ルールの数値を一時的に変えて比べる時は、`CFG` に JSON を渡します（例：火種でのブロックをなくす）。

```bash
CFG='{"emberBlockCost":0}' node tools/simulate.js --games 500
```
