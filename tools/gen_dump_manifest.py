#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SGBD ダンプの台帳を書く。`python tools/gen_dump_manifest.py`

出力: `tools/SgbdDump/out.manifest.json`

ダンプそのものは repo の外にある（BMW の SGBD 由来。理由は `tools/paths.py`）。
台帳のほうは**中身を持たない**——ファイル名・SHA-256・バイト数・ジョブ数・テーブル数
だけで、SGBD の文字列は 1 つも入らない。だからこれはコミットでき、public repo を
clone した人が「何が、どれだけ欠けているか」を形と大きさで確認できる。

これが置き換えるもの: `check_references.py` にリテラルで 6 個並んでいた SHA-256。
3 モジュールのときは 6 行で足りたが、51 では手で維持する表になり、維持されなくなる。
ダンプを差し替えたのに台帳を書き直し忘れれば検査が落ちる——それが正しい。

**入っていない 2 つの欄と、その理由。** 計画は `dumpedAt` と `sgbdSha256`（元の
`.prg` のハッシュ）も持たせるとしている。どちらもダンプ側が名乗っていないので、
ここでは作れない——作れば、それは我々がでっち上げた値になる。SgbdDump を直して
全数を取り直したときに入る。それまでは「どのダンプから出たか」は言えるが、「その
ダンプがいつ、どの .prg から出たか」は言えない。
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import paths                                                # noqa: E402

DUMP = paths.require_dump_dir()
OUT = os.path.join(HERE, "SgbdDump", "out.manifest.json")


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def entry(name: str) -> dict:
    path = os.path.join(DUMP, name)
    d = json.load(open(path, encoding="utf-8"))
    # ダンプ以外の JSON もこのディレクトリにいる（_addresses.json、テレグラム抽出、
    # 過去の実行の残骸）。根がオブジェクトでないものは員数を名乗れないので名乗らない。
    if not isinstance(d, dict):
        d = {}
    tables = d.get("tables")
    return {
        "path": name,
        "sha256": sha256(path),
        "bytes": os.path.getsize(path),
        # テレグラム抽出の出力には jobs/tables が無い。無いものを 0 と書くと
        # 「テーブルを持たないダンプ」と区別できなくなるので、欄ごと落とす。
        **({"jobCount": d["jobCount"]} if "jobCount" in d else {}),
        **({"tableCount": len(tables)} if isinstance(tables, (dict, list)) else {}),
    }


def main() -> int:
    names = sorted(f for f in os.listdir(DUMP) if f.endswith(".json"))
    manifest = {
        "note": ("SGBD ダンプの台帳。中身は入っていない（ファイル名・ハッシュ・員数のみ）。"
                 "更新は python tools/gen_dump_manifest.py。差分はレビュー対象。"),
        "generator": "tools/gen_dump_manifest.py",
        "dumps": [entry(n) for n in names],
    }
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, OUT)
    withjobs = sum(1 for e in manifest["dumps"] if "jobCount" in e)
    print(f"wrote {os.path.relpath(OUT, os.path.dirname(HERE))}: {len(names)} files, "
          f"{withjobs} of them SGBD dumps, "
          f"{sum(e['bytes'] for e in manifest['dumps']):,} bytes total")
    return 0


if __name__ == "__main__":
    sys.exit(main())
