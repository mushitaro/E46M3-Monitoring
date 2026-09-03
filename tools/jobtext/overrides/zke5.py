#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Body electronics GM5 (ZKE5) の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


ZKE5: dict[str, tuple[str, str]] = {
    'STEUERN_DIGITAL': (
        '窓（MFF*/MFB*）・集中ロック（MER/MVR/MZS）・ワイパー（WI1/WI2）・サイレンなどを直接駆動します。窓の挟み込み保護は効きません——ガラスの経路に手・頭が無いことを確認し、EIN=0 で必ず戻すこと。',
        'Drives windows (MFF*/MFB*), central locking (MER/MVR/MZS), wipers (WI1/WI2), the siren and more directly. Anti-trap does not apply — keep hands and heads out of the glass path and always release with EIN=0.',
    ),
    'STEUERN_IB_AUS': (
        '室内灯を恒久的に消します。SGBD に解除ジョブは無く、室内灯スイッチを手で押すまで点きません。',
        'Switches the interior lighting off permanently. The SGBD has no release job — it stays off until the interior-light button is pressed by hand.',
    ),
}
