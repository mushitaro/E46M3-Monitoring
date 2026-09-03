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

# 51 モジュール全部。表で持たず index.json から読む——生成器に足したのに
# ここに足し忘れたモジュールが「検査に通った」ことになるのを避ける。
MODULES = tuple(
    m["id"] for m in json.load(
        open(os.path.join(DATA, "index.json"), encoding="utf-8"))["modules"]
)
SCHEMA = 2

# 分類できなかったジョブの注意文。**名前ではなくクラスで引く。**
#
# SGBD がそのジョブについて何も述べていない、というのがこのクラスの意味である。
# だから名前から族を当てて個別の文を書くことはできない——書けばそれは、我々が
# 知らないことを知っているかのように書くことになる。160 件あり、全部同じ文で
# 正しい。1 件ずつ書けばそれは 160 通りの作り話になる。
#
# risk=high なのは「危険だと分かっている」からではなく「分からない」から。
# その区別が文面に出ている必要がある。
UNCLASSIFIED_CAUTION = (
    "この ECU の SGBD が、このジョブについて何も述べていません。何をするものか分からないので、"
    "**実車では実行できません。** 危険度は「高」としていますが、これは危険だと分かっている"
    "という意味ではなく、分からないという意味です。",
    "This ECU's SGBD says nothing about this job. Because we cannot say what it does, **it cannot "
    "be run on a vehicle.** Its risk is marked high — not because we know it is dangerous, but "
    "because we do not know.",
)

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
        if not text and job["class"] == "unclassified":
            text = UNCLASSIFIED_CAUTION
        if text:
            out.append({"id": jid, "caution": {"ja": text[0], "en": text[1]}})
        if needs_caution(job):
            required += 1
            if not text:
                gaps.append(f"{module}.{jid} ({job['risk']}"
                            f"{'/' + job['op']['irreversible'] if job['op'].get('irreversible') else ''})")

    return ({"schema": SCHEMA, "module": module, "jobs": out}, gaps, required)


def render(doc: dict) -> str:
    return json.dumps(doc, ensure_ascii=False, indent=1) + "\n"


def main() -> int:
    # `--check` は「書かずに、ディスク上のものが今生成されるものと一致するか見る」。
    #
    # これまで sys.argv を一切見ておらず、--check を付けても常に書いていた——CLAUDE.md
    # の検査コマンド一覧に載っているのに、検査ではなく生成をしていたということ。名前が
    # 約束していることをしない引数は、無いより悪い。
    check_only = "--check" in sys.argv
    all_gaps: list[str] = []
    stale: list[str] = []
    total_required = 0
    for module in MODULES:
        doc, gaps, required = build(module)
        all_gaps += gaps
        total_required += required
        path = os.path.join(DATA, f"{module}.jobtext.json")
        text = render(doc)
        if check_only:
            on_disk = open(path, encoding="utf-8").read() if os.path.exists(path) else None
            if on_disk != text:
                stale.append(module if on_disk is not None else f"{module} (missing)")
        else:
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                f.write(text)
            os.replace(tmp, path)
        print(f"  {module:10} cautions={len(doc['jobs']):4}  "
              f"required={required:3}  missing={len(gaps):3}")

    covered = total_required - len(all_gaps)
    print(f"\n  high-risk or irreversible: {total_required}, with a caution: {covered}, "
          f"missing: {len(all_gaps)}")
    if check_only and stale:
        print("\n[FAIL] 生成物がディスク上のものと一致しません（生成器を回してください）:")
        for m in stale:
            print("  -", m)
        return 1
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
