# E46M3///Diagnosis

E46 M3 の診断・データログ・キャリブレーションを、**ブラウザから直接** DS2 / K-line で行うツール。
対象モジュール: **MSS54**(エンジン 0x12) / **SMG II**(変速機 0x32) / **DSC**(0x56)。

TSUNAGI ///M の計器系サブブランド。DS2 通信は
[MSS54HP CSL Convert Tuner](../E46M3CSL_TuningTool) と**同じリンク層**を共有する。

---

## 現在の状態

**読取経路は実装完了。実車での検証はこれから。**

| | 状態 |
|---|---|
| リポジトリ骨格・テーマ・静的エクスポート | ✅ |
| `packages/ds2-core`（共有 DS2 リンク層・4層構造） | ✅ |
| `packages/ds2-mss54`（213ライブ値・故障メモリ・テレグラム） | ✅ |
| UI（診断 / データログ / 通信ログ）＋ PRACTICE モード | ✅ |
| Cloudflare 配信一式（PWA / CSP / CI） | ✅ |
| **実車読取の検証** | ⏳ **車が必要** |
| SMG II / DSC のライブ値ブロック配置 | ⏳ 車 or ベンチECU が必要 |
| 書込・アクチュエータ | ⛔ 安全機構が揃うまで解禁しない |

**データはすべて未検証です。** ライブ値のオフセット/スケールは第三者ツールの
逆コンパイル由来、テレグラムは SGBD バイトコードの静的スクレイプ由来で、
どちらも実車で確認していません。アプリは常時その旨を表示します。

実装計画は `docs/PLAN.md`（`~/.claude/plans/pure-hopping-sutton.md` の写し）。

---
## clone すると何が手に入るか

このリポジトリは **public だがコードだけ**を含む。ECU テーブルは入っていない。
gitignore しているのではなく、**全コミットの履歴からも除去済み**である。理由は
`THIRD-PARTY-NOTICES.md` §3 — あれは BMW の SGBD から生成した派生物であり、
この企画が再ライセンスできるものではない。

clone した状態でできること・できないこと:

| | |
|---|---|
| `npm ci` | ✅ |
| `npm run typecheck` / `npm run lint` | ✅ |
| `npm test` | ⚠️ **237 中 55 が落ちる**（実測）。カタログを読むテストが該当し、`adaptationReset` / `jobOps` / `runGate` / `dscHydraulics` / `procedureSteps` が「出荷データが仕様と食い違っていないか」を検査しているため |
| `npm run build` | ✅ 成功し、アプリのシェルは動く |
| ECU セレクタ | ❌ `public/ecu-data/index.json` が無いので空。その旨を表示する |
| 車両との通信 | ❌ 上と同じ理由（どのジョブをどのアドレスへ送るかを知らない） |

**自分のデータを作るには**、自分の EDIABAS インストールが要る。手順と、リポジトリ外に
ある 5 つの真実の在り処は `docs/REFERENCES.md`、再生成できない資産の一覧は
`docs/PRESERVED.md` にある。おおまかには:

```bash
dotnet build tools/SgbdDump/SgbdDump.csproj -c Release   # 要 EdiabasLib のクローン
python tools/dump_modules.py                             # $SGBD_DUMP_DIR に SGBD をダンプ
python tools/gen_ecu_data.py                             # public/ecu-data/ を生成
```

`tools/SgbdDump` は EdiabasLib（**GPLv3**）とリンクする。ここのソースは MIT だが、
**ビルドした `SgbdDump.exe` は GPLv3 の結合著作物であり再配布してはならない**
（`THIRD-PARTY-NOTICES.md` §2）。

配信物は事情が違う。デプロイは開発機から行うので `out/` にはテーブルが載る —
つまり**露出しているのはリポジトリではなく配信先のほう**である。意図して受け入れた
トレードオフで、緩和策は Cloudflare Access（§3.3）。

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
詳細は [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)（依存監査の評価も同ファイル §4）。

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
