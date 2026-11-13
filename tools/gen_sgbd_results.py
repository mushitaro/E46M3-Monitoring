#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  gen_sgbd_results.py — 応答の読み方を、SGBD のジョブ自身のコードとして出す
# ----------------------------------------------------------------------------
#  出力: public/ecu-data/<id>.results.json（BMW の SGBD 由来。データリポジトリに置く）
#
#  SGBD のジョブは、要求を送ったあと、答えのどのバイトがどの値か（`STAT_…_WERT`）、
#  単位（`…_EINH`）、倍率を、自分のバイトコードで組み立てている。それを手で写さず、
#  ジョブのコードそのもの（XOR 0xF7 を外したもの）を出して、アプリの小さな解釈器
#  （`packages/monitoring-engine/src/sgbd/vm.ts`）がその場で走らせる。解釈器は実車の EdiabasLib トレースと
#  命令ごとに突き合わせてある（`vm.test.ts`）。
#
#  出すのは、ジョブの先頭から**届きうる**命令の範囲だけ（分岐をたどって、最後に届く
#  命令の終わりまで）。ジョブ表の次のジョブまでを切ると、STATUS_FAHRZEUGTESTER_LESEN
#  は表の領域まで含んで 270 KB になる。届かないバイトは要らない。
#
#  表（`tabset` が名指すもの）は、ダンプ（`$SGBD_DUMP_DIR/<SGBD>.json` の `tables`）
#  から、そのジョブが使うものだけを付ける。
#
#  載せるジョブは下の表で、モジュールごとに決める。読取のジョブだけ。引数を取るジョブは、
#  電文の表ではひな形のまま（`shared`）で、送る電文は引数を与えてこのコードに組ませる。
# ============================================================================
import base64
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import paths                                                # noqa: E402
from extract_telegrams import ECU_DIR, OUT, _ARG_LEN, dexor, jobtable, resolve_prg  # noqa: E402

RESULT_JOBS = {
    "smg2": (
        "SMG2.prg",
        [
            "STATUS_IO_LESEN",
            "STATUS_IO_STATI_LESEN",
            "STATUS_HARDWARE_STATI_LESEN",
            "STATUS_FAHRZEUGTESTER_LESEN",
            # 0x40, SMG II の読取（runGate.MODULE_READ_ONLY_CONTROLS）。学習値は引数（0 クラッチ・
            # 1 変速機・2 変速機データ）で読む場所を選ぶ。電文もこのコードに組ませる（vm の dry run）。
            "GETRIEBEDATEN_LESEN",
            "ADAPTIONSWERTE_LESEN",
        ],
    ),
}

# 故障メモリの読取（FS_LESEN）は下の all_jobs が、SGBD に FS_LESEN があるモジュール全部に足す。
# 2026-11-13 の #56 は、アプリが送るページとジョブが同じ順で送るモジュールだけ（34）を載せていたが、
# いまはジョブ自身が実車相手に読み取りを進める（packages/monitoring-engine/src/sgbd/faultRead.ts）ので、先に識別やログインを
# 送るもの（LWS5・MRS3/4・SM46）、件数 0 なら次を送らないもの（SPM46）、命令 0x7e（strcat）も読める。

JUMPS = {0x0B, 0x0E, 0x0F, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x47, 0x48, 0x5A, 0x5B, 0x5C, 0x5D, 0x5E, 0x5F}
JUMP, EOJ, TABSET = 0x0B, 0x1D, 0x7B


def decode(dec, p, end):
    """(next pc, opcode, [(mode, start, bytes)]) or None past the end."""
    if p + 2 > end:
        return None
    op, mode = dec[p], dec[p + 1]
    q = p + 2
    args = []
    for m in (mode >> 4, mode & 0x0F):
        if m == 8:
            if q + 2 > end:
                return None
            n = struct.unpack_from("<H", dec, q)[0]
            args.append((m, q + 2, bytes(dec[q + 2:q + 2 + n])))
            q += 2 + n
        else:
            n = _ARG_LEN.get(m)
            if n is None:
                return None
            args.append((m, q, bytes(dec[q:q + n])))
            q += n
    return (q, op, args) if q <= end else None


def reach(dec, start, end):
    """The end of the last instruction reachable from `start`, and the tables named on the way."""
    seen, todo, last, tables = set(), [start], start, set()
    while todo:
        p = todo.pop()
        while start <= p < end and p not in seen:
            seen.add(p)
            d = decode(dec, p, end)
            if d is None:
                break
            q, op, args = d
            last = max(last, q)
            if op == TABSET and args[0][0] == 8:
                tables.add(args[0][2].rstrip(b"\0").decode("latin-1"))
            if op in JUMPS and args[0][0] == 7:
                todo.append(q + struct.unpack("<i", args[0][2])[0])
            if op in (JUMP, EOJ):
                break
            p = q
    return last, tables


def dump_tables(sgbd):
    d = paths.SGBD_DUMP_DIR
    hit = next((f for f in os.listdir(d) if f.lower() == f"{os.path.splitext(sgbd)[0].lower()}.json"), None)
    if hit is None:
        raise FileNotFoundError(f"{sgbd}: no dump in {d}")
    return json.load(open(os.path.join(d, hit), encoding="utf-8")).get("tables", {})


def build(mid, sgbd, names):
    raw = open(resolve_prg(sgbd), "rb").read()
    dec = dexor(raw)
    jobs = jobtable(raw)
    all_tables = {k.upper(): v for k, v in dump_tables(sgbd).items()}
    out_jobs, used = {}, set()
    for name in names:
        k = next((i for i, (_, n) in enumerate(jobs) if n == name), None)
        if k is None:
            raise KeyError(f"{mid}: no job {name}")
        start = jobs[k][0]
        end = jobs[k + 1][0] if k + 1 < len(jobs) else len(dec)
        last, tables = reach(dec, start, end)
        used |= {t.upper() for t in tables}
        out_jobs[name] = {"base": start, "bytes": last - start,
                          "code": base64.b64encode(dec[start:last]).decode("ascii"),
                          "tables": sorted(t.upper() for t in tables)}
    missing = sorted(t for t in used if t not in all_tables)
    if missing:
        raise KeyError(f"{mid}: tables not in the dump: {missing}")
    return {
        "module": mid,
        "sgbd": sgbd,
        "source": "the jobs' own BEST/2 code from the SGBD (XOR 0xF7 removed), reachable instructions only; "
                  "run by src/lib/sgbd/vm.ts on the module's answer. Tables from the SGBD dump.",
        "jobs": out_jobs,
        "tables": {t: all_tables[t] for t in sorted(used)},
    }


# Every module's own fault read (運営者 2026-11-13「全部読めるようにしろ」): FS_LESEN, run by the app on
# the car through the gate (packages/monitoring-engine/src/sgbd/faultRead.ts) — the job sends the count first, then the
# entries it says there are, some with their IDENT or a login first. Not the MSS54 (it has its own
# decoder) and not a KWP-on-DS2 module (lib/kwpOnDs2).
FAULT_JOB = "FS_LESEN"
FAULT_SKIP = {"mss54"}


def all_jobs():
    """Module id -> (SGBD, jobs to carry): RESULT_JOBS, plus FS_LESEN wherever the module's SGBD has one."""
    out = {mid: (sgbd, list(names)) for mid, (sgbd, names) in RESULT_JOBS.items()}
    for f in sorted(os.listdir(OUT)):
        if not f.endswith(".telegrams.json"):
            continue
        t = json.load(open(os.path.join(OUT, f), encoding="utf-8"))
        mid, sgbd = t["module"], t["sgbd"]
        if mid in FAULT_SKIP or t.get("framing") == "kwp-ds2":
            continue
        try:
            raw = open(resolve_prg(sgbd), "rb").read()
        except (FileNotFoundError, KeyError):
            continue
        if not any(n == FAULT_JOB for _, n in jobtable(raw)):
            continue
        sg, names = out.get(mid, (sgbd, []))
        if FAULT_JOB not in names:
            names.append(FAULT_JOB)
        out[mid] = (sg, names)
    return out


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    only = set(sys.argv[1:])
    for mid, (sgbd, names) in all_jobs().items():
        if only and mid not in only:
            continue
        data = build(mid, sgbd, names)
        dest = os.path.join(OUT, f"{mid}.results.json")
        with open(dest + ".tmp", "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write("\n")
        os.replace(dest + ".tmp", dest)
        sizes = ", ".join(f"{j} {v['bytes']} B" for j, v in data["jobs"].items())
        print(f"  {mid}: {len(data['jobs'])} jobs ({sizes}), tables {list(data['tables'])} <- {sgbd} ({ECU_DIR})")
