#!/usr/bin/env bash
# itch.io にアップロードするZIPを作る（dist/arcana-forge.zip）
# ゲームの実行に必要なファイル（index.html, css/, js/）だけを含めます。
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dist
rm -f dist/arcana-forge.zip
zip -r dist/arcana-forge.zip index.html css js
echo "作成しました: dist/arcana-forge.zip"
