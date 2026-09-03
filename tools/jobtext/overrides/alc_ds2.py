#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Adaptive light control ALC の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


ALC_DS2: dict[str, tuple[str, str]] = {
    'STEUERGERAETE_RESET_ALC': (
        'ALC 制御ユニットが再起動します。数秒間、通信と機能が途切れます。',
        'The ALC controller reboots. Communication and function drop for a few seconds.',
    ),
    'STEUERN_BETR_H_ALC_LOESCHEN': (
        'ALC 制御ユニットの稼働時間カウンタを消します。元には戻せません。',
        "Clears the ALC controller's operating-hour counter. It cannot be restored.",
    ),
    'STEUERN_BETR_H_SMC_LOESCHEN': (
        'SMC（SMC_L / SMC_R）の稼働時間カウンタを消します。元には戻せません。',
        'Clears the operating-hour counter of the SMC (SMC_L / SMC_R). It cannot be restored.',
    ),
    'STEUERN_POSITION_SMC': (
        'ヘッドライトの旋回角（POS_KURVENLICHT）と光軸（POS_LWR）を指定位置へ動かします。SMC は SMC_L / SMC_R。SGBD は復帰手順を説明していません——DIAGNOSE_ENDE を送り、戻らなければイグニッションを切ってください。',
        'Moves the headlight swivel (POS_KURVENLICHT) and levelling (POS_LWR) to the given positions. SMC is SMC_L / SMC_R. The SGBD does not say how normal control returns — send DIAGNOSE_ENDE, and cycle the ignition if it does not.',
    ),
    'STEUERN_REFERENZLAUF_SMC': (
        'ヘッドライト内のステッピングモータが基準走行で端まで動きます。SMC は SMC_L / SMC_R（ALC_SG は制御ユニット自身）、REFERENZLAUF は REF_ALC_MIT / REF_ALC_OHNE / REF_LWR。',
        'The stepper inside the headlight runs to its end stop for a reference run. SMC is SMC_L / SMC_R (ALC_SG is the controller itself); REFERENZLAUF is REF_ALC_MIT / REF_ALC_OHNE / REF_LWR.',
    ),
    'STEUERN_SCHRITTVERLUSTE_SMC_LOESCHEN': (
        'SMC の脱調カウンタを消します。元には戻せません。',
        "Clears the SMC's lost-step counter. It cannot be restored.",
    ),
    'STEUERN_TEMPERATURVERTEILUNG_SMC_LOESCHEN': (
        'SMC の温度分布統計を消します。元には戻せません。',
        "Clears the SMC's temperature-distribution statistics. They cannot be restored.",
    ),
    'STEUERN_VERTEILUNG_WINKEL_ANSTEUERUNG_SMC_LOESCHEN': (
        'SMC の角度分布統計を消します。元には戻せません。',
        "Clears the SMC's angle-distribution statistics. They cannot be restored.",
    ),
}
