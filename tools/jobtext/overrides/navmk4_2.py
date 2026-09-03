#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Navigation computer MK4 (2) の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


NAVMK4_2: dict[str, tuple[str, str]] = {
    # "Flottenmodus Status"、引数 BYTE1 は 0x00-0x02。STATUS_FLOTTENMODUS で読み返せる。
    'STEUERN_FLOTTENMODUS': (
        'フリートモードを 3 値(0x00〜0x02)のいずれかに設定します。**SGBD は「一時的」とは'
        '述べておらず、`STATUS_FLOTTENMODUS` で後から読み返せます**——ジョブが終わった時点で'
        '元に戻ってはいません。実行前に `STATUS_FLOTTENMODUS` で現在値を控えてください'
        '（このアプリはそれを自動では行いません）。',
        'This sets fleet mode to one of three values (0x00-0x02). **The SGBD does not call it '
        'temporary, and `STATUS_FLOTTENMODUS` reads it back afterwards** — it has not reverted '
        'when the job ends. Read and note the current value with `STATUS_FLOTTENMODUS` first; '
        'this app will not do it for you.',
    ),
    'FORCE_EJECT': (
        'イジェクトボタンのロックを解除します。ディスクが出てきます。',
        'Releases the eject button lock. The disc comes out.',
    ),
    'SPRACHAUSGABE': (
        'ナビの音声案内を一度発声させます。',
        'Makes the navigation computer speak once.',
    ),
}
