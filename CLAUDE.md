# E46M3///Diagnosis

BMW E46 M3 を DS2 で読むブラウザ専用ツール。K+DCAN ケーブルに直接話す——デスクトップは
Web Serial、Android は WebUSB（Chrome for Android の `navigator.serial` は Bluetooth の
シリアルポート模倣しか列挙しないので、USB ケーブルはそちらの選択肢に現れない）。
サーバもローカルホストも無い（理由は `README.md`）。

対象は **E46 M3 の 52 モジュール**と、**M3 でない DS2 の E46 の DME 5 つと GS20**（2026-11-11、`fit: nonm3`）。エンジン MSS54 `0x12` / 変速機 SMG II `0x32` から
ボディ・快適装備・AV まで、INPA の E46 メニュー × M3 の装備で列挙してある
（`tools/gen_ecu_data.py` の `MODULES`）。`0x56` は年式で中身が入れ替わる: 前期は
ASCMK20、後期は DSC_E46 で、同時装着は無い。**DSC MK60**（運営者の車の DSC、2026-11-10）だけは
DS2 の回線の上に KWP2000 の形の電文（`B8 29 F1 LL …`、線上の宛先 0xB8・KWP の宛先 0x29）を載せる。
識別と故障の読み取りは、ほかのモジュールと同じく走行中も（運営者 2026-11-12。`packages/monitoring-engine/src/kwpOnDs2.ts`）。
動かすジョブ（作動テスト・油圧・調整・動作モードほか）は、ほかのモジュールと同じく運営者の表に従い、ジョブ自身の
コードが組んで EdiabasLib と一致した電文だけを送る（2026-11-18、`session.ts` の `runByCode`）。答えの形は実車でまだ確かめていない。

Next.js 16 / React 19 / Tailwind v4、`output: 'export'` の静的書き出し。

## まず読むもの

| 知りたいこと | 場所 |
|---|---|
| 外部の参照物がどこにあるか | **`docs/REFERENCES.md`** |
| どの SGBD を載せ、どれを載せないか | `docs/FITMENT.md` ＋ `tools/sgbd/fitment.py` |
| 何を作ってきたか・なぜそう決めたか | `docs/PLAN.md` |
| 診断エンジンと画面の境目、GREN BLUE SUITE への渡し方 | **`docs/ENGINE.md`** |
| 車と例題で自分を育てる仕組み（机・タブ・Matrix） | `docs/AUTONOMY.md` |
| 「実車未確認」で止めない決まり・止めてよい理由の一覧・実車で確かめること | **`docs/NO-STOP.md`** |
| ライセンスとデータの出所 | `THIRD-PARTY-NOTICES.md` |
| ///M の意匠体系 | `tsunagi-m-design` スキル（`SKILL.md` だけでなく `references/` も） |

## この repo の決まり

- **診断エンジンは `packages/monitoring-engine`（`@tsunagi/monitoring-engine`）。** リンクのセッション・電文・
  `runGate`・変種・走査・記録の形・練習の車はここで、React も画面も持たない（`boundary.test.ts` が見る）。
  画面（views・文言・facade・ヘッダ）は `src/`。GREN BLUE SUITE も同じエンジンを使うので、エンジンに画面の
  都合を入れない。境目と公開する関数は `docs/ENGINE.md`。
- **UI は `src/components/ui.tsx` のプリミティブから組む。** 生の Tailwind で行を書き起こさない。
  `DataRow` の主スロットは `HumanName` しか受け取らないので、SGBD 識別子を人間向けの位置に
  入れるとコンパイルエラーになる。これは規約ではなく機構。
- **枠線は領域と領域の**間**の罫**。物の周りを囲まない（`border-b/-t/-l/-r` は可、裸の `border` は不可）。
- **「実車未確認」で止めない（運営者 2026-11-26）。** 「実車未確認」「推定」「未検証」は出所を言い添える言葉で、
  送る・作る・開ける・取り込むのを止める理由にしない。送る直前に止めてよいのは `docs/NO-STOP.md` §2 の閉じた一覧
  （停車・電圧とエンジンの状態の実測、読み返しと「いいよ」、電文の一致、IDENT が言う別のモジュール、運営者の表の
  「出さない」と取り下げ、一度に一つ）だけで、ほかの理由の門を足さない。実車で確かめることはアプリが台帳に自分で
  記録し、人の手順にしない。開発の AI も「実車で確かめていない」を理由に作業を止めず、模擬で確かめて PR にする。
  止まったときは、同じ番で次の手（誰が何をすれば進むか、開発への依頼）を出す。
- **実車に何を送るかは、運営者が項目ごとに決める。** 「実車に送るのは読取だけ」の決まりは運営者が廃止した
  （2026-11-14）。項目ごとに、いつ（走行中も／停車中だけ）・どこまで（実行／画面に表示だけ／出さない）・
  誰が始めるか（画面の人／AI も）を運営者が決め（2026-11-15、`packages/monitoring-engine/src/policy.ts` の
  `OWNER_DECISION`。項目の性質は `natureOf` が SGBD の名前と分類から判断し、書き込みの名前のものは必ず書き込み）、
  その表に従う。判断する場所は `packages/monitoring-engine/src/runGate.ts` の `mayRun` 一箇所で、ここを迂回する経路を
  作らない。部品を動かすものは、停車中に、画面の確認のあとで、`permitFor` の許可をつけて送る。練習はビルドが
  全項目を模擬実車で本物の送る道に一度ずつ流して済ませ（`src/lib/practiceEveryItem.test.ts`、運営者 2026-11-26）、
  端末ごと・項目ごとには求めない。リンクは許可がその電文そのものかを確かめ、送る直前に車速・電圧（12 V 以上）・
  SGBD が言うエンジンの状態を測る（`session.ts` の `preflightRun`）。一度に一つ、時間切れで止める（`useActuatorArming`）。
  実車での実行は台帳に残る（`recordVehicleRun`）。SMG II の手順は `mayRunProcedure`（状態の問い直しは
  測り直さない `follow` の許可）。M3 でない E46 では、停車・電圧・エンジンをその車の DME 自身のジョブで測り、
  その車で一度 0 より上を見た車速だけを停車の証にする（`readDmeState`）。
- **モジュールには、そのモジュール自身の SGBD が送るものだけを送る。** 宛先は送るたびに名前で
  言う（`link.to(address)`）。IDENT・消去・ハートビートは `packages/monitoring-engine/src/moduleProtocol.ts` が
  そのモジュールのテレグラム表から完全一致で取る。故障読取は、そのモジュール自身の FS_LESEN ジョブを
  アプリの中で動かして進める（`packages/monitoring-engine/src/sgbd/faultRead.ts`。運営者 2026-11-13）：ジョブが組む電文を
  一つずつ `runGate` の `mayJobSend`（このモジュール宛て・読取か、エアバッグが自分のジョブで先に送る
  ログインだけ）に通して送り、答えをジョブに返す。項目はジョブ自身の文で出る。ジョブが無いときは表の電文。
  表の電文の答えは、MSS54 は専用の解読器、ほかはそのモジュール自身の SGBD の故障読取のコード（`sgbd/results.ts`）で読む。
  そのコードが無いモジュール（非 M3 の DME・GS20 ほか）は、そのモジュール自身の SGBD の FS_LESEN が読む場所から読む
  （`faultLayouts.ts`、`tools/sgbd/gen_fault_layouts.py` が EDIABAS の模擬で確かめた `fault-layouts.json`）。実車未確認と
  画面と報告が言い、生のバイトは答えとして残す。それ以外はバイトのまま。
- **どのモジュールがいるかは、そのアドレスの IDENT が決める。** 一覧は E46 M3 のもので、非 M3 の E46
  では同じアドレスに別のモジュールがいる（0x12 に MS43、0x32 に GS20）。共通の IDENT（`<addr> 04 00`）の
  答えから、グループファイル（`D_00xx.grp`）と同じ選び方で SGBD を選び（`packages/monitoring-engine/src/variants.ts`、規則は
  `tools/sgbd/gen_variants.py` が作り EDIABAS 自身の選び方と突き合わせる）、このアプリが載せている
  SGBD に当たったときだけ、そのモジュールの電文を送る。0x12 が MSS54 と答えた車（M3）では、規則の無い
  アドレスは M3 の装備として扱う（DSC MK60 もこのときだけ読む）。それ以外の車では、変種の分からないアドレスは「?」で、IDENT のほかは
  送らない。`Ds2Link.setSendGuard` が全経路の最後の砦。推測で変種を決めない。規則は 0x12（D_0012）・
  0x32（D_0032）・0x80（D_0080。診断インデックスを BCD の数として範囲で選ぶ）。
- **VIN はメーターから一度だけ読む。** 全モジュールの読取で、0x80 の IDENT が KOMBI46・46R を選んだときだけ、
  そのメーター自身の `80 05 02 02`（AIF ブロック 2）を送り、VIN の下 7 桁の文字だけを走査の `vin` に置く
  （`packages/monitoring-engine/src/clusterVin.ts`。17 桁はメーターに無い。実車未確認）。答えのバイトは走査の結果・台帳・AI の返り値に入れない。
- **止まっているかは実測する。** `mayRun` は motion を必須で受け、停車中だけのものは送る直前に DME の
  車速（M3 はブロック 19、ほかの E46 はその DME 自身の車速のジョブ）が 0 のときだけ出る。読めなければ出さない。走行中も送るのは、運営者が決めたもの
  （識別と故障の読み取り、状態の値の読み取り。`policy.ts`）と、オーナーが台帳で認めたもの（`grantMovingOk`）。
  アプリは自分で格上げしない。故障の消去は停車中だけ（誰が始めるかは表）。
- **時刻は `packages/monitoring-engine/src/clock.ts` の `appNow()`。** ナビの時計は 2006・2007 年で起き、走行中に飛ぶ。記録の順序と
  車速の鮮度は、飛ばない時計（ページ内で単調、サーバーの Date で一度だけ合わせる）で測る。
  合わせる前の記録は `loose` で、合わせた時に同じだけ動かす。動かせなかったもの（2026 年より前か `loose`）は
  日付が確かでないものとして、時計の合ったページが見つけた時から 7 日で消す（`packages/monitoring-engine/src/journal.ts` の `expired`）。
  クラウドへ送った CO-WORK の記録で 2026 年より前のものは、サーバーが今に寄せる（`settleUndated`）。
- **アシスタントが届くのは画面の操作まで。** Matrix から呼べるのは `src/lib/bridge/tools.ts` の一覧だけで、
  答えは `useMonitoringFacade` が組む。読取・記録の開始と停止・CO-WORK・画面の切り替え・手順を画面に置く・
  保存と送信・TUNER への切り替え。接続は、一度画面で許可したケーブルへのつなぎ直しと切断だけ（記録中は
  止める確認のあと。運営者 2026-10-28）で、選ぶ画面は出さない（`reconnectPermitted`）。AI の三つのモード
  （事後保全・予兆保全・症状。運営者 2026-11-01）のために、全モジュールの故障の読み取り（`packages/monitoring-engine/src/probe/scan.ts`）、
  画面のモジュールの切り替え（DISCONNECT・CONNECT と同じ手順）、任された調査の PROBE の開始も届く。
  PROBE のモード（運営者 2026-11-02）では、セッションを開く・始める・引き継ぐ（NEW SESSION・NEXT）ことと、
  ボードに部品を置くこと（値はタブが描く）。データログのチャンネルを選び、記録の中身を読むことも届く
  （運営者 2026-11-04）。
  作動テスト・手順・調整・消去・書き込みを AI が始められるかは、上の運営者の表の「誰が」で決まる
  （2026-11-16 に書き込みと安全装置のほかは「AI も」）。口は `monitoring_actuate`（一つのジョブ）と
  `monitoring_procedure`（SMG II の手順）で、画面と同じ関門・測定を通る。新しい機器の許可は画面の人。
- **送る電文は、ジョブ自身のコードが組み、EdiabasLib が同じものを組むときだけ。** 動かすジョブは、値を
  取るものも取らないものも、2 通以上送るものも、そのモジュール自身の SGBD のコード（`sgbd/vm.ts`）で組み、
  `job-frames.oracle.json`（`tools/sgbd/gen_job_frames.py` が EdiabasLib の模擬で値の組ごとに記録）と一致した
  ものだけを開く（`sgbd/agreedFrame.ts`。数は、比べた値のあいだが全部一致したときだけ）。2 通以上のものは
  リンクがジョブを動かし、比べた電文の順のものだけを送る（`session.ts` の `runByCode`）。表で「実行」なのに
  動かない項目は `npm run coverage:runs` が一覧に出し（SGBD のジョブ名の一覧なのでデータ repo の `run-coverage/` に置く）、
  外の理由の無いものが残れば試験が落ちる（`src/lib/runCoverage.test.ts`）。
- **出所を落とさない。** 分類・訳・規定値には `provenance` が付く。分からないものは
  「分からない」と表示する。推定値を実測値の顔で出さない。
- **予約スロット**。状態が変わっても再レイアウトが起きないよう、通知行・サブアクション行などは
  空でも高さを保つ。

## 検査

```
npm run lint && npm run typecheck && npm test
node tools/check_ui_tokens.mjs
python tools/check_references.py
python tools/check_term_scope.py
python tools/jobtext/gen_jobtext.py --check
python tools/verify_ecu_data.py
python tools/verify_translation_quality.py
npm run build:e2e && npm run e2e          # デモテスト（下）
```

**デモテスト**（`tools/e2e/run.mjs`、`scenarios/e2e/*.mjs`）は、本物のアプリを PRACTICE の模擬実車
（`packages/monitoring-engine/src/practiceCar.ts`：後期 E46 M3 SMG II、DSC、ナビ。故障と車速をシナリオが変える）で動かし、
アシスタントの道具（`src/lib/e2e.ts` の口、テスト用のビルドだけが持つ）で操作して、各段階の想定する反応を
確かめる。報告は `e2e-report/`。WORKS 版への配信の前に毎回回り、一つでも落ちたら配信しない。
画面や道具を変えたら、シナリオを足すか直す。

`check_references.py` は開発機（`C:\EDIABAS` ほか）の参照物を検査するので、クラウドでは落ちる。
クラウドのセッションは `.claude/hooks/session-start.sh` が隣の `E46M3-Monitoring-data` から
データを置き、それ以外の検査はそこで回る。

`public/ecu-data/*.json` と `packages/ds2-mss54/src/*.generated.ts` は**生成物**。
手で直さず、`docs/REFERENCES.md` §3 の表にある生成器を回す。

## デプロイ

Cloudflare Pages の `e46m3-monitoring-preview`（ワークス版）ひとつだけ。全パスが m3 の
オーナーのゲート（`functions/_middleware.ts`、`owner_preview`）の内側にある（`ecu-data/` は
BMW SGBD 由来＋逆コンパイル由来で、`THIRD-PARTY-NOTICES.md` §3 が配信を閉じた内側と定めている）。
Access の内側にあった旧本番 `e46m3-monitoring` と staging の `e46m3-diagnosis` は 2026-10-02 に
削除した。GitHub Pages は採らない。`npm run deploy`。デプロイ後はビルドログではなく**配信物**を確認する。
