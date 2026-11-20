# SC01–SC07 の所見（2026-11-20）

落ちた確かめは残してある。書き方：場所／基準／画面や答え／原因／案。AI の言い方は声の稽古で確かめる（ここでは道具の答えの中身だけを見た）。U8・U1（CONNECT・READ・START）は合格。

## SC01
- F01（手順1）開いても何をすればよいか分からない。画面「全モジュール / 全モジュール読取待機中…」、STARTUP は出ない。最初が MANUAL の DIAGNOSIS。案：未接続の一行を「PRACTICE を入れて CONNECT を押してください」に。
- F02（手順2）ヘッダに PRACTICE の文字が無い（点の title だけ、AppHeader.tsx:133 showLabel={false}）。「PRACTICE CONNECTED」はハブの横に出る。
- F03（手順3）IDENT が決めても候補が全部並ぶ。0x12「MSS54 … / MS42 … / MS43 …」ほか 14 行（ScanView.tsx:122 が r.modules を全部つなぐ）。案：identified／m3-fitment の行は一つの名前。
- F04（手順3）故障の無い 0x00 GM5・0x56 が「未解読」（read past the end of a string、応答 00）。練習の車の CLEAN=[0x00] が ZKE5・ASCMK20 の FS_LESEN に足りない。0x56 は後期 DSC なのに先頭候補 ascmk20 のコードで読む。
- F05（手順3）「n モジュール、故障 m 件」が無い。画面は「34」、VISU「18/34 応答したモジュール」。

## SC02（40 km/h、DSC MK60 2 件・DME 1 件）
- F06（手順1・2）名前が答えでは英・独、全モジュール画面の DSC も独語でコードが 10 進（23948）。describeScan が 'en'、ScanView.tsx:172 が f.text。案：SGBD の ja 訳と 16 進。
- F07（手順1）今出ているか散発か：DME は type 0x08 だけ、DSC は独語の kinds だけ。案：present と札「今出ている／記録のみ」。
- F08（手順2）全モジュール画面に記録時の条件が無い。MSS54 単体画面のフリーズフレームは「12801/min」（1280 1/min がくっつく）「48Grad C」、距離なし。
- F09（手順3）走行中の消去の断りの理由が「Not sent: the link refused or the module did not answer.」。本当は moving。断ったのに画面が ACTUATOR に変わる。useMonitoringFacade.ts:520 が送る前の link.error を読む。motion が 5 秒で unknown になり assistantMayStart を通り抜ける。
- F10（手順3）走行中も CLEAR FAULTS が押せ、確認に走行中の言葉が無い。ALL MODULES でも消えるのは MSS54 だけで名前が無い（page.tsx:1020）。
- F11（手順4）カタログの FS_LOESCHEN が練習モードで「Run it once in PRACTICE first」。フリーズフレームも消えることが答えに無い（useMonitoringFacade.ts:342 が mode なしの mayRun）。
- F12（手順5）保存が「faultCount 1、MSS54 PRACTICE」。走査の DSC 2 件が入らない。SESSIONS も「故障 1」。
- F13（手順5）練習の車の MK60 が KWP 14 で消えない（practiceEcu.ts:443 は 0x1A・0x18 だけ）。
- 参考：停車後 5 秒は car: moving、その後 unknown だが speedKmh は 40 のまま。

## SC03
- F14（手順2）ハブ「PROBE v1 · 1/1」。手順は 3 つ、その 1 は断られた DSC の読取。useProbe.ts:112 が一度だけの読取だけを数え、断りも済みに数える。
- F15（手順2）走行中のボードに計画外の値（噴射カット気筒数、噴射時間 気筒1〜3）。ブロック 19 丸ごと。D2-4。
- F16（手順3）PROBE で DSC MK60 の故障が読めない（probe/executor.ts:655「not in PROBE yet」）。

## SC04
- F17 練習の車に SMG II の値を変える項目が無い。「前回より低い」も「外れ」の見せ方も試せない。
- F18 練習の STAT_PHYD_WERT が 65524 bar（一定）。判定「40 bar 以上」が合格になる。
- F19（手順2）比較に前回の日時が出ない（「RUN 1 · v1 → RUN 2 · v1」）。

## SC05
- F20 start_log の答えが started: true なのに running: false と「Nothing recorded yet…」（handlers.ts:333、facade:570 の古い状態）。
- F21 ナビの DATALOG で回転のグラフが見えない（油温だけ、スクロールが要る）。
- F22 連続の記録を 10 分で区切る仕組みが無く、時間を縮める口も無い（journal.ts:29 IDLE_MS は無記録 10 分で切るだけ）。
- F23「さっきの」：monitoring_moment が PROBE しか見ない（handlers.ts:309）。ギアも記録されず、グラフに印の仕組みも無い。
- F24 sync の答え {sent:0, waiting:1} に理由が無い。送った印も無い。実際の送信は WORKS 版のみ（実車のみ扱い）。

## SC06
- F25「練習から」は title（マウス）だけ。触っても何も出ない。
- F26 値の組が SGBD の独語で 390 個（HYDROPUMPE に 65535・-32768 まで）。日本語の部品名なし。行名「アクチュエ…」で切れる。
- F27 確認に 12 V と止まるまでの秒数が無い。電文と呼び出しが「何が動くか」より先（D3-3）。
- F28 動作中：残り秒数なし、何が動くか出ない、結果欄（送信・応答）なし。
- F29 STOP・時間切れのあと「止まった」「時間切れで止まった」が残らない。SC07 も同じ。
- F30 自動停止は 60 秒（runGate.ts:437 が SGBD の最大 60 秒を使う。既定は policy.ts:155 の 10 秒）。シナリオは 10 秒。運営者が決める。
- F31 実車のみ：実車モードで START が押せる、START→実行で「車速・電圧を測っています」→動作中。
- 参考：ANSTEUERUNG_VORBEREITEN が送られない。確認ダイアログはオーナーに「先に送ってください」と頼むが、送る手段が無い。

## SC07
- F32 カタログ「油圧ポンプ」で出るのは ANSTEUERUNG_VORBEREITEN だけ。STEUERN_STELLGLIED に行き着かない。
- F33 値なしの答えの sets が 120 個で切れ、HYDROPUMPE の組が無い（useMonitoringFacade.ts:478 slice(0,120)）。
- F34 始める前の答えに秒数・12 V・日本語の部品名が無い。
