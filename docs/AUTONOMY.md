# 車と例題で自分を育てる仕組み

ヘッドユニットの MONITORING WORKS に K+DCAN を挿したまま運営者が用事で走る間に、ドライバーの問い
（「低速カーブで DSC が早く効く気がする。原因と対策を」）を燃料に、**診断**と**道具の開発**が勝手に
進む仕組み。Matrix↔TUNER（CO-WORK・OBSERVE・`tuner_*`）の延長に置く。運営者の依頼は 2026-10-23、
計画の承認は 2026-10-27。

この文書が仕組みの正本。安全の決まりの実体はコードにあり、ここはその地図と理由を持つ。

## 1. 形 — 二つのループ

```
 例題（scenarios/）──► 机（Claude Code の定期セッション）──► 計画 v+1 ──┐
        ▲                 │ 道具の穴 → PR → CI → 自動マージ/人の承認 → WORKS 配信
        │                 ▼                                              │
   完成度の表 ◄── 所見・台帳 ◄── 走行・停車の記録（D1）◄── タブ（PROBE 実行）◄┘
                                   ▲  ヘッドユニットの MONITORING WORKS（オフライン先行）
                    Matrix MONITORING（monitoring_*）: 運転中の会話と机の両方が使う口
```

- **タブ**は、机が置いた計画の「起きたら取る」項目を自分で捕まえる。読取だけ。運転を指示しない。
  ネットが切れても走り、記録は後で上がる。
- **机**は Claude Code の自律ループ。頼まれた瞬間に起きる：WORKS が委任・机への問い・問いへの答え・PROBE の
  実行を D1 に入れると、`functions/_lib/wake.ts` がループの定期実行を API で起こす（合図は記録の id だけ。
  一つの記録は 10 分に 1 回、全体で 1 時間に 20 回まで）。定期の巡回は取りこぼしと CI・レビュー・例題の穴を
  拾う予備。記録を読み、仮説を確定・否定し、次の計画（再試験・別モジュール）か、道具の穴（拒否・未知の
  テレグラム・デコード不明）を開発タスクにして PR まで進める。承認の要らない直しは、マージされるとすぐ
  配信される（`autonomy-merge.yml` が `deploy-works.yml` を呼ぶ）。
- **例題**は受入テスト。各例題が要る能力を宣言し、例題 × 能力の表が「完成」の物差しになる。

## 2. TUNER の作法から引き継ぐもの、足すもの

会話と記録は TUNER の作法をそのまま採る（中継 0.10.0 の `tuner_guide` 全トピック）。

- 手順は Skill に写さず、道具と一緒に配る手順書（`monitoring_guide`）が持つ。Skill は入口だけ。
- トピックはオーナーの言い回しではなく「これから何をするか」で分け、各トピックに「読むとき」を付ける。
- 事実は手順書に書かない。ツールの説明とタブの応答が持つ。数はタブが計算し、ツールは読むだけ。
- CO-WORK（計画・手順の印・ドライバーの言葉・fact / read / ask / answer / status）。上書きしない。
- ドライバーの言葉がログに勝つ。推測は書かずに問いにする。結論を一文目に、確かさを言い分ける。
- 確認は二種類（頼まれた言葉が「はい」／失うものは復唱）。新しいケーブルの許可・書込・フラッシュは画面で人。一度画面でつないだケーブルへのつなぎ直しと切断は声でよい（運営者 2026-10-28。記録中の切断は止める確認のあと）。

TUNER に無いのは自律だけなので、そこだけ足す。

- **委任（mandate）**。TUNER の「計画はオーナーが同意した中身だけ」を守ったまま、オーナーの頼み
  （「原因と対策を考えて」「勝手に進めて」）を、その調査の範囲で読取の計画を書いてよい同意として
  CO-WORK に残す。範囲の外（読取以外・別の調査・期限切れ）は `ask` にしてオーナーを待つ。
- 判定基準 `criteria` に、文の他に機械で判定できる形（出所つき）を足す。判定はタブが計算する。
- 例題は Skill の網羅表にせず、Skill が正しく応じるかを試す評価用の例題にする。

## 3. Skill の組み方 — 一つの診断サイクル

オーナーの頼みは、言い回しは無数でも、次のサイクルのどこかに入る。エージェントは入口を決め、
そこのトピックを読む。網羅表なしに柔軟に応じられるのはこのため。

```
 症状 → 仮説（否定する観察つき）→ 証拠の取り方 → 計画（CO-WORK）→ 実行 → 判定 → 次の一手
  ▲                                                                     │
  └──── 再試験／別モジュールへ／対策（修理・画面での手順・TUNER へ）／道具の穴（開発）◄─┘
```

| 層 | 使う者 | 正本 | 入口 |
|---|---|---|---|
| 車側の会話 | 声の会話（claude.ai ほか） | `public/guide/*.md` → タブが hello で申告 → 中継が保持して `monitoring_guide` で返す | Matrix プラグインの薄い Skill `monitoring-drive` |
| 机 | Claude Code | `.claude/skills/monitoring-desk/SKILL.md` | 「解析して」「次の計画」「この項目を読めるように」 |
| 自律 | 定期起動の Claude Code | `.claude/skills/monitoring-loop/SKILL.md` | scheduled task のプロンプトは「これに従う」だけ |

`monitoring_guide` のトピック：drive・faults・investigate・catalog・cowork・moment・overview・
service・tuning・session・trouble・autonomy・reactive・predictive・symptom。

### 三つのモード（運営者 2026-11-01）

AI がオンのとき、オーナーの頼みはどれかのモードになる。委任（`mandate.mode`）に残り、車側の
会話（guide の同名のトピック）と机（`monitoring-desk`）が同じ形で続ける。

| モード | 始まり | AI がすること | 続け方 |
|---|---|---|---|
| 事後保全 `reactive` | 故障コード（`focus` に `module:code`） | 全モジュールの故障（`monitoring_scan`）→ 関係する値を集めた計画 → 観測（`monitoring_probe`）→ 版を重ねて値を絞る → 学習のリセット・調整は画面に置く → 同じ計画で再観測して比べる（`monitoring_compare`） | 同じ記録に委任を足す（`monitoring_investigate` の `record`）。ランの番号が定点観測の系譜 |
| 予兆保全 `predictive` | 故障は無い、健康診断、定期 | 全モジュールの故障、DME の全ブロック（`3:*`）と学習値（`adapt`）を合格基準（`judge`、出所つき、24 まで）で判定 → 外れを先に総評 → 前回と比べ、3 回目からは推移（`trend`）で次の一手 | 同上 |
| 症状 `symptom` | オーナーの言葉（「パワーが落ちた」） | 症状を示す値を見繕い、起きる条件で取り（`capture`）、基準（前の予兆保全のラン）と比べて伝える | 基準は別の記録のランでもよい（`baseline`） |

モジュールの切り替えも AI が行える（`monitoring_module`。画面の DISCONNECT・CONNECT と同じ手順）。

証拠は安い順に取る：故障とフリーズフレーム → 停車中の状態 → 停車中のライブ値 → 走行中の捕捉 →
DME の RAM（master の窓だけ）→ 画面での手順。

guide が名乗るツールは `src/lib/bridge/tools.ts` の一覧だけ（`guide.test.ts` が照合し、中継の
大きさの上限も検査する）。

### 例題 — 評価用で、Skill には書かない

`scenarios/cases.json` に、オーナーの言葉・状況・サイクルの入口・読むトピック・呼ぶツール・
してはいけないこと（`nevers`）・「答えた」の定義・要る能力を一件ずつ置く。`scenarios/capabilities.json`
は能力ごとの状態（`car` 実車で確認／`built` 作った／`missing` まだ）と、その根拠。

- `src/lib/bridge/scenarios.test.ts` — 例題が存在するトピック・ツール・決まり・能力だけを指すこと、
  guide の全トピックと全ての決まりにどれかの例題が当たること。
- `node tools/scenario_coverage.mjs` — 今答えられる例題の数と、どの能力が何件を塞いでいるか。
  完成度の物差しで、自律ループが開発の順を決めるのもこの表。
- 能力の状態を上げるのは、`where` に書いた根拠（実車の記録・コード）があるときだけ。

## 4. 安全の境界

| 決まり | どこが強制するか | 状態 |
|---|---|---|
| 送るかを決めるのは `runGate.ts`（カタログの読取は `mayRun`、アプリが組む読取は `mayRunProtocolRead`）。ツールは K ラインに直接何も足さない | `packages/monitoring-engine/src/runGate.ts`、`packages/monitoring-engine/src/probe/executor.ts` | 済。実行器は全フレームでゲートに訊く（2026-10-27） |
| モジュールには、そのモジュール自身の SGBD が送るものだけ | `packages/monitoring-engine/src/moduleProtocol.ts`、`link.to(address)` | 済（2026-10-27） |
| どのモジュールがいるかは IDENT で選ぶ。非 M3 の車に M3 の電文を送らない。変種の分からないアドレスは「?」で IDENT だけ | `packages/monitoring-engine/src/variants.ts`（規則は `tools/sgbd/gen_variants.py`）、`Ds2Link.setSendGuard`、`packages/monitoring-engine/src/probe/scan.ts` | 0x12・0x32 は済（2026-11-10）。0x80（D_0080、KOMBI）は 2026-11-11。ほかのアドレスの規則は未 |
| 読取は、送る直前に DME の車速が 0 と読めたときだけ。読めなければ出さない | `packages/monitoring-engine/src/link/session.ts` の事前読取（`preflight`）、`packages/monitoring-engine/src/vehicleState.ts` | 済（2026-10-27） |
| 走行中に送ってよい読取はオーナーが決める。アプリもアシスタントも格上げしない | `packages/monitoring-engine/src/ledger.ts` の `grantMovingOk`。画面は SESSION SYNC の WHILE MOVING（`views/sessions/MovingOkSection.tsx`、確認のあと、走行中は押せない）。`monitoring_ledger` は読むだけ | 済（画面は #9、2026-10-28）。認めた分はページを開いている間だけ |
| 意味的失敗（0xB0 など）は再送しない。再送は transport の失敗だけ | `packages/ds2-core/src/link.ts` | 済（以前から） |
| 読取以外は画面に置くだけ。実行は停車中に画面で人。DSC 油圧系は出さない | `mayRun`（非読取は拒否）、`monitoring_stage` | 拒否は済。stage は段 3 |
| キルリストで任意のジョブを即時に止める | `public/kill-list.json`、`packages/monitoring-engine/src/ledger.ts`、SW は precache しない | 取得と適用は済。D1 からの配信は段 2 |
| タブは新しい計画の版と新しいビルドを停車中・リンク休止中にだけ採る | 計画は `useProbe` が開始時に一度だけ読む（開始は画面の人、または AI モードでアシスタントの `monitoring_probe`。運営者 2026-11-01）。ビルドは、リンクが 1 分続けて切れていて未保存が無いときだけ（`lib/adoptBuild.ts`） | 済（ビルドは 2026-10-28） |
| 送るのは、委任が立っている調査だけ。取り下げたら、まだ送っていないものも送らない | `lib/investigation/share.ts`（タブ・`functions/api/notebook`・`/runs`・机が同じ関数を使う） | 済（2026-10-28） |
| 全モジュールの読取は、各モジュール自身の故障読取だけ。同じアドレスに複数の SGBD があれば、全員の表にあるフレームだけ。停車の確認は数アドレスごとに測り直す | `packages/monitoring-engine/src/probe/scan.ts` | 済（2026-11-01） |
| 机が読むのは委任中の調査だけ。オーナーの ID と VIN は出さない。書くのは `desk` としての追記だけ | `workers/desk/`、`packages/monitoring-engine/src/investigation/redact.ts`、`deskProblem`、監査の行 | 済（2026-10-28）。配備は §6 |
| 入庫点検の VIN はメーター（KOMBI46・46R）の AIF ブロック 2 から一度だけ読み、下 7 桁の文字だけを走査の `vin` に置く（点検報告への組み込みは次）。走査の結果のバイトにも AI の返り値にも入れない | `packages/monitoring-engine/src/clusterVin.ts`、`packages/monitoring-engine/src/probe/scan.ts` の `vin`、`runGate` の `identity-read`、`useMonitoringFacade.vin.test.ts`、デモテスト S20 | 作った（2026-11-11）。実車未確認 |

## 5. 段取り

| 段 | 中身 | 承認 |
|---|---|---|
| 0 | 宛先の修正、実測の車両状態、台帳の段階、キルリスト、試験とクラウドの足場 | 人 |
| 1 | タブの実行器（`src/lib/probe/`）と CO-WORK（TUNER の `notebook/rules.ts` の形）。実行器・判定・委任の規則、端末の保存（`notebook/store.ts`）、PROBE（副操作で開始、ハブで STOP と一行）は済 | 人 |
| 2 | ポリシーの改訂（成功した読取の送信・中継の catalog）→ D1 → 机の CLI。ポリシーは済（tsunagi-m3 #29）。お知らせ v2、D1（`0002`）、端末の送信（読み取りの記録・調査の記録）、机の Worker と `npm run desk` は作成済み（§8） | 人 |
| 3 | Matrix MONITORING：ticket・同一オリジンのソケット・hello・19 のツール・SESSION SYNC の ASSISTANT。タブ側は済（代わりの中継で確認）。中継 0.11.0 は作成済み、未配備 | 人 |
| 4 | guide の全トピック、机と自律の Skill、例題と能力の表、自動マージの分類（`.github/autonomy.json`・`scripts/autonomy-class.mjs`・CODEOWNERS・`autonomy.yml`）、配信（`deploy-works.yml`）は済。定期実行は PR #1 が main に入ってから | 分類による |
| 5 | テレグラムを SGBD の実行トレースで得る（`.prg` をデータ repo へ） | 人 |
| 6 | 例題 1（DSC 低速カーブ）を一周 | — |
| 7 | Manifold の DIAG の枠（OTA の署名は PC） | 人 |

自動マージ（運営者 2026-11-13「取り込みを止めるのをやめてほしい」。2026-10-23 の PLAN §8-3 より広げた）：
CI が通れば、どの変更も自動で取り込まれる。人の承認が残るのは表の `human` だけ——決まりそのもの（`.github/`・
`.claude/`・`CLAUDE.md`・分類と声の OK の判定器・机の CLI と受け口）と、車に何を送ってよいかを決める所
（`runGate`・台帳・作動のゲート・車両状態・変種の選び方 `variants`・`packages/ds2-core`・キルリスト・ゲートの入口。前の五つはエンジン `packages/monitoring-engine/src/` の中）。配信の前には
デモテストが毎回回り、落ちれば配信しない。分類はパスの許可表と CI で決め、
エージェントの判断にしない。`autonomy.yml` が PR に `autonomy:auto` か `autonomy:human` を付ける（ラベルは
無ければ作る）。`autonomy-merge.yml` は、Claude のブランチ（`claude/*`。自律ループと開発のセッション）で `auto` のものだけを、CI が
その同じコミットで通ったあとにマージする。分類は main の表で計算し直すので、ブランチが自分を裁く表を
緩めることはできない。リポジトリの設定（自動マージ・ブランチ保護）は要らない。`human` は CODEOWNERS が
オーナーにレビューを頼む。表と CODEOWNERS が食い違わないことは `src/lib/autonomyClass.test.ts` が見る。

**声の OK（運営者の依頼、2026-11-12「声のマージOKで、取り込めるようにしてください」）。** 運営者は運転中に GitHub の
レビューができないので、`human` の PR にもう一つの道を用意した。車内のアシスタントが、運営者の「マージOK」を
調査の記録に `マージOK #<番号>` で始まる項目として書く。`scripts/owner-ok.mjs` がその記録と表を読み、`merge` か
`wait: 理由` を言う。`merge` の条件は三つ：その項目を書いたのが机でないこと（机のトークンは `desk` としてしか
書けないので、ループは自分で OK を書けない）、項目が PR の最後のコミットより新しいこと（OK は言われた時点の
中身にだけ効く）、変更が表の `owner` のパスに触れていないこと。`owner` は、決まりそのもの（`.github/`・
`.claude/`・`CLAUDE.md`・分類と OK の判定）、`runGate`・台帳・作動のゲート・車両状態・変種の選び方・`ds2-core`・キルリスト、
机とゲートの入口で、これらは今までどおり運営者のアカウントだけが取り込む。声の OK は PR ごとで、「これからの
分は全部」は無い。信頼の置き場所は 2026-11-09 の決まり（会話が運営者のアカウントで取り込む）と同じ——運営者の
言葉を書き取るアシスタント——で、変わるのは取り込む手だけ。`src/lib/ownerOk.test.ts` が見る。

ループは起動のたびに記録の `マージOK #<番号>` を探し、`owner-ok.mjs` が `merge` と言った PR を、CI が緑で
衝突が無いときに取り込む（`.claude/skills/monitoring-loop/SKILL.md` §3。手順書の書き換えは運営者の依頼で
運営者のセッションがした）。`wait` のときは理由を同じ記録に書く。車内のアシスタントは、運営者が「マージOK」と
言ったら `monitoring_finding`（`kind: ask`、`to: desk`）の一行目に `マージOK #<番号>` と書く（手順書 `index.md`）。
机への問いなのでループはすぐ起こされる。

配信は `deploy-works.yml`（main への push と 6 時間ごと、配信済みのコミットは飛ばす）。`npm run deploy` が
きれいな main とデータを確かめてから上げ、配信物を読み戻す。ゲートの内側の確認はオーナーのセッションが
要るので、ランナーでは「配信済み・内側は未確認」の警告で終わる。

## 6. 運営者に一度だけ頼むこと

済んだもの（2026-10-28）：ポリシーの公開（tsunagi-m3 #29）、段 0–4 のマージ（#1）、`.prg` と SIM（データ
repo #1）、中継 0.11.0 の配備と MONITORING 用の秘密、定期実行（専用セッション「MONITORING 自律ループ」）。
段 2 と机（#4・#5）：D1 の `0002`、WORKS の配信（build 143.c0d3826）、机（`https://monitoring-desk.pages.dev`、
Pages の別プロジェクト。Worker の `workers.dev` はアカウント名が URL に出るので使わない）、机のトークン
（`loop`、2026-11-27 まで）とクラウド環境の `MONITORING_DESK_URL`・`MONITORING_DESK_TOKEN`・ネットワークの許可。
GitHub のラベル・自動マージ・ブランチ保護は `autonomy.yml` と `autonomy-merge.yml` が要らなくした。

机のトークンは期限（既定 30 日）の前に `npm run desk:token -- issue loop` で新しいものを出し、クラウド環境を
差し替えてから、古いものを `revoke` する。Cloudflare の鍵はクラウドのセッションに置かない（運営者、2026-10-28）。

机の受け口は、main に入った変更のうち受け口が取り込むもの（`workers/desk/`、計画と記録の決まり）があるとき、
`deploy-desk.yml` が WORKS と同じ `works` 環境の鍵で配り直す（2026-11-12。それまでは手で `npm run desk:deploy`
していて、受け口が計画の `adapt` の手順も知らないほど遅れていた）。手で回すのは Actions の Deploy desk。

残るもの：

1. この変更（起こす口・すぐの配信・机の分け方）のレビュー（人の承認クラス）。
2. ヘッドユニットで MONITORING WORKS を開き直し（新しいビルド）、お知らせ v2 に同意、ヘッダの AI で ASSISTANT を
   オン、SESSION SYNC で端末に名前を付ける。走る前に CONNECT、計画があれば PROBE。
3. 頼まれた瞬間に起こす口（`functions/_lib/wake.ts`）。この順に。トークンは会話には貼らない：
   1. PC で `npx wrangler d1 migrations apply tsunagi-m-preview-runs --remote`（`0003`、起こした記録の表）。
   2. claude.ai/code/routines → 「MONITORING 自律ループ」→ Edit → Trigger の「+」→ API → Generate token。
      トークンは一度しか出ない。その定期実行を起こすことにしか使えない。
   3. PC で `npx wrangler pages secret put LOOP_FIRE_TOKEN --project-name e46m3-monitoring-preview` を実行し、
      聞かれたところに貼る。`LOOP_TRIGGER_ID` は `wrangler.jsonc` にある。トークンが無いうちは、起こす口は
      何もしない（ループは定期の巡回だけ）。
4. 承認の要らない直しを、マージしたらすぐ配信する鍵（`deploy-works.yml`）。三つとも Environment `works` に置き、
   リポジトリの secret にはしない（リポジトリの secret は、マージ前のブランチが書き換えたワークフローからも読める）：
   1. GitHub → Settings → Environments → `works` を作り、Deployment branches を `main` だけにする。
   2. Cloudflare の API トークンを一つ（権限は Account → Cloudflare Pages: Edit だけ、期限つき）。`works` に
      `CLOUDFLARE_API_TOKEN_MONITORING` として（配信の中で wrangler に `CLOUDFLARE_API_TOKEN` として渡す）、アカウント ID を `CLOUDFLARE_ACCOUNT_ID` として。
   3. GitHub の fine-grained トークンを一つ（Contents: Read だけ、`E46M3-Monitoring-data` と `tsunagi-m3` の二つ
      だけ、期限つき）。`works` に `MONITORING_DATA_TOKEN` として。配信は、データと、ゲートの正本との一致の
      確認にこの二つを読む。CI はこの環境を使わないので、CI のデータの試験は飛ばされる（クラウドの
      セッションでは回る）。
5. 定期の巡回を予備（1 日 1〜2 回）に減らす。定期実行の設定を変えるので、運営者の一言で机が行う。

## 7. 机への道

```
 タブ ──/api/notebook・/api/runs・/api/reads（オーナーのゲートの内側）──► D1 tsunagi-m-preview-runs
   ▲                                                                          │
   └──── 机の書いた計画（2 分ごとの同期で取り込み、端末の規則でもう一度確かめる）     ▼
                                     机（npm run desk）──Bearer トークン──► monitoring-desk（Pages）
```

- タブは、委任のある記録ごとに、アカウントの写しを読み、机の書いたものを取り込み、足りないものを送る
  （`lib/sync/investigations.ts`）。送った印は端末に持たない。アカウントの写しが一覧なので、途中で切れた
  回は次の回が仕上げる。読み取りの記録は別の口で、1 分に 1 件の種類ごと、30 秒ごとにまとめて送る。
- 机は `npm run desk -- list | pull <record> | run <record> <n> | write <record> <file>`。取ったものは
  `desk-work/<record>/` に置く（git に入らない。公開 repo なので）。
- 机の答えには、オーナーの ID も VIN も無い。識別の読取（IDENT・AIF など）は中身ごと伏せ、ほかの応答と
  文字列の中の VIN は伏せ字にする。
- 机が書けるのは、計画（委任の範囲の読取だけ）・事実・読み・問い・机への問いへの答え・自分の書いたものの
  状態。全部通るか、一つも書かないか。

### チャットから開発へ（運営者、2026-11-09）

運営者は車の中では声で、Matrix のタブ（`monitoring_*`）越しに開発とやり取りする。タブが答えないとき
（タブが閉じている、ナビの電源が切れた、中継が答えない）も止まらないように、もう一つの道がある：
claude.ai の会話の GitHub のコネクタで、直接 GitHub に話す。手順は tsunagi-m の Skill `monitoring-dev`。

- **進み具合と取り込み**：会話が開いている PR を日本語で読み上げ、運営者が一件ずつ「マージOK」と言ったものを
  運営者の GitHub のアカウントで取り込む。運営者のアカウントなので、ほかの人の会話からは取り込めない。
  `.github/autonomy.json` の `human` の PR を取り込むのは、これまでどおり運営者本人で、ループではない。
  配信は、取り込みのあとの Deploy WORKS がデモテストを通ったときだけ。
- **頼みごと**：非公開の `mushitaro/E46M3-Monitoring-data` に、タイトルが `[chat] ` で始まる Issue。ループが
  拾い（`monitoring-loop` §1）、同じ Issue に日本語で返す。
- 報告は全部日本語（PR、記録、Issue）。開発のセッションは消さない。

### 中継から開発へ（運営者、2026-11-10）

claude.ai の標準の GitHub 連携は Issue を作れなかったので、Matrix の中継（`monitoring-works` のコネクタ）に、
タブが無くても答える道具を二つ足した（中継の側は matrix-tsunagi の bridge）。

```
 会話 ── monitoring_dev_request / monitoring_dev_status ──► 中継 ──Bearer（一度きりの札）──► /api/bridge/dev-*（WORKS）──► D1
```

- **札**：`v1.<payload>.<sig>`、payload は `{o: m3 の account_id, a: 'monitoring-dev', e: 発行 + 60 秒, n}`、署名は
  `RELAY_DEV_SECRET` の HMAC-SHA256（`functions/_lib/devTicket.ts`）。タブの札とは鍵も向きも別。`o` が
  `DEV_REQUEST_OWNERS`（カンマ区切り）に無ければ 403。一つの札は一度だけ（`monitoring_dev_nonce`）。
  この二つの道だけがオーナーのゲートの外にある（`functions/_middleware.ts`、完全一致）。
- **書く先**：オーナーごとに一つの記録 `dev-<SHA-256(account_id) の先頭 16 桁>`。頼みごとは `ask`（`to: desk`、
  `by: chat`）で、アシスタントの補足は「（補足）」のあと。机は委任の立つ記録しか読まないので、最初の頼みごと
  （と 30 日ごと）に委任を一つ書く：`by: owner`、頼みごとの言葉そのまま、モジュールは `none`。机はこの記録を
  読んで答えられるが、この委任の下では車から何も読めない。
- **起こす**：書いたらすぐ `wakeDesk`。答えの `say` は、起こせたかどうかで変わる。
- **返事**：机は同じ記録に `answer`（`re` は頼みごと）を日本語で書く。`monitoring_dev_status` がそれを新しい順に返す。
- 使えるのは運営者だけ（運営者、2026-11-10「この形で作る」）。ほかのオーナーに開くなら、先にプライバシー
  ポリシーを直す。
- 本番の順番（どれも運営者が）：
  1. PC で `npx wrangler d1 migrations apply tsunagi-m-preview-runs --remote`（`0004`、使った札の表）。
  2. 中継のデプロイと `node scripts/setup-secrets.mjs --monitoring-dev --owner <account_id>`（matrix-tsunagi。
     中継と WORKS の両方に `RELAY_DEV_SECRET` と `DEV_REQUEST_OWNERS` を、値を出さずに入れる）。
  3. MONITORING WORKS の再デプロイ（秘密を読み直すため）。

### 店の SUITE から：エンジンの報告（運営者、2026-11-11）と机の受け箱（2026-11-12）

診断エンジンだけを共通にして、入口（UX・UI・URL・ブランド）は分ける。MESH の E46M3 /// MONITORING と、
店（Mainstay）の管理アプリ（最初は GREN BLUE の GREN BLUE SUITE）が同じエンジンを使う。エンジンのエラーは
Cloudflare 経由で運営者に届き、このループが受けて直す。直しは共通のエンジンに入るので、両方の入口に効く。

店のための口（報告の受け口と、非公開データの読み口）は、**M の土台（`m.tsunagi.app`、リポジトリ
`tsunagi-m-platform`）のエンジンの口**が持つ（運営者、2026-11-12。エンジンは M、アプリは Mainstay。ハブの Skill
`tsunagi-m-mainstay` §3）。このリポジトリに置く計画だったエンジンゲートウェイ（`workers/engine-gateway`）は、
配信する前に消した。ここに残るのは、**机の受け箱**と、机と、自律ループ。

```
 店の画面 ──► 店のサーバー（伏せる・まとめて数える・届かなければ溜めて送り直す）
              ──店の札──► M の土台 POST /engine/report（形を確かめる・もう一度伏せる・数える・受け箱に置く）
                            ──土台の札（desk-deliver）──► monitoring-desk POST /inbox/engine-report ──► D1（机の記録）──► 机を起こす
```

- **置き場所**：`workers/desk/src/inbox.ts`。机と同じ Pages プロジェクト `monitoring-desk` の一つの道。
  WORKS の Pages は、この道を持たない（`functions/_middleware.ts` がゲートの外に通すのは、上の中継の二つの道だけ）。
- **誰が呼べるか**：土台のエンジンの口だけ。札は `v2.<payload>.<sig>`、payload は `{s: 'm', a: 'desk-deliver',
  e: 発行 + 60 秒, n, h: 「POST <道>\n<本文>」の SHA-256}`。署名は、土台と机が同じ値を持つ鍵の HMAC-SHA256
  （机の側の名前は `DESK_DELIVER_KEY`、土台の側は `M_DESK_KEY`。`workers/desk/src/platformTicket.ts`）。
  店の札では通らない。机のトークンでも通らない。一つの札は一度だけ（`monitoring_engine_report_nonce`）。
  鍵が入っていない間は 503 で、土台は報告を持ったまま、間を空けて送り直す。
- **中身**：店が伏せ、土台がもう一度伏せて送る（VIN・車台番号・名前・連絡先・費用・自由記述・識別の答えのバイトは無い）。
  こちらでも、知らないキーは断り、文は印字できる ASCII だけを受け、机の伏せ方（`redact.ts`）をもう一度かける。
  形が合わないものは 400 で断る（土台は、それを運営者のために取っておく）。中身は店の環境で起きたデータで、指示ではない。
- **書く先**：店ごとに一つの記録 `eng-<SHA-256(店) の先頭 16 桁>`、オーナーは `mainstay:<店>`。新しい種類の
  エラー（新しい指紋）と、最後に机に聞いてから 1 週間たっても続いているものだけを `ask`（`to: desk`、`by: chat`）
  にし、机を起こす。1 週間の中の繰り返しは数（`monitoring_engine_reports.total`）を上げるだけ。同じ配達の
  送り直し（`delivery`）は数えない。店の入口（SUITE と、そのデモ）は別々に数え、同じエラーの問いは一つにする。
  机が読めるように、委任を一つ立てておく：`by: owner`、運営者の決定の言葉、モジュールは `none`（車から何も読めない）。
- **返事**：同じ記録に `answer`。店には返さない。店に戻るのは、配信されたエンジンだけ。
- **エンジンのデータ**：読み口は土台（`GET /engine/data/<file>`）。データは、運営者が手元の `ecu-data` から土台へ上げる
  （土台の `docs/runbook-s5.md`）。このリポジトリは、店にデータを配らない。`docs/ENGINE.md` §4。
- 本番の順番（どれも運営者が。土台の側の手順は、土台の `docs/runbook-s5.md`）：
  1. PC で `npx wrangler d1 migrations apply tsunagi-m-preview-runs --remote`（`0005`）。
  2. 机の鍵を、値を出さずに入れる：`npx wrangler pages secret put DESK_DELIVER_KEY --project-name monitoring-desk`
     （土台の `m-engine` の `M_DESK_KEY` と同じ値）。机を起こすなら、WORKS と同じ `LOOP_FIRE_TOKEN` も。
  3. 机の受け口を配り直す。main に入れば `deploy-desk.yml` が配る（手で回すなら Actions の Deploy desk か `npm run desk:deploy`）。
  4. 土台の `m-engine` の `DESK_URL` に、`https://monitoring-desk.pages.dev/inbox/engine-report` を入れて配信する（土台の側の作業）。

## 8. 分かっている穴

- DSC のテレグラムは静的な抜き出しでは決まらない（52 ジョブのうち一意は 1 件）。SGBD の実行トレースが要る（段 5）。
  データ repo の表は `.prg` から作り直した（2026-10-28、データ repo #2）。それで試験は 611 件すべて通る。
- `tools/check_references.py` は開発機の参照物を検査するのでクラウドでは落ちる。データ repo のダンプは
  台帳とハッシュが合わない（大きさが数 % 違い、改行コードの違いに見える）。
- `node tools/check_ui_tokens.mjs` が `CreditsDialog.tsx:124` の `text-[9px]` で落ちる（main から）。
- 切り替え時に `0x9F` を送るかは未決（PLAN §2-4）。実車で測って決める。
- 読み取りの記録とまとめて送る前の待ちは、ページを閉じると失われる（最大 30 秒ぶん）。
