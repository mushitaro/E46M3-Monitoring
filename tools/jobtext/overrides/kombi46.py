#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Instrument cluster KOMBI の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations

from ._shared import _SIA_EN, _SIA_JA

KOMBI46: dict[str, tuple[str, str]] = {
    'KALIBRIERFAKTOR_VERBRAUCH_SCHREIBEN': (
        'オンボードコンピュータの燃費表示の較正係数（0〜1000）を書きます。先に KALIBRIERFAKTOR_VERBRAUCH_LESEN で現在値を控えてください。',
        "Writes the on-board computer's consumption calibration factor (0-1000). Read the current value with KALIBRIERFAKTOR_VERBRAUCH_LESEN first and note it.",
    ),
    'SIA_KORREKTUR_SCHREIBEN': (
        'SIA の表示種別を「インスペクション」⇔「オイルサービス」でトグルします。押すたびに切り替わるので、実行前に現在の表示を確認してください。',
        'Toggles the SIA display between Inspection and Oil service. Every press flips it, so check what is shown now before running it.',
    ),
    'SIA_RESET': (
        _SIA_JA,
        _SIA_EN,
    ),
    'SOFTWARE_RESET': (
        'メーターパネルが再起動します。針が落ち、表示が数秒消えます。走行中には絶対に実行しないでください。',
        'The instrument cluster reboots: needles drop and the display goes dark for a few seconds. Never run this while driving.',
    ),
    'STEUERN_ANZEIGE': (
        'ORT は TACHO / DREHZAHL / TANKINHALT / KUEHLMITTELTEMPERATUR / VERBRAUCH、WERT は針の角度 10〜90 度。SGBD の指示: 90 度を超える跳びで針を打ちつけないこと。',
        'ORT is TACHO / DREHZAHL / TANKINHALT / KUEHLMITTELTEMPERATUR / VERBRAUCH; WERT is the needle angle, 10-90 degrees. The SGBD says: do not slam the movements with jumps of more than 90 degrees.',
    ),
    'STEUERN_IO': (
        'PORT6 のビットで警告灯を点けます（Bit0 右ウインカー, Bit1 左ウインカー, Bit2 ハイビーム, Bit3 リアフォグ）。メーター内の表示灯だけです。',
        'Lights tell-tales via the PORT6 bits (bit0 right indicator, bit1 left indicator, bit2 main beam, bit3 rear fog). Cluster tell-tales only.',
    ),
    'STEUERN_TACHO_A': (
        'スピードメータの針を指定速度（3〜250 km/h）に振ります。表示だけで車両は動きません。',
        'Sweeps the speedometer needle to the given speed (3-250 km/h). Display only; the car does not move.',
    ),
    'ZEITINSPEKTIONSDATUM_SCHREIBEN': (
        '時間インスペクションの月（1〜12）・年（0〜99）を EEPROM に書きます。先に ZEITINSPEKTIONSDATUM_LESEN で現在値を控えてください。',
        'Writes the time-inspection month (1-12) and year (0-99) into EEPROM. Read the current value with ZEITINSPEKTIONSDATUM_LESEN first and note it.',
    ),
}
