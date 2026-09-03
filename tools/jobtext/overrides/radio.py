#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Radio の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


RADIO: dict[str, tuple[str, str]] = {
    'STEUERN_DEFAULT_SOUND': (
        'バランス・フェーダー・音量を初期値に戻します。現在の設定は失われます。',
        'Resets balance, fader and volume to defaults. The current settings are lost.',
    ),
    'STEUERN_FREQUENZ': (
        '受信周波数を kHz で設定します（0〜999999）。',
        'Tunes the radio to a frequency in kHz (0-999999).',
    ),
    'STEUERN_GAL_DEK': (
        '速度連動音量（GAL）の設定値を 1 段下げます（ラジオの設定値を変えるので永続扱い）。STEUERN_GAL_INK で戻します。',
        'Lowers the speed-dependent volume (GAL) setting by one step (treated as persistent because it changes a radio setting). STEUERN_GAL_INK steps it back.',
    ),
    'STEUERN_GAL_INK': (
        '速度連動音量（GAL）の設定値を 1 段上げます（ラジオの設定値を変えるので永続扱い）。STEUERN_GAL_DEK で戻します。',
        'Raises the speed-dependent volume (GAL) setting by one step (treated as persistent because it changes a radio setting). STEUERN_GAL_DEK steps it back.',
    ),
    'STEUERN_RADIO_POWER': (
        'ARG1 は EIN/AUS（ON/OFF）。ラジオの電源を切り替えます。',
        'ARG1 is EIN/AUS (ON/OFF). Switches the radio on or off.',
    ),
    'STEUERN_RADIO_SCHALTEN': (
        'SCHALTMODUS は ein/aus（on/off）。KWP2000 IO 制御でラジオの電源を切り替えます。',
        'SCHALTMODUS is ein/aus (on/off). Switches the radio on or off via KWP2000 IO control.',
    ),
    'STEUERN_VF_DEK': (
        '交通情報（VF）の最低音量を 1 段下げます（ラジオの設定値を変えるので永続扱い）。STEUERN_VF_INK で戻します。',
        'Lowers the traffic-announcement (VF) minimum volume by one step (treated as persistent because it changes a radio setting). STEUERN_VF_INK steps it back.',
    ),
    'STEUERN_VF_INK': (
        '交通情報（VF）の最低音量を 1 段上げます（ラジオの設定値を変えるので永続扱い）。STEUERN_VF_DEK で戻します。',
        'Raises the traffic-announcement (VF) minimum volume by one step (treated as persistent because it changes a radio setting). STEUERN_VF_DEK steps it back.',
    ),
    'STEUERN_VOL_UP': (
        '音量を 11 dB/s で上げます。INKREMENTE は送るテレグラム数（既定 1）。大きな値は大音量になります。',
        'Raises the volume at 11 dB/s. INKREMENTE is the number of telegrams sent (default 1) — large values get loud.',
    ),
}
