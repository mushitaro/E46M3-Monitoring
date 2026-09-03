#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Park distance control PDC の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


PDCE38: dict[str, tuple[str, str]] = {
    'STEUERN_IO_STATUS': (
        'ORT は DTAUS / DTVEIN / DTHEIN（ブザー）・DKSAUS / DKSEIN（コントロール信号）・DEIN（診断モード）・SAUS / SEIN（システム）。音と表示だけです。',
        'ORT is DTAUS / DTVEIN / DTHEIN (beeper), DKSAUS / DKSEIN (control signal), DEIN (diagnostic mode), SAUS / SEIN (system). Sound and indication only.',
    ),
    'STEUERN_WEG_V': (
        'PDC に偽の距離・車速を与えて表示とブザーを鳴らします。センサは駆動しません。',
        'Feeds the PDC fake distances and a speed so it displays and beeps. The sensors are not driven.',
    ),
}
