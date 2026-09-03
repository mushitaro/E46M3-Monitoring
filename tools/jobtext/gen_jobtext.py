#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  gen_jobtext.py — 押す前の注意文 → public/ecu-data/<module>.jobtext.json
# ----------------------------------------------------------------------------
#  以前ここは5スロット（何が行われるか／車で何が起きるか／どうなれば問題ないか／
#  そうならなかったら何を疑うか／実行後に何が残るか）を 1640 フィールド生成して
#  いた。うち 1315 が定型文で、操作画面には見出しが5つ並び、ほぼ同じ文が出ていた。
#  SMG II の14手順に至っては、全部が `TESTPRG_STARTEN` の同じ文を継承していた。
#
#  それらが答えようとしていたことは、UI 側がもっと正確に答える:
#      何が行われるか  → 手順リスト（ECU 自身の進行語彙、またはジョブの送信計画）
#      どうなれば正常  → 結果一覧と、記録された値
#      何が残るか      → 前後の数値と、元からある不可逆バナー
#
#  残るのは「押す前に知らないと困ること」1本だけである。
#
#  ゲート: risk=high または不可逆のジョブは注意文を持たねばならない。無ければ
#  非ゼロ終了。旧ゲート（較正/書換に定型 fail/after があれば失敗）が守っていた
#  性質——危険な操作が総称文のまま出荷されない——を、スロットが消えた後も
#  守り続けるための置き換えである。
#
#  実行: python tools/jobtext/gen_jobtext.py
# ============================================================================
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))

from jobtext import cautions                 # noqa: E402
from jobtext.overrides import OVERRIDES      # noqa: E402

DATA = os.path.join(HERE, "..", "..", "public", "ecu-data")
MODULES = ("mss54", "smg2", "dsc_e46")
SCHEMA = 2

# 注意文が必須なジョブ。押した結果が残る、あるいは戻せないもの。
def needs_caution(job: dict) -> bool:
    return job["risk"] == "high" or bool(job["op"].get("irreversible"))


def build(module: str) -> tuple[dict, list[str], int]:
    profile = json.load(open(os.path.join(DATA, f"{module}.jobs.json"), encoding="utf-8"))
    out: list[dict] = []
    gaps: list[str] = []
    required = 0

    for job in profile["jobs"]:
        jid = job["id"]
        # 個体の上書きが最優先。次に族の注意文。
        ov = OVERRIDES.get(module, {}).get(jid)
        text = ov or cautions.caution_for(jid)
        if text:
            out.append({"id": jid, "caution": {"ja": text[0], "en": text[1]}})
        if needs_caution(job):
            required += 1
            if not text:
                gaps.append(f"{module}.{jid} ({job['risk']}"
                            f"{'/' + job['op']['irreversible'] if job['op'].get('irreversible') else ''})")

    return ({"schema": SCHEMA, "module": module, "jobs": out}, gaps, required)


def main() -> int:
    all_gaps: list[str] = []
    total_required = 0
    for module in MODULES:
        doc, gaps, required = build(module)
        all_gaps += gaps
        total_required += required
        path = os.path.join(DATA, f"{module}.jobtext.json")
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=1)
            f.write("\n")
        os.replace(tmp, path)
        print(f"  {module:10} cautions={len(doc['jobs']):4}  "
              f"required={required:3}  missing={len(gaps):3}")

    covered = total_required - len(all_gaps)
    print(f"\n  high-risk or irreversible: {total_required}, with a caution: {covered}, "
          f"missing: {len(all_gaps)}")
    if all_gaps:
        # 危険な操作が注意文なしで出荷されることを許さない。計画では負債69件を
        # 見込んで2段階（警告→失敗）にするつもりだったが、族の正規表現表で全部
        # 埋まったので最初から失敗させる。埋まっている状態を維持し続ける方が、
        # 後から埋め直すより安い。
        print("\n[FAIL] high-risk or irreversible jobs with no caution:")
        for g in all_gaps:
            print("  -", g)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
