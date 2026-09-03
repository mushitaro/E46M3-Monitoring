# E46M3///Diagnosis

BMW E46 M3 を DS2 で読むブラウザ専用ツール。K+DCAN ケーブルに直接話す——デスクトップは
Web Serial、Android は WebUSB（Chrome for Android の `navigator.serial` は Bluetooth の
シリアルポート模倣しか列挙しないので、USB ケーブルはそちらの選択肢に現れない）。
サーバもローカルホストも無い（理由は `README.md`）。

対象は **E46 M3 の 51 モジュール**。エンジン MSS54 `0x12` / 変速機 SMG II `0x32` から
ボディ・快適装備・AV まで、INPA の E46 メニュー × M3 の装備で列挙してある
（`tools/gen_ecu_data.py` の `MODULES`）。`0x56` は年式で中身が入れ替わる: 前期は
ASCMK20、後期は DSC_E46 で、同時装着は無い。

Next.js 16 / React 19 / Tailwind v4、`output: 'export'` の静的書き出し。

## まず読むもの

| 知りたいこと | 場所 |
|---|---|
| 外部の参照物がどこにあるか | **`docs/REFERENCES.md`** |
| 何を作ってきたか・なぜそう決めたか | `docs/PLAN.md` |
| ライセンスとデータの出所 | `THIRD-PARTY-NOTICES.md` |
| ///M の意匠体系 | `tsunagi-m-design` スキル（`SKILL.md` だけでなく `references/` も） |

## この repo の決まり

- **UI は `src/components/ui.tsx` のプリミティブから組む。** 生の Tailwind で行を書き起こさない。
  `DataRow` の主スロットは `HumanName` しか受け取らないので、SGBD 識別子を人間向けの位置に
  入れるとコンパイルエラーになる。これは規約ではなく機構。
- **枠線は領域と領域の**間**の罫**。物の周りを囲まない（`border-b/-t/-l/-r` は可、裸の `border` は不可）。
- **実車に送るのは読取だけ。** 何を送ってよいかを決めるのは `src/lib/runGate.ts` の `mayRun` 一箇所。
  ここを迂回する経路を作らない。故障メモリ消去だけが唯一の書き込みで、確認ダイアログを伴う。
- **出所を落とさない。** 分類・訳・規定値には `provenance` が付く。分からないものは
  「分からない」と表示する。推定値を実測値の顔で出さない。
- **予約スロット**。状態が変わっても再レイアウトが起きないよう、通知行・サブアクション行などは
  空でも高さを保つ。

## 検査

```
npm run lint && npm run typecheck && npm test
node tools/check_ui_tokens.mjs
python tools/check_references.py
python tools/verify_ecu_data.py
python tools/verify_translation_quality.py
```

`public/ecu-data/*.json` と `packages/ds2-mss54/src/*.generated.ts` は**生成物**。
手で直さず、`docs/REFERENCES.md` §3 の表にある生成器を回す。

## デプロイ

Cloudflare Pages の `e46m3-diagnosis` ひとつだけ。**Cloudflare Access の内側**に置く
（`ecu-data/` は BMW SGBD 由来＋逆コンパイル由来で、`THIRD-PARTY-NOTICES.md` §3.3 が
repo を private・配信を Access 内と定めている）。GitHub Pages は採らない。
`npm run deploy`。デプロイ後はビルドログではなく**配信物**を確認する。
