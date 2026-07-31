# E46M3///Diagnosis

E46 M3 の診断・データログ・キャリブレーションを、**ブラウザから直接** DS2 / K-line で行うツール。
対象モジュール: **MSS54**(エンジン 0x12) / **SMG II**(変速機 0x32) / **DSC**(0x56)。

TSUNAGI ///M の計器系サブブランド。DS2 通信は
[MSS54HP CSL Convert Tuner](../E46M3CSL_TuningTool) と**同じリンク層**を共有する。

---

## 現在の状態

**スキャフォールド段階。まだ車とは話せません。**

| | 状態 |
|---|---|
| リポジトリ骨格・テーマ・静的エクスポート | ✅ |
| `packages/ds2-core`（共有 DS2 リンク層） | ⏳ 未着手 |
| 4ビュー UI（診断/データログ/キャリブレーション/アクチュエータテスト） | ⏳ 未着手 |
| 実車読取 | ⏳ |
| 書込・アクチュエータ | ⛔ 安全機構が揃うまで解禁しない |

実装計画は `docs/PLAN.md`（`~/.claude/plans/pure-hopping-sutton.md` の写し）。

---

## アーキテクチャ

```
[ブラウザ (Cloudflare Pages 上の静的サイト)]
        │  Web Serial  9600 8E1
        ▼
[K+DCAN ケーブル] ──K-line(OBD-II ピン7)──▶ [ECU]
```

**サーバもローカルホストも無い。** 前身の `OldBMW-Diag-PWA` は EdiabasLib を組み込んだ
ローカル .NET ホスト（`127.0.0.1:5199`）を経由していたが、この構成は本番配信と両立しない：

- Chrome 142 以降、HTTPS のパブリックオリジンからループバック宛の要求は
  **Local Network Access 権限なしでブロック**される
- 旧ホストは `Access-Control-Allow-Origin: *` かつ無認証で任意ジョブを実行できた
  （ケーブル接続中は任意の Web ページが ECU を叩けた）
- 利用者全員に `C:\EDIABAS` の導入と .NET ホストの起動を要求していた
- EdiabasLib は **GPLv3**。リンクしたホストを配布しつつリポジトリを非公開に保つのは無理がある

いまは EdiabasLib を**ビルド時のデータ生成ツール**としてのみ使う（`tools/`, `host/`）。
詳細は [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

---

## 開発

```bash
npm install
npm run dev      # http://localhost:5046
npm run build    # → out/ (静的エクスポート)
npm run lint
npm run typecheck
```

**Web Serial はデスクトップ Chromium 系のみ**（Chrome / Edge）。iOS・Android・Safari・Firefox は非対応。
セキュアコンテキストが必須なので `localhost` か HTTPS で開くこと。

---

## ディレクトリ

```
src/app/          Next.js App Router。globals.css は TSUNAGI ///M テーマ(2026-07改訂)
src/components/   UI コンポーネント
src/hooks/        React 側の状態（リンク状態・キープアライブタイマ等）
src/lib/          アプリ固有ロジック
packages/         共有パッケージ（ds2-core 予定）
ecu-data/         SGBD 由来の生成データ。indent=1 で committed（差分が読めること）
recordings/       実車キャプチャ。テストフィクスチャとして使う
tools/            SGBD → ecu-data の生成パイプライン（Python / C#）
tools/deprecated/ 旧・正規表現スクレイパ。実行不可にしてある
host/             EdiabasLib ブリッジ。**ビルド時のデータ生成専用**（実行時依存ではない）
```

---

## 安全について

このツールは実車の ECU に命令を送ります。書込・アクチュエータ駆動は
**検証台帳で1ジョブずつ解禁する方式**で、既定はすべて無効です。
DSC のブレーキ油圧系は SGBD 自身が「ポンプは自動停止しない（最大60秒）」と警告しており、
出荷可否を個別に判断します。

`packages/ds2-core` のコメントは**仕様書です**。測定値・訂正・棄却した仮説・
各ガードを生んだ事故が記録されています。剥がさないでください。
