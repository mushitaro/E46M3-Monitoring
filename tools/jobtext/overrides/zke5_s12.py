#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Body electronics GM5 (S12) の個別注意文。

前身アプリ（`tools/sgbd_overrides.py`）の `note_ja` / `note_en` から移した手書きの文。
分類の事実（risk / cat / style / preconditions）は一緒に来ていない——そちらは
`tools/sgbd/classify.py` の領分で、いくつかは前身とこの repo で食い違っている。文は
食い違っていない: 無害だと思ったジョブに注意文を書く人はいない。

族の一般論で足りるものは `cautions.py` の正規表現表が受け持つ。ここに書くのは
**その族の一般論では足りない個体**だけである。

各値は `(ja, en)` のタプル。
"""
from __future__ import annotations


ZKE5_S12: dict[str, tuple[str, str]] = {
    'STEUERN_DIGITAL': (
        '窓（MFF*/MFB*）・集中ロック（MER/MVR/MZS）・ワイパー（WI1/WI2）・サイレン・ウォッシャーノズルヒータ（SDH_L/R）・CVM 要求（CVM_FA/FZ = 窓, CVM_VKA/VKZ = 幌カバー）などを直接駆動します。窓の挟み込み保護は効きません——ガラス・幌の経路に手・頭が無いことを確認し、EIN=0 で必ず戻すこと。',
        'Drives windows (MFF*/MFB*), central locking (MER/MVR/MZS), wipers (WI1/WI2), the siren, washer-jet heaters (SDH_L/R) and the CVM requests (CVM_FA/FZ = windows, CVM_VKA/VKZ = roof cover) directly. Anti-trap does not apply — keep hands and heads out of the glass and roof path and always release with EIN=0.',
    ),
    'STEUERN_IB_AUS': (
        '室内灯を恒久的に消します。SGBD に解除ジョブは無く、室内灯スイッチを手で押すまで点きません。',
        'Switches the interior lighting off permanently. The SGBD has no release job — it stays off until the interior-light button is pressed by hand.',
    ),
    'STEUERN_LIN_ASP': (
        "LIN 経由でドアミラーを動かし/折り畳みます。手を近づけないこと。'MEMx_SPEICHERN' は保存済みメモリ位置を上書きします。EIN=0 で戻すこと。",
        "Moves or folds the door mirrors over LIN — keep hands away. 'MEMx_SPEICHERN' overwrites the stored memory position. Release with EIN=0.",
    ),
    'STEUERN_LIN_SZT': (
        "SZT（E83 用センターコンソール）経由で窓を動かします（ORT = SZT-SFVL/SFVR/SFHL/SFHR、EIN = 'auf'/'zu'/'maut-auf'/'maut-zu'。LED_FN_TASTE1/2 は 'an'/'aus'）。E46 の LIN に SZT はありません（SGBD: SZT は E83）——効かないのが正常ですが、効いた場合は窓が動くので手を離しておくこと。",
        "Moves windows via the SZT, the E83 centre console (ORT = SZT-SFVL/SFVR/SFHL/SFHR, EIN = 'auf'/'zu'/'maut-auf'/'maut-zu'; LED_FN_TASTE1/2 take 'an'/'aus'). An E46 has no SZT on its LIN (the SGBD says SZT = E83) — no effect is normal, but if it does act a window moves, so keep hands clear.",
    ),
}
