#!/usr/bin/env bash
# itch.io にアップロードするZIPを作る（dist/chrono-duel.zip）
# ゲームの実行に必要なファイル（index.html, css/, js/）だけを含めます。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/chrono-duel.zip
zip -r dist/chrono-duel.zip index.html css js
echo "作成しました: dist/chrono-duel.zip"
