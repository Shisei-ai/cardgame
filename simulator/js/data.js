/*
 * data.js — ルールで使う「決まった値」の一覧
 *
 * 文明（ぶんめい）・カードの種類・ルールの数値をここにまとめています。
 * 他のファイルはここを参照するので、数値を変えたい時はここだけ直せば済みます。
 *
 * ※ このファイルは「ブラウザ」でも「Node.js（テスト用）」でも読み込めるように、
 *    最後の行で両方に対応した書き方（UMD）をしています。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SimData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** 文明。key は内部の名前、name は画面に出す名前、color はカードの色 */
  const CIVS = [
    { key: 'light', name: '光', color: '#f2d84b' },
    { key: 'water', name: '水', color: '#3d9be9' },
    { key: 'darkness', name: '闇', color: '#8a5ad6' },
    { key: 'fire', name: '火', color: '#e8513a' },
    { key: 'nature', name: '自然', color: '#45b04c' },
    { key: 'zero', name: 'ゼロ', color: '#9aa0a6' }, // 無色（どの文明でもない）
  ];
  const CIV_BY_KEY = Object.fromEntries(CIVS.map((c) => [c.key, c]));
  /** 「光」→ 'light' のように、日本語の文明名から内部の名前を引く */
  const CIV_BY_NAME = Object.fromEntries(CIVS.map((c) => [c.name, c.key]));

  /** カードの種類 */
  const TYPES = [
    { key: 'creature', name: 'クリーチャー' },
    { key: 'evolution', name: '進化クリーチャー' },
    { key: 'spell', name: '呪文' },
    { key: 'tamaseed', name: 'タマシード' },
  ];
  const TYPE_BY_KEY = Object.fromEntries(TYPES.map((t) => [t.key, t]));

  /** ルールの数値 */
  const RULES = {
    deckSize: 40,      // デッキはちょうど40枚
    maxCopies: 4,      // 同じ名前のカードは4枚まで
    startShields: 5,   // 最初のシールドの数
    startHand: 5,      // 最初の手札の枚数
    turnLimit: 120,    // これだけターンが進んだら引き分け（無限ループ防止のための安全装置）
    effectDepth: 30,   // 効果が効果を呼ぶ連鎖の上限（同上）
  };

  return { CIVS, CIV_BY_KEY, CIV_BY_NAME, TYPES, TYPE_BY_KEY, RULES };
});
