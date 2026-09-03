# -*- coding: utf-8 -*-
"""ダンプはあるが**モジュールにしていない** SGBD と、その理由。

`$SGBD_DUMP_DIR` には 87 ファイルあり、51 がモジュールになっている。残りを
「無い」ことにすると、除外は誰にも見られない決定になる——実際そうなっていた。
`gen_from_dump.py` のヘッダ 23-26 行に散文で 6 件分だけ書かれていて、そこに
書かれていない 5 件は理由ごと存在しなかった。**その 5 件のうち 1 件が `ASCMK20`
で、「従来決定どおり」とだけ書かれたまま、前期車の 0x56 を丸ごと落としていた。**

だからここは表であり、`check_references.py` が「ダンプ 1 個につき、モジュールか
除外理由のどちらかが必ずある」ことを検査する。新しいダンプを置いた人は、それを
使うか、使わない理由をここに書くかのどちらかを迫られる。黙って落とす経路が無い。

`provenance` の意味は repo の他の場所と同じ:

    trace       実送信テレグラムで確かめた（`_addresses.json` 由来）。最も強い。
    authored    人が装備・年式の知識から判断した。SGBD は何も述べていない。
    unrecorded  **理由が記録されていない。** 引き継いだ決定で、根拠が残っていない。
                これを 0 にするのが目標だが、根拠が無いことを `authored` と書いて
                隠すほうがずっと悪い。

散文と背景は `docs/FITMENT.md`。
"""
from __future__ import annotations

from typing import TypedDict


class Fitment(TypedDict, total=False):
    addr: str            # 実送信 IDENT テレグラムから見た DS2 アドレス（分かる場合）
    ident: str           # その IDENT テレグラムそのもの
    reason_ja: str
    reason_en: str
    provenance: str      # trace | authored | unrecorded
    instead: str         # 同じアドレスを占めるモジュール id（ある場合）


# ---------------------------------------------------------------------------
#  1) プロトコルが違う
# ---------------------------------------------------------------------------
_PROTOCOL: dict[str, Fitment] = {
    # このアプリは DS2 しか話さない。他の 58 モジュールの IDENT が 3 バイトの
    # DS2（`<アドレス> 04 00`）なのに対し、これだけが 6 バイトの KWP2000 を、
    # しかも 0x56 ではなく 0xB8 へ送る。
    #
    # 前身アプリはこれを「この車両の DSC ではない」と記録していたが、**半分違う**。
    # SGBD 自身は E46 だと名乗っている:
    #
    #     ECU:     "Dynamische Stabilitaets Control DSC E46,R50,E85"
    #     COMMENT: "Version Conti_Teves MK60 DSC3 E46(ASC/DSC), R50(ABS/ASC/DSC), E85 DSC"
    #
    # 車が違うのではなく**話す言葉が違う**。DS2 のツールから届かない、が正確な理由で、
    # そちらのほうが強い——装備の推測を挟まずに済む。
    "DSC_MK60": {
        "addr": "0xB8", "ident": "B8 29 F1 02 1A 80", "provenance": "trace",
        "reason_ja": "IDENT が KWP2000（6 バイト、0xB8 宛）。このアプリは DS2 しか話さないので届かない。"
                     "SGBD 自身は E46 を名乗っている（MK60 DSC3）——車ではなくプロトコルが理由。",
        "reason_en": "Its IDENT is KWP2000 — six bytes, addressed to 0xB8. This app speaks only DS2, so it "
                     "cannot reach it. The SGBD does name the E46 (MK60 DSC3): the reason is the protocol, "
                     "not the car.",
    },
    # ECU ではない。フラッシュ書込のプロトコル SGBD で、ジョブは
    # FLASH_PARAMETER_*, MOST_CAN_GATEWAY_*, ACCESS_TIMING_PARAMETER。
    # 診断アドレスを持たない（`_addresses.json` に唯一入っていないダンプ）。
    "10flash": {
        "provenance": "trace",
        "reason_ja": "ECU ではなくフラッシュ書込のプロトコル SGBD。診断アドレスを持たず、"
                     "`_addresses.json` にも載らない。WinKFP の領分。",
        "reason_en": "Not an ECU — the flash-programming protocol SGBD. It has no diagnostic address and is "
                     "the only dump absent from _addresses.json. WinKFP's territory.",
    },
}

# ---------------------------------------------------------------------------
#  2) E46 M3 に載っていない装備
# ---------------------------------------------------------------------------
#  理由は前身アプリの `gen_from_dump.py` ヘッダ 23-26 行から一字も変えずに移した。
#  どれも SGBD が述べていることではなく、人が装備から判断したこと——`authored`。
_NOT_EQUIPPED: dict[str, Fitment] = {
    "EWS": {
        "addr": "0x44", "instead": "ews3", "provenance": "authored",
        "reason_ja": "EWS2。E46 M3 非搭載（0x44 は EWS3 / EWS3D）。",
        "reason_en": "EWS2, not fitted to the E46 M3 (0x44 carries EWS3 / EWS3D).",
    },
    "IHKR46": {
        "addr": "0x5B", "instead": "ihka46_2", "provenance": "authored",
        "reason_ja": "マニュアルエアコン。M3 は IHKA（オートエアコン）が標準。",
        "reason_en": "Manual climate control; the M3 has IHKA (automatic) as standard.",
    },
    "MRS4RD": {
        "addr": "0xA4", "instead": "mrs4", "provenance": "authored",
        "reason_ja": "E83（X3）用。",
        "reason_en": "For the E83 (X3).",
    },
    "DWS": {
        "addr": "0x70", "instead": "rdc", "provenance": "authored",
        "reason_ja": "空気圧警告（DWS）。M3 の 0x70 は RDC（Reifendruckkontrolle）。",
        "reason_en": "Deflation warning. On the M3, 0x70 is RDC (tyre-pressure control).",
    },
    "GR2": {
        "addr": "0xA6", "provenance": "authored",
        "reason_ja": "独立したクルーズコントロール ECU。M3 のクルーズは DME 内蔵で、0xA6 は空。",
        "reason_en": "A standalone cruise-control ECU. On the M3 cruise lives inside the DME and 0xA6 is empty.",
    },
    "EKP_DS2": {
        "addr": "0x65", "provenance": "authored",
        "reason_ja": "電子燃料ポンプ制御。M3 の燃料ポンプはリレー駆動で、0x65 は空。",
        "reason_en": "Electronic fuel-pump control. The M3's pump is relay-driven and 0x65 is empty.",
    },
}

# ---------------------------------------------------------------------------
#  3) 同じアドレスの、別世代
# ---------------------------------------------------------------------------
#  ここが `unrecorded` の 4 件である。**なぜ第 4 世代を採って第 3 世代を採らな
#  かったのか、どこにも書かれていない。** 0x56（ASCMK20 / DSC_E46）や 0x5B
#  （IHKA46 / _2 / _3）は同じ形——同一アドレスに世代違いが並ぶ——を `fit` で
#  両載せして解決しているので、この 4 件も本来は fit の候補である。
#
#  推測で埋めない。E46 M3 のシートメモリがどの世代かを、この repo は測っていない。
#  「分からない」と書いてある状態のほうが、それらしい理由が書いてある状態より強い。
_UNRECORDED_GENERATION: dict[str, Fitment] = {
    "SM46": {
        "addr": "0x72", "instead": "sm46_4", "provenance": "unrecorded",
        "reason_ja": "0x72 のシートメモリの旧世代。採否の理由が記録されていない。"
                     "0x56 や 0x5B と同じく fit で両載せできる形。",
        "reason_en": "An earlier generation of the 0x72 seat memory. No reason was recorded. Same shape as "
                     "0x56 and 0x5B, which carry both generations via fit.",
    },
    "SM46_3": {
        "addr": "0x72", "instead": "sm46_4", "provenance": "unrecorded",
        "reason_ja": "0x72 のシートメモリ第 3 世代。採否の理由が記録されていない。",
        "reason_en": "Third-generation 0x72 seat memory. No reason was recorded.",
    },
    "SM46C_4": {
        "addr": "0x72", "instead": "sm46c_5", "provenance": "unrecorded",
        "reason_ja": "0x72 のカブリオレ用シートメモリ第 4 世代（採ったのは第 5 世代）。"
                     "採否の理由が記録されていない。",
        "reason_en": "Fourth-generation cabriolet seat memory on 0x72 (the fifth is the one shipped). No "
                     "reason was recorded.",
    },
    "B_SM46_3": {
        "addr": "0xDA", "instead": "b_sm46_4", "provenance": "unrecorded",
        "reason_ja": "0xDA の助手席シートメモリ第 3 世代。採否の理由が記録されていない。",
        "reason_en": "Third-generation passenger seat memory on 0xDA. No reason was recorded.",
    },
}

NOT_FITTED: dict[str, Fitment] = {**_PROTOCOL, **_NOT_EQUIPPED, **_UNRECORDED_GENERATION}

# 台帳にあるがモジュールでも ECU でもないファイル。ダンプ生成器の副産物と、
# 用語抽出の中間物。`check_references.py` はこれらを ECU として数えない。
NON_ECU_PREFIXES = ("_",)
NON_ECU_SUFFIXES = (".telegrams.json",)


def is_ecu_dump(filename: str) -> bool:
    """台帳の 1 行が「ECU の SGBD ダンプ」かどうか。"""
    return (filename.endswith(".json")
            and not filename.startswith(NON_ECU_PREFIXES)
            and not filename.endswith(NON_ECU_SUFFIXES))


def unrecorded() -> list[str]:
    """理由が記録されていない除外。0 が目標。"""
    return sorted(k for k, v in NOT_FITTED.items() if v.get("provenance") == "unrecorded")
