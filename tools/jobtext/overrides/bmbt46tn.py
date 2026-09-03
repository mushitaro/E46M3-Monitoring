#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""On-board monitor (Top Nav) の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


BMBT46TN: dict[str, tuple[str, str]] = {
    'CASSETTENDECK_BETRIEBSSTUNDENZAEHLER_LOESCHEN': (
        'カセットデッキの稼働時間カウンタを消します。元には戻せません。',
        'Clears the cassette-deck operating-hour counter. It cannot be restored.',
    ),
    'LC_ANZEIGE_BETRIEBSSTUNDENZAEHLER_LOESCHEN': (
        'LC ディスプレイの稼働時間カウンタを消します。元には戻せません。',
        'Clears the LC display operating-hour counter. It cannot be restored.',
    ),
    'STEUERN_CASSETTE': (
        'STEUERTEXT は EJECT / PLAY / FFW / FRW / MSS_FW / MSS_RW / STANDBY / PAUSE_EIN / PAUSE_AUS / WIEDERGABE_NORMAL / WIEDERGABE_REVERSE / DOLBY_B / DOLBY_C / DOLBY_AUS。',
        'STEUERTEXT is EJECT / PLAY / FFW / FRW / MSS_FW / MSS_RW / STANDBY / PAUSE_EIN / PAUSE_AUS / WIEDERGABE_NORMAL / WIEDERGABE_REVERSE / DOLBY_B / DOLBY_C / DOLBY_AUS.',
    ),
    'STEUERN_HEIZUNG': (
        'ディスプレイヒータを STEUERCODE で切り替えます。SGBD はコード値を説明していません。入れたまま放置しないこと。',
        'Switches the display heater via STEUERCODE; the SGBD does not document the code values. Do not leave it on.',
    ),
    'STEUERN_NTSC_PAL': (
        '映像方式を NTSC/PAL で切り替えます。SGBD はコード値を説明しておらず、現在値を読むジョブもありません。間違えると画面が乱れるので、正しいコードが分かっている場合だけ実行してください。',
        'Switches the video standard NTSC/PAL; the SGBD does not document the code values and there is no job to read the current one. A wrong value scrambles the picture, so only run it if you know the correct code.',
    ),
    'STEUERN_SELBSTHALTUNG': (
        'ボードモニターの自己保持（イグニッションOFF後も起動したまま）を STEUERCODE で切り替えます。SGBD はコード値を説明していません。入れたまま放置するとバッテリが上がります。',
        "Sets the on-board monitor's self-hold (stays awake after ignition off) via STEUERCODE; the SGBD does not document the code values. Left on, it drains the battery.",
    ),
}
