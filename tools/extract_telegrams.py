#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  extract_telegrams.py — SGBD(.prg) から「ジョブ → DS2要求テレグラム」を静的抽出
# ----------------------------------------------------------------------------
#  MSS54-DS2-Tool-Public の analysis-tools/prg_ds2_telegrams.py を一般化したもの。
#  変更点:
#    - モジュール(アドレス)を3種に一般化（MSS54 0x12 / SMG II 0x32 / DSC 0x56）
#    - 出力を JSON に（gen_from_dump.py がマージできるように）
#    - 各テレグラムに「静的抽出の確からしさ」を付ける（後述）
#
#  原理: BEST/2 のジョブ・バイトコードは文字列表と同じく XOR 0xF7 でスクランブル
#  されている。復号すると各ジョブは DS2 要求テレグラムをリテラルで組み立てている:
#      [addr][LL=チェックサム込み全長][cmd][data...]
#  チェックサムは送信時に付くのでファイル中には無い。ここで計算して補う。
#
#  ⚠ これは**バイトコードの静的スクレイプ**であって実行トレースではない。
#     引数でアドレスやデータが差し替わるジョブ、条件分岐やループを持つジョブは
#     完全には捕まらない。だから confidence を付けて出し、
#       - 1ジョブ1テレグラム              -> "single"（そのまま使える見込み）
#       - 1ジョブ複数テレグラム            -> "multiple"（引数依存の疑い。要検証）
#       - 他ジョブと同一テレグラムを共有   -> "shared"（テンプレート。ほぼ確実に引数依存）
#     出荷対象にできるのは実車で検証したものだけ（検証台帳を参照）。
# ============================================================================
import json
import os
import struct
import sys

ECU_DIR = os.environ.get("EDIABAS_ECU_DIR", r"C:\EDIABAS\ECU")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import paths                                                # noqa: E402

OUT = paths.SGBD_DUMP_DIR   # リポジトリ外。理由は tools/paths.py

# id : (SGBD ファイル名, DS2 アドレス)
MODULES = {
    "mss54":    ("MSS54DS0.prg", 0x12),
    "smg2":     ("SMG2.prg",     0x32),
    "dsc_e46": ("DSC_E46.prg",  0x56),
}

CMD = {
    0x00: "identification", 0x04: "read fault memory", 0x05: "CLEAR fault memory",
    0x06: "read memory", 0x07: "write memory", 0x0A: "coding checksum",
    0x0B: "read status/IO block", 0x0C: "IO control (actuator)", 0x1A: "read ident",
    0x43: "CLEAR adaptations", 0x53: "mfr-specific data", 0x6C: "EWS init",
    0x6D: "EWS status", 0x90: "login (seed/key)", 0x91: "baud switch",
    0x9E: "keepalive", 0x9F: "end diagnostics",
}

# テレグラム長の窓。4未満は不正、24超はリテラルの偶然一致がほとんど。
MIN_LEN, MAX_LEN = 4, 24


def dexor(b):
    return bytes(x ^ 0xF7 for x in b)


def xorck(b):
    x = 0
    for v in b:
        x ^= v
    return x


def jobtable(raw):
    """ジョブ表: 0x88 にオフセット、先頭に件数、以降 68バイト/レコード
       （64バイト名 + 4バイト・オフセット、いずれも XOR 0xF7）。"""
    tab = struct.unpack_from("<I", raw, 0x88)[0]
    cnt = struct.unpack_from("<i", raw, tab)[0]
    out, pos = [], tab + 4
    for _ in range(cnt):
        rec = raw[pos:pos + 68]
        pos += 68
        name = dexor(rec[0:64]).split(b"\x00")[0].decode("latin-1", "replace").strip()
        off = struct.unpack_from("<I", dexor(rec[64:68]), 0)[0]
        out.append((off, name))
    out.sort()
    return out


def owner(jobs, pos):
    name = "?"
    for off, nm in jobs:
        if off <= pos:
            name = nm
        else:
            break
    return name


def extract(path, addr):
    raw = open(path, "rb").read()
    dec = dexor(raw)
    jobs = jobtable(raw)

    seen = {}
    for i in range(len(dec) - 4):
        if dec[i] != addr:
            continue
        ll = dec[i + 1]
        if ll < MIN_LEN or ll > MAX_LEN:
            continue
        cmd = dec[i + 2]
        if cmd not in CMD:
            continue
        stored = dec[i:i + ll - 1]          # チェックサム抜きのテレグラム
        if len(stored) < 3:
            continue
        tel = stored + bytes([xorck(stored)])
        seen.setdefault((owner(jobs, i), tel), 0)
        seen[(owner(jobs, i), tel)] += 1

    byjob = {}
    for (job, tel), count in seen.items():
        byjob.setdefault(job, []).append((tel, count))

    # 同一テレグラムを何ジョブが共有しているか＝テンプレートの度合い
    shared = {}
    for job, tels in byjob.items():
        for tel, _ in tels:
            shared.setdefault(tel, set()).add(job)

    out = {}
    for job, tels in sorted(byjob.items()):
        entries = []
        for tel, count in sorted(set(tels)):
            sharers = len(shared[tel])
            if sharers > 1:
                confidence = "shared"
            elif len(tels) > 1:
                confidence = "multiple"
            else:
                confidence = "single"
            entries.append({
                "hex": tel.hex(" "),
                "cmd": tel[2],
                "cmdName": CMD.get(tel[2], "?"),
                "occurrences": count,
                "sharedWithJobs": sharers - 1,
                "confidence": confidence,
            })
        out[job] = entries
    return out


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    failed = []
    for mid, (prg, addr) in MODULES.items():
        path = os.path.join(ECU_DIR, prg)
        try:
            if not os.path.exists(path):
                raise FileNotFoundError(path)
            data = extract(path, addr)
            dest = os.path.join(OUT, f"{mid}.telegrams.json")
            tmp = dest + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({
                    "module": mid, "sgbd": prg, "address": addr,
                    "source": "static extraction of XOR-0xF7 job bytecode (NOT an execution trace)",
                    "jobs": data,
                }, f, ensure_ascii=False, indent=1)
                f.write("\n")
            os.replace(tmp, dest)
            counts = {}
            for entries in data.values():
                for e in entries:
                    counts[e["confidence"]] = counts.get(e["confidence"], 0) + 1
            print(f"  {mid:10} jobs={len(data):<4} telegrams: "
                  f"single={counts.get('single', 0):<4} multiple={counts.get('multiple', 0):<4} "
                  f"shared={counts.get('shared', 0):<4} <- {prg}")
        except Exception as e:
            failed.append((mid, e))
            print(f"  {mid:10} ERR {e}")

    if failed:
        sys.stderr.write(f"\n[FATAL] {len(failed)} module(s) failed: "
                         + ", ".join(m for m, _ in failed) + "\n")
        sys.exit(1)
    print(f"wrote {len(MODULES)} telegram tables to {OUT}")
