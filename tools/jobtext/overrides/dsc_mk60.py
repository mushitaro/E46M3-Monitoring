#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DSC MK60 (Conti/Teves, DSC III) の個別注意文。2026-11-10 に一覧へ足したときに書いた。

族の一般論で足りない、書き込みと作動の 10 本。どれもこのアプリは送らない
（車に送るのは読み取りだけ。runGate）。手順を画面で読む人のための注意である。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations

DSC_MK60: dict[str, tuple[str, str]] = {
    'LENKWINKEL_DSC_ABGLEICHEN': (
        '舵角センサのゼロ点を合わせ直します。平坦な場所で、車輪を直進に向け、車両を完全に静止させてから。ずれたまま合わせると DSC が誤って介入します。',
        'Re-zeroes the steering-angle sensor. Level ground, wheels straight, car completely still. Zeroed off-centre, DSC intervenes when it should not.',
    ),
    'QUERBESCHLEUNIGUNG_DSC_ABGLEICHEN': (
        '横加速度センサのゼロ点を合わせ直します。平坦な場所で、車両を完全に静止させ、誰も乗り降りしない状態で。',
        'Re-zeroes the lateral-acceleration sensor. Level ground, car completely still, nobody getting in or out.',
    ),
    'STEUERN_DIGITAL_WARNLAMPEN': (
        'メーターの DSC・ABS・ブレーキの警告灯を指令で点けます。走行中は行わないでください。終えたら元に戻ったことを確かめてください。',
        'Lights the DSC, ABS and brake warning lamps on command. Never while driving; confirm they return to normal afterwards.',
    ),
    'STEUERN_DIGITAL_BLS': (
        'ブレーキ油圧のバルブを駆動します。停車中、エンジン停止、ブレーキを踏まない状態でだけ。途中で止めると油圧が抜けたままになることがあります。',
        'Drives a brake-hydraulic valve. Only parked, engine off, brake pedal untouched. Stopped part-way, pressure can be left released.',
    ),
    'COD_SCHREIBEN': (
        'コーディング（この車の装備に合わせた設定）を書き換えます。誤ると DSC が正しく働きません。書く前に今のコーディングを読み出して控えてください。',
        "Rewrites the coding (the settings matched to this car's equipment). Wrong coding stops DSC working correctly; read and keep the current coding first.",
    ),
    'IDENT_VIN_SCHREIBEN': (
        '制御ユニットに記録された車台番号を書き換えます。元には戻せません。',
        'Rewrites the VIN stored in the unit. It cannot be undone.',
    ),
    'IDENT_PROGRAMMING_DATE_SCHREIBEN': (
        '制御ユニットの識別データ（プログラミング日付）を書き換えます。元には戻せません。',
        "Rewrites the unit's identification data (programming date). It cannot be undone.",
    ),
    'IDENT_PRODUCTION_DATA_SCHREIBEN': (
        '制御ユニットの識別データ（製造データ）を書き換えます。元には戻せません。',
        "Rewrites the unit's identification data (production data). It cannot be undone.",
    ),
    'FAKTOR_SCHREIBEN': (
        '補正係数を書き込みます。DSC の介入の仕方が変わります。元の値を控えてから。',
        "Writes correction factors, which change how DSC intervenes. Keep the original values first.",
    ),
    'PRUEFFLAG_SCHREIBEN': (
        '検査印（テスト済みの印）の 1 バイト目を書き換えます。工場の検査工程のための操作です。',
        'Rewrites the first byte of the test stamp. It belongs to the factory test process.',
    ),
}
