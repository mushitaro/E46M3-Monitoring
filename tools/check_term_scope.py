#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""族別の語彙が、その族の外の ECU を名乗っていないことの検査。

`python tools/check_term_scope.py`

`tools/terms/*.py` は ECU の族で分けてあるが、PHRASES は**文字列完全一致で全体に効く**。
独語の散文ならそれでよい——同じ文はどこでも同じ意味だから。裸の SGBD 識別子は違う:
同じ名前が多くの SGBD に別の意味で存在する。

これが実際に起きた形: `shd46.py` が `STEUERN_DIGITAL` に「サンルーフ駆動」と付けており、
その識別子は 14 の SGBD にある。DSC ではブレーキ電磁弁 8 個とポンプを駆動するジョブで、
ラベルは「サンルーフ駆動」になっていた。3 モジュールしか無かった間は起きようがなく、
51 に増やした最初の生成で出た。

規則: 族別ファイルが識別子をキーにしてよいのは、その識別子が自分の族の SGBD にしか
存在しないときだけ。外にもあるものは SCOPED_PHRASES に置く（term_overrides が SGBD
単位で引く）。`common.py` は例外——そこの訳は全 ECU に通る一般語であることが前提。

判定はダンプに対する実測で、推測ではない。
"""
from __future__ import annotations

import ast
import collections
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import paths                                                # noqa: E402
from terms import FAMILY_SGBDS                              # noqa: E402

DUMP = paths.require_dump_dir()
TERMS = os.path.join(HERE, "terms")
DATA = os.path.join(HERE, "..", "public", "ecu-data")

# 裸の SGBD 識別子。独語の散文はここに当たらない（空白・小文字を含むため）。
IDENT = re.compile(r"^[A-Z][A-Z0-9_]{2,}$")

# ECU の族ではないファイル。名指しで書くのは、PHRASES を持たないから自動で除外する、
# という作りにすると、族別ファイルの PHRASES を書き損ねた日に検査が黙って通るため。
NOT_A_FAMILY = {
    "common": "一般語。全 ECU に通る前提で書かれている",
    "live_channels": "ライブ値チャンネルの和名。ECU ではなく計測チャンネルの表",
}

FAILS: list[str] = []


def owners() -> dict[str, set[str]]:
    """識別子 -> それを持つ SGBD の集合。ジョブ名・結果名・引数名のすべて。"""
    index = json.load(open(os.path.join(DATA, "index.json"), encoding="utf-8"))
    own: dict[str, set[str]] = collections.defaultdict(set)
    for sgbd in sorted({m["sgbd"][:-4] for m in index["modules"]}):
        d = json.load(open(os.path.join(DUMP, sgbd + ".json"), encoding="utf-8"))
        for j in d["jobs"]:
            own[j["job"]].add(sgbd)
            for r in (j.get("results") or []):
                own[r["name"]].add(sgbd)
            for a in (j.get("args") or []):
                own[a["name"]].add(sgbd)
    return own


def phrases(path: str) -> dict:
    tree = ast.parse(open(path, encoding="utf-8").read())
    for node in tree.body:
        t = getattr(node, "targets", [])
        if t and isinstance(t[0], ast.Name) and t[0].id == "PHRASES":
            return ast.literal_eval(node.value)
    return {}


own = owners()

# 表そのものの検査。ここが古いと、この検査は「調べていない」を「問題なし」と言う。
index = json.load(open(os.path.join(DATA, "index.json"), encoding="utf-8"))
all_sgbds = {m["sgbd"][:-4] for m in index["modules"]}
covered = {s for v in FAMILY_SGBDS.values() for s in v}
missing = sorted(all_sgbds - covered)
if missing:
    FAILS.append(f"FAMILY_SGBDS がどの族にも入れていない SGBD: {missing}")
stray = sorted(covered - all_sgbds)
if stray:
    FAILS.append(f"FAMILY_SGBDS に、モジュール表に無い SGBD がある: {stray}")

for f in sorted(os.listdir(TERMS)):
    stem = f[:-3]
    if not f.endswith(".py") or f in ("__init__.py",) or f.startswith("_"):
        continue
    if stem in NOT_A_FAMILY:
        continue
    if stem not in FAMILY_SGBDS:
        FAILS.append(f"terms/{f}: FAMILY_SGBDS にこのファイルの担当 ECU が書かれていない")
        continue
    mine = set(FAMILY_SGBDS[stem])
    for key in phrases(os.path.join(TERMS, f)):
        k = key.strip()
        if not IDENT.match(k):
            continue
        outside = own.get(k, set()) - mine
        if outside:
            FAILS.append(
                f"terms/{f}: {k!r} は {len(outside)} 個の族外 SGBD にも存在する "
                f"（{sorted(outside)[:4]}…）。SCOPED_PHRASES へ移してください")

if FAILS:
    sys.stderr.write("\n[FATAL] 語彙の適用範囲:\n")
    for m in FAILS:
        sys.stderr.write(f"    {m}\n")
    sys.exit(1)

n_scoped = sum(
    len(ast.literal_eval(node.value))
    for f in os.listdir(TERMS) if f.endswith(".py") and not f.startswith("_")
    for node in ast.parse(open(os.path.join(TERMS, f), encoding="utf-8").read()).body
    for t in [getattr(node, "targets", [])]
    if t and isinstance(t[0], ast.Name) and t[0].id == "SCOPED_PHRASES"
)
print(f"ok - 語彙の適用範囲: 族 {len(FAMILY_SGBDS)}・ECU {len(all_sgbds)}・"
      f"族専用エントリ {n_scoped} 件")
