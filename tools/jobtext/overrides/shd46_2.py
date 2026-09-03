#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sunroof SHD (2) の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


SHD46_2: dict[str, tuple[str, str]] = {
    'DEL_INIT': (
        'サンルーフの初期化（位置学習）を消します。消した直後からルーフの自動動作と挟み込み保護が使えません。必ず続けて STEUERN_AUTO_INIT_EIN または手動のノーマライズを行ってください。',
        "Deletes the sunroof's initialisation (learned positions). From that moment automatic travel and anti-trap are unavailable. Follow up immediately with STEUERN_AUTO_INIT_EIN or a manual normalisation.",
    ),
    'RESET': (
        'サンルーフ制御ユニットが再起動します。数秒間、通信と機能が途切れます。',
        'The sunroof controller reboots. Communication and function drop for a few seconds.',
    ),
    'STEUERN_AUTO_INIT_AUS': (
        '自動初期化を無効にします（SGBD のコメントは EIN と同じ「SG Autoinit durchführen」のみ）。無効のままだとサンルーフが未初期化状態から自動では復帰しません。',
        "Disables auto-initialisation (the SGBD comment is the same 'SG Autoinit durchfuehren' as for EIN). Left disabled, the sunroof will not recover from an uninitialised state on its own.",
    ),
    'STEUERN_AUTO_INIT_EIN': (
        'サンルーフの自動初期化を有効にします（SGBD のコメントは EIN/AUS とも「SG Autoinit durchführen」のみ）。初期化中はルーフが全ストローク動く可能性があります——開口部に手・頭が無いこと。バッテリ電圧が十分で、途中で中断されない状況で実行してください。',
        "Enables the sunroof auto-initialisation (the SGBD comment for both EIN and AUS is just 'SG Autoinit durchfuehren'). While it initialises the roof may travel its full stroke — keep hands and heads out of the opening. Good battery voltage, and no chance of interruption.",
    ),
    'STEUERN_DIGITAL': (
        'サンルーフが動きます（SSHDH/SSHDZ/SSHDA = スイッチ偽装, TIPP_H/Z/A = ワンタッチ, RSHDZ = 閉リレー）。開口部に手・頭が無いことを確認し、EIN=0 で必ず戻すこと。',
        'The sunroof moves (SSHDH/SSHDZ/SSHDA fake the switch, TIPP_H/Z/A one-touch, RSHDZ the close relay). Keep hands and heads out of the opening and always release with EIN=0.',
    ),
}
