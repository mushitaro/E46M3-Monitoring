# できること・止める理由（コードから生成）

<!-- 生成物。手で直さない。`npm run gen:capabilities`（src/lib/bridge/capabilities.ts）。capabilities.test.ts が、コードと違えば落ちる。 -->

この文書は、このビルドのコード（道具の一覧 `src/lib/bridge/tools.ts`、運営者の表 `policy.ts` の `OWNER_DECISION`、
止める理由の閉じた一覧 `stopReasons.ts`＝`docs/NO-STOP.md` §2）から作る。AI は同じ中身を `monitoring_capabilities` で読む。
**README・ほかの docs・Skill・記憶と食い違ったら、こちら（とタブの答え）が正しい。** ここかタブの断りが言わない限り「できない」と言わない。
タブは同じ答えを hello に載せ、中継が持つので、タブが寝ていても `monitoring_capabilities` は答える。タブの答えには、ここに無い
モジュールごとの表（`modules`：どれを読み、アドレスで何が決め、故障を何で読むか）が足される。ecu-data から作るので、この文書には載せない。

## 運営者の表（項目の性質ごと）

| 性質 | いつ | どこまで | 誰が | AI は | 道具 |
|---|---|---|---|---|---|
| 識別と故障メモリを読む | 走行中も | 実行 | AI も | できる（走行中も） | `monitoring_faults`、`monitoring_scan`、`monitoring_probe` |
| 状態の値を読む | 走行中も | 実行 | AI も | できる（走行中も） | `monitoring_probe`、`monitoring_log_channels`、`monitoring_start_log` |
| 読取（書き込み側に分けられていたもの） | 停車中だけ | 実行 | AI も | できる（停車中） | `monitoring_probe` |
| メーター・警告灯・チャイム・表示を点ける | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_actuate` |
| オーディオ・ナビを操作する | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_actuate` |
| 快適装備を動かす | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_actuate` |
| 灯火・施錠・盗難防止の入出力を動かす | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_actuate` |
| 舵角・タイヤ空気圧の入出力を動かす | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_actuate` |
| エンジンの部品を動かす | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_actuate` |
| 変速機（SMG II）の部品を動かす | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_actuate` |
| ブレーキ油圧を動かす（DSC・ASC） | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_actuate` |
| 安全装置を展開する | 停車中だけ | 出さない | 画面の人 | できない（出さない） | — |
| 変速機の手順（SMG II が自分で進める） | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_procedure` |
| 機能検査（ECU 自身のシステムチェック） | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_actuate` |
| センサー信号の模擬 | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_actuate` |
| 学習値のリセット・基準合わせ | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_actuate` |
| 動作モードを変える | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_actuate` |
| 初期化・設定の変更 | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_actuate` |
| 消去する | 停車中だけ | 実行 | AI も | できる（停車中、読み返して「いいよ」のあと） | `monitoring_actuate` |
| 書き込む（コーディング・プログラミング・識別・フラッシュ） | 停車中だけ | 出さない | 画面の人 | できない（出さない） | — |

## 全部に掛かる決まり

- 送る直前に測る：DME の車速 0（停車）、電圧 12 V 以上、ジョブ自身の SGBD が言うエンジンの状態。測れなければ送らない。
- ジョブ自身の SGBD が停車を求めるものは、表が何と言っても停車中だけ。
- 部品を動かす・消すものは、何が起きるかを読み返し、オーナーの「いいよ」を待ち、その言葉を owner_said に添える。
- 一度に一つ。どれも時間切れ（SGBD の上限、無ければ 10 秒）で止まる。止めるのは誰でもいつでも（monitoring_stop_outputs）、走行中も。
- 練習はビルドが全項目を模擬実車で済ませる（src/lib/practiceEveryItem.test.ts）。端末で先に練習することは求めない。
- 走行中に AI が始められるのは読取だけ。走行中も送る読取は、運営者の表とオーナーが台帳で認めたもの。
- 「実車未確認」「推定」「未検証」は答えに言い添える言葉で、止める理由ではない（docs/NO-STOP.md §1）。
- 実行と結果は台帳と CO-WORK に残る。

## 止めてよい理由（閉じた一覧）

| # | 理由 | 次の手 | どこ |
|---|---|---|---|
| S1 | 停車が要るものを、送る直前に測った車速が 0 でないとき・測れないとき | 止まってから、もう一度頼む。測れないときは接続を確かめる。 | link/session.ts preflightRun, vehicleState.ts |
| S2 | 電圧が 12 V 未満、または SGBD が言うエンジンの状態と違うとき | エンジンを掛ける・充電器をつなぐ、またはエンジンを SGBD の言う状態にしてから、もう一度頼む。 | link/session.ts preflightRun |
| S3 | 部品を動かす・消すものを、読み返して「いいよ」を聞く前 | 何が動く（消える）か・条件を読み返し、オーナーの言葉を owner_said に添えて呼ぶ。 | src/lib/actuation.ts assistantMayStart, the screen’s confirmation |
| S4 | 電文を、そのモジュール自身の SGBD のコードが組めず、EdiabasLib とも一致しないとき | 値を取るジョブなら、答えに並ぶ値の組から一つ選んで渡す。組が無ければ道具の穴なので、開発に頼む（monitoring_finding の ask、to: desk）。 | sgbd/agreedFrame.ts, runGate.ts telegramIsCertain |
| S5 | そのアドレスにいるのが別のモジュールだと IDENT（またはオーナーの言葉）が言ったとき | 付いている方のモジュールを画面に出す（monitoring_module）。IDENT で分からないアドレスは、オーナーに訊いて monitoring_variant で残す。 | variants.ts, Ds2Link.setSendGuard, src/lib/variantChoice.ts |
| S6 | 運営者の表で「出さない」「表示だけ」（安全装置の展開・書き込みほか）、またはキルリストで取り下げたとき | 変えられるのは運営者だけ。開けたいなら、オーナーの言葉のまま開発に頼む。 | policy.ts OWNER_DECISION, ledger.ts withdrawn |
| S7 | 一つ動いている間の二つ目 | 今動いているものを止めてから（monitoring_stop_outputs）、次を頼む。 | src/hooks/useActuatorArming.ts |

門と回線の断りが、どの理由に当たるか：

- `run_block_programming` → S6
- `run_block_identity` → S6
- `run_block_noTelegram` → S4
- `run_block_needsArgs` → S4
- `run_block_notRead` → not a stop: another tool runs it (the answer names which)
- `run_block_controlWrites` → S4
- `run_block_revoked` → S6
- `run_block_moving` → S1
- `run_block_policyShow` → S6
- `run_block_policyOff` → S6
- `notSent:link` → S1
- `notSent:moving` → S1
- `notSent:voltage` → S2
- `notSent:engine` → S2
- `notSent:permission` → S4

## 画面の人だけがすること

- 新しいケーブル（機器）の許可。一度許可したケーブルへのつなぎ直しと切断は AI もできる（monitoring_connect・monitoring_disconnect）
- 書き込み（コーディング・プログラミング・識別・フラッシュ）：運営者の表で「出さない」
- 安全装置の展開：運営者の表で「出さない」

## AI の道具

| 道具 | 種類 | 何をするか |
|---|---|---|
| `monitoring_status` | read | The tab now: |
| `monitoring_capabilities` | read | What the assistant can do here and what may stop it, built by this build from its own code: |
| `monitoring_faults` | read | Fault memories the tab has read: |
| `monitoring_catalog` | read | Jobs of a module from its own SGBD, matched against a query: |
| `monitoring_cowork` | read | CO-WORK records on this device. |
| `monitoring_moment` | read | What the tab recorded around a moment: |
| `monitoring_run_overview` | read | The PROBE run in progress or the last one: |
| `monitoring_ledger` | read | The verification ledger: |
| `monitoring_sessions` | read | Sessions saved on this device: |
| `monitoring_investigate` | control | Start an investigation the owner handed over — or carry one on: |
| `monitoring_plan` | control | Write the next plan of a record, under its standing mandate: |
| `monitoring_finding` | control | Add to a record: |
| `monitoring_note` | control | Keep the driver's own words in a record, on the clock of the PROBE run in progress if there is one. |
| `monitoring_mark` | control | Mark a plan step done, on the clock of the PROBE run in progress. |
| `monitoring_scan` | control | Read every module's fault memory, one address at a time, without choosing a module: |
| `monitoring_module` | control | Put another module on the screen (DIAGNOSIS, SERVICE, the catalogue's 'in session'). |
| `monitoring_probe` | control | Start a PROBE run: |
| `monitoring_compare` | read | Compare PROBE runs. |
| `monitoring_display` | control | Change what the screen shows: |
| `monitoring_session` | control | PROBE sessions on STARTUP — the screen's NEW SESSION and NEXT. |
| `monitoring_show` | control | Place parts on a session's PROBE board (default: |
| `monitoring_stage` | control | Put a job on the screen — SERVICE, with the job selected, its preconditions, and the gate's answer — for a person to run there, parked. |
| `monitoring_actuate` | control | Start one job that makes the car do something — only those the owner's table opens to the assistant (the rest: |
| `monitoring_procedure` | control | Start one of SMG II's guided procedures (its test programs: |
| `monitoring_variant` | control | Record which of this app's modules is fitted at an address several share with no IDENT rule to tell them apart (0x56: |
| `monitoring_stop_outputs` | control | Stop every output that is on, oldest first: |
| `monitoring_start_log` | control | Start recording the DATALOG channels selected (monitoring_log_channels chooses them; the answer names them). |
| `monitoring_log_channels` | control | DATALOG's channels: |
| `monitoring_datalog` | read | The DATALOG recording, in progress or the last one: |
| `monitoring_stop_log` | control | Stop the recording or the PROBE run in progress. |
| `monitoring_save` | control | Save on this device (the screen's SAVE): |
| `monitoring_sync_upload` | control | Save, then send every session the owner's account does not have yet (the screen's SYNC). |
| `monitoring_connect` | control | Connect again to the car through the cable this device has already been allowed — the one a person connected on the screen before (operator, 2026-10-28). |
| `monitoring_disconnect` | control | Let the cable go (the screen's DISCONNECT). |
| `monitoring_open_tuner` | control | Move this tab to TUNER WORKS (MAPPING: |
| `monitoring_guide` | read | The procedure for the conversation (held by the relay, there while the tab sleeps; so is this answer). |
| `monitoring_dev_request` | control | The operator's words to MONITORING's development, without the tab. |
| `monitoring_dev_status` | control | Development's answers to the operator's requests. |
