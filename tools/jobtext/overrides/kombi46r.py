#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Instrument cluster (Redesign) の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


KOMBI46R: dict[str, tuple[str, str]] = {
    'C_ZEIT_RESET': (
        '時間インスペクション間隔をリセットします。整備を実施した後にだけ実行してください。',
        'Resets the time-inspection interval. Only run it after the service has actually been done.',
    ),
    'SIA_KORREKTUR_SCHREIBEN': (
        'SIA の表示種別を「インスペクション」⇔「オイルサービス」でトグルします。押すたびに切り替わるので、実行前に現在の表示を確認してください。',
        'Toggles the SIA display between Inspection and Oil service. Every press flips it, so check what is shown now before running it.',
    ),
    'SIA_RESET': (
        'サービスインターバル表示をリセットします。引数は Oel_Reset / Weg_Reset / Zeit_Reset / Weg_Reset_Werk のいずれか。整備を実施していないのにリセットすると次回時期の根拠が失われます。元には戻せません。',
        'Resets the service-interval display. Argument is one of Oel_Reset / Weg_Reset / Zeit_Reset / Weg_Reset_Werk. Resetting without having done the service loses the basis for the next due date. It cannot be undone.',
    ),
    'SOFTWARE_RESET': (
        'メーターパネルが再起動します。針が落ち、表示が数秒消えます。走行中には絶対に実行しないでください。',
        'The instrument cluster reboots: needles drop and the display goes dark for a few seconds. Never run this while driving.',
    ),
    'STEUERN_ANZEIGE': (
        'ORT は TACHO / DREHZAHL / TANKINHALT / KUEHLMITTELTEMPERATUR / VERBRAUCH、WERT は針の角度 10〜90 度。SGBD の指示: 90 度を超える跳びで針を打ちつけないこと。',
        'ORT is TACHO / DREHZAHL / TANKINHALT / KUEHLMITTELTEMPERATUR / VERBRAUCH; WERT is the needle angle, 10-90 degrees. The SGBD says: do not slam the movements with jumps of more than 90 degrees.',
    ),
    'ZEITINSPEKTIONSDATUM_SCHREIBEN': (
        '時間インスペクションの月（1〜12）・年（0〜99）を EEPROM に書きます。先に ZEITINSPEKTIONSDATUM_LESEN で現在値を控えてください。',
        'Writes the time-inspection month (1-12) and year (0-99) into EEPROM. Read the current value with ZEITINSPEKTIONSDATUM_LESEN first and note it.',
    ),
}
