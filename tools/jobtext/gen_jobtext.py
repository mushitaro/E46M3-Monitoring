#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  gen_jobtext.py — オーナー向けジョブ説明 → public/ecu-data/<module>.jobtext.json
# ----------------------------------------------------------------------------
#  部品辞書 × 動作辞書 でテンプレート生成し、overrides/ の手書きで上書きする。
#
#  confidence は **フィールド単位**で記録する。1つのジョブに手書きの `does` と
#  テンプレートの `fail` が同居するのは普通で、読む側はどちらを読んでいるのか
#  知る権利がある。
#
#  実行: python tools/jobtext/gen_jobtext.py
# ============================================================================
from __future__ import annotations

import collections
import json
import os
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))

from jobtext import actions, components   # noqa: E402
from jobtext.overrides import OVERRIDES   # noqa: E402

DATA = os.path.join(HERE, "..", "..", "public", "ecu-data")
MODULES = ("mss54", "smg2", "dsc_mk60")
SLOTS = ("does", "observe", "pass", "fail", "after")

# 手書きが必須のクラス。ここにテンプレートの `fail` / `after` を出してはいけない
# ——「失敗したら何を疑うか」が総称文なら、それは説明ではなく体裁である。
MUST_AUTHOR = {"calibration", "programming"}


def build(module: str) -> tuple[dict, collections.Counter, list[str]]:
    profile = json.load(open(os.path.join(DATA, f"{module}.jobs.json"), encoding="utf-8"))
    conf = collections.Counter()
    gaps: list[str] = []
    out = []

    for job in profile["jobs"]:
        jid = job["id"]
        comp = components.match(jid)
        act = actions.for_kind(job["op"]["kind"], job["class"])
        ov = OVERRIDES.get(module, {}).get(jid, {})

        if comp is None and not ov:
            gaps.append(f"{module}.{jid}: no component match and no override")
            continue
        if act is None and not ov:
            gaps.append(f"{module}.{jid}: no action template for kind={job['op']['kind']}")
            continue

        text: dict[str, dict[str, str]] = {}
        confidence: dict[str, str] = {}
        for slot in SLOTS:
            if slot in ov:
                text[slot] = {"ja": ov[slot][0], "en": ov[slot][1]}
                confidence[slot] = "authored"
                continue
            if act is None:
                gaps.append(f"{module}.{jid}: slot {slot} has neither override nor template")
                continue
            ja, en = act[slot]
            fmt = {
                "c": comp["ja"] if comp else jid,
                "where": comp["ja_where"] if comp else "",
            }
            fmt_en = {
                "c": comp["en"] if comp else jid,
                "where": comp["en_where"] if comp else "",
            }
            text[slot] = {"ja": ja.format(**fmt).strip(), "en": en.format(**fmt_en).strip()}
            # 部品辞書の `where` が空なら、テンプレートの穴が埋まっていない。
            thin = comp is not None and not comp["ja_where"] and "{where}" in ja
            confidence[slot] = "template-thin" if thin else "template"

        # 体感できること（sense）は、あるときだけ `fail` に足す。
        if comp and comp.get("ja_sense") and confidence.get("fail") != "authored":
            text["fail"]["ja"] += " " + comp["ja_sense"]
            text["fail"]["en"] += " " + comp["en_sense"]

        if "caution" in ov:
            text["caution"] = {"ja": ov["caution"][0], "en": ov["caution"][1]}
            confidence["caution"] = "authored"

        # 手書き必須クラスにテンプレートの fail/after を出さない
        if job["class"] in MUST_AUTHOR:
            for slot in ("fail", "after"):
                if confidence.get(slot, "").startswith("template"):
                    gaps.append(f"{module}.{jid}: class={job['class']} needs an authored '{slot}'")

        for v in confidence.values():
            conf[v] += 1

        entry = {"id": jid, "text": text, "confidence": confidence}
        if comp:
            entry["from"] = {"component": comp["key"], "action": job["op"]["kind"]}
        out.append(entry)

    return ({"schema": 1, "module": module, "jobs": out}, conf, gaps)


def main() -> int:
    total = collections.Counter()
    all_gaps: list[str] = []
    for module in MODULES:
        doc, conf, gaps = build(module)
        total.update(conf)
        all_gaps += gaps
        path = os.path.join(DATA, f"{module}.jobtext.json")
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
            f.write("\n")
        os.replace(tmp, path)
        n = len(doc["jobs"])
        authored = sum(1 for j in doc["jobs"] if all(v == "authored" for v in j["confidence"].values()))
        print(f"  {module:10} jobs={n:4} fully-authored={authored:3} "
              f"fields={dict(conf.most_common())}")

    print(f"\n  field confidence overall: {dict(total.most_common())}")
    if all_gaps:
        print(f"\n[GAPS] {len(all_gaps)} jobs need authored text:")
        for g in all_gaps[:40]:
            print("  -", g)
        if len(all_gaps) > 40:
            print(f"  ... and {len(all_gaps) - 40} more")
        # 網羅の穴は失敗にする。埋まっていないことを黙って出荷しない。
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
