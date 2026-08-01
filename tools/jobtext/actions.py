#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""動作辞書 — 「その部品に対して何をするか」の5スロット。

部品辞書（components.py）が **何を** を答え、こちらが **どうする** を答える。
掛け合わせて 323 件分の説明を作る。

## 5スロットの意味

    does     このジョブを実行すると何が送られ、ECU が何をするか
    observe  実行中に人間が観測できること（音・動き・灯・何も無い、を明示する）
    pass     どうなれば「問題なし」と言えるか
    fail     そうならなかったとき何を意味し、次に何を見るか
    after    終わったあと車がどういう状態で残るか

`{c}` に部品名、`{where}` に部品の所在説明が入る。

## `observe` に「何も起きません」を書く理由

読取ジョブで一番多い誤解は「押したのに何も起きない＝壊れている」である。
体感できることが無いなら、無いと書くのが説明であって、省略は説明ではない。
"""
from __future__ import annotations

# action key -> {slot: (ja, en)}
ACTIONS: dict[str, dict[str, tuple[str, str]]] = {
    # ---------------------------------------------------------------- 読取
    "read": {
        "does": ("{c}の現在値を ECU に問い合わせて表示します。書き込みは一切しません。",
                 "Asks the ECU for the current value of the {c} and shows it. Nothing is written."),
        "observe": ("車では何も起きません。エンジンの動きも音も変わりません。",
                    "Nothing happens on the car. The engine neither moves nor sounds different."),
        "pass": ("値が返ってくれば読取は成功です。値そのものの良し悪しは、範囲が公表されている項目のみ判定できます。",
                 "If a value comes back, the read succeeded. Whether the value itself is good can only be judged where a range is published."),
        "fail": ("応答が無い場合は通信の問題で、この項目の故障ではありません。ケーブルとイグニッションを確認してください。",
                 "No response means a communication problem, not a fault in this item. Check the cable and the ignition."),
        "after": ("何も変わりません。何度実行しても安全です。",
                  "Nothing changes. It is safe to repeat as often as you like."),
    },
    # ------------------------------------------------------------ 単発作動
    "pulse": {
        "does": ("{c}を短時間だけ作動させます。{where}",
                 "Briefly drives the {c}. {where}"),
        "observe": ("作動音やわずかな振動が確認できることがあります。部品によっては体感できません。",
                    "You may hear it click or feel a slight vibration. Some parts give nothing you can sense."),
        "pass": ("指示どおり動けば、その部品と配線と ECU の駆動段は生きています。",
                 "If it moves as commanded, the part, its wiring and the ECU's driver stage are all alive."),
        "fail": ("動かない場合は、部品そのもの・配線・ヒューズ・ECU の駆動段のいずれかです。単体で電源を当てて切り分けてください。",
                 "If nothing moves, it is the part, its wiring, a fuse, or the ECU's driver stage. Bench-power the part to narrow it down."),
        "after": ("ECU が自動で元に戻します。操作は残りません。",
                  "The ECU returns it by itself. Nothing is left running."),
    },
    # ------------------------------------------------------------ 保持駆動
    "hold": {
        "does": ("{c}を作動させ、停止するまでその状態を保ちます。{where}",
                 "Drives the {c} and HOLDS it there until you stop it. {where}"),
        "observe": ("作動している間ずっと動き続けます。連続通電になるので、発熱する部品では時間に注意してください。",
                    "It keeps running the whole time. It is continuously energised, so watch the clock on anything that heats up."),
        "pass": ("指示した状態を保ち、停止操作で確実に戻れば正常です。",
                 "Normal is: it holds the commanded state, and the stop control reliably returns it."),
        "fail": ("保持できずに落ちる場合は電源容量か配線、戻らない場合は固着を疑ってください。",
                 "Dropping out points to supply or wiring; failing to return points to something stuck."),
        "after": ("**停止するまで通電したままです。** 通信が切れた場合は ECU 側のタイムアウトで解除されます。",
                  "**It stays energised until stopped.** If the link drops, the ECU's own timeout releases it."),
    },
    # ---------------------------------------------------------- 対ジョブ型
    "paired": {
        "does": ("{c}の作動を開始します。停止は別のジョブで行います。{where}",
                 "Starts the {c}. Stopping it is a separate job. {where}"),
        "observe": ("開始すると作動し続けます。対になる停止ジョブを送るまで止まりません。",
                    "It runs from the moment you start it and does not stop until you send the paired stop job."),
        "pass": ("開始で作動し、対の停止ジョブで確実に止まれば正常です。",
                 "Normal is: it runs on start and reliably stops on the paired job."),
        "fail": ("停止ジョブで止まらない場合は、イグニッションを切って解除してください。",
                 "If the stop job does not stop it, cycle the ignition to release it."),
        "after": ("**対の停止ジョブを送るまで作動し続けます。**",
                  "**It keeps running until the paired stop job is sent.**"),
    },
    # ---------------------------------------------------------------- 測定
    "measurement": {
        "does": ("{c}の測定を開始します。開始したあとは ECU が最後まで実行します。{where}",
                 "Starts a measurement of the {c}. Once started the ECU runs it to completion. {where}"),
        "observe": ("測定中はエンジンの音や回転が変わることがあります。ECU が意図的に条件を作るためです。",
                    "The engine may change note or speed while it runs; the ECU is deliberately creating the conditions it needs."),
        "pass": ("測定が完了し、結果がライブ値に現れれば成功です。",
                 "Success is: it completes and the result appears in the live values."),
        "fail": ("完了しない場合は、測定の前提条件（温度・回転数・負荷）が満たされていない可能性が高いです。",
                 "Not completing usually means the measurement's preconditions - temperature, engine speed, load - were not met."),
        "after": ("測定値が更新されます。制御そのものは変わりません。",
                  "The measured value is updated. The control itself is unchanged."),
    },
    # -------------------------------------------------------------- ラッチ
    "latching": {
        "does": ("{c}を作動させ、**そのまま保持します**。{where}",
                 "Actuates the {c} and **latches it there**. {where}"),
        "observe": ("作動したまま戻りません。",
                    "It actuates and does not come back."),
        "pass": ("作動すること自体は確認できますが、このアプリからは解除できません。",
                 "You can confirm it actuates, but nothing here can release it."),
        "fail": ("作動しない場合は電磁弁か配線です。",
                 "Failure to actuate points to the solenoid or its wiring."),
        "after": ("**SGBD に解除ジョブが存在しません。** 復帰はイグニッションを切ることであって、コマンドではありません。",
                  "**The SGBD exposes no release job.** Recovery is an ignition cycle, not a command."),
    },
    # ---------------------------------------------------------------- 複合
    "compound": {
        "does": ("{c}に対して、SGBD ジョブ自身が複数の出力を順に駆動します。単一の操作ではありません。{where}",
                 "The SGBD job itself drives several outputs in sequence against the {c}. This is not a single action. {where}"),
        "observe": ("一連の動作音が続きます。途中で止めることはできません。",
                    "A sequence of sounds follows. It cannot be interrupted part-way."),
        "pass": ("一連の動作が最後まで進めば正常です。",
                 "Normal is: the whole sequence runs through."),
        "fail": ("途中で止まる場合は、その段の部品か油圧経路を疑ってください。",
                 "Stopping part-way points at the component or hydraulic path for that step."),
        "after": ("ジョブ自身が元に戻す設計ですが、油圧系では圧力が残ることがあります。",
                  "The job is designed to reset itself, but on hydraulic systems pressure can remain."),
    },
    # ------------------------------------------------ 自動プログラム(SMG II)
    "procedure": {
        "does": ("変速機 ECU が複数ステップの試験プログラムを自走させます。進行状況と結果をコードで報告してきます。",
                 "The gearbox ECU runs a multi-step program by itself, reporting progress and a result as codes."),
        "observe": ("クラッチやシフトが自動で動きます。作動音が続きます。手順によっては十数分かかります。",
                    "The clutch and shift move on their own, audibly. Some of these run for over a quarter of an hour."),
        "pass": ("結果コードが「異常なし」で終われば成功です。コード表は下に全件あります。",
                 "Success is a result code meaning no fault. The full code table is below."),
        "fail": ("結果コードがそのまま原因を指しています。中断した場合は前提条件を満たしてやり直してください。",
                 "The result code names the cause directly. If it aborted, meet the preconditions and run it again."),
        "after": ("学習値が書き換わります。途中で中断すると中途半端な状態が残ることがあるので、必ず完走させてください。",
                  "Learned values are rewritten. Aborting can leave a half-finished state, so let it run to the end."),
    },
    # ---------------------------------------------------------------- 書込
    "write": {
        "does": ("{c}を書き換えます。イグニッションを切っても残ります。{where}",
                 "Rewrites the {c}. The change survives an ignition cycle. {where}"),
        "observe": ("車では何も起きません。変化は次に走ったときに現れます。",
                    "Nothing happens on the car. The change shows up the next time you drive."),
        "pass": ("書込が受理されれば成功です。効果は走行で確認することになります。",
                 "Acceptance of the write is the success criterion. The effect is confirmed by driving."),
        "fail": ("拒否された場合は、前提条件（電圧・エンジン停止・保護解除）のいずれかが満たされていません。",
                 "A refusal means one of the preconditions - voltage, engine stopped, protection unlocked - was not met."),
        "after": ("**元の値をこのアプリは読み戻せないため、取り消しはできません。** 学習値を消した場合は、走行で学習し直すまで挙動が変わります。",
                  "**Nothing here can read the previous value back, so there is no undo.** If learned values were cleared, the car behaves differently until it re-learns."),
    },
    # ------------------------------------ 開始 → 別ジョブで結果（SYSTEMCHECK）
    "deferred": {
        "does": ("{c}の検査を開始します。**結果はこのジョブでは返りません。** 別の読取ジョブで受け取ります。{where}",
                 "Starts a test of the {c}. **The result does not come back from this job** - a separate read job delivers it. {where}"),
        "observe": ("検査中はポンプや弁の作動音がすることがあります。時間がかかるものもあります。",
                    "You may hear a pump or valve working. Some of these take a while."),
        "pass": ("検査が受理されて開始すれば、この操作としては成功です。合否は結果読取ジョブで判定します。",
                 "If the test is accepted and starts, this step succeeded. Pass or fail comes from the result-read job."),
        "fail": ("開始が拒否される場合は、温度や回転数などの検査条件が満たされていません。",
                 "A refusal to start means the test conditions - temperature, engine speed - are not met."),
        "after": ("検査が走り続けます。**結果読取ジョブを実行するまで完了しません。**",
                  "The test keeps running. **It is not finished until you run the result-read job.**"),
    },
    # ---------------------------------------------- プログラミング（実行不可）
    "programming": {
        "does": ("{c}を書き換えるプログラミング操作です。**このアプリからは実行しません。**",
                 "A programming operation that rewrites the {c}. **This app does not run it.**"),
        "observe": ("このアプリでは実行できないため、何も起きません。",
                    "Nothing happens, because this app will not run it."),
        "pass": ("該当しません。",
                 "Not applicable."),
        "fail": ("該当しません。",
                 "Not applicable."),
        "after": ("この種の操作は WinKFP など専用のプログラミングツールの領域です。失敗すると ECU が起動しなくなり、復旧には別の手段が要ります。",
                  "This is WinKFP territory. A failure here can leave the ECU unable to start, and recovering it needs different tooling."),
    },
    # ------------------------------------------------------ プロトコル部品
    "protocol": {
        "does": ("他のジョブの手順の一部です。単体で実行するものではありません。",
                 "A step inside other jobs' procedures. Not something you run on its own."),
        "observe": ("車では何も起きません。",
                    "Nothing happens on the car."),
        "pass": ("該当しません。",
                 "Not applicable."),
        "fail": ("該当しません。",
                 "Not applicable."),
        "after": ("診断セッションの状態が変わるだけです。",
                  "Only the state of the diagnostic session changes."),
    },
}


def for_kind(kind: str, job_class: str) -> dict[str, tuple[str, str]] | None:
    """操作種別とクラスから動作テンプレートを選ぶ。

    クラスが先。`programming` と `protocol` は「何をする種類か」が
    「どう動くか」より重要で、実行制御を出さない根拠にもなる。
    """
    if job_class == "programming":
        return ACTIONS["programming"]
    if job_class == "protocol":
        return ACTIONS["protocol"]
    return ACTIONS.get(kind)
