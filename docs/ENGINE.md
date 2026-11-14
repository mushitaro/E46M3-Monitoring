# 診断エンジン — `@tsunagi/monitoring-engine`

E46M3 /// MONITORING の診断エンジンを、画面から切り離した部品。この文書がエンジンと画面の境目の正本。

## 1. 何のために（運営者 2026-11-11）

- MESH に出す **E46M3 /// MONITORING**（このリポジトリ）と、GREN BLUE の管理アプリ **GREN BLUE SUITE**
  （`mushitaro/tsunagi-gren-blue-private`）は、入口（UX・UI・URL・ブランド）を分ける。どちらにも
  「E46M3 か E46 か」を選ぶ操作を置かない。
- GREN BLUE SUITE は一つの入口で MONITORING と MAINTENANCE を切り替えて使う。**SUITE が使うのはこの
  エンジンだけ**で、画面は SUITE が自分で持つ。
- 更新は、運営者がこのリポジトリの main に入れると、各 Mainstay のリポジトリへ「エンジンの版を上げる PR」が出る（§6）。
  Mainstay の必須のチェックが通れば入り、壊れた組み合わせは店に届かない。M は Mainstay の main に直接書かない。

エンジンを切り出しても、E46M3 /// MONITORING の画面・URL・操作・車に送るものは一つも変わらない。

## 2. 境目

### エンジン（`packages/monitoring-engine/src/`）

`src/lib/<path>` から **同じ相対パスのまま** `packages/monitoring-engine/src/<path>` に移した（`git mv`。
開いている PR は、同じファイルの新しい場所に当たる）。

| 役目 | ファイル |
|---|---|
| リンクのセッション（React を持たない核）。送るガード・停車の事前読取・IDENT による変種の確認・走行の境目・ハートビートの判断 | `link/session.ts`（`src/hooks/useDs2Link.ts` から移した）、`link/types.ts` |
| 薄い React のフック（`@tsunagi/monitoring-engine/react`） | `react.ts` の `useLinkSession` |
| 電文の台帳と送るかの判断 | `telegrams.ts`、`moduleProtocol.ts`、`kwpOnDs2.ts`、`runGate.ts`、`actuationGate.ts`、`ledger.ts`、`vehicleState.ts` |
| SGBD の分類を読む（`classify.py` の結果） | `ecuCatalog.ts`、`jobOps.ts`、`humanName.ts` |
| 変種の選び方 | `variants.ts`、`identity.ts` |
| 全モジュールの走査、故障の読み・解読 | `probe/scan.ts`、`probe/modules.ts`、（PROBE の実行器）`probe/executor.ts`・`plan.ts`・`criteria.ts` |
| 各モジュール自身の SGBD のジョブを動かす：故障読取 FS_LESEN を実車相手に進める・答えを値と単位に読む・データログの値（`<id>.results.json`。main の #48〜#58 で入り、ここに置いた） | `sgbd/vm.ts`、`sgbd/results.ts`、`sgbd/faultRead.ts`、`sgbd/logChannels.ts` |
| MSS54 以外の故障コードの読み方（各モジュール自身の SGBD が読む場所。`fault-layouts.json`、実車未確認）。ジョブのコードが無いモジュール（非 M3 の DME・GS20 ほか）で使う | `faultLayouts.ts` |
| 記録の形 | `journal.ts`、`sync/session.ts`、`investigation/readRecord.ts`、`investigation/redact.ts`、`logText.ts` |
| 点検報告 `e46.intake-check.v1` の形と組み立て、メーターの VIN の下 7 桁 | `intake/intakeCheck.ts`、`intake/build.ts`、`clusterVin.ts` |
| 練習用の車（PRACTICE） | `practiceCar.ts`、`practiceEcu.ts` |
| 時計 | `clock.ts` |
| 非公開データの受け取り口 | `ecuData.ts`（§4） |
| 試験の道具（入口には入れない。`/testing/*`） | `testing/shipped.ts`、`testing/variantFixture.ts` |

電文の符号化そのもの（フレーム、エコー、再送、Web Serial / WebUSB）は前からの `packages/ds2-core`、
MSS54 の表と解読は `packages/ds2-mss54`。エンジンはこの二つに名前で依存する。

### 画面に残したもの（`src/`）

- views、components、ヘッダ・メニュー（`src/components/shell/`）、文言（`src/lib/i18n/`）。
- Matrix の facade（`src/hooks/useMonitoringFacade.ts`）と橋渡し（`src/lib/bridge/`）。アシスタントが
  届くのは今までどおり画面の操作まで。
- `src/hooks/useDs2Link.ts`：エンジンの `useLinkSession` に、ページだけができることを足す薄い層
  （記録中の離脱の警告、画面を点けておく、隠れたことの記録、隠れて休んでいるときにケーブルを放す）。
  返すものは前と同じ形。
- M3 だけの機能の画面：作動テスト・調整・手順（`actuatorArgs`・`argFrame`・`procedure*`・`wizardSteps`・
  `smg2Workflows`・`adaptationReset`・`dscHydraulics`）、PROBE の盤・比べ・セッション
  （`probe/board`・`compare`・`graph`・`items`・`sessions`・`runStore`・`boardStore`）、CO-WORK
  （`notebook/`）、調査の委任（`investigation/share.ts`）、SYNC（`sync/` のうち `session.ts` 以外）、
  ファイルを渡す `download.ts`（文の形はエンジンの `logText.ts` を再輸出）。

### 境目を守るもの

- `packages/monitoring-engine/src/boundary.test.ts`：エンジンは `@/…` も、パッケージの外への相対パスも
  import しない（GREN BLUE には私たちの `src/` が無い）。外は `@tsunagi/ds2-core`・`@tsunagi/ds2-mss54` だけ。
  React を import するのは `react.ts` だけ。試験の道具は入口に入れない。
- `.github/autonomy.json` と `CODEOWNERS`：車に何を送ってよいかを決めるファイル（`runGate.ts`・`ledger.ts`・
  `actuationGate.ts`・`vehicleState.ts`・`variants.ts`）は人の承認（`autonomy:human`）で、自律ループは自分でマージできない。
  エンジンのほかのファイルは、運営者の 2026-11-13 の決まり（CI が通れば自動で取り込む）に従う。GREN BLUE に届くのは、
  Mainstay の側の必須のチェックが通った版だけ（§6）。

## 3. 公開する関数（入口 `@tsunagi/monitoring-engine`）

主なものを役目ごとに。全部は `src/index.ts`（各ファイルの `export *`）。

| 役目 | 名前 |
|---|---|
| リンク | `LinkSession`（`connect`・`reconnectPermitted`・`disconnect`・`readIdent`・`readFaults`・`readAdaptations`・`runRead`・`clearFaults`・`startLog`・`stopLog`・`startProbe`・`scanAll`・`readVehicleState`・`heartbeat`・`releaseWhileHidden`・`clearLog`・`clearError`・`lastError`・`subscribe`・`getSnapshot`・`setTarget`・`setHandlers`・`dispose`）、`KEEP_ALIVE_INTERVAL_MS`、型 `LinkSnapshot`・`LinkHandlers`・`LinkState`・`LinkMode`・`CommsLogLine`・`LiveSample`・`JobRunResult`・`AdaptationRead`・`RawFaultRead`・`LinkFailure`・`ParkedObservation` |
| React（`/react`） | `useLinkSession({ target, onFailure?, onObserved?, onRead? })` → `{ session, snapshot }` |
| 非公開データ | `configureEcuData`、`readEcuData`、`fetchEcuDataFromPage`、型 `EcuDataLoader`・`EcuDataResponse` |
| カタログ | `loadEcuIndex`、`loadEcuCatalog`、`label`・`text`・`description`、`jobIndex`、`jobRiskOf`、`verdictFor`、`facetCounts`、`humanName` |
| 電文 | `loadTelegrams`、`bestTelegram`、`moduleProtocol`、`noProtocol`、`hasIdent`、`hasFaultRead`、`mayTryFaultRead`、`kwpFrameOf`、`kwpExchange`、`parseDtcsByStatus` |
| 送るかの判断 | `mayRun`、`mayRunProtocolRead`、`mayJobSend`、`telegramBytes`、`clearFaultsCommand`、`READ_ONLY_CONTROLS`、`isReadOnlyControl`、`mayActuate`、`whyNotSendable` |
| SGBD のジョブ | `loadSgbdResults`、`runSgbdJob`、`decodeRead`、`decodeFaultRead`（ジョブのコードで故障の答えを読む）、`readFaultsByJob`、`hasFaultJob`、`moduleLogReads`・`moduleChannels`・`moduleLogGate` |
| 台帳 | `EMPTY_LEDGER`、`recordParkedObservation`、`recordClear`、`grantMovingOk`、`mayReadWhileMoving`、`applyKillList`、`fetchKillList`、`mayRunOnVehicle` |
| 車の状態 | `vehicleStateFrom`、`motionOf`、`VEHICLE_STATE_MAX_AGE_MS` |
| 変種 | `loadIdentity`、`loadVariantRules`、`fittedFrom`、`isM3`、`mayModuleBeSent`、`frameVerdict`、`commonIdent`、`isCommonIdent`、`DME_ADDRESS` |
| 走査 | `loadScanTargets`、`scanTargets`、`runScan`、`scanCounts`、`ALL_MODULES` |
| 速度源 | `SPEED_SOURCES`、`usableSpeedSource(dmeModuleId)`（M3 の MSS54 ブロック 19 だけが使える。非 M3 の候補は名前だけで、実車まで閉じている） |
| 故障の読み方 | `loadFaultLayouts`、`decodeByLayout(layout, reads)` → `DecodedFault[]`（`{ code: '0x2A', count, present }`）。読取の `RawFaultRead.decoded`、走査の `ScanResult.faults` に入る |
| PROBE | `runProbe`、`probeBlocks`、`loadProbeModules`、`judge`、`stepsProblem`・`judgesProblem`・`hypothesesProblem` |
| 記録の形 | `episodes`、`toSession`、`expired`、`SavedSession`・`FailureNote`・`excerpt`・`isSavedSession`、`ReadRecord`・`readRecordProblem`、`redactText`・`redactHex`・`redactResponse`・`redactDeep`、`logLine`、`datalogCsv` |
| 点検報告 | `buildIntakeCheck`、`intakeCheckReport`（zod）、`INTAKE_CHECK_SCHEMA`、`decodeIdent`、`sha256Hex`、`intakeFileName`、`clusterVinShort` |
| 練習の車 | `practiceCar`、`resetPracticeCar`、`PracticePort`、`practiceBus` |
| 時計 | `appNow`、`learnServerTime`、`isAnchored`、`onAnchor`、`PLAUSIBLE_FROM` |

### 使う側の決まり（GREN BLUE SUITE も同じ）

- **車に送れるのは `LinkSession` の操作だけ。** 送るガード（`Ds2Link.setSendGuard`）、IDENT での変種の確認、
  停車の事前読取（DME の車速 0 だけ）、`runGate` の判断は全部セッションの中にあり、画面からは迂回できない。
- **`clearFaults` は確認しない。** 呼ぶ前に、停車中に、画面で人に確かめるのは呼ぶ側の仕事（このアプリでは
  確認ダイアログ）。送る関数が確認を持つと、確認なしで呼べる関数になるから。
- 走行中の読取を認める（`grantMovingOk`）のは画面の人だけ。アプリもアシスタントも格上げしない。
- 画面の文は使う側の言葉で書く。エンジンが返すのは英語のログと拒否の文で、そのまま人に見せる文ではない。

### GREN BLUE での取り込み（e46-maintenance と同じ形）

1. git submodule：`vendor/e46m3-monitoring` ← `https://github.com/mushitaro/E46M3-Monitoring.git`（公開。
   認証は要らない）。
2. root の npm workspaces に `vendor/e46m3-monitoring/packages/*` を足す（`@tsunagi/ds2-core`・
   `@tsunagi/ds2-mss54`・`@tsunagi/monitoring-engine` の三つが入る）。
3. 使うアプリの `dependencies` に `@tsunagi/monitoring-engine`、`next.config.ts` の `transpilePackages` に
   三つ全部。ビルドなしの TS（`exports` は `src/*.ts`）。
4. 起動のはじめに一度、`configureEcuData(...)`（§4）。

エンジンと `@tsunagi/ds2-core`・`@tsunagi/ds2-mss54` の相対 import は `.ts` を名指し、構文は消すだけの TypeScript
（`erasableSyntaxOnly`・`verbatimModuleSyntax`。各パッケージの `tsconfig.json` が GREN BLUE の設定と同じ）なので、
バンドラなしの `node --experimental-strip-types --test` からも読める（`boundary.test.ts` が Node で入口を読み込んで
確かめる）。各パッケージの `npm run typecheck` は試験を除いて型を見る（GREN BLUE には vitest が無いため）。
`"test"` の script は置かない：GREN BLUE の `npm test --workspaces` に私たちの vitest の試験を走らせないため。

### 点検報告 `e46.intake-check.v1`

形（`intake/intakeCheck.ts`、zod だけに依る。E46 /// MAINTENANCE の `packages/contract` と同じバイト）と、走査からの
組み立て（`intake/build.ts` の `buildIntakeCheck`・`decodeIdent`・`sha256Hex`・`intakeFileName`）はエンジンにある。
JSON Schema は `docs/schemas/e46.intake-check.v1.schema.json`（`node scripts/gen-intake-schema.mjs` が書く）。

- `vinShort` は走査の `vin.vinShort`（メーターが自分で答えた下 7 桁、`clusterVin.ts`）。読んだバイトが別の VIN を
  綴っていたら、`vin` も `vinShort` も null にして選ばない。17 桁の `vin` は、読んだバイトに一つだけ綴られていたとき
  だけ（DS2 の E46 では null）。
- 渡し方は画面のもの。E46M3 /// MONITORING では `feat/intake-check-send` の SEND（MAINTENANCE のタブへの postMessage、
  `handoff.ts`）で、GREN BLUE SUITE では SUITE の中で渡す。どちらもエンジンには入れない。
- ジャーナルの `scan`（走査を記録に残す）は、プライバシーポリシーの改訂と組なので `feat/intake-check-send` に残した。

## 4. 非公開データ（ecu-data）の受け取り方

### 実装した：差し込める口

エンジンは URL を一つも持たない。読むのはファイル名だけで、全部 `ecuData.ts` の一つの口を通る。

```ts
import { configureEcuData } from '@tsunagi/monitoring-engine';
configureEcuData((file) => fetch(`/api/monitoring/ecu-data/${file}`, { cache: 'no-store' }));
```

- 読むファイルは `index.json`・`variants.json`・`<module>.jobs.json`・`<module>.telegrams.json`。
- 既定の口は `./ecu-data/<file>`（`fetchEcuDataFromPage`）で、E46M3 /// MONITORING は何も設定しない。
  前と同じものを同じ所から読む。
- 一度だけ、最初の読込みより前に呼ぶ（カタログと電文の表はページの間キャッシュされる）。
- 読めないときの振る舞いは前と同じ：カタログ・索引は HTTP の状態つきで投げ、電文の表と変種の規則は
  「無い」になって何も送らない側に倒れる。
- `link/session.test.ts` が、ディスクから読む口を渡して練習の車につなぎ、IDENT・故障の読み・走行中の拒否まで
  通ることを確かめる。

### 店のサーバーへの読み口：M の土台の「エンジンの口」（運営者 2026-11-11、2026-11-12）

データは BMW SGBD 由来と逆コンパイル由来で、`THIRD-PARTY-NOTICES.md` §3 が配信を閉じた内側と定めている。
GREN BLUE のリポジトリにもビルドにも写さない。

読み口は、このリポジトリには無い。**M の土台（`m.tsunagi.app`、リポジトリ `tsunagi-m-platform`）のエンジンの口**が持つ
（運営者 2026-11-12。エンジンは M、アプリは Mainstay。ハブの Skill `tsunagi-m-mainstay` §3）。MESH の道具である
E46M3 /// MONITORING の WORKS の配信や不具合が、店の流れに効かないようにするため。

前は、このリポジトリに `workers/engine-gateway`（`tsunagi-engine-gateway`）として置く計画だった。配信する前に、
同じ役目を土台の `m-engine` に置き直したので、ゲートウェイは消した（`feat/desk-inbox`）。

```
 GREN BLUE SUITE（ブラウザ）── 同じオリジン ──► GREN BLUE のサーバー（スタッフのサインインは店のもの）
   configureEcuData(f => fetch(`<店のサーバーの口>/${f}`))         店の engine-data の鍵で、札を作る（60 秒、その道だけ）
                                                                      ▼
                       M の土台  GET /engine/data/<file>
                         ① ファイル名は index.json・variants.json・fault-layouts.json・<id>.jobs.json・<id>.telegrams.json だけ
                         ② 鍵の名簿で、店の札を確かめる
                         ③ R2 の <束>/<版>/<file> を返す。版と ETag を付ける。同じものを持っていれば 304
```

- 道、札の形、鍵の出し方、データの上げ方は、土台の `docs/design.md` §7 の S5 と `docs/runbook-s5.md`。
- データは、運営者が手元の `ecu-data`（E46M3-Monitoring-data）から、土台の `npm run data:publish` で版にして R2 に上げる。
  このリポジトリの配信とは関係しない。**データを直したら、土台へ上げ直す**（版を有効にするまで、店は前の版を読む）。
- 店のスタッフのうち誰が読めるかは店のサインイン、どの店が読めるかは土台の鍵の名簿。m3 のトークンは使わない。
- エンジンの報告は、店のサーバー → 土台の `POST /engine/report` → このリポジトリの机の受け箱
  （`workers/desk`、`POST /inbox/engine-report`）の順に届く。机と自律ループはここに残る（`docs/AUTONOMY.md` §7）。

### このアプリ（m3 の WORKS）も、同じ口から読む（運営者 2026-11-14）

m3 も GREN BLUE と同じ、土台の上の Mainstay で、特別な入口を持たない。だから E46M3 /// MONITORING の WORKS も、
モジュールのデータ（エンジンが読むものと、画面が読む `<id>.jobtext.json`・`<id>.hydraulics.json`・`<id>.results.json`・
`smg2-workflows.json`）を土台のエンジンの口から読み、ビルドとリポジトリに入れない。

```
 MONITORING WORKS（ブラウザ）── ./ecu-data/<file>（今までと同じ道。エンジンも画面も設定を変えない）
   └ Service Worker：ecu-data-<版> のキャッシュ。車の中で電波が無くても開ける
        ▼ オーナーのゲート（functions/_middleware.ts）
 functions/ecu-data/[[path]].ts ── functions/_lib/engineData.ts（束を isolate のメモリにだけ、版が同じ間）
        ▼ m3 の engine-data の鍵で札（functions/_lib/door.ts は土台の正本の写し。npm run door:verify）
 M の土台  GET /engine/data/_bundle（index.json を求められたときだけ、一分に一度まで「変わった？」）
```

- **一つだけ GREN BLUE と違う：** 車の中で使う道具なので、ゲートの内側の端末に、版が同じ間だけ置いてよい（土台の
  `docs/design.md` §10、S5 の「写さない、残さない」の例外）。だから答えは `no-store` ではなく `private, no-cache` で、
  版（`x-m-dataset-version`）を名乗る。Service Worker は、新しい版のファイルが来たら古い版のキャッシュを消し、ゲートに
  断られたら（401・403・`/_gate/` への戻し）持っているデータを全部消す。
- **土台がこの配信に設定されるまでは、今までどおり**：`M_ENGINE_DATA_URL`・`M_MAINSTAY`・秘密値 `M_ENGINE_DATA_KEY` が
  揃っていなければ、道はビルドの中の写しへそのまま渡す。揃えた後は `npm run deploy -- --data-from-door` で、
  `public/ecu-data/` を外してビルドし、配信する（`out/ecu-data/` があれば止まる）。配信の後の確かめが、
  `/ecu-data/index.json` が版を名乗ることを見る。
- 土台に訊けないとき（電波、429、503）は、持っている束を使い続ける。何も持っていなければ、429 は「今日の上限、UTC 0 時に
  戻る」、それ以外は 503。どちらも「データが無い」とは言わない。

## 5. 公開の範囲

- エンジンはコードだけ。`public/ecu-data/`・`tools/terms/` は今までどおり `.gitignore` の内側で、パッケージに
  入らない（`check:public` が追跡中のファイル全部を見る）。
- 試験が読む `testing/shipped.ts` は、リポジトリの `public/ecu-data/` があれば読み、無ければ試験を飛ばす。
  GREN BLUE の `vendor/` の中には無いので、そこでは飛ぶ。

## 6. 更新の知らせ：Mainstay へ「エンジンの版を上げる PR」（運営者 2026-11-12）

正本は `tsunagi-m-mainstay` §6。エンジンは M のリポジトリだけで直し、M の main に入ると、M の CI が各 Mainstay の
リポジトリへ **エンジンの版を上げる PR** を出す。Mainstay の CI（必須のチェック）が適合の試験と自分の試験を回し、通れば入って
配信され、落ちれば前の版のまま。M は Mainstay の main に直接書かない：Mainstay のリポジトリは引き渡しの後は店のものになるから。

- ワークフロー：`.github/workflows/engine-to-mainstays.yml`。エンジンに触れる変更（`packages/monitoring-engine/**`・
  `packages/ds2-core/**`・`packages/ds2-mss54/**`）が main に入ると走る。エンジンは人の承認のクラスなので、届くのは人が見た変更だけ。
- 宛先の表：`.github/mainstays.json`（Mainstay ごとに `repo`・`path`（このリポジトリの submodule の場所。GREN BLUE は
  `vendor/e46m3-monitoring`）・`base`・`tokenSecret`）。引き渡しで宛先が変わったら、この表を直す（人の承認）。
- Mainstay ごとにすること：`base` の先頭の上に、submodule の gitlink だけを新しい SHA にするコミットを置いた枝
  `engine/e46m3-monitoring-<sha7>` を作り、PR を開き、**自動マージを有効にする**。同じ枝の名前の前の PR がまだ開いていれば閉じる
  （新しい方が置き換える）。すでにその SHA なら何もしない。
- 秘密値（名前だけ。値は運営者が入れる）：Environment `mainstays`（Deployment branches は `main` だけ）に、Mainstay ごとに一つ。

| 名前 | 中身 |
|---|---|
| `MAINSTAY_PR_TOKEN_GREN_BLUE_AUTO` | GitHub の fine-grained トークン。`mushitaro/tsunagi-gren-blue-private` だけ。Contents: Read and write（PR の枝を置くため）、Pull requests: Read and write。期限つき |

  トークンが無いとき、submodule がまだ無いときは、警告を出して何もしない。

Mainstay の側に要るもの（Mainstay の仕事）：

- submodule `vendor/e46m3-monitoring`（このリポジトリは公開なので認証は要らない）と workspaces（§3）。
- `base` の枝の保護：PR を必須にし、**必須のチェック**に Cloudflare のビルド（Git 連携。適合の試験と自分の試験を含む）を入れる。
  この保護が、上のトークンで main に直接書けないことを保つ。
- リポジトリの設定で「Allow auto-merge」。無いと PR は開いたまま（ワークフローは警告を出す）。
- `vendor/` の中は直さない。直してほしいことは、エンジンの報告（土台の `POST /engine/report`）か運営者への頼みで届ける。
