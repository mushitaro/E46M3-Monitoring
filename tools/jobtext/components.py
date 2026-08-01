#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""部品辞書 — ジョブ id が指している「車のどの部品か」。

## なぜ辞書が要るのか

SGBD が持っているのは `Auslass-VANOS Bank 1 Spaetventil ansteuern` のような
**識別子の言い換え**であって説明ではない。オーナーが読めるのは
「排気側カムシャフトのタイミングを遅らせる方の電磁弁（バンク1＝1〜3番気筒側）」
であって、「排気VANOSバンク1遅角弁駆動」ではない。その差は機械翻訳では埋まらない。

各項目は5つ持つ:
    key    テンプレート側から参照する識別子
    ja/en  部品名（名詞句）
    where  どこにあり何をしているか（1文）
    sense  故障したときオーナーが体感すること。空なら省略される

先頭から順に照合し、最初に当たったものを採る。**長い正規表現ほど先に置く**
（`EV1` は `EVANOS1` の前方一致なので順序を誤ると噴射弁が VANOS になる）。
"""
from __future__ import annotations

import re

# (pattern, key, ja, en, ja_where, en_where, ja_sense, en_sense)
_RAW: list[tuple[str, str, str, str, str, str, str, str]] = [
    # --- VANOS。EV/AV の前方一致より先に置く ------------------------------
    (r"EVANOS(?P<n>\d)_FRUEH_VENTIL", "evanos_frueh", "吸気VANOS 進角側電磁弁 バンク{n}", "Intake VANOS advance valve, bank {n}",
     "吸気カムシャフトのタイミングを進める側を開く電磁弁です。バンク1が1〜3番、バンク2が4〜6番気筒側です。",
     "The solenoid that advances intake cam timing. Bank 1 is cylinders 1-3, bank 2 is 4-6.",
     "低回転のトルクが痩せる、アイドルが不安定になる、といった形で出ます。",
     "Shows up as weak low-end torque or an unsteady idle."),
    (r"EVANOS(?P<n>\d)_SPAET_VENTIL", "evanos_spaet", "吸気VANOS 遅角側電磁弁 バンク{n}", "Intake VANOS retard valve, bank {n}",
     "吸気カムシャフトのタイミングを遅らせる側を開く電磁弁です。",
     "The solenoid that retards intake cam timing.",
     "高回転の伸びが鈍る形で出ます。", "Shows up as a flat top end."),
    (r"AVANOS(?P<n>\d)_FRUEH_VENTIL", "avanos_frueh", "排気VANOS 進角側電磁弁 バンク{n}", "Exhaust VANOS advance valve, bank {n}",
     "排気カムシャフトのタイミングを進める側を開く電磁弁です。",
     "The solenoid that advances exhaust cam timing.", "", ""),
    (r"AVANOS(?P<n>\d)_SPAET_VENTIL", "avanos_spaet", "排気VANOS 遅角側電磁弁 バンク{n}", "Exhaust VANOS retard valve, bank {n}",
     "排気カムシャフトのタイミングを遅らせる側を開く電磁弁です。",
     "The solenoid that retards exhaust cam timing.", "", ""),
    (r"(?P<io>[EA])VANOS(?P<n>\d)_VERSTELLZEIT", "vanos_verstellzeit", "VANOS 調整速度 バンク{n}", "VANOS adjustment time, bank {n}",
     "カムシャフトを端から端まで動かすのにかかる時間です。油圧と機構の健全性がここに出ます。",
     "How long the cam takes to travel end to end. Oil pressure and mechanical health show up here.",
     "遅ければ油圧不足かVANOSピストンの摩耗が疑われます。",
     "Slow means low oil pressure or a worn VANOS piston."),
    (r"(?P<io>[EA])VANOS(?P<n>\d)_DICHTHEIT", "vanos_dichtheit", "VANOS 気密 バンク{n}", "VANOS leak-down, bank {n}",
     "VANOS ピストンが位置を保持できるかを見ます。油圧が抜けると保持できません。",
     "Whether the VANOS piston can hold position. It cannot if oil pressure bleeds away.",
     "保持できないとアイドル不調やカム位置のばらつきになります。",
     "Failure to hold shows as a rough idle and wandering cam position."),
    (r"(?P<io>[EA])VANOS(?P<n>\d)_(FRUEH|SPAET)ANSCHLAG", "vanos_anschlag", "VANOS 機械端 バンク{n}", "VANOS mechanical stop, bank {n}",
     "カムシャフトを機械的な端まで動かして、そこが基準位置として使えるかを見ます。",
     "Drives the cam to its mechanical limit to check that position is usable as a reference.", "", ""),
    (r"(?P<io>[EA])VANOS(?P<n>\d)(?![_A-Z])", "vanos_unit", "VANOS ユニット バンク{n}", "VANOS unit, bank {n}",
     "カムシャフトのタイミングを回転数と負荷に応じて連続的に変える機構です。",
     "The mechanism that varies cam timing continuously with engine speed and load.", "", ""),
    (r"VDSV", "vdsv", "VANOS 圧力アキュムレータ弁", "VANOS pressure accumulator valve",
     "VANOS 用に油圧を溜めておく容器の弁です。始動直後の応答を確保します。",
     "The valve on the reservoir that stores oil pressure for VANOS, so it responds right after a cold start.",
     "", ""),
    (r"VANOS_NW_LAGE_EINLASS_BANK_(?P<n>\d)", "vanos_nw_lage", "吸気カム位置 バンク{n}", "Intake cam position, bank {n}",
     "吸気カムシャフトの現在角度です。", "The current intake camshaft angle.", "", ""),

    # --- 燃料・噴射 --------------------------------------------------------
    (r"\bEV(?P<n>\d)\b", "injector", "インジェクタ 第{n}気筒", "Injector, cylinder {n}",
     "燃料を筒内に噴く電磁弁です。1気筒に1本あります。",
     "The solenoid that sprays fuel into that cylinder. One per cylinder.",
     "詰まりや不作動は失火・振動・排ガス悪化として出ます。",
     "Clogging or failure shows as a misfire, vibration and worse emissions."),
    (r"\bTI(?P<n>\d)\b", "ti_cyl", "噴射時間 第{n}気筒", "Injection time, cylinder {n}",
     "その気筒のインジェクタを開いている時間です。長いほど濃く入ります。",
     "How long that cylinder's injector is held open. Longer means more fuel.", "", ""),
    (r"EINSPRITZZEIT|TI_AUS", "ti", "噴射時間", "Injection time",
     "インジェクタを開いている時間です。", "How long the injector is held open.", "", ""),
    (r"EKP", "ekp", "燃料ポンプリレー", "Fuel pump relay",
     "タンク内の燃料ポンプへの電源を入り切りするリレーです。",
     "The relay that powers the in-tank fuel pump.",
     "入らなければ始動しません。", "If it does not close, the engine will not start."),
    (r"VENTIL_SAUGSTRAHLPUMPE", "saugstrahl", "サクションジェットポンプ弁", "Suction-jet pump valve",
     "タンク内で燃料を吸い上げ側へ寄せるジェットポンプの弁です。残量が少ないときに効きます。",
     "The valve for the jet pump that keeps fuel around the pickup, which matters when the tank is low.",
     "", ""),
    (r"TEV_CHECK", "tev_check", "タンク通気弁の点検", "Tank vent valve check",
     "タンク通気弁が指示どおり開閉するかを見ます。",
     "Checks that the tank vent valve opens and closes as commanded.", "", ""),
    (r"\bTEV\b|TV_TEV", "tev", "タンク通気弁", "Tank vent valve",
     "タンクから出るガソリン蒸気をキャニスタ経由でエンジンに吸わせる弁です。",
     "The valve that lets fuel vapour from the tank be drawn into the engine via the charcoal canister.",
     "固着すると始動性悪化やアイドル不調、車検の排ガス項目に出ます。",
     "A stuck valve causes hard starting, a rough idle, and emissions-test failures."),
    (r"DMTL_HEIZUNG|DMTL_HEATER", "dmtl_heater", "DMTL ヒータ", "DMTL heater",
     "タンク漏れ検査ポンプ内のヒータです。検査精度のために使われます。",
     "The heater inside the tank-leak diagnosis pump, used to keep the measurement accurate.", "", ""),
    (r"DMTL", "dmtl", "タンク漏れ診断モジュール（DMTL）", "Tank leak diagnosis module (DMTL)",
     "タンクとその配管に穴が無いかを、微小な加圧で調べる装置です。右後輪の内側付近にあります。",
     "Pressurises the tank and its plumbing slightly to find leaks. It sits near the right rear wheel arch.",
     "不良は「燃料キャップの緩み」と同じ警告灯として出ます。",
     "A failure lights the same lamp as a loose fuel cap."),
    (r"TANK_LECK|TANK_DICHTHEIT", "tank_leak", "燃料タンクの気密", "Fuel tank leak tightness",
     "タンクと蒸発ガス配管に漏れが無いかを見ます。",
     "Whether the tank and its evaporative plumbing hold pressure.", "", ""),

    # --- 点火 --------------------------------------------------------------
    (r"\bZS(?P<n>\d)\b", "coil", "点火コイル 第{n}気筒", "Ignition coil, cylinder {n}",
     "プラグに高電圧を送る部品です。S54 は気筒ごとに1個載っています。",
     "Sends high voltage to that cylinder's spark plug. The S54 has one per cylinder.",
     "不良は失火・振動・警告灯として出ます。",
     "Failure shows as a misfire, vibration and a warning lamp."),
    (r"\bTZ(?P<n>\d)\b", "tz", "点火時期 第{n}気筒", "Ignition angle, cylinder {n}",
     "その気筒の点火時期です。ノッキングが起きると DME がこれを遅らせるので、ノック監視はこの値で行います。",
     "That cylinder's ignition timing. The DME retards it when it detects knock, so this is how knock is watched live.",
     "", ""),
    (r"LAUFUNRUHE", "laufunruhe", "回転変動（失火検出）", "Running roughness (misfire detection)",
     "クランクの回り方のムラから失火を検出する仕組みです。",
     "Detects misfires from unevenness in how the crankshaft turns.", "", ""),
    (r"GEBERRAD", "geberrad", "クランク角センサホイール", "Crank trigger wheel",
     "クランク軸に付いた歯車で、回転位置を DME に伝えます。歯の製造ばらつきは学習で補正されます。",
     "The toothed wheel on the crankshaft that tells the DME where the engine is. Tooth-spacing tolerance is learned out.",
     "", ""),

    # --- 排気・ラムダ ------------------------------------------------------
    (r"LSHV(?P<n>\d)", "lsh_pre", "O2センサヒータ 触媒前 バンク{n}", "O2 sensor heater, pre-cat bank {n}",
     "触媒の手前にある酸素センサを早く働かせるためのヒータです。",
     "Brings the pre-catalyst oxygen sensor up to temperature quickly.", "", ""),
    (r"LSHN(?P<n>\d)", "lsh_post", "O2センサヒータ 触媒後 バンク{n}", "O2 sensor heater, post-cat bank {n}",
     "触媒の後ろにある酸素センサ用のヒータです。", "Heater for the post-catalyst oxygen sensor.", "", ""),
    (r"LS_VKAT|L_SONDE(_2)?$", "lambda_pre", "O2センサ 触媒前", "Pre-catalyst O2 sensor",
     "排気の酸素量から混合気の濃さを測り、燃料補正の基準になります。",
     "Measures exhaust oxygen to judge mixture strength; it is the reference for fuel trim.", "", ""),
    (r"LS_NKAT|L_SONDE_?\d?_H", "lambda_post", "O2センサ 触媒後", "Post-catalyst O2 sensor",
     "触媒が効いているかを判定するためのセンサです。",
     "Used to judge whether the catalyst is still working.", "", ""),
    (r"LAMBDAREGLER_SPERREN", "lambda_lock", "ラムダ制御の停止", "Lambda control lockout",
     "燃料の閉ループ補正を一時的に止めます。素の状態を測るために使います。",
     "Temporarily stops closed-loop fuel correction so the underlying state can be measured.", "", ""),
    (r"LAMBDA_ADD|\bADD(_2)?$", "lambda_add", "ラムダ加算補正", "Lambda additive trim",
     "アイドル付近の燃料ずれを吸収する加算側の学習値です。",
     "The additive learned correction that absorbs fuel error near idle.",
     "大きく振れていれば二次エア吸いや噴射系の劣化が疑われます。",
     "A large value points to an air leak or tired injectors."),
    (r"LAMBDA_MUL|\bMUL(_2)?$", "lambda_mul", "ラムダ乗算補正", "Lambda multiplicative trim",
     "負荷域全体の燃料ずれを吸収する乗算側の学習値です。",
     "The multiplicative learned correction that absorbs fuel error across the load range.", "", ""),
    (r"LAMBDA_INTEGRATOR|\bINT(_2)?$", "lambda_int", "ラムダ積分値", "Lambda integrator",
     "いま現在の閉ループ補正量です。学習値と違い走行中に絶えず動きます。",
     "The instantaneous closed-loop correction. Unlike the learned values it moves constantly while driving.",
     "", ""),
    (r"SEK_LUFT|\bSLP\b|\bSLV\b|SLS", "secondary_air", "二次空気システム", "Secondary air system",
     "冷間始動直後に排気側へ空気を送り、触媒を早く暖める仕組みです。ポンプと弁で構成されます。",
     "Pumps air into the exhaust right after a cold start to warm the catalyst quickly. A pump and a valve.",
     "詰まりや固着は冷間時のみ警告灯が点く形で出ます。",
     "Blockage or sticking lights the lamp only when cold."),
    (r"\bAKL\b", "akl", "排気フラップ", "Exhaust flap",
     "排気の経路を切り替えて音量と背圧を変えるフラップです。",
     "Switches the exhaust path to change noise and back pressure.", "", ""),
    (r"GERAEUSCHKLAPPE|GKS", "gks", "吸気ノイズフラップ", "Intake noise flap",
     "吸気の共鳴を切り替えるフラップです。CSL 系の吸気に関係します。",
     "Switches intake resonance. Relevant to the CSL intake.", "", ""),
    (r"VENTIL_KURBELGEHAEUSE", "ccv", "クランクケース換気弁", "Crankcase ventilation valve",
     "クランクケース内のブローバイガスを吸気に戻す弁です。",
     "Returns crankcase blow-by gas to the intake.", "", ""),
    (r"ABGAS_VARIANTE", "abgas_variante", "排ガス仕様", "Emissions variant",
     "この ECU がどの排ガス規制向けに設定されているかです。",
     "Which emissions standard this ECU is configured for.", "", ""),
    (r"TABG", "tabg", "排気温度", "Exhaust temperature", "排気の温度です。", "Exhaust gas temperature.", "", ""),

    # --- 吸気・スロットル --------------------------------------------------
    (r"LL_STELLER|LLS_TESTDREHZAHL|N_LL_SOLL", "idle", "アイドル制御", "Idle control",
     "アイドル回転数を目標に保つ制御です。S54 は電子スロットルで行います。",
     "Holds idle speed at target. On the S54 this is done with the electronic throttle.", "", ""),
    (r"DKP_WINKEL", "dkp", "スロットル開度", "Throttle angle",
     "スロットルバルブの開き角です。", "How far the throttle plate is open.", "", ""),
    (r"PWG_POTI", "pwg", "アクセルペダルセンサ", "Accelerator pedal sensor",
     "ペダルの踏み込み量を測るセンサです。安全のため2系統あります。",
     "Measures how far the pedal is pressed. Two independent channels, for safety.", "", ""),
    (r"\bLMM\b|LMM_MASSE", "lmm", "エアマスセンサ", "Air mass sensor",
     "吸い込んだ空気の量を測ります。燃料量の基礎になります。",
     "Measures how much air is being drawn in. The basis for how much fuel to inject.", "", ""),
    (r"AN_LUFTTEMPERATUR", "iat", "吸気温度", "Intake air temperature",
     "吸い込む空気の温度です。", "The temperature of the incoming air.", "", ""),
    (r"\bRF\b|PUMG|LAST", "load", "充填率・負荷", "Charge / load",
     "シリンダにどれだけ空気が入ったかの割合です。エンジンの仕事量の指標になります。",
     "How full the cylinder is. The measure of how hard the engine is working.", "", ""),
    (r"TI_ABGLEICH", "ti_abgleich", "個別スロットル補正", "Individual throttle correction",
     "6連スロットルの個体差を自動で測って揃える試験走行です。",
     "A test run that measures and equalises the six individual throttle bodies.", "", ""),
    (r"SG_AUTOSYNC|SYNC_MODE", "autosync", "アイドル同調", "Idle synchronisation",
     "6連スロットルのアイドル時のバランスを取ります。",
     "Balances the six throttle bodies at idle.", "", ""),

    # --- 冷却・潤滑 --------------------------------------------------------
    (r"E_LUEFTER", "fan", "電動ファンリレー", "Electric fan relay",
     "ラジエータの電動ファンを回すリレーです。",
     "The relay that runs the radiator's electric fan.", "", ""),
    (r"OEKV(?P<n>\d)", "oekv", "オイル回路切替弁 {n}", "Oil circuit switching valve {n}",
     "油路を切り替えて、必要なところに油圧を回す弁です。",
     "Switches the oil circuit to route pressure where it is needed.", "", ""),
    (r"OEL_TEMPERATUR", "oil_temp", "油温", "Oil temperature", "エンジンオイルの温度です。",
     "Engine oil temperature.", "", ""),
    (r"MOTORTEMPERATUR|KUEHLW", "coolant", "冷却水温", "Coolant temperature",
     "冷却水の温度です。多くの制御がこれで切り替わります。",
     "Coolant temperature. A great many control decisions switch on it.", "", ""),
    (r"TUMG", "ambient", "外気温", "Ambient temperature", "外の気温です。", "Outside air temperature.", "", ""),

    # --- 電気 --------------------------------------------------------------
    (r"STEUERN_START", "starter", "スタータリレー", "Starter relay",
     "セルモータへの電源を入れるリレーです。",
     "The relay that powers the starter motor.",
     "エンジンが掛かっている状態で叩いてはいけません。",
     "Must not be driven while the engine is running."),
    (r"SERVOV", "servotronic", "サーボトロニック弁", "Servotronic valve",
     "車速に応じてパワーステアリングの重さを変える弁です。",
     "Varies power-steering assistance with road speed.", "", ""),
    (r"\bKO\b", "ac_compressor", "エアコンコンプレッサリレー", "A/C compressor relay",
     "エアコンのコンプレッサを入り切りするリレーです。",
     "Engages and disengages the air-conditioning compressor.", "", ""),
    (r"UBATT|UEXT", "voltage", "電源電圧", "Supply voltage",
     "ECU が見ている電源電圧です。", "The supply voltage the ECU sees.", "", ""),
    (r"IO_STATUS_VORGEBEN", "io_pin", "任意の出力ピン", "An arbitrary output pin",
     "ピン番号・デューティ比・周期を直接指定して出力を駆動します。何が繋がっているかはアプリ側では分かりません。",
     "Drives an output by pin number, duty cycle and period. What is wired to it is not knowable from here.",
     "", ""),

    # --- 変速機（SMG II）--------------------------------------------------
    (r"KUPPL|SCHLEIF", "clutch", "クラッチ", "Clutch",
     "SMG II が油圧で操作するクラッチです。食いつき点は摩耗に応じて学習し直します。",
     "The clutch, operated hydraulically by SMG II. Its bite point is re-learned as the disc wears.",
     "学習がずれると発進のぎくしゃく感や半クラッチの長さの違和感になります。",
     "A stale adaptation shows as jerky pull-away or an odd-feeling bite."),
    (r"GETRIEBEDATEN|GETRIEBE", "gearbox", "変速機", "Gearbox",
     "SMG II の変速機本体です。", "The SMG II gearbox itself.", "", ""),
    (r"STELLGLIED", "smg_actuator", "SMG アクチュエータ", "SMG actuator",
     "クラッチとシフトを動かす油圧アクチュエータ群です。どれを動かすかは引数で選びます。",
     "The hydraulic actuators that move the clutch and the shift mechanism. Which one is chosen by argument.",
     "", ""),
    (r"TESTPRG", "testprg", "SMG 試験プログラム", "SMG test program",
     "変速機 ECU が自走する適応・点検プログラムです。番号で選びます。",
     "An adaptation or check program the gearbox ECU runs by itself, selected by number.", "", ""),

    # --- ブレーキ・DSC ------------------------------------------------------
    (r"DSC_SIM_(?P<c>VA\d?|HA\d?)", "dsc_sim", "DSC 電磁弁（{c}）", "DSC solenoid ({c})",
     "ブレーキ油圧を制御する電磁弁です。VA が前軸、HA が後軸です。",
     "A brake-pressure control solenoid. VA is the front axle, HA the rear.",
     "", ""),
    (r"DRUCKAUFBAU", "druckaufbau", "ブレーキ油圧の加圧", "Brake pressure build-up",
     "DSC のポンプでブレーキ油圧を上げます。", "Raises brake pressure using the DSC pump.", "", ""),
    (r"DRUCKABBAU", "druckabbau", "ブレーキ油圧の減圧", "Brake pressure release",
     "ブレーキ油圧を抜きます。", "Bleeds brake pressure off.", "", ""),
    (r"DRUCKHALTEN", "druckhalten", "ブレーキ油圧の保持", "Brake pressure hold",
     "ブレーキ油圧をその場に保ちます。", "Holds brake pressure where it is.", "", ""),
    # 出典の訂正: 「自動停止しない・最大60秒・100barでリリーフ弁」は **SMG II** の
    # `STEUERN_STELLGLIED` / `ANSTEUERUNG_VORBEREITEN` の記述であって、DSC の
    # SGBD には一切無い（ダンプ全体を検索して `Sekund`/`Stop`/`Abbruch`/
    # `abschalt`/`_AUS` は 0 件、タイムアウトも最大時間も未記載）。
    # 出典を土台にしているアプリで、他モジュールの警告を借りてくるのは捏造である。
    # 危険が無いという意味ではない——SGBD が**何も言っていない**という意味であり、
    # それはそれで述べるに値する事実なので、そう述べる。
    (r"PUMPENFOERDERLEISTUNG", "dsc_pump", "DSC ポンプ", "DSC pump",
     "ブレーキ油圧を作る電動ポンプです。DSC の SGBD は、このポンプの最大駆動時間も"
     "停止方法も述べていません。",
     "The electric pump that generates brake pressure. The DSC SGBD states neither a "
     "maximum run time for it nor any way to stop it.",
     "", ""),
    (r"NA_ENTLUEFTUNG|ENTLUEFTUNG_SERVICE", "brake_bleed", "ブレーキのエア抜き", "Brake bleeding",
     "ブレーキ配管から空気を抜くために、DSC のポンプと弁を動かします。",
     "Runs the DSC pump and valves to purge air from the brake lines.", "", ""),
    (r"ABS_REGELSIMULATION", "abs_sim", "ABS 制御の模擬", "ABS control simulation",
     "ABS が働いたときの動きを模擬して、油圧経路が正しく動くかを見ます。",
     "Simulates an ABS intervention to check the hydraulic paths respond.", "", ""),
    (r"STEUERN_DIGITAL", "dsc_digital", "DSC 電磁弁とポンプ", "DSC solenoids and pump",
     "ブレーキ油圧ユニットの8個の電磁弁とポンプを、ビット指定で直接駆動します。",
     "Drives the eight brake-hydraulic solenoids and the pump directly, selected by bit.",
     "", ""),
    (r"LENKWINKEL|\bLWS\b", "steering_angle", "ステアリング角センサ", "Steering angle sensor",
     "ハンドルの切れ角を測るセンサです。DSC が car の意図を知るために使います。",
     "Measures how far the wheel is turned. DSC uses it to know where the driver intends to go.", "", ""),
    (r"QUERBESCHLEUNIGUNG|\bAQREL\b", "lat_accel", "横加速度センサ", "Lateral acceleration sensor",
     "横方向の加速度を測るセンサです。", "Measures sideways acceleration.", "", ""),
    (r"DRUCKSENSOR_DSC", "brake_pressure_sensor", "ブレーキ圧センサ", "Brake pressure sensor",
     "ブレーキ油圧を測るセンサです。", "Measures brake hydraulic pressure.", "", ""),
    (r"\bDDS\b|LESEN_DDS", "dds", "タイヤ空気圧警報（DDS）", "Tyre pressure warning (DDS)",
     "4輪の回転差から空気圧の低下を推定する仕組みです。圧力センサは使いません。",
     "Infers a low tyre from differences in wheel rotation. There is no pressure sensor.",
     "タイヤ交換やローテーション後は必ず再学習が要ります。",
     "Always needs re-initialising after a tyre change or rotation."),
    (r"\bTRIG\b|TRIGGERSCHWELLE", "wheel_trigger", "車輪速センサのしきい値", "Wheel-speed sensor threshold",
     "車輪速センサの信号を有効と判定する電圧のしきい値です。",
     "The signal threshold at which a wheel-speed sensor pulse counts.", "", ""),

    # --- ECU 本体・識別 -----------------------------------------------------
    (r"^FS_|FEHLERSPEICH", "fault_memory", "故障メモリ", "Fault memory",
     "ECU が記録した故障コードと、そのときの運転条件（フリーズフレーム）です。",
     "The fault codes the ECU has stored, with the operating conditions captured at the time.",
     "", ""),
    (r"ADAPTIONSBLOCK|ADAPTIONSWERTE|ADAPT_", "adaptations", "学習値", "Adaptation values",
     "DME や変速機 ECU が走行中に学習した補正値です。経年・個体差・燃料・気圧を吸収します。",
     "The corrections the ECU has learned while driving. They absorb wear, unit-to-unit variation, fuel and air pressure.",
     "消すと学習し直すまで一時的に調子が変わります。",
     "Clearing them makes the car temporarily run differently until it re-learns."),
    (r"ABGLEICHWERTE|ABGLEICHFLAG|ABGLEICH_LOGIN", "abgleich", "工場調整値", "Factory calibration values",
     "そのエンジン個体に合わせて工場で書かれた調整値です。学習値とは別物です。",
     "Calibration values written at the factory for this specific engine. Not the same as learned values.",
     "", ""),
    (r"CO_EINZELABGLEICH", "co_trim", "CO 調整値", "CO trim value",
     "排ガスの CO 濃度を合わせるための調整値です。RAM で変えてから EEPROM に焼く2段構えになっています。",
     "The trim that sets exhaust CO. It is changed in RAM first and only then burned to EEPROM.",
     "", ""),
    (r"CODIERDATEN|CODIER|COD_", "coding", "コーディングデータ", "Coding data",
     "この車の装備構成を ECU に教えるデータです。",
     "The data that tells the ECU what equipment this car has.", "", ""),
    (r"\bEWS3?\b", "ews", "イモビライザ（EWS）", "Immobiliser (EWS)",
     "鍵と ECU が互いを認証する盗難防止機構です。",
     "The anti-theft system in which the key and the ECU authenticate each other.",
     "同期が崩れるとエンジンが始動しなくなります。",
     "If synchronisation is lost the engine will not start."),
    (r"\bISN\b", "isn", "個体識別番号（ISN）", "Individual serial number (ISN)",
     "ECU と車体を結び付ける番号です。", "The number that ties this ECU to this car.", "", ""),
    (r"PRUEFSTEMPEL", "pruefstempel", "検査スタンプ", "Inspection stamp",
     "工場やサービスが書き込む検査記録です。", "The inspection record written by the factory or service.",
     "", ""),
    (r"\bAIF\b", "aif", "更新履歴（AIF）", "Update history (AIF)",
     "この ECU が過去にいつ何を書き込まれたかの記録です。",
     "The record of when this ECU was last programmed and with what.", "", ""),
    (r"\bZIF\b", "zif", "追加識別情報（ZIF）", "Additional identification (ZIF)",
     "ECU の追加の識別データです。", "Additional ECU identification data.", "", ""),
    (r"FLASH|SPEICHER|\bRAM\b|\bROM\b|EEPROM", "memory", "ECU メモリ", "ECU memory",
     "ECU の内部メモリそのものです。プログラムと設定が入っています。",
     "The ECU's own memory, holding its program and its settings.", "", ""),
    (r"BAUDRATEN|EDIC_BAUDRATE", "baud", "通信速度", "Link baud rate",
     "診断通信そのものの速度です。変えると通信中のセッションが壊れます。",
     "The speed of the diagnostic link itself. Changing it breaks the session that is carrying the command.",
     "", ""),
    (r"SEED_KEY|LOGIN", "login", "保護解除（シード／キー）", "Protection unlock (seed/key)",
     "保護された操作を行う前に必要な認証手続きです。",
     "The authentication step required before a protected operation.", "", ""),
    (r"DIAGNOSE_", "session", "診断セッション", "Diagnostic session",
     "ECU との診断通信そのものの維持・終了です。",
     "Keeping the diagnostic conversation with the ECU alive, or ending it.", "", ""),
    (r"SG_RESET|EDIC_RESET|SG_PRUEFLAUF", "ecu", "ECU 本体", "The ECU itself",
     "この制御ユニット自身です。", "The control unit itself.", "", ""),
    (r"IDENT|HERSTELLER|HERSTELLDATEN|HW_REFERENZ|DATEN_REFERENZ|BLOCKLAENGE|ECU_CONFIG|SYS_ADR",
     "identity", "ECU の識別情報", "ECU identity",
     "この ECU の型番・製造情報・ソフトウェア版数です。",
     "This ECU's part numbers, manufacturing data and software version.", "", ""),
    (r"UEBERGABE", "handover", "引き渡しモード", "Handover mode",
     "新車引き渡し前の輸送モードに関する設定です。",
     "The transport-mode setting used before a new car is handed over.", "", ""),
    (r"MOTORDREHZAHL|NMAX|TNMAX", "rpm", "エンジン回転数", "Engine speed",
     "クランクシャフトの回転数です。NMAX は過去の最高値の記録です。",
     "Crankshaft speed. NMAX is the highest ever recorded.", "", ""),
    (r"GESCHWINDIGKEIT|V_CAN|VMAX", "speed", "車速", "Road speed",
     "車の速度です。VMAX は過去の最高値の記録です。",
     "Road speed. VMAX is the highest ever recorded.", "", ""),

    # --- ここから下は「上のどれにも当たらなかったもの」の受け皿。------------
    # 具体的な部品を指す項目より必ず後ろに置く（順に照合して最初に当たったものを
    # 採るため、先に置くと本来もっと具体的に言える部品を潰す）。
    (r"(?P<io>[EA])VANOS(?P<n>\d)_(SOLL|IST)", "vanos_pos", "VANOS 位置 バンク{n}", "VANOS position, bank {n}",
     "カムシャフトの実位置(IST)と ECU が指示している目標位置(SOLL)です。両者の差が制御のずれを表します。",
     "The cam's actual position (IST) and the target the ECU is commanding (SOLL). The gap between them is the control error.",
     "", ""),
    (r"SERVO_I_(IST|SOLL)", "servo_current", "サーボトロニック電流", "Servotronic current",
     "サーボトロニック弁に流している電流の実値と目標値です。",
     "The actual and target current through the Servotronic valve.", "", ""),
    (r"LFR(_KO)?(?![A-Z0-9])", "lfr", "アイドル充填率補正", "Idle charge correction",
     "アイドルを保つのに必要な空気量の学習値です。_KO はエアコン作動時の値です。",
     "The learned air requirement for holding idle. The _KO variant is with the A/C running.", "", ""),
    (r"ANALOG_GM3", "gm3", "GM3 アナログ入力", "GM3 analogue input",
     "ボディモジュール(GM3)から届くアナログ信号です。",
     "An analogue signal arriving from the body module (GM3).", "", ""),
    (r"STEUERN_ANALOG_(ASC_LM|MSR)", "dsc_torque_req", "エンジントルク要求（アナログ）", "Engine torque request (analogue)",
     "DSC からエンジンへのトルク低減／増加要求です。トラクション制御とエンジンブレーキ制御が使います。",
     "The torque cut or increase DSC asks the engine for. Used by traction control and engine-drag control.",
     "", ""),
    (r"ANSTEUERUNG_VORBEREITEN", "smg_prepare", "SMG アクチュエータ駆動の前準備", "SMG actuation preparation",
     "SGBD が「スタータ解除・油圧ポンプ・故障表示・シフトロックではこのジョブを先に送ること」と明記している前段処理です。ECU 側の時間カウンタもここでゼロに戻ります。",
     "The SGBD states outright that this must be sent before actuating the starter release, hydraulic pump, fault indicator or shift lock. It also zeroes the ECU's time counter.",
     "", ""),
    (r"MCS_AKTIVIEREN", "mcs", "MCS モード", "MCS mode",
     "製造・サービス用の特別モードを有効にします。",
     "Enables a manufacturing and service mode.", "", ""),
    (r"^ID_SCHREIBEN$", "id_stamp", "検査スタンプ（ID）", "Inspection stamp (ID)",
     "検査記録をアドレス指定で書き込みます。名前は ID ですが、実体は Prüfstempel の書込です。",
     "Writes an inspection record by address. Named ID, but what it writes is the Pruefstempel.",
     "", ""),
    (r"STATUS_(SENSOREN|SPANNUNGSWERTE|OFFSET|HARDWARE_STATI|IO_STATI|FAHRZEUGTESTER|DME_DDE)",
     "module_state", "モジュールの内部状態", "Module internal state",
     "この ECU が見ているセンサ値・電圧・入出力の状態です。",
     "The sensor values, voltages and I/O states this ECU is currently seeing.", "", ""),
    (r"IO_STATUS_LESEN|STATUS_DIGITAL|STATUS_LESEN$|STATUS_IO_LESEN", "io_state",
     "入出力の状態", "Input/output state",
     "ECU の入出力ピンの現在の状態です。",
     "The current state of the ECU's input and output pins.", "", ""),
    (r"ABGLEICH_(DSC_SENSOREN|LWS_AQ_SENSOREN)", "dsc_sensor_zero", "DSC センサのゼロ点調整", "DSC sensor zero calibration",
     "ステアリング角センサと横加速度センサの中立位置を教え込みます。車両を直進・静止させた状態が前提です。",
     "Teaches the steering-angle and lateral-acceleration sensors where neutral is. The car must be straight and still.",
     "ずれているとDSCが曲がっていないのに介入する、あるいは必要なときに介入しない、という形で出ます。",
     "If it is off, DSC intervenes when the car is straight, or fails to when it should."),
    (r"^INITIALISIERUNG$", "init", "ECU の初期化", "ECU initialisation",
     "ECU を出荷時に近い初期状態へ戻します。何が初期化されるかはモジュールによって違います。",
     "Returns the ECU towards its as-delivered state. Exactly what that covers differs by module.",
     "学習値が失われるので、しばらくは走行で学習し直すことになります。",
     "Learned values are lost, so the car re-learns them over the drives that follow."),
    (r"^INFO", "info", "SGBD 情報", "SGBD information",
     "この診断定義ファイル自身についての情報です。車両の状態ではありません。",
     "Information about the diagnostic definition file itself. Not about the car.", "", ""),
]

# 正規表現の `` は `_` を語中文字として扱うため、`STEUERN_ZS8` の `ZS` の手前では
# 境界にならない。SGBD の識別子では `_` こそが区切りなので、英数字だけを見る
# 先読み／後読みに機械的に置き換える。
#
# これを見落として `ZS(\d)` と書いた初版では、点火コイル8本・噴射弁8本・
# 気筒別点火角8本・気筒別噴射時間7本を含む 98 件が部品辞書に当たらなかった。
_TOKEN_START = "(?<![A-Z0-9])"
_TOKEN_END = "(?![A-Z0-9])"


def _fix_boundaries(pattern: str) -> str:
    """パターン文字列中の 2 文字 `\b` を、`_` を区切りとみなす境界に置き換える。

    走査対象は「パターンという文字列」であって、それが表す言語ではない。
    `re.compile(r"\b")` と書くと、パターン文字列そのものの語境界にマッチして
    `(?P<n>` の内側にまで挿入され、グループ名が壊れる（実際に壊れた）。
    """
    out, i = [], 0
    while i < len(pattern):
        if pattern[i] == "\\" and pattern[i + 1 : i + 2] == "b":
            nxt = pattern[i + 2 : i + 3]
            out.append(_TOKEN_END if not nxt or nxt in ")|$" else _TOKEN_START)
            i += 2
        else:
            out.append(pattern[i])
            i += 1
    return "".join(out)


COMPONENTS = [
    {"pattern": re.compile(_fix_boundaries(p), re.I), "key": k, "ja": ja, "en": en,
     "ja_where": jw, "en_where": ew, "ja_sense": js, "en_sense": es}
    for p, k, ja, en, jw, ew, js, es in _RAW
]


def match(job_id: str) -> dict | None:
    """ジョブ id に当たる部品を返す。当たらなければ None（テンプレート不能）。"""
    for c in COMPONENTS:
        m = c["pattern"].search(job_id)
        if not m:
            continue
        groups = {k: v for k, v in (m.groupdict() or {}).items() if v}
        out = dict(c)
        for field in ("ja", "en", "ja_where", "en_where", "ja_sense", "en_sense"):
            try:
                out[field] = c[field].format(**groups)
            except (KeyError, IndexError):
                pass
        return out
    return None
