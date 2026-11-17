/*
 * sample-cards.js — 動作確認用の「見本カード」と「見本デッキ」
 *
 * 画像からカードを登録する前でも遊べるように、このツールのために作ったオリジナルのカードを用意しています。
 * （名前・種族・効果の組み合わせはすべて架空のものです）
 *
 * カードの形：
 *   id     … カードを見分けるための文字列（同じ名前でも id が違えば別のカード）
 *   name   … 名前
 *   type   … 'creature'（クリーチャー）/ 'evolution'（進化クリーチャー）/ 'spell'（呪文）
 *   civs   … 文明の配列（'light' 'water' 'darkness' 'fire' 'nature' 'zero'）
 *   cost   … コスト
 *   power  … パワー（呪文は null）
 *   races  … 種族の配列
 *   text   … 能力の文章（textparser.js が読んで効果にする）
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SampleCards = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const C = (id, name, type, civs, cost, power, races, text) => ({ id: 's_' + id, name, type, civs, cost, power, races, text, sample: true });

  const CARDS = [
    // ── 光
    C('alba', '白翼の見張り番アルバ', 'creature', ['light'], 2, 3000, ['光翼族'], '■ブロッカー\n■このクリーチャーは攻撃できない。'),
    C('serafina', '天光の守護者セラフィナ', 'creature', ['light'], 4, 4500, ['光翼族'], '■ブロッカー\n■このクリーチャーが出た時、カードを1枚引いてもよい。'),
    C('gardion', '聖盾機兵ガルディオン', 'creature', ['light'], 6, 9000, ['守護機兵'], '■ブロッカー\n■W・ブレイカー'),
    C('flashpray', '閃光の祈り', 'spell', ['light'], 2, null, [], '■S・トリガー\n■相手のクリーチャーを1体選び、タップする。'),
    C('lightseal', '光輝の結界', 'spell', ['light'], 5, null, [], '■S・トリガー\n■相手のクリーチャーをすべてタップする。'),
    C('milka', '暁の伝令ミルカ', 'creature', ['light'], 5, 4000, ['光翼族'], '■このクリーチャーが出た時、自分の山札の上から1枚目をシールド化する。'),
    C('arcus', '光帝アークス', 'creature', ['light'], 8, 12000, ['守護機兵'], '■T・ブレイカー'),
    // ── 水
    C('poppo', '泡沫の偵察機ポッポ', 'creature', ['water'], 3, 2000, ['深海機'], '■このクリーチャーが出た時、カードを1枚引く。'),
    C('nerei', '潮流の術士ネレイ', 'creature', ['water'], 5, 3000, ['水晶族'], '■このクリーチャーが出た時、相手のクリーチャーを1体選び、持ち主の手札に戻してもよい。'),
    C('whirl', '逆巻く渦', 'spell', ['water'], 3, null, [], '■S・トリガー\n■相手のクリーチャーを1体選び、持ち主の手札に戻す。'),
    C('wisdom', '知恵の泉', 'spell', ['water'], 3, null, [], '■カードを2枚引く。'),
    C('levia', '深海の巨像リヴァイア', 'creature', ['water'], 7, 11000, ['深海機'], '■W・ブレイカー\n■このクリーチャーが攻撃する時、カードを1枚引いてもよい。'),
    C('crystal', '水晶の盾兵', 'creature', ['water'], 3, 2000, ['水晶族'], '■ブロッカー'),
    C('kirigakure', '霧隠れの忍', 'creature', ['water'], 3, 3000, ['水晶族'], '■ジャストダイバー\n■このクリーチャーはブロックされない。'),
    // ── 闇
    C('ghoul', '影喰いのグール', 'creature', ['darkness'], 3, 2000, ['影獣'], '■ブロッカー\n■スレイヤー'),
    C('collector', '冥府の取り立て人', 'creature', ['darkness'], 4, 3000, ['冥府兵'], '■このクリーチャーが出た時、相手の手札を見ないで1枚選び、捨てさせる。'),
    C('scythe', '黒き鎌', 'spell', ['darkness'], 3, null, [], '■S・トリガー\n■相手のパワー2000以下のクリーチャーを1体破壊する。'),
    C('whisper', '終焉の囁き', 'spell', ['darkness'], 6, null, [], '■S・トリガー\n■相手のクリーチャーを1体破壊する。'),
    C('necro', '墓守の死霊術師', 'creature', ['darkness'], 5, 4000, ['冥府兵'], '■このクリーチャーが出た時、自分の墓地からクリーチャーを1体、手札に戻す。'),
    C('necros', '深淵竜ネクロス', 'creature', ['darkness'], 7, 10000, ['影獣'], '■W・ブレイカー\n■このクリーチャーが破壊された時、相手の手札を見ないで1枚選び、捨てさせる。'),
    C('imp', '影の小鬼', 'creature', ['darkness'], 2, 2000, ['影獣'], '■このクリーチャーが破壊された時、カードを1枚引く。'),
    // ── 火
    C('raider', '火花の突撃兵', 'creature', ['fire'], 2, 1000, ['火山兵'], '■スピードアタッカー'),
    C('garo', '爆炎の剣士ガロ', 'creature', ['fire'], 3, 3000, ['火山兵'], '■パワーアタッカー+2000'),
    C('volka', '灼熱の戦竜ヴォルカ', 'creature', ['fire'], 6, 6000, ['炎竜族'], '■W・ブレイカー\n■このクリーチャーが攻撃する時、相手のパワー2000以下のクリーチャーを1体破壊する。'),
    C('arrow', '炎の矢', 'spell', ['fire'], 2, null, [], '■S・トリガー\n■相手のパワー2000以下のクリーチャーを1体破壊する。'),
    C('brawler', '火山の暴れ者', 'creature', ['fire'], 4, 5000, ['火山兵'], '■マッハファイター'),
    C('zelga', '紅蓮の竜王ゼルガ', 'evolution', ['fire'], 5, 9000, ['炎竜族'], '■進化－自分の《炎竜族》または《火山兵》1体の上に置く。\n■W・ブレイカー'),
    C('banner', '炎の軍旗手', 'creature', ['fire'], 4, 3000, ['火山兵'], '■バトルゾーンにある自分の他の火のクリーチャーのパワーは+1000される。'),
    // ── 自然
    C('pipi', '若葉の森獣ピピ', 'creature', ['nature'], 3, 1000, ['森獣'], '■このクリーチャーが出た時、自分の山札の上から1枚目をマナゾーンに置く。'),
    C('grower', '大地の育て手', 'spell', ['nature'], 2, null, [], '■S・トリガー\n■自分の山札の上から1枚目をマナゾーンに置く。'),
    C('golm', '剛腕の樹霊ゴルム', 'creature', ['nature'], 4, 5000, ['樹霊'], ''),
    C('baoran', '森の巨獣バオラン', 'creature', ['nature'], 6, 8000, ['森獣'], '■W・ブレイカー\n■このクリーチャーが出た時、自分の山札の上から1枚目をマナゾーンに置く。'),
    C('toto', '森の番人トト', 'creature', ['nature'], 3, 3000, ['樹霊'], '■G・ストライク'),
    // ── 多色
    C('lume', '蒼天の賢者ルーメ', 'creature', ['light', 'water'], 5, 5500, ['光翼族', '水晶族'], '■ブロッカー\n■このクリーチャーが出た時、カードを1枚引く。'),
    C('gabra', '野生の炎獣ガブラ', 'creature', ['fire', 'nature'], 4, 6000, ['森獣', '火山兵'], '■パワーアタッカー+1000'),
    C('executioner', '黒炎の処刑人', 'creature', ['darkness', 'fire'], 6, 7000, ['冥府兵', '炎竜族'], '■W・ブレイカー\n■このクリーチャーが出た時、相手のパワー3000以下のクリーチャーを1体破壊する。'),
  ];

  const D = (name, list) => ({ id: 'sd_' + name, name, sample: true, cards: list.flatMap(([id, n]) => Array(n).fill('s_' + id)) });
  const DECKS = [
    D('見本：守りの光水', [['alba', 4], ['serafina', 4], ['gardion', 2], ['flashpray', 4], ['lightseal', 2], ['milka', 2], ['poppo', 4], ['nerei', 4], ['whirl', 4], ['wisdom', 2], ['levia', 2], ['crystal', 2], ['lume', 4]]),
    D('見本：速攻の火自然', [['raider', 4], ['garo', 4], ['volka', 3], ['arrow', 4], ['brawler', 3], ['zelga', 2], ['banner', 2], ['pipi', 4], ['grower', 4], ['golm', 4], ['baoran', 2], ['gabra', 4]]),
    D('見本：闇火の除去', [['ghoul', 4], ['collector', 4], ['scythe', 4], ['whisper', 2], ['necro', 3], ['necros', 2], ['imp', 4], ['executioner', 3], ['raider', 4], ['garo', 4], ['arrow', 4], ['volka', 2]]),
  ];

  return { CARDS, DECKS };
});
