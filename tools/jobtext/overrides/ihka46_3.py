#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Climate control IHKA (PU03/2003) の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations

from ._shared import _IHKA_EN, _IHKA_JA

IHKA46_3: dict[str, tuple[str, str]] = {
    'STEUERN_AUSSENTEMPERATUR': (
        'IHKA に偽の外気温（-45〜+40 °C）を与えます。IHKA の制御だけに影響します。' + _IHKA_JA,
        "Feeds the IHKA a fake outside temperature (-45 to +40 C). Only the IHKA's control is affected. " + _IHKA_EN,
    ),
    'STEUERN_BELEUCHTUNG': (
        '表示の照明を 0〜100 % にします。' + _IHKA_JA,
        'Sets the display illumination to 0-100 %. ' + _IHKA_EN,
    ),
    'STEUERN_DISPLAY': (
        '表示にテストパターン（1〜4）を出します。SGBD: テストは必ず TEST_MUSTER=0 で消すこと。' + _IHKA_JA,
        'Shows a test pattern (1-4) on the displays. The SGBD says the test must always be switched off again with TEST_MUSTER=0. ' + _IHKA_EN,
    ),
    'STEUERN_DREHZAHL': (
        'IHKA に偽のエンジン回転数（0〜8000 1/min）を与えます。エンジンは動きませんが、IHKA はその値で制御します。' + _IHKA_JA,
        'Feeds the IHKA a fake engine speed (0-8000 1/min). The engine is unaffected, but the IHKA controls on that value. ' + _IHKA_EN,
    ),
    'STEUERN_EICHLAUF': (
        '全ステッピングモータのフラップが端から端まで走る較正走行を起動します。' + _IHKA_JA,
        'Starts the stepper calibration run: every flap travels end to end. ' + _IHKA_EN,
    ),
    'STEUERN_GEBLAESE': (
        'ブロワを 0〜100 % で回します。100 % は大電流なので長時間放置しないこと。' + _IHKA_JA,
        'Runs the blower at 0-100 %. 100 % draws heavy current — do not leave it there. ' + _IHKA_EN,
    ),
    'STEUERN_GESCHWINDIGKEIT': (
        'IHKA に偽の車速（0〜200 km/h）を与えます。IHKA の制御だけに影響します。' + _IHKA_JA,
        "Feeds the IHKA a fake road speed (0-200 km/h). Only the IHKA's control is affected. " + _IHKA_EN,
    ),
    'STEUERN_MOTOR_KLAPPENPOSITION': (
        "各フラップのステッピングモータを 0〜100 % の位置へ動かします。触らない引数は '' で省略できます。" + _IHKA_JA,
        "Drives each flap stepper to a 0-100 % position. Leave an argument as '' to skip that flap. " + _IHKA_EN,
    ),
    'STEUERN_REGLERGROESSE': (
        '制御量 Y を 0〜100 % で直接与えます。' + _IHKA_JA,
        'Sets the controller output Y directly to 0-100 %. ' + _IHKA_EN,
    ),
    'STEUERN_RELAIS_HECKSCHEIBE': (
        'リアウィンドウ熱線のリレーを EIN/AUS します。大電流負荷なので AUS で終えること。' + _IHKA_JA,
        'Switches the rear-window heater relay EIN/AUS. It is a heavy load — finish with AUS. ' + _IHKA_EN,
    ),
    'STEUERN_TASTE_HECKSCHEIBE': (
        'リアウィンドウ熱線ボタンを押した状態を作ります。SGBD の前提: エンジンが回っていること。解除の手順は SGBD に書かれていません。',
        "Simulates pressing the rear-window heater button. The SGBD's precondition: the engine must be running. The SGBD does not describe how it is released.",
    ),
    'STEUERN_WASSERVENTIL': (
        'ヒータのウォーターバルブを 0〜100 % で駆動します。' + _IHKA_JA,
        'Drives the heater water valve to 0-100 %. ' + _IHKA_EN,
    ),
    'STEUERN_ZUHEIZER': (
        '補助ヒータ出力を EIN/AUS します。SGBD: STEUERN_RELAIS_FRONTSCHEIBE と同一の出力です。AUS で終えること。' + _IHKA_JA,
        'Switches the auxiliary-heater output EIN/AUS. The SGBD says this is the same output as STEUERN_RELAIS_FRONTSCHEIBE. Finish with AUS. ' + _IHKA_EN,
    ),
    'STEUERN_ZUSATZWASSERPUMPE': (
        '補助ウォーターポンプを EIN/AUS します。冷却水が空の状態で回さないこと。AUS で終えること。' + _IHKA_JA,
        'Switches the auxiliary water pump EIN/AUS. Do not run it with the coolant circuit empty. Finish with AUS. ' + _IHKA_EN,
    ),
}
