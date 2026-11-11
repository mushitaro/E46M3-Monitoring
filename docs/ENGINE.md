# 診断エンジン — `@tsunagi/monitoring-engine`

E46M3 /// MONITORING の診断エンジンを、画面から切り離した部品。この文書がエンジンと画面の境目の正本。

## 1. 何のために（運営者 2026-11-11）

- MESH に出す **E46M3 /// MONITORING**（このリポジトリ）と、GREN BLUE の管理アプリ **GREN BLUE SUITE**
  （`mushitaro/tsunagi-gren-blue-private`）は、入口（UX・UI・URL・ブランド）を分ける。どちらにも
  「E46M3 か E46 か」を選ぶ操作を置かない。
- GREN BLUE SUITE は一つの入口で MONITORING と MAINTENANCE を切り替えて使う。**SUITE が使うのはこの
  エンジンだけ**で、画面は SUITE が自分で持つ。
- 更新は、運営者がこのリポジトリの main に入れると GREN BLUE が受け取る（甲の道。§6）。壊れた組み合わせは
  店に届かない。

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
- `.github/autonomy.json` と `CODEOWNERS`：`packages/monitoring-engine/**` は人の承認（`autonomy:human`）。
  自律ループはエンジンを自分でマージできない。GREN BLUE に届くエンジンの変更は、必ず人が見たもの。

## 3. 公開する関数（入口 `@tsunagi/monitoring-engine`）

主なものを役目ごとに。全部は `src/index.ts`（各ファイルの `export *`）。

| 役目 | 名前 |
|---|---|
| リンク | `LinkSession`（`connect`・`reconnectPermitted`・`disconnect`・`readIdent`・`readFaults`・`readAdaptations`・`runRead`・`clearFaults`・`startLog`・`stopLog`・`startProbe`・`scanAll`・`readVehicleState`・`heartbeat`・`releaseWhileHidden`・`clearLog`・`clearError`・`lastError`・`subscribe`・`getSnapshot`・`setTarget`・`setHandlers`・`dispose`）、`KEEP_ALIVE_INTERVAL_MS`、型 `LinkSnapshot`・`LinkHandlers`・`LinkState`・`LinkMode`・`CommsLogLine`・`LiveSample`・`JobRunResult`・`AdaptationRead`・`RawFaultRead`・`LinkFailure`・`ParkedObservation` |
| React（`/react`） | `useLinkSession({ target, onFailure?, onObserved?, onRead? })` → `{ session, snapshot }` |
| 非公開データ | `configureEcuData`、`readEcuData`、`fetchEcuDataFromPage`、型 `EcuDataLoader`・`EcuDataResponse` |
| カタログ | `loadEcuIndex`、`loadEcuCatalog`、`label`・`text`・`description`、`jobIndex`、`jobRiskOf`、`verdictFor`、`facetCounts`、`humanName` |
| 電文 | `loadTelegrams`、`bestTelegram`、`moduleProtocol`、`noProtocol`、`hasIdent`、`hasFaultRead`、`kwpFrameOf`、`kwpExchange`、`parseDtcsByStatus` |
| 送るかの判断 | `mayRun`、`mayRunProtocolRead`、`telegramBytes`、`clearFaultsCommand`、`READ_ONLY_CONTROLS`、`mayActuate`、`whyNotSendable` |
| 台帳 | `EMPTY_LEDGER`、`recordParkedObservation`、`recordClear`、`grantMovingOk`、`mayReadWhileMoving`、`applyKillList`、`fetchKillList`、`mayRunOnVehicle` |
| 車の状態 | `vehicleStateFrom`、`motionOf`、`VEHICLE_STATE_MAX_AGE_MS` |
| 変種 | `loadIdentity`、`loadVariantRules`、`fittedFrom`、`isM3`、`mayModuleBeSent`、`frameVerdict`、`commonIdent`、`isCommonIdent`、`DME_ADDRESS` |
| 走査 | `loadScanTargets`、`scanTargets`、`runScan`、`scanCounts`、`ALL_MODULES` |
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

1. git submodule：`vendor/E46M3-Monitoring` ← `https://github.com/mushitaro/E46M3-Monitoring.git`（公開。
   認証は要らない）。
2. root の npm workspaces に `vendor/E46M3-Monitoring/packages/*` を足す（`@tsunagi/ds2-core`・
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

### 実装した：運営者の Cloudflare に置いたまま、m3 で確かめて読む（運営者 2026-11-11）

データは BMW SGBD 由来と逆コンパイル由来で、`THIRD-PARTY-NOTICES.md` §3 が配信を閉じた内側と定めている。
GREN BLUE のリポジトリにもビルドにも写さない。

```
 GREN BLUE SUITE（ブラウザ）── 同じオリジン ──► GREN BLUE の Pages Function（GREN BLUE 側で作る）
   configureEcuData(f => fetch(`/api/monitoring/ecu-data/${f}`))     /api/monitoring/ecu-data/:file
                                                                      │ Authorization: Bearer <m3 のトークン、
                                                                      │   このアプリ（monitoring-preview）宛て>
                                                                      ▼
                     e46m3-monitoring-preview  GET /api/engine-data/:file（functions/api/engine-data/[file].ts）
                       ① ファイル名は index.json・variants.json・<id>.jobs.json・<id>.telegrams.json だけ
                       ② m3 の /api/access/introspect に、このアプリのクライアントと M3_CLIENT_SECRET で訊く
                       ③ active で、利用権 `monitoring_engine` を持つアカウントだけ（肯定は 60 秒覚える、否定は覚えない）
                       ④ ASSETS の ecu-data/<file> を返す。Cache-Control: private, no-store。CORS なし
```

- クッキーのゲート（`functions/_middleware.ts`）は、この接頭辞の**データのファイル名だけ**を通し、確かめは
  関数に任せる。同じ接頭辞のほかのパスと、ほかの全部は今までどおりゲートの内側。ゲートの正本（`_owner-gate/`）は
  変えていない（`gate:verify` が見る）。
- 確かめられないとき（秘密値が無い・m3 に届かない・答えが読めない）は 503 で、何も返さない。
- 試験は `src/lib/sync/engineData.test.ts`。

#### m3 と GREN BLUE に要るもの（このリポジトリの外。まだ無い）

m3 はセッションを、発行したクライアントにしか「有効」と答えない（`readSession` の `client_id`）。そしてトークンは
サービスからサービスへ渡さない（`tsunagi-m-access` §3-3）。だから GREN BLUE のスタッフの、GREN BLUE 宛ての
トークンをこちらへ回すことはしない。GREN BLUE のサーバーは m3 から**このアプリ宛て**のトークンを得る：

1. **m3（tsunagi-m3）**：トークン交換（RFC 8693、`grant_type=urn:ietf:params:oauth:grant-type:token-exchange`）。
   GREN BLUE の機密クライアントが、スタッフの自分宛てのトークン（`subject_token`）を出し、`audience=monitoring-preview`
   で短い寿命のトークンを受け取る。m3 は交換を許すクライアントの組を `access_clients` に持つ。
2. **m3**：利用権 `monitoring_engine` を `Scope` に足し、運営者が店のスタッフのアカウントに付ける。
3. **GREN BLUE**：自分の Pages Function が交換したトークンをサーバーの中だけで持ち、上の図の一本を作る。

それまではこのアプリ宛てで `monitoring_engine` を持つトークンが無いので、`/api/engine-data/` は全部 401 か 403 で
閉じている。秘密値は今の `M3_CLIENT_SECRET` だけで、新しいものは無い。

## 5. 公開の範囲

- エンジンはコードだけ。`public/ecu-data/`・`tools/terms/` は今までどおり `.gitignore` の内側で、パッケージに
  入らない（`check:public` が追跡中のファイル全部を見る）。
- 試験が読む `testing/shipped.ts` は、リポジトリの `public/ecu-data/` があれば読み、無ければ試験を飛ばす。
  GREN BLUE の `vendor/` の中には無いので、そこでは飛ぶ。

## 6. 更新の知らせ：pin bump（運営者 2026-11-11）

`.github/workflows/notify-gren-blue.yml`。エンジンに触れる変更（`packages/monitoring-engine/**`・`packages/ds2-core/**`・
`packages/ds2-mss54/**`）が main に入ると、GREN BLUE（`mushitaro/tsunagi-gren-blue-private`）の main に、
`vendor/E46M3-Monitoring` の gitlink だけを新しい SHA にするコミットを API で作る（早送りだけ。間に main が進んだら
作り直す、3 回まで）。GREN BLUE の Cloudflare のビルドがその push で走り、試験とビルドが通れば配信、落ちれば前の
配信のまま。エンジンは人の承認のクラスなので、届くのは人が見た変更だけ。

運営者が入れる秘密値（名前だけ）：

| 名前 | 置き場 | 中身 |
|---|---|---|
| `GREN_BLUE_PIN_TOKEN` | このリポジトリの Environment `gren-blue`（Deployment branches は `main` だけ） | GitHub の fine-grained トークン。`mushitaro/tsunagi-gren-blue-private` だけ、Contents: Read and write、期限つき |

秘密値が無いとき、GREN BLUE にまだ submodule が無いときは、警告を出して何もしない。

GREN BLUE 側に要るもの（GREN BLUE の仕事）：

- submodule `vendor/E46M3-Monitoring`（このリポジトリは公開なので認証は要らない）と workspaces（§3）。
- Cloudflare の Git 連携のビルド。ビルドコマンドに**試験を含める**（例：`npm ci && npm test && npm run build -w apps/admin`）。
  今は手元の `npm run deploy` で出している。私的な `e46-maintenance` の submodule が Git 連携のビルドで取れるかは未確認。

`repository_dispatch` の道は採らない：GREN BLUE の GitHub Actions が止まっていて、受け取る側が無いため。
