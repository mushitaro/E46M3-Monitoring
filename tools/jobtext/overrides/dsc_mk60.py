#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DSC MK60 (E46 M3) の個別注意文。

族で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations

DSC_MK60: dict[str, tuple[str, str]] = {
    'ABGLEICH_DSC_SENSOREN': (
        '必ず平坦な場所で、ハンドルを直進位置に保ち、車両を完全に静止させてから実行してください。',
        'Do this only on level ground, with the wheel held straight and the car completely still.',
    ),
    'ABGLEICH_LWS_AQ_SENSOREN': (
        '平坦な場所・直進・静止が前提です。ステアリングを切ったまま実行しないでください。',
        'Level ground, wheels straight, car still. Never with the wheel turned.',
    ),
    'DDS_EOL_PASSIV': (
        'SGBD が動作も結果も記述していない操作です。実車では実行しないでください。',
        'The SGBD describes neither the action nor the result. Do not run this on a car.',
    ),
    'DDS_RESET': (
        'タイヤ交換・ローテーション・空気圧調整のあとは必ず実行してください。逆に、規定圧に合わせる前に実行してはいけません。',
        'Always run it after a tyre change, rotation or pressure adjustment - and never before setting the pressures.',
    ),
    'DRUCKSENSOR_DSC_ABGLEICHEN': (
        '実行中はブレーキペダルに触れないでください。',
        'Do not touch the brake pedal while it runs.',
    ),
    'FS_LOESCHEN': (
        '車検や保証の判断材料になる履歴を消してしまうことがあります。',
        'You may be erasing history that a workshop or a warranty claim would have relied on.',
    ),
    'ID_SCHREIBEN': (
        '同じ操作が PRUEFSTEMPEL_SCHREIBEN という名前でも存在します。片方だけを安全だと考えないでください。',
        'The same operation also exists as PRUEFSTEMPEL_SCHREIBEN. Do not assume one of them is the safe one.',
    ),
    'INITIALISIERUNG': (
        '較正まで一続きで行える時間と場所を確保してから始めてください。',
        'Start only when you have the time and the level ground to complete the calibrations as well.',
    ),
    'PRUEFSTEMPEL_SCHREIBEN': (
        '検査記録の書き換えは、車両の来歴に関する情報を変えることになります。',
        "Rewriting an inspection record changes information about the car's history.",
    ),
    'QUERBESCHLEUNIGUNGSSENSOR_DSC_ABGLEICHEN': (
        '必ず水平な場所で、車両を完全に静止させてください。',
        'Level ground only, and the car completely still.',
    ),
}
