#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tyre pressure control RDC の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


RDC: dict[str, tuple[str, str]] = {
    'ABGLEICHWERT_SCHREIBEN': (
        'ホイール位置 RADPOS にセンサ ID RADID を書き込みます（センサ交換後の登録）。先に ABGLEICHWERT_LESEN で現在の割当を控えてください。',
        'Writes sensor ID RADID to wheel position RADPOS (registration after a sensor change). Read the current assignment with ABGLEICHWERT_LESEN first and note it.',
    ),
    'STEUERN_DIGITAL': (
        '各機能は *_REQ=1 で要求、*_VAL で値を与えます（TST=較正ボタン, DWA=DWA 出力, BM=バンドモード, AER=自動自車輪, ERK=自車輪認識, CAL=較正, ANT=アンテナテスト）。要求しない組は 0 のままにしてください。',
        'Each function is requested with *_REQ=1 and given its value in *_VAL (TST = calibration button, DWA = DWA output, BM = band mode, AER = automatic own-wheel, ERK = own-wheel detection, CAL = calibrate, ANT = antenna test). Leave pairs you are not using at 0.',
    ),
}
