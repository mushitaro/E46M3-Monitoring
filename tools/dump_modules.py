#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  dump_modules.py — 候補 SGBD を一括ダンプし、DS2 アドレスを
#  **EdiabasLib が実際に送ったテレグラム**から取る。
# ----------------------------------------------------------------------------
#  1) SgbdDump.exe <SGBD...>          → $SGBD_DUMP_DIR/<SGBD>.json（既存はスキップ）
#  2) SgbdDump.exe --exec <SGBD> IDENT → trc/ifh.trc に "(Send sim): 80 04 00"
#                                        が残る。先頭バイト = DS2 診断アドレス。
#  出力: $SGBD_DUMP_DIR/_addresses.json  {sgbd: {addr, hex, ident_tele, info}}
#
#  **静的推定は使わない。** `.prg` を XOR 0xF7 して復号し、`[addr][長さ][既知の
#  DS2 コマンド]` の並びを数える方法（`deprecated/detect_address.py`）は、既知
#  3 モジュールすべてで外れた——BEST バイトコードのノイズが 0x40 / 0x70 を返す。
#  実行トレースが唯一の根拠である。
#
#  **既定の挙動は「継承」であって「再生成」ではない。** すでにアドレスが分かって
#  いる SGBD は飛ばす。だから `_addresses.json` は 59 件を積み上げてきたものとして
#  残り、走らせ直すたびに作り直される値にはならない。
#
#  `--refresh` は**上書きしない**。もう一度測って、台帳と食い違ったら両方を表示して
#  非ゼロ終了する。アドレスが黙って変わるということは、**隣の ECU と話している**
#  ということなので、黙って直してはならない。
#
#  候補は表で持たない。`public/ecu-data/index.json` の 51 モジュール ∪
#  `sgbd/fitment.py` の除外 12 件——つまり ECU のダンプ全部。モジュールを増やした
#  のにここに足し忘れる経路を作らない。
#
#  使い方:
#      python tools/dump_modules.py                  # 足りないものだけ
#      python tools/dump_modules.py DSC_E46          # 名指し
#      python tools/dump_modules.py --refresh DSC_E46  # 測り直して台帳と照合
# ============================================================================
from __future__ import annotations

import glob
import json
import os
import re
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import paths                                                # noqa: E402
from sgbd.fitment import NOT_FITTED                          # noqa: E402

SG = os.path.join(HERE, "SgbdDump")
OUT = paths.require_dump_dir()
TRC = os.path.join(SG, "trc", "ifh.trc")
ADDRESSES = os.path.join(OUT, "_addresses.json")
ECU_DATA = os.path.join(HERE, "..", "public", "ecu-data")


def exe() -> str:
    found = glob.glob(os.path.join(SG, "bin", "Release", "*", "SgbdDump.exe"))
    if not found:
        sys.stderr.write(
            "[FATAL] SgbdDump.exe が無い。tools/SgbdDump で\n"
            "        dotnet build -c Release -p:EdiabasLibPath=<path>\n"
            "        （EdiabasLib は GPLv3。exe は再配布しない——THIRD-PARTY-NOTICES.md §2）\n")
        sys.exit(1)
    return found[0]


def candidates() -> list[str]:
    """出荷している 51 モジュール ∪ 理由付きで除外した 12 件。"""
    index = json.load(open(os.path.join(ECU_DATA, "index.json"), encoding="utf-8"))
    shipped = [m["sgbd"][:-4] for m in index["modules"]]
    return sorted(set(shipped) | set(NOT_FITTED), key=str.upper)


def run(args, timeout=600):
    return subprocess.run([exe()] + args, cwd=SG, capture_output=True, text=True,
                          timeout=timeout, encoding="utf-8", errors="replace")


def probe(name: str) -> dict:
    """IDENT を実行し、ifh.trc に残った送信テレグラムからアドレスを読む。"""
    try:
        if os.path.exists(TRC):
            os.remove(TRC)
    except OSError:
        pass
    r = run(["--exec", name, "IDENT"], timeout=300)
    tele = addr = None
    if os.path.exists(TRC):
        txt = open(TRC, encoding="utf-8", errors="replace").read()
        m = re.search(r"\(Send sim\):\s*((?:[0-9A-Fa-f]{2}\s*)+)", txt)
        if m:
            tele = m.group(1).strip()
            addr = int(tele.split()[0], 16)
    info = {}
    for line in run(["--exec", name, "INFO"], timeout=300).stdout.splitlines():
        m = re.match(r"\s+(\S+)\s+= (.*)$", line)
        if m:
            info[m.group(1)] = m.group(2).strip()
    return {"addr": addr,
            "hex": f"0x{addr:02X}" if addr is not None else None,
            "ident_tele": tele,
            "exec_out": (r.stdout.strip().splitlines() or [""])[0],
            "info": info}


def main() -> int:
    argv = [a for a in sys.argv[1:] if a != "--refresh"]
    refresh = "--refresh" in sys.argv
    names = argv or candidates()

    os.makedirs(OUT, exist_ok=True)
    todo = [c for c in names if not os.path.exists(os.path.join(OUT, c + ".json"))]
    print(f"dump: {len(todo)} to do, {len(names) - len(todo)} cached", flush=True)
    for chunk in [todo[i:i + 8] for i in range(0, len(todo), 8)]:
        t0 = time.time()
        r = run(chunk, timeout=1800)
        print(r.stdout.strip(), flush=True)
        if r.returncode != 0:
            print("  stderr:", r.stderr[-500:], flush=True)
        print(f"  ({time.time() - t0:.0f}s)", flush=True)

    addrs = json.load(open(ADDRESSES, encoding="utf-8")) if os.path.exists(ADDRESSES) else {}
    conflicts = []
    for c in names:
        known = addrs.get(c)
        if known and known.get("addr") is not None and not refresh:
            continue
        got = probe(c)
        if known and known.get("addr") is not None and got["addr"] != known["addr"]:
            # 黙って上書きしない。アドレスが変わったなら、どちらかの測定が
            # 別の ECU のものである。
            conflicts.append(f"{c}: 台帳 {known['hex']} ({known['ident_tele']}) "
                             f"!= 実測 {got['hex']} ({got['ident_tele']})")
            continue
        addrs[c] = got
        print(f"{c:10} addr={got['hex']} tele={got['ident_tele']}  "
              f"ECU={got['info'].get('ECU', '')[:44]}", flush=True)
        tmp = ADDRESSES + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(addrs, f, ensure_ascii=False, indent=1)
        os.replace(tmp, ADDRESSES)

    missing = [c for c in names if addrs.get(c, {}).get("addr") is None]
    if missing:
        print(f"\nアドレスが取れなかった: {', '.join(missing)}")

    if conflicts:
        sys.stderr.write("\n[FATAL] アドレスが台帳と食い違う（上書きしていない）:\n"
                         + "".join(f"    {c}\n" for c in conflicts)
                         + "    どちらかの測定が別の ECU のもの。手で確かめること。\n")
        return 1
    print("done", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
