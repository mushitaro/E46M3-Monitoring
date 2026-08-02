#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  verify_translation_quality.py — ecu-data/*.json の「未訳の独語残り」を定量測定する。
#  gen_from_dump.py / gen_smg2_workflows.py 再生成後に実行し、対策前後の
#  label/desc/faultText 各カテゴリの残存率(%)を比較する。
#  ※ translate.py の内部(leftover_ratio)には依存しない — 出力JSONのja文字列を
#     外形的に検査することで、生成ロジック自体のバグも検出できるようにする
#    （生成側と同じロジックで自己採点しない）。
#  使い方: python tools/verify_translation_quality.py [--json] [--list mss54 faultText]
# ============================================================================
import json, os, re, sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # Windowsコンソール(cp932)でüäö等が落ちるのを防ぐ

HERE = os.path.dirname(__file__)
# データは public/ecu-data に移した。ここが古いままだったため、この検査は
# 「ファイルが無ければ continue」で3件とも黙って飛ばし、ヘッダだけ出して
# exit 0 していた——何も検査しない検査。下の「1件も読めなければ失敗」が
# その再発を止める。
ECU_DIR = os.path.join(HERE, "..", "public", "ecu-data")
sys.path.insert(0, HERE)
from translate import DICT  # ja==en の既存キー = 意図的な保持略語を自動で許可リスト化

_DICT_RETAINED = {k for k, (ja, en) in DICT.items() if ja and ja == en}
# DICTにまだ無いが正当な残存として許容する略語（小さく保つ・DICT拡充で置き換えていく）
# ※ SGBD原文のテーブル/カラム名参照（例: "table LED WERT ANZEIGE_TEXT 参照"）や
#   SGBD由来の短い識別子的パラメータ名（Nmax/Vmax等、単語というより変数記号に近い）は
#   意図的に保持するのが正しい翻訳であり「未訳」ではないため、ここに含めている。
_EXTRA_ALLOW = {"CAN", "LSZ", "PDC", "IHKA", "KL15", "DME", "MSV", "M3", "S54", "E46",
                "ECU", "ID", "HW", "SW", "ZB", "CSL",
                "NMAX", "VMAX", "TNMAX", "ROH", "MUL", "LMM", "UEXT1", "UEXT2", "UEXT",
                "TUMG", "TABG", "PUMG", "ISERV", "SSERV", "TI", "SIEMENS", "MIL", "LED",
                "FGR", "SACHS", "OKAY", "ERROR", "ARGCOMMENT", "JOBCOMMENT"}
ALLOW = _DICT_RETAINED | _EXTRA_ALLOW
_LATIN_RUN = re.compile(r"[A-Za-zÄÖÜäöüß]{3,}")


def has_leftover_german(ja_text):
    return any(w.upper() not in ALLOW for w in _LATIN_RUN.findall(ja_text or ""))


def pct(items):
    return round(100 * sum(1 for s in items if has_leftover_german(s)) / len(items), 1) if items else 0.0


def collect(d):
    labels, descs = [], []
    for g in d.get("groups", []):
        for p in g.get("params", []):
            labels.append(p.get("ja", ""))
            if p.get("desc"): descs.append(p["desc"].get("ja", ""))
    for a in d.get("actuators", []) + d.get("testJobs", []):
        labels.append(a.get("ja", ""))
        if a.get("desc"): descs.append(a["desc"].get("ja", ""))
    faults = [f.get("ja", "") for f in d.get("faultText", [])]
    return labels, descs, faults


def main():
    results = {}
    for fname in ("mss54.json", "smg2.json", "dsc_mk60.json"):
        path = os.path.join(ECU_DIR, fname)
        if not os.path.exists(path):
            sys.stderr.write(f"[FATAL] {path} not found — this check would measure nothing.\n")
            return 1
        d = json.load(open(path, encoding="utf-8"))
        labels, descs, faults = collect(d)
        results[fname[:-5]] = {
            "label": pct(labels), "label_n": len(labels),
            "desc": pct(descs), "desc_n": len(descs),
            "faultText": pct(faults), "faultText_n": len(faults),
        }
    if "--list" in sys.argv:
        i = sys.argv.index("--list"); mod, cat = sys.argv[i + 1], sys.argv[i + 2]
        d = json.load(open(os.path.join(ECU_DIR, mod + ".json"), encoding="utf-8"))
        items = dict(zip(("label", "desc", "faultText"), collect(d)))[cat]
        for s in items:
            if has_leftover_german(s): print(s)
        return
    if "--json" in sys.argv:
        print(json.dumps(results, ensure_ascii=False, indent=1)); return
    print(f"{'module':10} {'label%':>8} {'desc%':>8} {'fault%':>8}   (n=label/desc/fault)")
    for mod, r in results.items():
        print(f"{mod:10} {r['label']:>7}% {r['desc']:>7}% {r['faultText']:>7}%   "
              f"(n={r['label_n']}/{r['desc_n']}/{r['faultText_n']})")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
