#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成物の不変条件。CI で走らせる。`python tools/verify_ecu_data.py`

このファイルの存在理由は1行目の検査にある: **ジョブが黙って消えないこと**。
旧生成器は 323 件中 192 件を落としながら exit 0 で終わり、CI が通り、
アプリだけが静かにジョブを失っていた。件数の表明があれば起きなかった。
"""
from __future__ import annotations

import collections
import json
import os
import sys

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "..", "public", "ecu-data")
sys.path.insert(0, os.path.abspath(HERE))
import paths                                                # noqa: E402

DUMP = paths.require_dump_dir()   # リポジトリ外。理由は tools/paths.py
MODULES = {"mss54": "MSS54DS0", "smg2": "SMG2", "dsc_mk60": "DSC_E46"}
TOTAL_JOBS = 323
TOTAL_RESULTS = 2311

FAILS: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        FAILS.append(msg)


def load(name: str) -> dict:
    return json.load(open(os.path.join(DATA, name), encoding="utf-8"))


profiles = {mid: load(f"{mid}.jobs.json") for mid in MODULES}
dumps = {mid: json.load(open(os.path.join(DUMP, f"{d}.json"), encoding="utf-8"))
         for mid, d in MODULES.items()}

# --- 1. 件数。これが無かったから 192 件が消えた -----------------------------
total = sum(len(p["jobs"]) for p in profiles.values())
check(total == TOTAL_JOBS, f"expected {TOTAL_JOBS} jobs across all modules, got {total}")
for mid, p in profiles.items():
    check(len(p["jobs"]) == p["jobCount"],
          f"{mid}: {len(p['jobs'])} jobs emitted but jobCount says {p['jobCount']}")
    check(p["jobCount"] == dumps[mid]["jobCount"],
          f"{mid}: jobCount {p['jobCount']} disagrees with the dump's {dumps[mid]['jobCount']}")

# --- 2. ダンプの全 id がちょうど1回、1ファイルだけに現れる ------------------
for mid, p in profiles.items():
    emitted = [j["id"] for j in p["jobs"]]
    dup = [k for k, v in collections.Counter(emitted).items() if v > 1]
    check(not dup, f"{mid}: duplicate job ids {dup}")
    want = {j["job"] for j in dumps[mid]["jobs"]}
    check(set(emitted) == want, f"{mid}: emitted set differs from the dump: "
                                f"missing={sorted(want - set(emitted))[:5]} "
                                f"extra={sorted(set(emitted) - want)[:5]}")

# --- 3. 結果が全部出ていること、各1ロール ------------------------------------
res_total = sum(len(j["results"]) for p in profiles.values() for j in p["jobs"])
check(res_total == TOTAL_RESULTS, f"expected {TOTAL_RESULTS} results, got {res_total}")
roles = collections.Counter(r["role"] for p in profiles.values() for j in p["jobs"] for r in j["results"])
check(sum(roles.values()) == res_total, "some result carries no role")
# ロール分布を固定する。分類器を変えたら件数差分で必ず見える。
check(roles["status"] == 317, f"JOB_STATUS-family count changed: {roles['status']} (was 317)")

# --- 4. 単位/平文行のリンク先が実在すること ----------------------------------
for mid, p in profiles.items():
    for j in p["jobs"]:
        names = {r["name"] for r in j["results"]}
        for r in j["results"]:
            # `text` は必ず値に紐付く（紐付かないものは model が `value` に格上げ済み）。
            # `unit` は紐付かないものが SGBD に 8 件実在するので、あることを強制せず、
            # あるなら実在することだけを確かめる。
            if r["role"] == "text":
                check(r.get("valueOf") is not None, f"{mid}.{j['id']}.{r['name']}: text with no valueOf")
            if r.get("valueOf") is not None:
                check(r["valueOf"] in names,
                      f"{mid}.{j['id']}.{r['name']}: valueOf {r['valueOf']} does not exist")
            for key in ("unitRes", "textRes"):
                if key in r:
                    check(r[key] in names, f"{mid}.{j['id']}.{r['name']}: {key} {r[key]} missing")

# --- 5. 規定値 --------------------------------------------------------------
# 存在するのは SMG2 の ADAPTIONSWERTE_LESEN だけ。値行に 43 件
# （パーサ自体は 44 件を拾うが、44 件目は KORR_SW_EVEN_EINH という単位行で、
#  その値行 KORR_SW_EVEN_WERT は自分のコメントで既に同じ Default を持つ）。
spec_rows = [(mid, j["id"], r) for mid, p in profiles.items() for j in p["jobs"]
             for r in j["results"] if "spec" in r]
smg2_specs = [x for x in spec_rows if x[0] == "smg2" and x[1] == "ADAPTIONSWERTE_LESEN"]
check(len(smg2_specs) == 43, f"expected 43 specs on SMG2 ADAPTIONSWERTE_LESEN values, got {len(smg2_specs)}")
mss54_specs = [x for x in spec_rows if x[0] == "mss54"]
check(not mss54_specs, f"MSS54 has no published ranges; got {[x[2]['name'] for x in mss54_specs]}")
for mid, job, r in spec_rows:
    s = r["spec"]
    if all(k in s for k in ("min", "default", "max")):
        check(s["min"] <= s["default"] <= s["max"],
              f"{mid}.{job}.{r['name']}: min<=default<=max violated {s}")
    check("source" in s, f"{mid}.{job}.{r['name']}: a spec with no source text is unreviewable")

# 既知の値を名指しで固定する。
def find(mid: str, job: str, res: str) -> dict | None:
    p = profiles[mid]
    j = next((x for x in p["jobs"] if x["id"] == job), None)
    return next((r for r in j["results"] if r["name"] == res), None) if j else None

r = find("smg2", "ADAPTIONSWERTE_LESEN", "DIFF_V_ACHS_WERT")
check(r and r["spec"]["min"] == -15.875 and r["spec"]["max"] == 15.875,
      f"DIFF_V_ACHS_WERT (German decimal comma): {r and r.get('spec')}")
r = find("smg2", "ADAPTIONSWERTE_LESEN", "M_KUPPL_MAX_WERT")
check(r and r["spec"].get("always") == 700.0, f"M_KUPPL_MAX_WERT always: {r and r.get('spec')}")
r = find("dsc_mk60", "STATUS_LESEN_DDS", "STATUS_KM")
check(r and r["spec"]["max"] == 524280.0, f"DSC STATUS_KM range: {r and r.get('spec')}")

# --- 6. フィールド間制約 -----------------------------------------------------
j = next(x for x in profiles["smg2"]["jobs"] if x["id"] == "ADAPTIONSWERTE_LESEN")
cf = j.get("crossFieldConstraints") or []
check(len(cf) == 1, f"expected exactly one cross-field constraint, got {len(cf)}")
if cf:
    check(cf[0]["between"] == ["POS_EINKUP_WERT", "POS_AUSKUP_WERT"], f"cross-field pair: {cf[0]['between']}")
    check((cf[0]["min"], cf[0]["max"]) == (430.0, 590.0), f"cross-field bounds: {cf[0]}")
# 制約の数値が当のフィールド自身の範囲を汚していないこと
r = find("smg2", "ADAPTIONSWERTE_LESEN", "POS_EINKUP_WERT")
check(r and (r["spec"]["min"], r["spec"]["max"]) == (640.0, 1002.0),
      f"POS_EINKUP_WERT contaminated by the Hinweis: {r and r.get('spec')}")

# --- 7. 引数による分割 -------------------------------------------------------
vals = [r for r in j["results"] if r["role"] == "value"]
unplaced = [r["name"] for r in vals if not r.get("whenArg")]
check(not unplaced, f"ADAPTIONSWERTE_LESEN value results outside the clutch/gearbox partition: {unplaced}")
for r in vals:
    check(r["whenArg"]["provenance"] == "inferred",
          f"{r['name']}: the SGBD does not machine-encode this partition; it must say so")

# --- 8. ファセットが全ジョブを覆うこと ---------------------------------------
for mid, p in profiles.items():
    n = len(p["jobs"])
    for facet in ("class", "audience", "system"):
        ctr = collections.Counter(j[facet] for j in p["jobs"])
        check(sum(ctr.values()) == n, f"{mid}: facet {facet} covers {sum(ctr.values())} of {n}")
        check("unknown" not in ctr or facet == "system",
              f"{mid}: facet {facet} has unknown entries")
    unk = [j["id"] for j in p["jobs"] if j["system"] == "unknown"]
    check(not unk, f"{mid}: jobs with no system: {unk}")
    check(all(j["op"].get("kind") != "unknown" for j in p["jobs"]),
          f"{mid}: jobs with unknown operation kind: "
          f"{[j['id'] for j in p['jobs'] if j['op'].get('kind') == 'unknown']}")

# --- 9. 故障本文がコード付きであること ---------------------------------------
# 旧版は 0xF7 XOR スクレイプで、コードが付かず 250 件で打ち切られていた。
for mid, p in profiles.items():
    ft = p["faultText"]
    check(len(ft) > 0, f"{mid}: no fault text")
    check(len(ft) != 250, f"{mid}: exactly 250 fault entries - that is the old truncation, not a coincidence")
    check(all("code" in e and "text" in e for e in ft), f"{mid}: fault entries without a code")
    codes = [e["code"] for e in ft]
    check(len(codes) == len(set(codes)), f"{mid}: duplicate fault codes")

# --- 10. フリーズフレームがデコード可能であること ----------------------------
mss = profiles["mss54"]["envFields"]
check(len(mss) >= 80, f"mss54: {len(mss)} environment fields")
scaled = [e for e in mss if "scale" in e]
check(len(scaled) >= 70, f"mss54: only {len(scaled)} env fields carry a scale; freeze frames stay raw hex")
rpm = next((e for e in mss if e["code"] == "0x00"), None)
check(rpm and rpm.get("scale") == 40.0, f"mss54 env 0x00 (Motordrehzahl) scale: {rpm}")

# --- 11. テキスト intern が効いていること ------------------------------------
for mid, p in profiles.items():
    n_texts = len(p["texts"])
    refs = set()
    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in ("comment", "desc", "text", "source") and isinstance(v, int):
                    refs.add(v)
                else:
                    walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(p["jobs"]); walk(p["faultText"]); walk(p["envFields"]); walk(p["vocabularies"])
    check(all(0 <= i < n_texts for i in refs), f"{mid}: text ref out of range")
    orphans = set(range(n_texts)) - refs
    check(not orphans, f"{mid}: {len(orphans)} interned texts referenced by nothing")

# --- 12. 出所の記録 ----------------------------------------------------------
for mid, p in profiles.items():
    g = p.get("generatedFrom") or {}
    for k in ("dump", "dumpSha256", "generator", "generatedAt"):
        check(bool(g.get(k)), f"{mid}: generatedFrom.{k} missing")
    check(len(g.get("dumpSha256", "")) == 64, f"{mid}: dumpSha256 is not a sha256")

if FAILS:
    print(f"FAIL ({len(FAILS)})")
    for f in FAILS:
        print("  -", f)
    sys.exit(1)

print(f"ok - {total} jobs, {res_total} results, "
      f"{sum(len(p['faultText']) for p in profiles.values())} coded faults, "
      f"{sum(len(p['envFields']) for p in profiles.values())} env fields")
print(f"   roles: {dict(roles.most_common())}")
