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

注意（未確認）：エンジンの相対 import は拡張子なし（`'./runGate'`）で、Next・vitest・`tsc`（`moduleResolution:
bundler`）では通るが、`node --experimental-strip-types --test` では解決できない。GREN BLUE の `node --test`
の試験からエンジンを直接 import するなら、vitest で回すか、拡張子をそろえる別の変更が要る。

### 点検報告 `e46.intake-check.v1`

`feat/intake-check-send`（e2610ba、まだマージ前）の `src/lib/intake/intakeCheck.ts`（形、zod）と `build.ts`
（走査からの組み立て）は**エンジン**に入る。依存は `probe/scan`・`runGate`・`variants`・
`investigation/redact`・`@tsunagi/ds2-mss54`・zod だけで、全部エンジンの中にある。このブランチの土台
（b132df7）にはまだ無いので、移していない。どちらかが先に main に入ったら、もう一方を載せ直すときに：

- `src/lib/intake/intakeCheck.ts`・`build.ts`（と `intake.test.ts`）→ `packages/monitoring-engine/src/intake/`、
  `index.ts` に `export * from './intake/intakeCheck'` と `'./intake/build'`、パッケージの `dependencies` に zod。
- `handoff.ts`（MAINTENANCE のタブへの postMessage）と SEND の画面（`useIntakeSend`、`/intake`）は画面に残す。
- 同じブランチのジャーナルの `scan`（`journal.ts`）と `redact.ts` の変更は、エンジンの同じファイルに当たる。

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

### 設計案（実装しない）：運営者の Cloudflare に置いたまま、m3 のサインインで読む

データは BMW SGBD 由来と逆コンパイル由来で、`THIRD-PARTY-NOTICES.md` §3 が配信を閉じた内側と定めている。
GREN BLUE のリポジトリにもビルドにも写さない。

```
 GREN BLUE SUITE（ブラウザ）── 同じオリジン ──► GREN BLUE の Pages Function
   configureEcuData(f => fetch(`/api/monitoring/ecu-data/${f}`))     /api/monitoring/ecu-data/:file
                                                                      │ スタッフの m3 トークン（サーバーが持つ）
                                                                      ▼
                                   e46m3-monitoring-preview の Pages Function /api/engine-data/:file
                                     ① Authorization: Bearer を m3 の /api/access/introspect で確かめる
                                     ② 利用権を確かめる（下の「決めること」）
                                     ③ ASSETS から ecu-data/<file> を返す。Cache-Control: private, no-store
```

- **本人と利用権は m3 だけ**（`tsunagi-m-access` §3-1）。GREN BLUE は m3 のクライアントとして登録し
  （`npm run access:client`、機密クライアント、`M3_CLIENT_SECRET`）、スタッフは m3 でサインインする。GREN BLUE
  にはすでに m3 アカウントの結び付けがある。
- **トークンを素通しさせない**（同 §3-3）。m3 のトークンは GREN BLUE のサーバー側だけが持ち、ブラウザには
  渡さない。ブラウザは自分のオリジンの `/api/monitoring/ecu-data/*` だけを読むので、CORS も要らない。
- MONITORING 側の新しい受け口は、ゲートの `publicPaths` に足さず、ゲートと別の確かめ方（Bearer と
  introspect）をする一本の Function。ファイル名は `^[a-z0-9_]+\.(jobs|telegrams)\.json$|^index\.json$|^variants\.json$`
  だけを通す。
- データの版：GREN BLUE は `index.json` の `generatedAt` をエンジンの記録（`sgbdSet`）に残す。

運営者に決めてもらうこと（選べる道・起きること・推す道）：

| 決めること | 道 | 起きること | 推す |
|---|---|---|---|
| 誰が読めるか | 甲：既存の `owner_preview` | 店のスタッフ全員に WORKS の全部も開く | |
| | 乙：新しい利用権 `monitoring_engine`（運営者が店のスタッフに付ける） | データだけが読める。WORKS の画面は開かない | **乙**。用途ごとに分けると、取り消しも分けられる |
| どこから配るか | 甲：MONITORING WORKS の Pages（`e46m3-monitoring-preview`）の Function | データの置き場は一つのまま。WORKS の配信と同じ更新で GREN BLUE も新しいデータを読む | **甲** |
| | 乙：R2 に置き、別の Worker が配る | 置き場が二つになり、データの更新を二か所に出す | |

## 5. 公開の範囲

- エンジンはコードだけ。`public/ecu-data/`・`tools/terms/` は今までどおり `.gitignore` の内側で、パッケージに
  入らない（`check:public` が追跡中のファイル全部を見る）。
- 試験が読む `testing/shipped.ts` は、リポジトリの `public/ecu-data/` があれば読み、無ければ試験を飛ばす。
  GREN BLUE の `vendor/` の中には無いので、そこでは飛ぶ。

## 6. 更新の知らせ（案。まだ置いていない）

エンジンに触れる変更（`packages/monitoring-engine/**`・`packages/ds2-core/**`・`packages/ds2-mss54/**`）が
main に入ったら、GREN BLUE に知らせる。エンジンは人の承認のクラスなので、届くのは人が見た変更だけ。

GREN BLUE 側の GitHub Actions は支払いの件で止まっている。受け取る側は Cloudflare のビルド（Git 連携）を
使う前提で、二つの道がある。

| | 甲：submodule の pin を上げるコミット（推す） | 乙：`repository_dispatch` |
|---|---|---|
| MONITORING がすること | GREN BLUE の main に、`vendor/E46M3-Monitoring` の gitlink だけを新しい SHA にするコミットを API で作る | GREN BLUE に `monitoring-engine-updated`（SHA つき）を送るだけ |
| GREN BLUE がすること | Cloudflare のビルドが push で走り、試験とビルドが通れば配信。落ちれば前の配信のまま | 受け取った Actions が pin を上げて試験する |
| 今動くか | 動く（GitHub Actions は MONITORING 側だけで足りる） | **動かない**（GREN BLUE の Actions が止まっている） |
| 壊れた組み合わせ | Cloudflare のビルドコマンドに試験を入れておけば、落ちたビルドは配信されない | GREN BLUE の Actions の試験次第 |
| 書き込む権限 | MONITORING の秘密値が GREN BLUE の Contents に書ける | Contents に書ける（dispatch に要る）が、ファイルは書かない |
| 履歴 | GREN BLUE の main に bot のコミットが積もる（エンジンの変更の数だけ） | GREN BLUE 側が決める |

甲の前に確かめること（未確認）：

- GREN BLUE は今、`npm run deploy`（手元の wrangler）で出していて、Cloudflare の Git 連携のビルドはまだ無い。
  `gren-blue-auto-admin` に Git 連携を付け、ビルドコマンドを `npm ci && npm test && npm run build -w apps/admin`
  のように**試験を含めて**組む。
- Cloudflare のビルドが submodule を取ること（このリポジトリは公開なので認証は要らない見込み）。
- `e46-maintenance` は私的なリポジトリなので、Git 連携のビルドでその submodule が取れるか。

運営者が入れる秘密値（名前だけ。値は運営者が入れる）：

| 名前 | 置き場 | 中身 |
|---|---|---|
| `GREN_BLUE_PIN_TOKEN` | このリポジトリの Environment `gren-blue`（Deployment branches は `main` だけ） | GitHub の fine-grained トークン。`mushitaro/tsunagi-gren-blue-private` だけ、Contents: Read and write、期限つき |

甲のワークフロー（`.github/workflows/notify-gren-blue.yml` に置くときの案）：

```yaml
name: notify-gren-blue
# エンジンに触れる変更が main に入ったら、GREN BLUE の submodule の pin を上げる（docs/ENGINE.md §6）。
on:
  push:
    branches: [main]
    paths:
      - 'packages/monitoring-engine/**'
      - 'packages/ds2-core/**'
      - 'packages/ds2-mss54/**'
permissions:
  contents: read
concurrency:
  group: notify-gren-blue
  cancel-in-progress: false
jobs:
  pin:
    runs-on: ubuntu-latest
    environment: gren-blue
    steps:
      - name: GREN BLUE の main に pin を上げるコミットを作る
        env:
          GH_TOKEN: ${{ secrets.GREN_BLUE_PIN_TOKEN }}
          REPO: mushitaro/tsunagi-gren-blue-private
          PATH_IN_REPO: vendor/E46M3-Monitoring
          SHA: ${{ github.sha }}
        run: |
          set -euo pipefail
          for attempt in 1 2 3; do
            head=$(gh api "repos/$REPO/git/ref/heads/main" --jq .object.sha)
            base_tree=$(gh api "repos/$REPO/git/commits/$head" --jq .tree.sha)
            current=$(gh api "repos/$REPO/contents/$PATH_IN_REPO?ref=$head" --jq .sha)
            if [ "$current" = "$SHA" ]; then echo "already at $SHA"; exit 0; fi
            tree=$(gh api "repos/$REPO/git/trees" -f base_tree="$base_tree" \
              -f "tree[][path]=$PATH_IN_REPO" -f "tree[][mode]=160000" -f "tree[][type]=commit" -f "tree[][sha]=$SHA" --jq .sha)
            commit=$(gh api "repos/$REPO/git/commits" -f tree="$tree" -f "parents[]=$head" \
              -f message="E46M3 /// MONITORING のエンジンを ${SHA:0:7} に上げる（mushitaro/E46M3-Monitoring@$SHA）" --jq .sha)
            # 早送りだけ。間に誰かが main を進めたら、作り直す。
            if gh api -X PATCH "repos/$REPO/git/refs/heads/main" -f sha="$commit" -F force=false >/dev/null; then
              echo "pinned $PATH_IN_REPO to $SHA"; exit 0
            fi
            sleep 5
          done
          echo "could not fast-forward GREN BLUE main" >&2; exit 1
```

乙のワークフロー（GREN BLUE の Actions が動くようになったとき）：

```yaml
name: notify-gren-blue
on:
  push:
    branches: [main]
    paths: ['packages/monitoring-engine/**', 'packages/ds2-core/**', 'packages/ds2-mss54/**']
permissions:
  contents: read
jobs:
  dispatch:
    runs-on: ubuntu-latest
    environment: gren-blue
    steps:
      - env:
          GH_TOKEN: ${{ secrets.GREN_BLUE_PIN_TOKEN }}
        run: |
          gh api repos/mushitaro/tsunagi-gren-blue-private/dispatches \
            -f event_type=monitoring-engine-updated -f "client_payload[sha]=${{ github.sha }}"
```
