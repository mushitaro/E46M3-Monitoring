#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rollover protection UEB2 の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


UEB2: dict[str, tuple[str, str]] = {
    'STEUERN_BUEGEL': (
        'ロールオーバーバーが勢いよく展開します。後席ヘッドレスト付近に頭・手・物が無いこと、ソフトトップが展開経路にかからないことを確認してください。SGBD に格納ジョブは無く、戻すのは手で押し下げる作業です。',
        'The rollover bars deploy with force. Nothing and nobody near the rear head restraints, and the soft top must be clear of the travel path. The SGBD has no retract job — they are pushed back down by hand.',
    ),
    'STEUERN_TRANSPORTSICHERUNG_AN': (
        '輸送ロックを設定します。設定中はロールオーバー保護が作動しません。作業後は必ず STEUERN_TRANSPORTSICHERUNG_AUS で解除し、STATUS_TRANSPORTSICHERUNG_LESEN で確認してください。',
        'Sets the transport lock. While it is set, rollover protection will not deploy. Always clear it afterwards with STEUERN_TRANSPORTSICHERUNG_AUS and confirm with STATUS_TRANSPORTSICHERUNG_LESEN.',
    ),
    'STEUERN_TRANSPORTSICHERUNG_AUS': (
        '輸送ロックを解除し、ロールオーバー保護を有効に戻します。STATUS_TRANSPORTSICHERUNG_LESEN で確認してください。',
        'Clears the transport lock and re-arms rollover protection. Confirm with STATUS_TRANSPORTSICHERUNG_LESEN.',
    ),
}
