#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MSS54 (S54 エンジン) の個別注意文。

族で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations

MSS54: dict[str, tuple[str, str]] = {
    'ABGLEICHWERTE_SCHREIBEN': (
        '元の値を保存せずに実行しないでください。このアプリは以前の値を復元できません。',
        'Do not run this without saving the current values. Nothing here can restore them.',
    ),
    'ADAPT_LOESCHEN': (
        '原因を調べずに消すと、症状だけが一時的に隠れて再発します。消す前に学習値を読んで控えてください。',
        'Clearing without investigating hides the symptom temporarily and it returns. Read and note the values before clearing.',
    ),
    'CO_EINZELABGLEICH_PROGRAMMIEREN': (
        'EEPROM の書込回数には限りがあります。試行錯誤は RAM 側 (`_VERSTELLEN`) で行ってください。',
        'EEPROM endurance is finite. Do the trial and error in RAM with _VERSTELLEN.',
    ),
    'EWS3_INITIALISIEREN': (
        '盗難防止機構に触る操作です。実行前に、正しい鍵が手元にあることを確認してください。',
        'This touches the anti-theft system. Confirm you have the correct key in hand before running it.',
    ),
    'EWS3_SYNC': (
        '正しい鍵が手元にあることを確認してから実行してください。',
        'Confirm you have the correct key before running it.',
    ),
    'FS_LOESCHEN': (
        '排ガス関連のレディネスコードもリセットされ、車検に必要な走行条件を満たし直す必要が出る場合があります。',
        'Emissions readiness monitors reset too, which can mean re-driving the cycles an inspection requires.',
    ),
    'PRUEFSTEMPEL_SCHREIBEN': (
        '車両の来歴に関する情報を変えることになります。',
        "You are changing information about the car's history.",
    ),
    'SG_RESET': (
        'エンジン停止・電圧安定を確認してから実行してください。',
        'Only with the engine stopped and the supply steady.',
    ),
    'START_SYSTEMCHECK_SEK_LUFT': (
        'エンジンが冷えている状態でないと、検査条件を満たしません。',
        'The engine has to be cold or the test conditions are not met.',
    ),
    'START_SYSTEMCHECK_TANK_LECK': (
        '燃料残量が多すぎても少なすぎても検査条件を満たしません。実行中は給油しないでください。',
        'The test will not run with the tank too full or too empty. Do not refuel while it runs.',
    ),
}
