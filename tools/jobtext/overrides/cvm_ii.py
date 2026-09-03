#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Convertible top module CVM II の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


CVM_II: dict[str, tuple[str, str]] = {
    'STEUERN_DIGITAL': (
        'ソフトトップの油圧バルブ（VENTIL1〜5）・ポンプ（PUMPE）・リアウィンドウ熱線（HHS）・AUF/ZU を直接駆動します。ルーフとトランクリッドの経路に人・物が無いことを確認し、ポンプを空運転させ続けないこと。SGBD に停止引数は無く、復帰手順も書かれていません——DIAGNOSE_ENDE を送り、戻らなければイグニッションを切ってください。',
        'Drives the soft-top hydraulic valves (VENTIL1-5), pump (PUMPE), rear-window heater (HHS) and AUF/ZU directly. Nobody and nothing in the path of the roof and boot lid, and do not leave the pump running against a stop. The SGBD has no stop argument and does not say how normal control returns — send DIAGNOSE_ENDE, and cycle the ignition if it does not.',
    ),
}
