#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Immobiliser EWS 3.3 の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


EWS3: dict[str, tuple[str, str]] = {
    'STEUERN_DIGITAL': (
        'ORT は DME_V/ANL_V/TRP_V/USE_V（予告）と DME_A/ANL_A/TRP_A/USE_A（実行）。ANL_A はスタータリレーを強制し、エンジンがクランキングします。ニュートラル・パーキングブレーキ・エンジンルームに人がいないことを確認してください。',
        'ORT is DME_V/ANL_V/TRP_V/USE_V (arm) and DME_A/ANL_A/TRP_A/USE_A (execute). ANL_A forces the starter relay — the engine cranks. Neutral, handbrake on, nobody in the engine bay.',
    ),
}
