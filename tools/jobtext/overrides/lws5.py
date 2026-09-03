#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Steering angle sensor LWS5 の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


LWS5: dict[str, tuple[str, str]] = {
    'ABGLEICH_SCHREIBEN': (
        'ABGLEICH_VORGEBEN で渡した較正レコード（LRW オフセット・LWS-ID・VIN）をセンサに書き込みます（SGBD: 「Programmieren der Abgleich-Werte」。ゼロ点の決め方は SGBD に書かれていません）。車両を静止させ、ステアリングを直進にしてから実行してください。書いた値はそのまま DSC の舵角基準になります。',
        "Programs the calibration record handed over by ABGLEICH_VORGEBEN (LRW offset, LWS ID, VIN) into the sensor (SGBD: 'Programmieren der Abgleich-Werte'; it does not describe how the zero is derived). Car stationary, wheels straight. Whatever is written becomes the DSC's steering-angle reference.",
    ),
    'ABGLEICH_VORGEBEN': (
        '較正レコード（LRW オフセット・LWS-ID・VIN）を ECU に予告する第1段です。先に ABGLEICH_LESEN で現在値を読み、LWS-ID と VIN は同じ値をそのまま入れること。確定は ABGLEICH_SCHREIBEN。',
        'Stage one of the calibration: hands the ECU the record (LRW offset, LWS ID, VIN). Read the current values with ABGLEICH_LESEN first and re-enter the LWS ID and VIN unchanged. ABGLEICH_SCHREIBEN commits it.',
    ),
    'STEUERN_DIGITAL': (
        'FUNKTION は B0 / KL87 / U_CAN / U_BAS / B4 / B5 / B6 / TAST（SGBD は各ピンの意味を説明していません）。EIN=1 で入れ、EIN=0 で必ず戻すこと。',
        'FUNKTION is B0 / KL87 / U_CAN / U_BAS / B4 / B5 / B6 / TAST — the SGBD does not say what each pin does. EIN=1 sets it; always release with EIN=0.',
    ),
}
