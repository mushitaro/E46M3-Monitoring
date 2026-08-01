#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""押す前に知っておくこと。ジョブの族ごとに1本。

## なぜ正規表現の表なのか

`STEUERN_EV1` から `STEUERN_EV8` までの8本の噴射弁は、**同じ危険を共有している**
——エンジン稼働中に開けば生ガスが筒内に入る。8回同じ文を書くのは冗長なだけでなく、
8箇所のうち1箇所だけ直す事故を招く。族に1本、が正しい粒度である。

個体差がある場合だけ `overrides/` の完全一致が上に被さる。

## 何を書き、何を書かないか

書くのは「**押す前に**知らないと困ること」だけ。何が起きるか・どうなれば正常か・
何を疑うかは、手順リスト・結果一覧・記録された値が答える——文章より正確に。
以前ここには5スロット×1315件の定型文があり、それは操作画面に見出しを5つ並べて
ほぼ同じ文を出すという結果になっていた。

先頭から順に照合し、最初に当たったものを採る。**長い正規表現ほど先に置く**。
"""
from __future__ import annotations

import re

# (pattern, ja, en)
_RAW: list[tuple[str, str, str]] = [
    # --- 燃料・点火。エンジンが回っているかどうかで意味が変わる ------------
    (r"^STEUERN_EV\d",
     "エンジン稼働中に開くと、燃焼していない生ガスが筒内と排気系に入ります。触媒を傷めます。"
     "**必ずエンジンを止めてから**実行してください。燃圧が残っているので、配管を外した状態では行わないこと。",
     "Opening this with the engine running puts unburnt fuel into the cylinder and the exhaust, which damages "
     "the catalyst. **Stop the engine first.** Fuel pressure remains in the rail, so never do this with a line "
     "disconnected."),
    (r"^STEUERN_ZS\d",
     "点火コイルに高電圧を発生させます。**プラグコード・コイル本体に触れないでください。**"
     "筒内に燃料が残っている状態で火花を飛ばすと点火する可能性があります。エンジンを止めて実行してください。",
     "This fires the ignition coil at high voltage. **Do not touch the coil or its lead.** If there is fuel in "
     "the cylinder, a spark can ignite it. Stop the engine first."),
    (r"^STEUERN_EKP",
     "燃料ポンプを回します。燃料系の配管が外れていると燃料が噴き出します。"
     "作業前に配管の接続を確認し、火気・スパークの無い場所で行ってください。",
     "This runs the fuel pump. If any fuel line is open, fuel will be pumped out of it. Check every connection "
     "first, and keep ignition sources away."),
    (r"^STEUERN_START$",
     "スタータを回します。**ギアが入っていると車両が動きます。**ニュートラルであること、"
     "車両の下や周囲に人がいないことを確認してください。",
     "This cranks the starter. **If a gear is engaged the car will move.** Confirm neutral, and that nobody is "
     "under or beside the vehicle."),

    # --- DSC 油圧。停止手段が SGBD に無い --------------------------------
    (r"^DSC_SIM_",
     "作動させたまま保持します。**SGBD に解除ジョブが存在しません。**"
     "一度作動させると作動したままになり、復帰はイグニッションを切ることであってコマンドではありません。"
     "ブレーキの効きが変わった状態が残るため、走行前に必ずイグニッションサイクルを行ってください。",
     "This actuates and holds. **The SGBD exposes no release job.** Once actuated it stays actuated, and "
     "recovery is an ignition cycle, not a command. Braking behaviour is altered until then — always cycle the "
     "ignition before driving."),
    (r"^(DRUCKAUFBAU|DRUCKABBAU|DRUCKHALTEN|PUMPENFOERDERLEISTUNG|NA_ENTLUEFTUNG|ENTLUEFTUNG_SERVICE|ABS_REGELSIMULATION)",
     "ブレーキ油圧ユニットのポンプと電磁弁を駆動します。**DSC の SGBD には停止手段の記述が一切ありません**"
     "——停止ジョブも、タイムアウトも、最大駆動時間も書かれていません。実行中はブレーキの効きが変わります。"
     "車両を確実に停止させ、輪止めをしてから実行してください。",
     "This drives the brake hydraulic pump and solenoids. **The DSC SGBD states no way to stop it** — no stop "
     "job, no timeout, no maximum duration. Braking behaviour changes while it runs. Chock the wheels and make "
     "sure the car cannot move."),
    (r"^STEUERN_DIGITAL$",
     "8個の電磁弁とポンプをビット単位で直接駆動します。**名前の付いた油圧ジョブより強力です**"
     "——それらが駆動するビットの上位集合を、任意の組合せで叩けます。組合せによってはブレーキが"
     "解放されないままになります。車両を確実に停止させてください。",
     "This drives the eight solenoids and the pump bit by bit. **It is more powerful than the named hydraulic "
     "jobs** — it can set any combination of the bits they use, including combinations that leave a brake "
     "applied. Make sure the car cannot move."),

    # --- 任意ピン駆動 ------------------------------------------------------
    (r"^IO_STATUS_VORGEBEN$",
     "任意の出力ピンを、指定したデューティ比・周期で強制駆動します。**SGBD 側にピンの制約がありません。**"
     "無害なピンと、駆動すると部品を壊すピンを、このアプリでは区別できません。ピン番号を確信を持って"
     "言えない場合は実行しないでください。",
     "This forces an arbitrary output pin at a given duty cycle and period. **Nothing in the SGBD constrains "
     "which pin**, so nothing here can tell a harmless one from a damaging one. Do not run it unless you know "
     "exactly which pin you are driving."),

    # --- 書換系。このアプリからは実行しない --------------------------------
    (r"^(FLASH|SPEICHER_SCHREIBEN|AIF_SCHREIBEN|ZIF_BACKUP)",
     "ECU のプログラム領域そのものを扱います。**このアプリからは実行しません。**"
     "書込に失敗した ECU は起動しなくなり、復旧はベンチでの書き戻しか交換です。WinKFP の領域です。",
     "This operates on the ECU's own program area. **This app does not run it.** An ECU whose write fails will "
     "not boot; recovery means writing it back on a bench, or replacing it. WinKFP territory."),
    (r"^(BAUDRATEN_UMSTELLUNG|SET_EDIC_BAUDRATE)$",
     "**このコマンドを運んでいる通信そのものの速度を変えます。**送った瞬間に ECU が新しい速度で待ち、"
     "こちらが古い速度で喋る状態になり、イグニッションを入れ直すまで復旧しません。",
     "**It changes the speed of the very link carrying the command.** The moment it is sent, the ECU listens at "
     "the new rate while the tool talks at the old one, and nothing recovers until the ignition is cycled."),
    (r"^(PRUEFSTEMPEL_SCHREIBEN|ID_SCHREIBEN)$",
     "検査スタンプ——車両の来歴に関する記録を書き換えます。**元の内容は復元できません。**"
     "書く前に必ず読み出して控えてください。",
     "This rewrites the inspection stamp, a record of the car's history. **The previous content cannot be "
     "restored.** Read it out and note it before writing."),

    # --- イモビライザ ------------------------------------------------------
    (r"^EWS3_(INITIALISIEREN|SYNC)$",
     "イモビライザ（EWS3）と DME の同期を書き換えます。**失敗するとエンジンが始動しなくなります。**"
     "バッテリ電圧が十分で、途中で中断されない状況を作ってから実行してください。",
     "This rewrites the immobiliser (EWS3) sync with the DME. **A failure can leave the car unable to start.** "
     "Only run it with good battery voltage and no chance of interruption."),

    # --- SMG II アクチュエータ。ここが 100bar / 60秒 の本当の出典 -----------
    (r"^STEUERN_STELLGLIED$",
     "SGBD の逐語: **「Hydropumpe schaltet nicht automatisch ab!」——油圧ポンプは自動停止しません。**"
     "「100 bar で過圧弁が開き、繰り返し吹かせるとポンプが劣化する」「診断を維持した場合、ポンプは最大60秒"
     "駆動される」とも述べています。停止は `INAKTIV` です。ECU のタイムアウトは10秒なので、"
     "実行中は通信を維持し続ける必要があります。先に `ANSTEUERUNG_VORBEREITEN` を送ってください。",
     "The SGBD, verbatim: **`Hydropumpe schaltet nicht automatisch ab!` — the hydraulic pump does not switch "
     "off by itself.** It also states that the relief valve opens at 100 bar and that repeatedly blowing off "
     "degrades the pump, and that with diagnostics held alive the pump runs for at most 60 s. `INAKTIV` is "
     "what switches it off. The ECU timeout is 10 s, so the link must be kept alive throughout, and "
     "`ANSTEUERUNG_VORBEREITEN` must be sent first."),

    # --- 故障メモリ --------------------------------------------------------
    (r"^FS_SELEKTIV_LOESCHEN$",
     "選んだ故障だけを消します。**消した記録は戻せません。**"
     "残した故障との前後関係が読めなくなるため、消す前に全件を読み出して控えてください。",
     "This erases only the faults you select. **What you erase cannot be recovered**, and the timing "
     "relationship with the faults you keep is lost with it. Read out and note the whole memory first."),
    (r"^FS_INIT$",
     "故障メモリを NVRAM ごと初期化します。`FS_LOESCHEN` より強く、記録が完全に消えます。"
     "消す前に必ず読み出して控えてください。",
     "This initialises the fault memory in NVRAM — stronger than FS_LOESCHEN, and the record is gone entirely. "
     "Read and note it first."),
    (r"^FS_LOESCHEN$",
     "故障の履歴が失われます。消す前に控えてください。原因が直っていなければ、走行後にまた記録されます。",
     "The fault history is lost. Note it before erasing. If the cause is not fixed, it will be recorded again "
     "after a drive."),

    # --- 較正・学習値の書換 -------------------------------------------------
    (r"^(ADAPT|ADAPTIONSWERTE_LOESCHEN)",
     "学習値を消去します。**消しただけでは走れる状態になりません。**適応手順をやり直すまで、"
     "変速や制御がぎくしゃくします。適応を最後まで実施できる時間・場所・バッテリ電圧を確保してから"
     "実行してください。消す前に現在値を読んで控えること。",
     "This clears learned values. **Clearing alone does not leave the car driveable** — until the adaptations "
     "are re-run, expect rough shifting or control. Only do it when you have the time, the place and the "
     "battery voltage to finish. Read and note the current values first."),
    (r"^(ABGLEICH|DRUCKSENSOR_DSC_ABGLEICHEN|QUERBESCHLEUNIGUNGSSENSOR_DSC_ABGLEICHEN|LENKWINKELSENSOR)",
     "センサのゼロ点を、**いま置かれている姿勢を基準として**書き込みます。"
     "傾いた場所や、ステアリングが直進でない状態で実行すると、その誤差がそのまま基準になります。"
     "平坦な場所で車両を完全に静止させ、ステアリングを直進にしてから実行してください。",
     "This writes the sensor zero **relative to the attitude the car is in right now**. Run it on a slope, or "
     "with the steering off-centre, and that error becomes the reference. Level ground, car fully stationary, "
     "wheels straight."),
    (r"^TRIG_SCHREIBEN$",
     "車輪速センサのトリガ閾値を書き換えます。**ABS/DSC が車輪速をどう読むかが変わります。**"
     "適正でない値を書くと、制御が効かない、あるいは不要に介入する状態になります。",
     "This rewrites the wheel-speed sensor trigger thresholds — **it changes how ABS and DSC read wheel "
     "speed.** A wrong value means the control either does not intervene when it should, or does when it "
     "should not."),
    (r"^(SG_RESET|EDIC_RESET|DDS_RESET|INITIALISIER)",
     "ECU の状態を初期化します。学習値が失われる場合があります。実行後に適応の状態を確認し、"
     "必要なら適応手順を実施してください。",
     "This resets the ECU's state; learned values may not survive. Check the adaptations afterwards and re-run "
     "them if needed."),
    (r"^CODIERDATEN_SCHREIBEN$",
     "車両の装備構成（コーディング）を書き換えます。他の ECU との整合が崩れると、警告灯や機能停止に"
     "つながります。**書く前に必ず現在のコーディングを読み出して控えてください。**",
     "This rewrites the vehicle coding. Out of step with the other modules, that means warning lights or lost "
     "functions. **Read out and keep the current coding before writing.**"),
    (r"^CO_EINZELABGLEICH_PROGRAMMIEREN$",
     "RAM 上の値を EEPROM へ確定書込します。**ここまでは書き戻せましたが、この操作以降は戻せません。**",
     "This commits the RAM value into EEPROM. **Everything up to here could be written back; from here it "
     "cannot.**"),
    (r"^DDS_EOL_PASSIV$",
     "タイヤ空気圧警報の製造ライン用状態を書き込みます。SGBD にコメントが無く、何が起きるか記述が"
     "ありません。通常の整備で使うものではありません。",
     "This writes a factory end-of-line state for the tyre-pressure system. The SGBD carries no comment for it "
     "at all, so what it does is not stated. It is not a normal service operation."),
    (r"^HERSTELLER_SELBSTTEST$",
     "メーカー固有の自己診断ルーチンを呼び出します。**SGBD は何が動くかを述べていません。**"
     "何が駆動されるか分からない状態で実行することになります。",
     "This calls a manufacturer-specific self-test. **The SGBD does not say what it runs**, so you are firing "
     "something whose effects are not stated."),
]

_COMPILED = [(re.compile(p, re.I), ja, en) for p, ja, en in _RAW]


def caution_for(job_id: str) -> tuple[str, str] | None:
    """族の注意文。無ければ None。"""
    for rx, ja, en in _COMPILED:
        if rx.search(job_id):
            return ja, en
    return None
