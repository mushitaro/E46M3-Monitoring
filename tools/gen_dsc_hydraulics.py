#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  gen_dsc_hydraulics.py — DSC の油圧操作面 → dsc_e46.hydraulics.json
# ----------------------------------------------------------------------------
#  DSC の per-wheel 操作は**引数ではなくジョブ名**に入っている。`DRUCKABBAU_VL`
#  と `DRUCKABBAU_VR` は引数を1つも取らず、車輪は名前の接尾辞である。
#  だから「右前エア抜き開始」のようなボタンは作れる——ただし3つの落とし穴がある。
#
#  1. **`DRUCKAUFBAU_VR` は存在しない。** `_VL` と `_HA` だけ。ECU 側の欠落で
#     あって、こちらの取りこぼしではない。黙って短いリストを出すのではなく、
#     理由を伴った行として出す。だから `job: null` に `absence` が付く。
#  2. **粒度が揃っていない。** `DRUCKABBAU_HA` は軸、`NA_ENTLUEFTUNG_LI` は
#     側（前左＋後左）、`DRUCKHALTEN` は接尾辞が無いのにバイトコード上 EVVL
#     しか触らない。車輪図にすると 4 隅との1対1対応を破る。
#  3. **停止手段が SGBD に一切無い。** ダンプ全体に `Stop`/`Abbruch`/`abschalt`/
#     `_AUS` は0件、タイムアウトも最大時間も未記載。ここが作る STOP は
#     **アプリの構成物**であり、そう明記する。
#
#  駆動ビットは telegrams から**実測**する。推測しない。
#
#  実行: python tools/gen_dsc_hydraulics.py
# ============================================================================
from __future__ import annotations

import datetime
import json
import os
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, HERE)
from sgbd import model                                          # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import paths                                                # noqa: E402

DUMP = paths.require_dump_dir()   # リポジトリ外。理由は tools/paths.py
DATA = os.path.join(HERE, "..", "public", "ecu-data")
OUT = os.path.join(DATA, "dsc_e46.hydraulics.json")
GENERATOR = "tools/gen_dsc_hydraulics.py"

IO_CONTROL = 0x0C

# `B_ASC` / `B_MSR` は出力ではなく**要求フラグ**。全出力OFF フレームにも残って
# いるので、駆動ビットの集計からは除く。残っている理由は SGBD が述べていない。
REQUEST_BITS = {"B_ASC", "B_MSR"}

# 電磁弁 → 車両上の隅。ポンプ類は隅を持たない。
CORNER = {
    "EVVL": "VL", "AVVL": "VL", "EVVR": "VR", "AVVR": "VR",
    "EVHL": "HL", "AVHL": "HL", "EVHR": "HR", "AVHR": "HR",
}
KIND = {"EV": "inlet", "AV": "outlet"}

# (family id, ja, en, [(site, ja, en, job or None, absence ja/en or None)])
FAMILIES: list[tuple[str, str, str, list[tuple[str, str, str, str | None, tuple[str, str] | None]]]] = [
    ("druckabbau", "ブレーキ油圧を抜く", "Release brake pressure", [
        ("VL", "前左", "Front left", "DRUCKABBAU_VL", None),
        ("VR", "前右", "Front right", "DRUCKABBAU_VR", None),
        ("HA", "後軸", "Rear axle", "DRUCKABBAU_HA", None),
    ]),
    ("druckaufbau", "ブレーキ油圧を上げる", "Build brake pressure", [
        ("VL", "前左", "Front left", "DRUCKAUFBAU_VL", None),
        ("VR", "前右", "Front right", None,
         ("SGBD には `DRUCKAUFBAU_VL` と `DRUCKAUFBAU_HA` があり、**`DRUCKAUFBAU_VR` は存在しません**。"
          "ECU 側の欠落であって、こちらの取りこぼしではありません。前右の減圧は `DRUCKABBAU_VR` にあります。",
          "The SGBD has `DRUCKAUFBAU_VL` and `DRUCKAUFBAU_HA` and **no `DRUCKAUFBAU_VR`**. That gap is the "
          "ECU's, not ours. Releasing front-right pressure does exist, as `DRUCKABBAU_VR`.")),
        ("HA", "後軸", "Rear axle", "DRUCKAUFBAU_HA", None),
    ]),
    ("druckhalten", "ブレーキ油圧を保持する", "Hold brake pressure", [
        ("VL", "前左", "Front left", "DRUCKHALTEN", None),
    ]),
    ("pumpe", "ポンプ吐出量の確認", "Check pump delivery", [
        ("VO", "前軸", "Front axle", "PUMPENFOERDERLEISTUNG_VO", None),
        ("HA", "後軸", "Rear axle", "PUMPENFOERDERLEISTUNG_HA", None),
    ]),
    ("na_entlueftung", "エア抜き（片側ずつ）", "Bleed, one side at a time", [
        ("LI", "左側（前左＋後左）", "Left side (front left + rear left)", "NA_ENTLUEFTUNG_LI", None),
        ("RE", "右側（前右＋後右）", "Right side (front right + rear right)", "NA_ENTLUEFTUNG_RE", None),
    ]),
    ("entlueftung_service", "エア抜き（サービス手順・4輪）", "Bleed, service routine (all four)", [
        ("ALL", "4輪すべて", "All four wheels", "ENTLUEFTUNG_SERVICE", None),
    ]),
    ("abs_sim", "ABS 制御の模擬", "Simulate an ABS intervention", [
        ("ALL", "4輪すべて", "All four wheels", "ABS_REGELSIMULATION", None),
    ]),
    ("dsc_sim", "DSC 介入の模擬（作動保持）", "Simulate a DSC intervention (latches)", [
        ("VA", "前軸", "Front axle", "DSC_SIM_VA", None),
        ("VA1", "前軸 1", "Front axle 1", "DSC_SIM_VA1", None),
        ("VA2", "前軸 2", "Front axle 2", "DSC_SIM_VA2", None),
        ("VA3", "前軸 3", "Front axle 3", "DSC_SIM_VA3", None),
        ("HA", "後軸", "Rear axle", "DSC_SIM_HA", None),
        ("HA1", "後軸 1", "Rear axle 1", "DSC_SIM_HA1", None),
        ("HA2", "後軸 2", "Rear axle 2", "DSC_SIM_HA2", None),
        ("HA3", "後軸 3", "Rear axle 3", "DSC_SIM_HA3", None),
    ]),
]


def valve_table(dump: model.SgbdDump) -> list[dict]:
    t = dump.table("STEUERN")
    out = []
    for r in t.dicts():
        name, byte, bit = r["STEUER_I_O"].strip(), r["BYTE"].strip(), r["BITWERT"].strip()
        # BITWERT 0x00 は何も駆動しないパディング行（`XYZ` が2行）。
        if not name or int(bit, 16) == 0:
            continue
        out.append({
            "name": name, "byte": int(byte), "bit": bit,
            "corner": CORNER.get(name), "kind": KIND.get(name[:2]) if name in CORNER else None,
        })
    return out


def actuated(hex_frame: str, valves: list[dict]) -> set[str]:
    """フレームが駆動しているビット。**active-LOW**（0 が作動）。

    根拠: `DRUCKABBAU_VL` と `_VR` は1フレームだけ違い、その差がちょうど
    `AVVL` と `AVVR`——前左と前右の**排出弁**である。隅の区別がそこにしか
    現れない以上、極性はこれで確定している。
    """
    b = [int(x, 16) for x in hex_frame.split()[3:6]]
    return {v["name"] for v in valves if not (b[v["byte"]] & int(v["bit"], 16))}


def main() -> int:
    dump = model.load(DUMP, "DSC_E46")
    tel = json.load(open(os.path.join(DATA, "dsc_e46.telegrams.json"), encoding="utf-8"))
    valves = valve_table(dump)
    jobs = {j.name for j in dump.jobs}

    def frames(job: str) -> list[str]:
        return [t["hex"] for t in tel["jobs"].get(job, []) if t["cmd"] == IO_CONTROL]

    # 全出力OFF の候補: 名前の付いた出力ビットが1つも立っていないフレーム。
    #
    # 候補は2つある。`ff f1 ff` と `ff f3 ff` で、違うのは byte 1 の 0x02 ——
    # **STEUERN 表が名前を持っていないビット**である。SGBD が何も言っていない
    # ものを「これも出力ではない」と断じるわけにはいかないので、選ぶ基準は
    # 「どちらが多くのジョブの終端に現れるか」という**観測**にする。
    named = {v["name"] for v in valves}
    known_bits = {(v["byte"], int(v["bit"], 16)) for v in valves}
    candidates = sorted(
        ({f for j in tel["jobs"] for f in frames(j)}),
        key=lambda h: (-sum(1 for j in tel["jobs"] if h in frames(j)), h),
    )
    candidates = [h for h in candidates if not (actuated(h, valves) - REQUEST_BITS)]
    if not candidates:
        raise SystemExit("no all-outputs-off frame found")
    stop_frame = candidates[0]
    terminates = sorted(j for j in tel["jobs"] if stop_frame in frames(j))
    runners = [
        {"telegram": h, "jobs": sum(1 for j in tel["jobs"] if h in frames(j)),
         "differsBy": sorted(
             f"byte {byte} bit 0x{bit:02x}"
             for byte in range(3)
             for bit in (1 << k for k in range(8))
             if ((int(h.split()[3 + byte], 16) ^ int(stop_frame.split()[3 + byte], 16)) & bit)
         )}
        for h in candidates[1:]
    ]
    # 名前の付いていないビットで違う候補が残るなら、それを黙って捨てない。
    for r in runners:
        r["unnamedBits"] = [d for d in r["differsBy"]
                            if (int(d.split()[1]), int(d.split()[3], 16)) not in known_bits]
    if len(terminates) <= max((r["jobs"] for r in runners), default=0):
        raise SystemExit(f"the stop frame is not the most-terminating one: {stop_frame} in {len(terminates)}")
    del named

    fam_out = []
    missing_jobs = []
    for fid, fja, fen, sites in FAMILIES:
        drives = {}
        for site, _, _, job, _ in sites:
            if job is None:
                continue
            if job not in jobs:
                missing_jobs.append(job)
                continue
            bits: set[str] = set()
            for h in frames(job):
                bits |= actuated(h, valves) - REQUEST_BITS
            drives[site] = bits

        fam_out.append({
            "id": fid, "ja": fja, "en": fen,
            "sites": [
                {
                    "site": site, "ja": sja, "en": sen, "job": job,
                    **({"absence": {"ja": absence[0], "en": absence[1]}} if absence else {}),
                    # 実測。ただし**手順のどこかの時点で**駆動するものの和集合で
                    # あって、同時に駆動するという意味ではない。静的抽出には順序が
                    # 無く、`NA_ENTLUEFTUNG_LI` の和集合には反対側の排出弁も入る
                    # ——エア抜き手順としては筋が通るが、こちらが解釈することでは
                    # ない。「この操作は前左だけを触る」とは言わない。
                    **({"drives": sorted(drives[site])} if site in drives else {}),
                }
                for site, sja, sen, job, absence in sites
            ],
        })

    if missing_jobs:
        raise SystemExit(f"families name jobs the SGBD does not have: {missing_jobs}")

    doc = {
        "schema": 1,
        "module": "dsc_e46",
        "generatedFrom": {
            "dump": "DSC_E46.json", "dumpSha256": dump.sha256,
            "telegrams": "dsc_e46.telegrams.json",
            "generator": GENERATOR,
            "generatedAt": datetime.datetime.now(datetime.timezone.utc)
            .replace(microsecond=0).isoformat(),
        },
        "encoding": "active-low",
        "requestBits": sorted(REQUEST_BITS),
        "valves": valves,
        "families": fam_out,
        "stop": {
            "id": "APP_ALL_OUTPUTS_OFF",
            # **アプリの構成物**。SGBD が定めた停止ではない。
            "provenance": "app-construct",
            "job": "STEUERN_DIGITAL",
            "telegram": stop_frame,
            "terminates": terminates,
            # 選ばれなかった候補。捨てずに残す——SGBD が名前を持たないビットで
            # 違うだけなので、「どちらでもよい」と判断する根拠がこちらには無い。
            "runnersUp": runners,
            "note": {
                "ja": ("この停止は本アプリが組み立てたものです。DSC の SGBD に停止ジョブはなく、"
                       "タイムアウトも最大駆動時間も記載がありません（ダンプ全体に `Stop`/`Abbruch`/"
                       "`abschalt`/`_AUS` は0件）。送るのは、SGBD 自身の複合ジョブ"
                       f"{len(terminates)}件がバイトコードの終端に置いているのと同じフレームです。"
                       "弁もポンプも全て落ちます（残る2ビットは出力ではなく要求フラグの "
                       "`B_ASC`/`B_MSR` で、なぜ残るのか SGBD は述べていません）。"),
                "en": ("This stop is the app's own construct. The DSC SGBD has no stop job, states no timeout "
                       "and no maximum run time (the whole dump contains no `Stop`, `Abbruch`, `abschalt` or "
                       f"`_AUS`). What it sends is the frame that {len(terminates)} of the SGBD's own compound "
                       "jobs put at the end of their bytecode. Every valve and both pumps drop out; the two "
                       "bits that remain are the request flags `B_ASC`/`B_MSR`, not outputs, and the SGBD does "
                       "not say why they are set."),
            },
        },
    }

    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, OUT)

    n_sites = sum(len(f["sites"]) for f in fam_out)
    n_absent = sum(1 for f in fam_out for s in f["sites"] if s["job"] is None)
    print(f"  valves={len(valves)}  families={len(fam_out)}  sites={n_sites} "
          f"(absent={n_absent})  stop terminates {len(terminates)} jobs")
    print(f"  stop frame: {stop_frame}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
