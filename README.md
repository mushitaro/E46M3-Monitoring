# E46M3 /// MONITORING

（旧称 E46M3///Diagnosis。リポジトリ名は E46M3-Monitoring）

E46 M3 の診断・データログ・キャリブレーションを、**ブラウザから直接** DS2 / K-line で行うツール。
対象は **E46 M3 の 51 モジュール**。**MSS54**(エンジン 0x12) / **SMG II**(変速機 0x32) から
ボディ・快適装備・AV まで。`0x56` は年式で入れ替わる（前期 ASCMK20 / 後期 DSC_E46。
同時装着は無い）——載せたもの・載せなかったものと理由は [`docs/FITMENT.md`](docs/FITMENT.md)。

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
| 全モジュールの故障読取（DIAGNOSIS の ALL MODULES。解読は MSS54 だけ、ほかはバイトのまま） | ✅ |
| Cloudflare 配信一式（PWA / CSP / CI） | ✅ |
| **実車読取の検証** | ⏳ **車が必要** |
| SMG II / DSC のライブ値ブロック配置 | ⏳ 車 or ベンチECU が必要 |
| 書込・アクチュエータ | ⛔ 安全機構が揃うまで解禁しない |

**データはすべて未検証です。** ライブ値のオフセット/スケールは第三者ツールの
逆コンパイル由来、テレグラムは SGBD バイトコードの静的スクレイプ由来で、
どちらも実車で確認していません。アプリは常時その旨を表示します。

実装計画は `docs/PLAN.md`（`~/.claude/plans/pure-hopping-sutton.md` の写し）。

---

## ワークス版

いま配っているのは**ワークス版だけ**で、場所は `e46m3-monitoring-preview.pages.dev`。

ワークス版（WORKS）は購入者向けのビルドの呼び名で、MILE の購入者を、研究開発に加わるワークス
（メーカー直系の開発チーム）の一員として迎えるために付けた（運営者の決定、2026-09-25。それまでは
プレビュー版）。変えたのは**表示だけ**: manifest の名前（`E46M3 /// MONITORING — WORKS`、
ホーム画面は `W E46M3 MON`）、ヘッダの WORKS のバッジ、画面の文言。ビルドの variant
（`app-variant=preview`）・`owner_preview`・client id・ホスト・スクリプト名は `preview` のまま。

- **誰のためのものか**: MILE の購入者と、これまでに施工したオーナーさん。m3.tsunagi.app の
  アカウントに `owner_preview` の権利がある人が、M メニューの WORKS の行から開く。
- **ゲートの内側にある**: すべてのパスが `functions/_middleware.ts`（tsunagi-m3 の
  `tools/owner-gate` の複写。`npm run gate:verify` が正本との一致を確かめる）を通る。
  権利の無い人・サインインしていない人には、ECU テーブルを含めて何も出さない。
- **本番との違い**: MEMORY タブ（最後）と SESSION SYNC がある。読み取り結果・データログ・失敗前後の通信ログを
  端末に保存し、SYNC で本人のアカウントへ送り、別の端末へ復元できる。操作が失敗したときは
  エラー記録を自動で送る。ヘッダの AI で ASSISTANT をオンにすると、本人の AI アシスタントが TSUNAGI///Matrix
  の中継を通してこのタブに問い合わせられる（`src/lib/bridge/`）。任された調査の計画は、ハブの下の PROBE で
  走らせる（`docs/AUTONOMY.md`）。本番のビルドはこれらを持たず、セッションを端末に保存せず、ネットワークにも
  何も送らない（`src/lib/features.ts`、`THIRD-PARTY-NOTICES.md` §1）。
- **何を送り、どう扱うか**: 初めて開いたとき、何かを送る前に、アプリ自身の最初のダイアログ
  （「免責事項」）で示す。確認されるまでは何も送らない（`src/lib/previewNotice.ts`）。
  [プライバシーポリシー（#preview）](https://m3.tsunagi.app/privacy-policy#preview)にも書いてあり、
  そのダイアログとアプリのヘッダの盾（PRIVACY）から開ける。

配信は `npm run deploy`。ゲートがあること、配る版のソースが公開済み（`HEAD == origin/main`）で
作業ツリーがきれいなこと、公開してはならないものが追跡されていないことを確かめてからでないと
配信しない（`scripts/deploy.mjs` の冒頭）。Access の内側にあった旧本番
プロジェクト `e46m3-monitoring` は 2026-10-02 に削除した。

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
| `npm test` | ✅ データを読む 12 ファイルは飛ばし、そう表示する（`vitest.config.mts`）。それらは「出荷データが仕様と食い違っていないか」を検査するもので、データのある CI とクラウドのセッションで回る |
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
トレードオフで、緩和策はワークス版のオーナーゲート（§3.3）。

---



## アーキテクチャ

```
[ブラウザ (Cloudflare Pages 上の静的サイト)]
        │  Web Serial  9600 8E1
        ▼
[K+DCAN ケーブル] ──K-line(OBD-II ピン7)──▶ [ECU]
```

**車と話すサーバもローカルホストも無い。**（ワークス版には、ゲートと SYNC のための
Pages Functions がある。どちらも車には触れない。）前身の `OldBMW-Diag-PWA` は EdiabasLib を組み込んだ
ローカル .NET ホスト（`127.0.0.1:5199`）を経由していたが、この構成は本番配信と両立しない：

- Chrome 142 以降、HTTPS のパブリックオリジンからループバック宛の要求は
  **Local Network Access 権限なしでブロック**される
- 旧ホストは `Access-Control-Allow-Origin: *` かつ無認証で任意ジョブを実行できた
  （ケーブル接続中は任意の Web ページが ECU を叩けた）
- 利用者全員に `C:\EDIABAS` の導入と .NET ホストの起動を要求していた
- EdiabasLib は **GPLv3**。リンクしたホストを配布しつつリポジトリを非公開に保つのは無理がある

いまは EdiabasLib を**ビルド時のデータ生成ツール**としてのみ使う（`tools/SgbdDump`）。
詳細は [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)（依存監査の評価も同ファイル §4）。

---

## 画面 — 三つの窓

三つの窓でできている。開発での呼び名は M のツール共通の MAIN・MULTI・HUB（`tsunagi-m-design` §5.12）。
この画面の名札は、MAIN が LIST、MULTI が VISU。

- **MAIN（LIST）** — タブの中身。読んで、選ぶ。
- **MULTI（VISU）** — 選んだもの、今の状態の絵。見る。
- **HUB** — 状態行・通知・ハブのリング・サブアクション。次の一手を押す。

広い画面では三つとも出る（左に MAIN、右に MULTI と HUB）。900px 未満では HUB が常に出て、残りの場所を
MAIN と MULTI がフッタで交代する。ナビ（683×400）と横持ちの電話では HUB は右、縦持ちでは下。

| タブ | MAIN（LIST） | MULTI（VISU） | HUB のリング |
|---|---|---|---|
| DIAGNOSIS | IDENT と故障コード。ALL MODULES ではアドレスごとの答え | 故障の数。ALL MODULES では答えたモジュールの数 | READ（サブに CLEAR FAULTS・OPEN） |
| DATALOG | 記録する値・周期・ファイルの中身 | 記録のトレース | RECORD / STOP（サブに CSV） |
| ADAPTATION | 学習値のブロック | 読めたブロックの数 | READ |
| SERVICE | 手順の一覧 | 選んだ手順と最後の結果 | RUN / START（選んだ手順） |
| ACTUATOR | 作動テスト（操作は各行に） | このモジュールで何が試せるか | なし |
| MEMORY | いまのまとまりと SAVE、まだ残していないまとまり（読み取りは操作のたびに端末に記録され、接続から切断まで・10 分の無操作で区切られる。残さないものは 7 日で消える）、端末に残した記録。SYNC で SESSION SYNC（アカウントの記録・エラー記録・ASSISTANT・走行中の読取の許可）を開く | 記録の数 | なし |
| STARTUP | PROBE のセッション（オーナーの言葉・形の版・取った回数・どのセッションの続きか） | 系列（NEXT でつながったセッションと、版で足した・外した項目） | なし（サブに NEW SESSION・NEXT） |
| PROBE | AI が置いた部品（AI の言葉・故障・全モジュール・形・判定・比較・値）。オーナーは開く・閉じる・並べ替える | 比較の絵、または AI の言葉 | PROBE（このセッションの形を走らせる） |

接続する前のハブは、どのタブでも CONNECT。

### MODE — MANUAL と PROBE

HUB の左下の MODE で切り替える（TUNER の MODE と同じ場所）。いつでも切り替えられ、それぞれ最後に開いていたタブに戻る。

- **MANUAL** — DIAGNOSIS・DATALOG・ADAPTATION・SERVICE・ACTUATOR・MEMORY。オーナーが自分で読む。AI も今の道具を使える。
  したことは端末に記録され、あとから MEMORY で残す。
- **PROBE** — STARTUP・PROBE。AI のモードで、画面から選べるのは AI がオンのときだけ（AI が部品を置くかセッションを開くと、
  画面は自分で PROBE になる）。セッションは NEW SESSION で開き、オーナーの言葉（委任）で始まる。AI が形（読む項目と判定）を
  決めてデータを取り、NEXT で次のセッションに引き継ぐ。データを取った形は変わらない。項目を足す・外すと新しい版になり、
  次の実行から数える。比べるのは両方の形が測った項目だけで、足した項目は「v から」、外した項目は「それまでの記録は残る」と出る。
  ボードは端末にだけ残る（`lib/probe/board.ts`）。

---

## 開発

```bash
npm install
npm run dev      # http://localhost:5046
npm run build    # → out/ (静的エクスポート)
npm run lint
npm run typecheck
npm run build:e2e && npm run e2e   # デモテスト：模擬実車と AI の道具でシナリオを流す（e2e-report/）
```

PRACTICE は一台の模擬実車（後期 E46 M3、SMG II、DSC、ナビ）として答える。DME は故障 2 件とライブ値、
ほかのモジュールは自分の住所で識別と故障の読み取りに答え、付いていないモジュールは答えない。

**Web Serial はデスクトップ Chromium 系のみ**（Chrome / Edge）。iOS・Android・Safari・Firefox は非対応。
セキュアコンテキストが必須なので `localhost` か HTTPS で開くこと。

`npm run dev`（`next dev`）はワークス版の画面（MEMORY タブ）を出し、セッションを端末
（IndexedDB `e46m3-monitoring`）に保存するが、何も送らない — 送るかどうかは配信物の
`app-variant` タグで決まり、`next dev` はそれを持たないから。本番のビルドはセッションの保存も送信もしない。
ゲートと SYNC まで含めて手元で動かすときは、ワークス版をビルドして `wrangler pages dev` で開く:

```bash
npm run hooks:install                      # 一度だけ。コミット前に check-public-tree を走らせる
npm run build:preview                      # next build → build-id → brand-preview → gen-sw
npx wrangler d1 migrations apply tsunagi-m-preview-runs --local
npx wrangler pages dev out --port 8799
```

`.dev.vars`（**コミットしない**。`.gitignore` と `check-public-tree` が止める）:

```
M3_CLIENT_SECRET=<32 文字以上の任意の値>
GATE_DEV_ACCOUNT=<任意の UUID>            # m3 を通さず、このアカウントとして扱う
```

`GATE_DEV_*` はホストが `localhost` / `127.0.0.1` のときだけ効き、配信先では無視される。
`GATE_DEV_ACCOUNT` を書かなければ、ゲートは本物どおり m3 へサインインに送る。
`--local` の D1 は `.wrangler/` に置かれ、これもコミットしない。

---

## ディレクトリ

```
src/app/          Next.js App Router。globals.css は TSUNAGI ///M テーマ(2026-07改訂)
src/components/   UI プリミティブと共有部品（ui.tsx が唯一の出所）
src/components/shell/  枠・タブ・モジュール行・重ね合わせ
src/views/        タブ 1 つにつき 1 ディレクトリ。ペインと可視化
src/hooks/        React 側の状態（リンク状態・キープアライブ・武装）
src/lib/          純粋なロジック。門・分類・プロトコル・i18n
packages/ds2-core/    DS2 のフレーム・トランスポート（Web Serial / WebUSB-FTDI）
packages/ds2-mss54/   MSS54 のブロック定義（生成物）
public/ecu-data/  SGBD 由来の生成データ。**コミットしない**（下記）
tools/            SGBD → ecu-data の生成パイプライン（Python / C#）
tools/deprecated/ 引退したツールと、負の結果の記録
functions/        ワークス版の Pages Functions。オーナーのゲートと SYNC（/api/sessions・/api/diagnostics）
migrations/       SYNC の D1 スキーマ（共用 DB なのでテーブルは monitoring_*）
docs/             決定と来歴。実車に繋ぐ手順は docs/CONNECT-VEHICLE.md
```

`public/ecu-data/` と `recordings/` はこのリポジトリに**入っていない**。BMW の SGBD 由来
なので `THIRD-PARTY-NOTICES.md` §3 の扱いに従い、別の private リポジトリに置いてある。
欠けているものの**形と大きさ**だけは `tools/ecu_data_counts.json` と
`tools/SgbdDump/out.manifest.json` から読める。

---

## Credits

このツールは、他の人が先にやった仕事の上に載っている。

### MSS54 DS2 Tool — karter16

<https://github.com/karter16/MSS54-DS2-Tool-Public> · © 2026 karter16 ·
*MSS54 DS2 Tool Freeware Licence*

**ライブ値 213 チャンネルと適応ブロックの、バイト位置・データ形式・スケール係数**は
このツールに由来する。BMW の SGBD が公表しているのはジョブ名と結果名だけで、
**「応答のどこに値があるか」も「何倍すればよいか」も SGBD からは復元できない**。
このアプリが表示する数値は、全部この仕事の上に載っている。

入手経路は逆コンパイルであり、そのライセンスはそれを許諾していない。バイト位置と
スケール係数は「BMW の ECU についての事実」であって著者の創作的表現ではない、という
主張は立つが、それは主張であって判決ではない。立場の全文は
`THIRD-PARTY-NOTICES.md` §3.2。**このツールのソースもバイナリも本リポジトリは
再配布していない。**

### EdiabasLib — Ulrich Holeschak

<https://github.com/uholeschak/ediabaslib> · GPLv3

SGBD からジョブ・引数・結果・故障テキストを取り出すのに使っている。
**ビルド時のデータ生成のみ**で、アプリにも配信物にも一切入らない。
`tools/SgbdDump` はこれとリンクするので、**ビルドされた `SgbdDump.exe` は GPLv3 の
結合著作物であり再配布してはならない**（`THIRD-PARTY-NOTICES.md` §2）。

### BMW EDIABAS / SGBD

51 モジュール分のジョブ・引数・結果・故障本文の出所。BMW の所有物であり、
本リポジトリには入っていない。生成には各自の EDIABAS インストールが要る
（`docs/REFERENCES.md`）。

---

これらはアプリ内の **CREDITS** ダイアログ（ヘッダ右のメダル）からも読める。PWA として
インストールした人は README を開かないし、免責ダイアログの中には置かない——
あれは一度承認したら二度と出ないので、残り続けねばならない表示の置き場として最悪。

## 安全について

このツールは実車の ECU に命令を送ります。書込・アクチュエータ駆動は
**検証台帳で1ジョブずつ解禁する方式**で、既定はすべて無効です。
DSC のブレーキ油圧系は SGBD 自身が「ポンプは自動停止しない（最大60秒）」と警告しており、
出荷可否を個別に判断します。

`packages/ds2-core` のコメントは**仕様書です**。測定値・訂正・棄却した仮説・
各ガードを生んだ事故が記録されています。剥がさないでください。
