#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""specs.py の実データ突き合わせ。`python tools/sgbd/test_specs.py` で走る。

依存を増やさないよう pytest は使わない（このリポジトリの Python 側は素の
インタプリタだけで回る）。失敗は非ゼロ終了。
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from sgbd.specs import CLUTCH_ABBREV, parse_cross_field, parse_spec  # noqa: E402

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import paths                                                # noqa: E402

DUMP = paths.require_dump_dir()   # リポジトリ外。理由は tools/paths.py
FAILS: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        FAILS.append(msg)


def dump(name: str) -> dict:
    return json.load(open(os.path.join(DUMP, name + ".json"), encoding="utf-8"))


def results(sgbd: str, job: str) -> dict[str, str]:
    d = dump(sgbd)
    j = next(x for x in d["jobs"] if x["job"] == job)
    return {r["name"]: r["comment"] for r in j["results"]}


# --- 1. 総数。SMG2 ADAPTIONSWERTE_LESEN にちょうど 44 -----------------------
adapt = results("SMG2", "ADAPTIONSWERTE_LESEN")
parsed = {n: parse_spec(c) for n, c in adapt.items()}
got = {n: s for n, s in parsed.items() if s}
check(len(got) == 44, f"expected 44 specs in SMG2 ADAPTIONSWERTE_LESEN, got {len(got)}")

# --- 2. 順序不変条件 --------------------------------------------------------
for n, s in got.items():
    if s.min is not None and s.max is not None and s.default is not None:
        check(s.min <= s.default <= s.max, f"{n}: min<=default<=max violated ({s.min},{s.default},{s.max})")

# --- 3. 独語小数コンマ、かつ Max の前にカンマが無い書式 ---------------------
s = got["DIFF_V_ACHS_WERT"]
check((s.min, s.default, s.max) == (-15.875, 0.0, 15.875), f"DIFF_V_ACHS_WERT: {s}")
check(s.unit == "km/h", f"DIFF_V_ACHS_WERT unit: {s.unit!r}")

# --- 4. `Immer:` は唯一の合法値。Min/Default/Max と併記されうる -------------
s = got["M_KUPPL_MAX_WERT"]
check(s.always == 700.0, f"M_KUPPL_MAX_WERT always: {s.always}")
check((s.min, s.default, s.max) == (1.0, 700.0, 1020.0), f"M_KUPPL_MAX_WERT range: {s}")

# --- 5. Default が先、min/max が小文字・コロン無しの語順 --------------------
s = got["OFF_A_LONG_WERT"]
check((s.min, s.default, s.max, s.unit) == (1500.0, 1800.0, 2100.0, "mV"), f"OFF_A_LONG_WERT: {s}")

# --- 6. Default だけ（範囲なし）でも spec として成立する --------------------
s = got["ANSCHLAG_SW_EVEN_WERT"]
check(s.default == 207.0 and s.min is None and s.max is None, f"ANSCHLAG_SW_EVEN_WERT: {s}")

# --- 7. 単位なし ------------------------------------------------------------
s = got["ADAPT_K1_WERT"]
check((s.min, s.default, s.max) == (17.0, 52.0, 114.0), f"ADAPT_K1_WERT: {s}")

# --- 8. フィールド間制約。句読点2変種が同一の制約になること -----------------
cf = [parse_cross_field(n, c, CLUTCH_ABBREV) for n, c in adapt.items()]
cf = [x for x in cf if x]
check(len(cf) == 2, f"expected the Hinweis on both POS_EINKUP and POS_AUSKUP, got {len(cf)}")
check(
    all(x.between == ("POS_EINKUP_WERT", "POS_AUSKUP_WERT") for x in cf),
    f"cross-field pair: {[x.between for x in cf]}",
)
check(
    all((x.min, x.max, x.unit) == (430.0, 590.0, "Ink") for x in cf),
    f"cross-field bounds differ between the two punctuation variants: {[(x.min, x.max, x.unit) for x in cf]}",
)

# --- 9. フィールド間制約の数値が、そのフィールド自身の範囲を汚染しないこと ---
# POS_EINKUP は 640..1002。Hinweis の 430/590 を拾ってしまうと範囲判定が壊れる。
s = got["POS_EINKUP_WERT"]
check((s.min, s.max) == (640.0, 1002.0), f"POS_EINKUP_WERT contaminated by the Hinweis: {s}")
s = got["POS_AUSKUP_WERT"]
check((s.min, s.max) == (146.0, 654.0), f"POS_AUSKUP_WERT contaminated by the Hinweis: {s}")

# --- 10. 否定テスト: `...oder ausser Bereich` から spec を作らないこと -------
neg = fp = 0
for sgbd in ("MSS54DS0", "SMG2", "DSC_E46"):
    for j in dump(sgbd)["jobs"]:
        for r in j["results"]:
            c = (r["comment"] or "").lower()
            if "ausser" in c and "bereich" in c:
                neg += 1
                if parse_spec(r["comment"]):
                    fp += 1
                    FAILS.append(f"false positive on boilerplate: {sgbd}.{j['job']}.{r['name']}")
check(neg > 0, "the 'ausser Bereich' boilerplate vanished from the dumps; this negative test is now vacuous")

# --- 11. 散文中の上限をレンジと誤認しないこと -------------------------------
# `alle Pruefcodes, max. 1024 Byte` はバッファ長であって値域ではない。上限だけを
# 範囲として出すと「1024 超は異常」という検査が生まれる。
check(parse_spec("alle Pruefcodes, max. 1024 Byte") is None, "a lone max is prose, not a range")
check(parse_spec("max. uebertragbares Kupplungsmoment") is None, "a lone prose 'max.' is not a range")

# --- 12. MSS54 と DSC の規定値の件数を固定する ------------------------------
# MSS54 は 0、DSC は 1（走行距離の値域のみ）。「無い」ことが事実なので、
# 増えたら必ずレビューが要る。
expected = {"MSS54DS0": 0, "DSC_E46": 1}
for sgbd, want in expected.items():
    hits = [
        f"{j['job']}.{r['name']}"
        for j in dump(sgbd)["jobs"]
        for r in j["results"]
        if parse_spec(r["comment"])
    ]
    check(len(hits) == want, f"{sgbd}: expected {want} specs, got {len(hits)}: {hits}")

# DSC の唯一の値域が本物であることを名指しで確認する。
km = parse_spec("Umweltbedingung Kilometerstand / Wertebereich: 0 - 524280 km")
check(km is not None and (km.min, km.max, km.unit) == (0.0, 524280.0, "km"), f"STATUS_KM: {km}")

if FAILS:
    print(f"FAIL ({len(FAILS)})")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)
print(f"ok - 44 specs, 2 cross-field constraints, {neg} boilerplate comments correctly ignored")
