# デモテスト SC08〜SC13・MM01〜MM04 の所見

`docs/VIRTUAL-CAR-TESTS.md` の M1（SC08〜SC13）と M2（MM01〜MM04）を、`scenarios/e2e/sc08-…`〜`mm04-…` にした。
合格はオーナーに見えるもの・聞こえるもの（M0 の U1〜U8 と各手順の「合格」）。落ちた確認は直さずに残し、ここに書く。
AI の言い回しそのものは声の予行で見る。ここでは、AI が言うべきことが道具の答えにあるかを見た。

実行：e76a992 の上、`npm run build:e2e && npm run e2e -- sc08 sc09 sc10 sc11 sc12 sc13 mm01 mm02 mm03 mm04`。
結果：10 本とも不合格（画面の操作と確認の行 154 が通り、58 が落ちた。各シナリオは途中で止めずに最後まで回す）。

| シナリオ | 通った | 落ちた |
|---|---|---|
| SC08 SMG II の手順（声） | 13 | 5 |
| SC09 舵角のゼロ点 | 6 | 5 |
| SC10 M3 でない E46 | 12 | 5 |
| SC11 ナビで一日 | 20 | 3 |
| SC12 残す・渡す・頼む | 22 | 4 |
| SC13 走りながらログ | 42 | 21 |
| MM01 中古車を全部 | 10 | 4 |
| MM02 幌が開かない | 11 | 4 |
| MM03 吹けない（7 モジュール） | 13 | 5 |
| MM04 ナビと AV | 5 | 3 |

書き方：シナリオ/手順・基準・画面に出たもの（引用）・考えられる原因・直し方の案。重さは「大」（オーナーが使えない・安全）「中」「小」。

---

## 大

### F01 SC10/1 M3 でない車で SMG II を選べ、手順のダイアログが開き、GS20 に SMG II の電文が出る
- 基準：M3 専用のもの（SMG の手順など）は出ない。違う変種には IDENT のほかを送らない。
- 画面：0x32 が GS20 と識別された車で `monitoring_module smg2` が通り、`monitoring_procedure 0x02` で「手順: クラッチ食いつき点の学習 … 正常には終了しませんでした / TESTPRG_STOP を送信済み」。練習の車の線に `32 04 9e a8`（SMG II の SGBD の 0x9E）が出た。
- 原因：モジュールの切り替え（`src/app/page.tsx:448` `switchModule`）と手順（`src/hooks/useMonitoringFacade.ts:524`）が、走査で識別した変種（0x32 = GS20）を見ていない。ヘッダの選択にも SMG II が残る。
- 案：識別済みのアドレスでは、識別と違う SGBD への切り替えを断る（理由「この車の 0x32 は GS20 です」）。`Ds2Link.setSendGuard` に「識別した変種以外の SGBD の電文を送らない」を足す。

### F02 SC13/2・4・5・11 DATALOG のグラフが 1 本だけ
- 基準：8 本のグラフ（名前・単位・今の値）。排気カムの実測線が目標線から離れるのが見える。カーソル。1 回目と 2 回目を回転の横軸で重ねる。
- 画面：VISU は「エンジン回転数 3:n 2204.0 – 2599.0」の 1 本だけ。カーソル・重ね描きは無い。
- 原因：`src/views/datalog/DatalogView.tsx:203` `const id = datalog.selected[0]`。
- 案：選んだ項目ごとに線（目標と実測は対で一枚に）。AI が分析した時刻にカーソルを立てる口。比べる回を回転の横軸で重ねる表示。

### F03 SC13/5 「今の何？」の道具が DATALOG の記録を読めない
- 基準：AI が分析した時点（n 秒前、3 速、4,100 回転）と、排気カムの遅れ約 6°・ノック無し。
- 答え：`monitoring_moment` →「Nothing has been recorded by PROBE on this tab yet.」
- 原因：`src/lib/bridge/handlers.ts:309` が PROBE の回だけを見る。
- 案：PROBE が無いときは DATALOG の記録から同じ形で返す。
- 補足：`monitoring_datalog` からは遅れ 6° と 4,100 回転は言えた。ギアは言えない（F14）。

### F04 SC13/7・11・12 記録を止めずに取り方を変えられない（区切りが無い）
- 基準：「いいよ」で 5 項目に変わり、記録は一つのまま区切りが入る。SESSIONS に区切り 2 つと各区切りの実効レート。「1 回目と比べて」で両方の踏みが読める。
- 答え：`monitoring_log_channels` →「A recording is going; channels change once it is stopped.」止めて取り直すと別の記録になり、`monitoring_datalog` は 2 回目しか返さない。MEMORY に区切りもレートも出ない。
- 原因：`src/hooks/useMonitoringFacade.ts:579`。DATALOG に「区切り」が無い。
- 案：記録中の選び直しを区切りとして受け、記録は続ける。区切りごとに項目・ブロック数・実効レートを残し、SESSIONS とグラフに印。`monitoring_datalog` に区切りの指定。

### F05 SC13/8 SMG の油圧を足すと、断る理由が違う
- 基準：「SMG の値は走っている間は読めません」。画面のその項目は空欄で理由つき（U2）。
- 答え：記録中なので「A recording is going; …」。画面に油圧の欄は出ない。
- 案：F04 を直せば、選び直しが通り、空のときは `channels_otherNote` の理由が出る。
- 文書との食い違い：運営者 2026-11-15 で SMG II の状態の値は走行中も読む（S17 が確かめている）。SC13 手順 8 の「走っている間は読めません」は古い。文書を直すか運営者に確かめる。

### F06 SC09 舵角のゼロ点が実行できない
- 基準：ADAPTATION で選ぶと前提（ハンドルをまっすぐ・停車）、実行で「完了」、続けて舵角 0° 付近。
- 画面：ADAPTATION は「このモジュールの学習値は、このアプリでは読めません。」だけ。SERVICE に置くと「このジョブの要求テレグラムが一意に確定していません。何を送るか分からないものは送りません。」どうすれば動くかは言わない。
- 原因：DSC_E46 の `ABGLEICH_LWS_AQ_SENSOREN` が「テレグラム未確定」。ADAPTATION は学習値の消去ジョブしか並べない（`src/views/adaptation/AdaptationView.tsx:60`）。前提は `voltage_ok`・`stationary` だけ。
- 案：舵角の較正を `gen_job_frames.py` の EdiabasLib 比べに入れて電文を確かめ、ADAPTATION に調整の段を作る。前提に操舵の中立を足す。DSC MK60 の `LENKWINKEL_DSC_ABGLEICHEN` も同じ。

### F07 SC08/4 ギアを選ぶ手順（0x0A）が、ギアを聞かずにニュートラルで始まる
- 基準：AI が「何速ですか？」と聞く。
- 答え：gear なしの `monitoring_procedure 0x0A` → `started: true`。
- 原因：`src/hooks/useMonitoringFacade.ts:536` が gear 無しを通し、`src/views/service/WizardDialog.tsx:91` `assistant?.gear ?? 0` が 0 にする。
- 案：`auswahl` の手順は gear が無ければ始めず「何速か」を返す。

---

## 中

### F08 SC08/3 手順の結果を AI が言えない
- 答え：`monitoring_status`・`monitoring_sessions`・`monitoring_run_overview` に、終わった手順の名前と結果が無い。
- 案：`monitoring_status` に最後の手順（番号・名前・終わり方・結果）を足す。

### F09 SC08/1・2 前提に「ブレーキ」が無く、ダイアログにオーナーがすることが出ない
- 答え：前提は「Engine running, neutral, ignition ON / Sufficient battery voltage … / Fluid near ambient temp; vehicle stationary on level ground」。ダイアログは経過と「いま何をしているか」だけ。
- 案：SGBD の手順書にブレーキがあれば `prereq` に足し、段ごとに「オーナーがすること」を出す。無ければ文書を直す。

### F10 SC08/U2 前提が合わないと「正常には終了しませんでした」だけ
- 画面：エンジンが回ったまま「クラッチ弁特性値の学習」（エンジン停止が前提）→「正常には終了しませんでした / TESTPRG_STOP を送信済み」。理由もどうすれば動くかも無い。
- 案：送る前の測定（`preflightRun`）で止めたときは「エンジンを止めてください」をダイアログに出す。

### F11 SC10/1・MM04/1 識別したアドレスにも候補の名前を全部並べる
- 画面：「0x12 MSS54 (S54 / E46 M3 エンジン) / MS42 (M52TU エンジン) / MS43 (M54 エンジン) / …」。M3 でない車でも MSS54・SMG II の名前が並ぶ。
- 原因：`src/views/diagnosis/ScanView.tsx:122` `r.modules.map(nameOf).join(' / ')`。
- 案：`variant.basis === 'identified'` なら識別した一つだけを出す。

### F12 SC10/3 「?」のモジュールを選んでも、画面は「送らない」と言わない
- AI の答えは正しい（「0x00: which module answers here is not known (?) … only its IDENT is sent」）。線の上も IDENT だけで正しい。画面には何も出ない（U3）。
- 案：DIAGNOSIS に同じ理由を日本語で出す。

### F13 SC10/2・MM01/2・MM02/1 故障の名前と状態が日本語でない
- 例：MS43「Ignition Cyl 2」、RDC「Hardware: EEPROM-Fehler Systemprozessor」「statischer Fehler」、ALC「Bremslichtschalter defekt」、幌「Checksummenfehler in den Codierdaten」、サンルーフ「reserviert」、キセノン左「unbekannter Fehlerort」。
- 案：故障文と状態（`kinds`）を訳す（`tools/jobtext` と同じ訳の道）。「reserviert」「unbekannter Fehlerort」は「この場所の名前は SGBD に無い」と言う。
- 補足：MM01 の故障バイトは練習用に作ったもの（`01 05 21 …`）。名前の無い 2 件はバイトのせいもあり得る。

### F14 SC13/1・5・6 AI の答えに名前・単位・見込みのレート・ギアが無い
- `monitoring_log_channels`（選ぶ）の答えは `{"changed":true,"selected":[…],"cost":{"channels":8,"blocks":4}}` だけ。名前・単位・毎秒およそ何回が無い。選ぶ前に「5 項目なら毎秒何回」を聞く口も無い。
- 「3 速」と言える値（`83:gang`）は 8 項目に無く、ほかの道具も返さない。
- 原因：`src/hooks/useMonitoringFacade.ts:593` 付近。
- 案：選んだ答えに各項目の `ja`・`unit` と見込みの `expectedHz`。`query` に見積もり。記録の答えにギアを添えるか、手引きでギアを選ばせる。

### F15 SC13/1 選んだ項目の行に単位が無い
- 画面：「エンジン回転数 n 2264.00」「車速（直接入力） v 31.00」。
- 原因：`src/views/datalog/DatalogView.tsx:90` が単位を出すのはほかのモジュールの値だけ。
- 案：MSS54 の項目にも単位を出す。

### F16 SC13/2 記録中の印・経過時間が無く、HUB に回転と車速が出ない
- 画面：HUB は「158 サンプル」と STOP だけ。
- 案：HUB に回転と車速を大きく、記録中の印と経過時間（走行中に読む画面、N の D2-4）。

### F17 SC13/1・9・10 計画が DATALOG の画面に出ず、「待っている → 取った」が見えない
- 画面：CO-WORK の計画（「3 速で踏む（3,000→6,000 回転）」「3 速で 3,800〜4,500 回転を通ったら取る」）が MANUAL の画面のどこにも出ない。段の状態は PROBE の回の中だけ。
- 案：DATALOG の記録中も計画の段（条件と状態）を出し、capture の条件を DATALOG でも見張る。

### F18 SC11/1 時計が合う前の記録に「時刻未確定」が出ない
- 画面：MEMORY は「この接続 故障 1」だけで時刻が無い（2006 年も出ないが、未確定とも言わない）。時計が合ったあとは今日の日付で正しく並ぶ。
- 案：合う前の記録に「時刻未確定」を出す。

### F19 SC11/4 記録中に UPDATE を押すと、ブラウザの確認が出る。開き直すと別の画面
- 画面：`window.confirm`「再読み込みすると、車との接続が切れ、保存も書き出しもしていない故障メモリの読み取りとデータログは消えます。…再読み込みしますか？」「はい」で記録ごと切れる。開き直すと DIAGNOSIS（前は DATALOG）。
- 原因：`src/app/page.tsx:542`。開き直す前のタブを覚えていない。
- 案：記録中・PROBE 中は進めず「記録を止めてから」と出す（ナビでブラウザの確認を使わない）。開き直したら前のタブに戻す。

### F20 SC12/1 保存した記録を AI が画面に開けない
- 答え：`monitoring_session {action:'open'}` は PROBE の記録だけ（「There is no record … monitoring_cowork lists them.」）。画面の人は MEMORY の VIEW で開ける。
- 案：`monitoring_session open` か `monitoring_display` で MEMORY の保存した記録も開く。

### F21 SC12/2 記録中は TUNER を開けない
- 基準：TUNER が開く。MONITORING の記録は止まらない。
- 答え：「A recording or a PROBE run is going. Stop it first …」（`src/hooks/useMonitoringFacade.ts:658`）。同じタブが TUNER に移るので、記録を続けたまま開けない。
- 案：運営者が決める：TUNER を別のタブで開くか、文書の基準を「止めてから開く」に直すか。

### F22 SC12/2 保存した直後でも「保存していない」と言われる（要確認）
- 答え：止めて保存（`saved: true`）して 1.5 秒後の `monitoring_open_tuner` →「opened:false, unsaved:true」。
- 原因の見込み：`src/hooks/useMonitoringFacade.ts:661` の `sessions.unsaved` が保存後も立ったまま。
- 案：保存の直後に下りるか確かめる。

### F23 MM01/1 電話（0xC8）は故障を読まない
- 画面：「0xC8 電話 送らない」。理由は答えにだけ（「its SGBD carries no short fault-read frame」、`packages/monitoring-engine/src/probe/scan.ts:324`）。
- 案：画面にも日本語で理由。

### F24 MM01/3・MM04/2 動かす項目が 0 件のモジュールで、なぜ無いかが出ない
- 画面：キセノン左右・SES・電話・CD チェンジャーの ACTUATOR は「0 件中 0 件が実行可能」だけ。
- 案：「このモジュールの SGBD には部品を動かすジョブがありません」と出す。

### F25 MM02/2 AI が幌を動かしても、画面に何も出ない
- 答え：`monitoring_actuate cvm_ii STEUERN_DIGITAL`（値の組つき）→ `started: true, on: false`。
- 画面：ACTUATOR の右は「作動中のものはありません」。送った・答えた・終わったのどれも見えない（U1・U4）。
- 案：一度だけ送るジョブも、行と HUB に送った・結果・終わったを残す。動き続ける部品は入れて止める形か確かめる。

### F26 MM02/3 ロールバー：理由が「安全装置の展開」でなく、画面に押せない RUN が残る
- 答え：「The owner keeps STEUERN_BUEGEL off: it is not run from here at all.」（`src/lib/actuation.ts:114`）。
- 画面：ACTUATOR に「高 ロールオーバーバー展開 STEUERN_BUEGEL 出さない RUN」（RUN は押せない）。
- 案：安全装置の展開は理由を「安全装置の展開なので送りません」に。行を出さないか RUN を描かない。

### F27 MM03/2・3 PROBE が、いま読んでいるモジュールを名前で示さない。結果がモジュールごとに読めない
- 画面：PROBE を 2 回回しても、読んでいるモジュールの名前が出ない。
- 答え：`monitoring_run_overview` の段は `{"n":1,"state":"done","sent":1}` だけ。`monitoring_compare` の故障は生のバイト（`"01 2a 08 03 01 20 40 …"`）で名前が無い。
- 原因：`src/lib/bridge/handlers.ts:358`・`375`（段をそのまま返す）。
- 案：段に `module`・`do` を入れる。比べる答えの故障は走査と同じ読み方で返す。ボードに「いま読んでいる：SMG II」。

### F28 MM03/3 確かさ（確か・可能性・未確認）が画面に出ない
- 手順：`monitoring_finding kind:'read' sure:'mid'/'low'` を書き、`monitoring_show {kind:'plan'}` を置いても、画面に確かさの語が無い。
- 案：見立てを確かさの札つきでボードに出す部品。

### F29 MM04/1 ボードモニター（0xF0）とナビ（0x7F）の機種を出し分けない
- 答え：IDENT を替えても `variant.sgbd: "?"`、候補「bmbt46rn / bmbt46tn / bmbt_mir / bm46wide」「navmk3 / navmk4 / navmk4_2」のまま。
- 原因：グループファイルの規則が 0x12・0x32・0x80 だけ（`tools/sgbd/gen_variants.py`）。
- 案：D_00F0・D_007F（ほか候補が二つ以上のアドレス）の規則を足す。それまでは画面で「機種は分かりません（候補 n）」と一語で。
- テストの限り：練習の車に出した IDENT（hw/diag）は作ったもの。規則を足したら実際の機種の値に替える。

---

## 小

### F30 SC13/2 値が小数 2 桁（2264.00 rpm、31.00 km/h）
- 案：項目ごとの桁（回転は整数、角度は 0.1）。

---

## 確かめられなかったもの

- **実車のみ**：SC08 の手順が実際に段階を進む時間（練習の車は 5 秒ほどで終わる）。SC09 の 0° 付近の値。SC13 の実効レート（練習の車は約 90 Hz、実車の K ラインはずっと遅い）と、遅れの 0.4 秒に入る点の数。MM02 の幌が実際に動くか。
- **中継のみ（デモテスト外）**：SC12/3 の開発への頼みごと（`monitoring_dev_request`・`monitoring_dev_status`）は中継が持ち、タブには無い。声の予行で確かめる。
- **声の予行**：AI の一文目・2〜3 文・「見てみます」・走り方を指示しない（SC13/9）・自分から話しかけない（SC13/10）は言い回しなので、ここでは見ていない。
- **テストの作り**：SC13 の筋書きは文書の 0〜60・60・120 秒を 0〜20・20・45 秒に縮めた。ナビの時計は Playwright の `page.clock`、新しい版は `/` の答えに無いチャンクを足して出した（sc11）。SC12 の TUNER のページは外へ取りに行かず、代わりの小さなページを返した。
