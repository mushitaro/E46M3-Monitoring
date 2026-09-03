#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Light switch centre LSZ の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations

from ._shared import _LSZ_IO_EN, _LSZ_IO_JA

LSZ: dict[str, tuple[str, str]] = {
    'BETRIEBSSTUNDENZAEHLER_LOESCHEN': (
        '灯火の稼働時間カウンタを消します。ZAEHLER は 0x01〜0x0B で個別、0xFF で全部。消す前に BETRIEBSSTUNDENZAEHLER_LESEN で控えてください。',
        'Clears the lamp operating-hour counters. ZAEHLER 0x01-0x0B clears one counter, 0xFF clears all. Read them with BETRIEBSSTUNDENZAEHLER_LESEN and note them first.',
    ),
    'STEUERN_BELADUNGSSENSOR_VORN': (
        '前側の荷重センサ電圧を偽装し、光軸モータが動きます。DIAGNOSE_ENDE で通常に戻ります。',
        'Fakes the front load-sensor voltage; the headlight-levelling motors move. DIAGNOSE_ENDE returns to normal.',
    ),
    'STEUERN_DIMMER': (
        '照明ディマー入力の電圧を偽装します。DIAGNOSE_ENDE で通常に戻ります。',
        'Fakes the illumination-dimmer input voltage. DIAGNOSE_ENDE returns to normal.',
    ),
    'STEUERN_FOTOZELLE': (
        'フォトセル（明るさ）の電圧を偽装します。オートライトが点く場合があります。DIAGNOSE_ENDE で通常に戻ります。',
        'Fakes the photocell (ambient light) voltage; automatic lights may come on. DIAGNOSE_ENDE returns to normal.',
    ),
    'STEUERN_IO': (
        _LSZ_IO_JA,
        _LSZ_IO_EN,
    ),
    'STEUERN_LWR_POTI': (
        'ヘッドライト光軸ポテンショの電圧を偽装し、光軸モータが動きます。DIAGNOSE_ENDE で通常に戻ります。',
        'Fakes the headlight-levelling potentiometer voltage; the levelling motors move. DIAGNOSE_ENDE returns to normal.',
    ),
    'STEUERN_SCHALTERSPANNUNG_BLINKER': (
        'ウインカースイッチの電圧を偽装します。ウインカーが点く場合があります。DIAGNOSE_ENDE で通常に戻ります。',
        'Fakes the indicator switch voltage; an indicator may come on. DIAGNOSE_ENDE returns to normal.',
    ),
    'STEUERN_SCHALTERSPANNUNG_FL_LH': (
        'ハイビーム/パッシングスイッチの電圧を偽装します。ハイビームが点く場合があります。DIAGNOSE_ENDE で通常に戻ります。',
        'Fakes the main-beam/flash switch voltage; the main beam may come on. DIAGNOSE_ENDE returns to normal.',
    ),
}
