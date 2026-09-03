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

# **アプリが読む場所に直接書く。**
#
# 出力先は `$SGBD_DUMP_DIR` だった。そこに書いてもアプリには届かないので、誰かが
# `public/ecu-data/` に手でコピーしていた——2 つの木がバイト一致していたのは、
# そうし続ける仕組みがあったからではなく、直近のコピーが正しかったからである
# （`docs/REFERENCES.md` §4(a) に穴として記録されていた）。再実行がそのまま
# 出荷物に反映されないと、抽出器を直しても何も変わらない。
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "ecu-data")

# モジュールは表で持たず `index.json` から読む。`gen_ecu_data.py` に足したのに
# ここに足し忘れたモジュールが「テレグラム表を持たない＝実車で何も送れない」まま
# 静かに残るのを避ける。アドレスも同じ出所を使う（そこは実送信トレースで裏を
# 取ってある——`docs/FITMENT.md`）。
def modules() -> dict[str, tuple[str, int]]:
    idx = json.load(open(os.path.join(OUT, "index.json"), encoding="utf-8"))
    return {m["id"]: (m["sgbd"], m["address"]) for m in idx["modules"]}


def resolve_prg(name: str) -> str:
    r"""`.prg` を大文字小文字を跨いで解決する。

    実在例: `C:\EDIABAS\ECU` には `ews3.prg` と `EWS3D.prg` が並んでいる。
    素の `os.path.join` では 51 モジュールのうち何件かを取り逃がす。"""
    exact = os.path.join(ECU_DIR, name)
    if os.path.exists(exact):
        return exact
    low = name.lower()
    for f in os.listdir(ECU_DIR):
        if f.lower() == low:
            return os.path.join(ECU_DIR, f)
    return exact   # 呼び出し側が FileNotFoundError にする

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
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(OUT, exist_ok=True)
    MODULES = modules()
    only = set(sys.argv[1:])
    failed = []
    totals = {"single": 0, "multiple": 0, "shared": 0}
    for mid, (prg, addr) in MODULES.items():
        if only and mid not in only:
            continue
        path = resolve_prg(prg)
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
            for k in totals:
                totals[k] += counts.get(k, 0)
            print(f"  {mid:10} 0x{addr:02X} jobs={len(data):<4} telegrams: "
                  f"single={counts.get('single', 0):<4} multiple={counts.get('multiple', 0):<4} "
                  f"shared={counts.get('shared', 0):<4} <- {os.path.basename(path)}")
        except Exception as e:
            failed.append((mid, e))
            print(f"  {mid:10} ERR {e}")

    if failed:
        sys.stderr.write(f"\n[FATAL] {len(failed)} module(s) failed: "
                         + ", ".join(m for m, _ in failed) + "\n")
        sys.exit(1)
    n = len(only) if only else len(MODULES)
    print(f"wrote {n} telegram tables to public/ecu-data/  "
          f"single={totals['single']} multiple={totals['multiple']} shared={totals['shared']}")
