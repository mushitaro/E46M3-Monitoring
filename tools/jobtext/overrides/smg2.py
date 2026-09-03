#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SMG II (E46 M3 変速機) の個別注意文。

族で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations

SMG2: dict[str, tuple[str, str]] = {
    'ADAPTIONSWERTE_LOESCHEN': (
        '適応手順を最後まで実施できる時間・場所・バッテリ電圧を確保してから消してください。途中で止まると走行できなくなる可能性があります。',
        'Only clear when you have the time, the place and the battery voltage to complete the adaptations. Stopping half-way can leave the car undriveable.',
    ),
    # 'INITIALISIERUNG' の注意文をここから外した。「較正/適応まで一続きで行える
    # 状況を用意してから」という文だったが、SGBD は EDIABAS が最初のアクセス時に
    # 自分で呼ぶ通信パラメータ設定だと述べている——較正は始まらない。前身アプリの
    # 表がこのジョブを除外していたのは正しく、この 2 ファイルの注意文が誤りだった。
    'PRUEFSTEMPEL_SCHREIBEN': (
        '車両の来歴に関する情報を変えることになります。',
        "You are changing information about the car's history.",
    ),
    'SG_RESET': (
        '車両を停止させ、ニュートラルにしてから実行してください。',
        'Car stopped and in neutral before you run it.',
    ),
    'TESTPRG_STARTEN': (
        'SGBD は前段に `TESTPRG_STOP` を送ることを要求しています。また ECU のタイムアウトは10秒なので、実行中は通信を維持し続ける必要があります。',
        "The SGBD requires TESTPRG_STOP to be sent first. The ECU's timeout is ten seconds, so the link must be kept alive throughout.",
    ),
}
