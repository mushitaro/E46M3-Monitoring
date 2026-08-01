#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SMG II (E46 M3 変速機) の手書き説明。

このモジュールだけは ECU が語彙を持っている——手順ごとの進行状況コードと結果
コード（変速機の完全適応で 21 と 38）、および前提条件が
`smg2-workflows.json` に入っている。ここで書くのは、その語彙が答えない
「押す前に知っておくこと」の側である。
"""
from __future__ import annotations

SMG2: dict[str, dict[str, tuple[str, str]]] = {
    "FS_LOESCHEN": {
        "does": ("変速機 ECU が記録している故障コードをすべて消します。",
                 "Erases every fault code the gearbox ECU has stored."),
        "observe": ("車では何も起きません。SMG の警告表示が出ていた場合、原因が直っていれば消えます。",
                    "Nothing happens on the car. An SMG warning clears if the cause is actually fixed."),
        "pass": ("消去後に読み直して空、走行後にも空なら直っています。",
                 "Read back empty, drive, read again still empty: it is fixed."),
        "fail": ("すぐ戻るコードは現在も出続けている故障です。油圧・クラッチ・センサのどれかを実際に直す必要があります。",
                 "A code that returns is still being set. Something in the hydraulics, clutch or sensors actually needs fixing."),
        "after": ("履歴が失われます。消す前に控えてください。",
                  "The history is gone. Note it before erasing."),
    },
    "ADAPTIONSWERTE_LOESCHEN": {
        "does": ("クラッチと変速機の学習値を消します。SGBD のコメントが結果を明言しています——**クラッチ値は既定値に戻り、変速機データはゼロになります。**",
                 "Clears the clutch and gearbox adaptations. The SGBD states the outcome outright: **clutch values return to defaults and the gearbox data is zeroed.**"),
        "observe": ("車では何も起きません。次に走らせたときに変速とクラッチの感触が変わります。",
                    "Nothing happens on the car. Shifting and clutch feel change the next time you drive."),
        "pass": ("消去後に適応手順（クラッチ食いつき点・変速機の完全適応）を実施し、変速がスムーズに戻れば一連の作業として成功です。",
                 "Success for the whole job is: clear, then run the adaptations - clutch bite point, complete gearbox adaptation - and shifting comes back smooth."),
        "fail": ("適応をやり直しても変速が改善しない場合、学習のずれではなく機械側です。クラッチの摩耗、油圧の低下、アクチュエータの不良を疑ってください。",
                 "If re-adapting does not improve shifting, the problem is mechanical, not a stale adaptation. Suspect clutch wear, low hydraulic pressure, or a failing actuator."),
        "after": ("**消しただけでは走れる状態になりません。** 適応手順を実施するまで、変速がぎくしゃくしたり発進しにくくなったりします。消す前に適応値を読んで控えてください。",
                  "**Clearing alone does not leave the car driveable.** Until the adaptations are run, expect jerky shifts and awkward pull-away. Read and note the values before clearing."),
        "caution": ("適応手順を最後まで実施できる時間・場所・バッテリ電圧を確保してから消してください。途中で止まると走行できなくなる可能性があります。",
                    "Only clear when you have the time, the place and the battery voltage to complete the adaptations. Stopping half-way can leave the car undriveable."),
    },
    "TESTPRG_STARTEN": {
        "does": ("番号で選んだ試験プログラムを変速機 ECU に自走させます。エア抜き・クラッチ学習・ギア学習など、手順ごとに内容が違います。",
                 "Runs the numbered test program on the gearbox ECU. What it does - bleeding, clutch learning, gear learning - depends entirely on which number."),
        "observe": ("クラッチとシフトが自動で動きます。作動音が続きます。手順によっては16分かかります。",
                    "The clutch and shift move by themselves, audibly. Some of these run for sixteen minutes."),
        "pass": ("結果コードが「異常なし」で終われば成功です。何を意味するかは手順ごとの結果コード表に全件あります。",
                 "Success is a result code meaning no fault. Every code and its meaning is in the per-procedure table."),
        "fail": ("結果コードが原因を直接指しています。中断で終わった場合は、前提条件（イグニッション・エンジン状態・バッテリ電圧・変速機油温）を満たしてやり直してください。",
                 "The result code names the cause directly. If it aborted, meet the preconditions - ignition, engine state, battery voltage, gearbox oil temperature - and run it again."),
        "after": ("**学習値が書き換わります。中断すると中途半端な状態が残ることがあります。** 開始したら完走させてください。バッテリ電圧が落ちると途中で止まるので、充電器の接続を推奨します。",
                  "**Learned values are rewritten, and aborting can leave a half-finished state.** Once started, let it finish. A sagging battery stops it part-way, so a charger is recommended."),
        "caution": ("SGBD は前段に `TESTPRG_STOP` を送ることを要求しています。また ECU のタイムアウトは10秒なので、実行中は通信を維持し続ける必要があります。",
                    "The SGBD requires TESTPRG_STOP to be sent first. The ECU's timeout is ten seconds, so the link must be kept alive throughout."),
    },
    "INITIALISIERUNG": {
        "does": ("変速機 ECU を初期状態へ戻します。",
                 "Returns the gearbox ECU towards its initial state."),
        "observe": ("車では何も起きません。",
                    "Nothing happens on the car."),
        "pass": ("初期化後に適応手順を実施し、変速が正常になれば一連の作業として成功です。",
                 "Success for the whole job is: initialise, run the adaptations, and shifting works."),
        "fail": ("適応が通らない場合は機械側の問題です。油圧とクラッチの状態を先に確認してください。",
                 "If the adaptations will not complete, the problem is mechanical. Check hydraulics and clutch condition first."),
        "after": ("**初期化だけでは走れません。** クラッチ・変速機の適応手順が必要です。",
                  "**Initialising alone does not leave the car driveable.** The clutch and gearbox adaptations must follow."),
        "caution": ("適応手順まで一続きで実施できる状況を用意してから始めてください。",
                    "Start only when you can carry on through the adaptations."),
    },
    "SG_RESET": {
        "does": ("変速機 ECU をソフトウェアリセットします。",
                 "Software-resets the gearbox ECU."),
        "observe": ("実行中は通信が切れます。ギアが入っている場合は事前にニュートラルにしてください。",
                    "Communication drops while it resets. Put the gearbox in neutral first if a gear is engaged."),
        "pass": ("リセット後に ECU が立ち上がり、通信が戻れば成功です。",
                 "Success is the ECU coming back up and communication returning."),
        "fail": ("立ち上がらない場合は電源電圧を確認してください。",
                 "If it does not come back, check the supply voltage."),
        "after": ("学習値が保存されない可能性があります。適応の状態を確認してください。",
                  "Adaptations may not survive. Check their state afterwards."),
        "caution": ("車両を停止させ、ニュートラルにしてから実行してください。",
                    "Car stopped and in neutral before you run it."),
    },
    "EDIC_RESET": {
        "does": ("EDIC（診断インタフェース側の設定）をリセットします。",
                 "Resets EDIC - the diagnostic interface settings."),
        "observe": ("車では何も起きません。診断通信が一時的に切れることがあります。",
                    "Nothing happens on the car. The diagnostic link may drop briefly."),
        "pass": ("通信が復帰すれば成功です。", "Success is communication coming back."),
        "fail": ("復帰しない場合はイグニッションを入れ直してください。",
                 "If it does not, cycle the ignition."),
        "after": ("診断通信の設定が初期値に戻ります。走行には影響しません。",
                  "Diagnostic link settings return to default. It does not affect driving."),
    },
    "PRUEFSTEMPEL_LESEN": {
        "does": ("この ECU の検査スタンプを読み出します。", "Reads this ECU's inspection stamps."),
        "observe": ("車では何も起きません。", "Nothing happens on the car."),
        "pass": ("記録が返れば成功です。", "A record coming back is success."),
        "fail": ("読めない場合は通信の問題です。", "Failure to read is a communication problem."),
        "after": ("何も変わりません。", "Nothing changes."),
    },
    "PRUEFSTEMPEL_SCHREIBEN": {
        "does": ("検査スタンプを書き込みます。", "Writes an inspection stamp."),
        "observe": ("車では何も起きません。", "Nothing happens on the car."),
        "pass": ("読み戻して意図した内容なら成功です。", "Success is reading back what you intended."),
        "fail": ("拒否される場合は保護が解除されていません。", "A refusal means the protection is not unlocked."),
        "after": ("**整備履歴の改変にあたります。** 元の内容は復元できません。",
                  "**This alters a service record.** The previous content cannot be restored."),
        "caution": ("車両の来歴に関する情報を変えることになります。",
                    "You are changing information about the car's history."),
    },
    # ---------------------------------------------------- プログラミング系
    **{
        job: {
            "does": (f"`{job}` は ECU のプログラムそのものを扱う操作です。**このアプリからは実行しません。**",
                     f"`{job}` operates on the ECU's own program. **This app does not run it.**"),
            "observe": ("このアプリでは実行できないため、何も起きません。",
                        "Nothing happens, because this app will not run it."),
            "pass": ("該当しません。", "Not applicable."),
            "fail": ("該当しません。", "Not applicable."),
            "after": ("フラッシュ書換に失敗した ECU は起動しなくなり、復旧にはベンチでの書き戻しか交換が要ります。WinKFP など専用ツールの領域です。",
                      "An ECU whose flash write failed will not boot; recovery means writing it back on a bench, or replacing it. This is WinKFP territory."),
        }
        for job in ("FLASH_LESEN", "FLASH_LOESCHEN", "FLASH_SCHREIBEN", "FLASH_SCHREIBEN_ENDE",
                    "SPEICHER_SCHREIBEN", "AIF_SCHREIBEN", "ZIF_BACKUP")
    },
    **{
        job: {
            "does": (f"`{job}` は診断リンク自身の通信速度を変更します。**このアプリからは実行しません。**",
                     f"`{job}` changes the speed of the diagnostic link itself. **This app does not run it.**"),
            "observe": ("このアプリでは実行できないため、何も起きません。",
                        "Nothing happens, because this app will not run it."),
            "pass": ("該当しません。", "Not applicable."),
            "fail": ("該当しません。", "Not applicable."),
            "after": ("**このコマンドを運んでいる通信そのものの速度が変わるため、送った瞬間にセッションが壊れます。** ECU 側が新しい速度で待ち、こちらが古い速度で喋る状態になり、イグニッションを入れ直すまで復旧しません。",
                      "**It changes the speed of the very link carrying the command, so the session breaks the moment it is sent.** The ECU listens at the new rate while the tool talks at the old one, and nothing recovers until the ignition is cycled."),
        }
        for job in ("BAUDRATEN_UMSTELLUNG", "SET_EDIC_BAUDRATE")
    },
}
