#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Immobiliser EWS 3.3D の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


EWS3D: dict[str, tuple[str, str]] = {
    # 名前は「自己診断」。SGBD の本文は "Schreibzugriff auf den Transponder via
    # EWS-SG"、引数は BLOCK(0-7) / POSITION(0-15) / DATENBYTE。鍵の中身を書く。
    'STEUERN_SELBSTTEST': (
        '名前は「自己診断」ですが、SGBD の説明は **「EWS 経由でトランスポンダへ書き込む」** です'
        '（`Schreibzugriff auf den Transponder via EWS-SG`）。引数はブロック番号(0〜7)・'
        'バイト位置(0〜15)・データバイトで、**鍵の中のトランスポンダの任意の 1 バイトを'
        '書き換えます。** 元の値を読み出す手段はこのアプリにありません。書き損じた鍵で'
        'エンジンが始動しなくなった場合、復旧にはディーラーの鍵データが要ります。',
        'The name says self-test. The SGBD says **write access to the transponder via the EWS** '
        '(`Schreibzugriff auf den Transponder via EWS-SG`). Its arguments are a block number '
        '(0-7), a byte position (0-15) and a data byte: **it rewrites one arbitrary byte inside '
        'the transponder in your key.** This app has no way to read the old value back. If the '
        'key stops starting the car, recovery needs the dealer\'s key data.',
    ),
    'STEUERN_DIGITAL': (
        'ORT は DME_V/ANL_V/TRP_V/USE_V（予告）と DME_A/ANL_A/TRP_A/USE_A（実行）。ANL_A はスタータリレーを強制し、エンジンがクランキングします。ニュートラル・パーキングブレーキ・エンジンルームに人がいないことを確認してください。',
        'ORT is DME_V/ANL_V/TRP_V/USE_V (arm) and DME_A/ANL_A/TRP_A/USE_A (execute). ANL_A forces the starter relay — the engine cranks. Neutral, handbrake on, nobody in the engine bay.',
    ),
}
