#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Where each module's fault read puts its fault codes — read off the module's own SGBD, run by EdiabasLib.

`public/ecu-data/fault-layouts.json`. The app decodes the MSS54's fault memory with a decoder of its own
(`packages/ds2-mss54`); every other module's answer used to stay bytes (CLAUDE.md). The bytes are not
private to the SGBD, though: its FS_LESEN job reads them, and EdiabasLib runs that job. So, for each
module here, this

  1. runs the SGBD's own FS_LESEN in EdiabasLib's simulation (`tools/SgbdDump --exec`, with a throwaway
     simulation file answering every request the job sends: IDENT with an answer the group file assigns to
     this SGBD, the quick test, the entries), and reads what the job reports (F_ORT_NR, F_HFK,
     F_VORHANDEN or the F_ART text "Fehler momentan vorhanden");
  2. infers the layout from answers whose bytes are all different (which byte became the code, which the
     frequency, how many records came out, where they start) and, bit by bit, which bit means "present now";
  3. checks the layout against EdiabasLib on random answers: the codes, their order, the frequencies and
     the "present" flags must agree on every one, or nothing is written for the module.

No car, no cable: the SGBD and EdiabasLib, as `gen_variants.py` does with the group files. What this
proves is that the app reads the bytes the way BMW's own job reads them; whether a real module answers
with those bytes is not proved until one has, so every decoded fault is marked unverified on a car.

    python tools/sgbd/gen_fault_layouts.py            # all modules below
    python tools/sgbd/gen_fault_layouts.py KOMBI46    # one
"""
from __future__ import annotations

import datetime as _dt
import glob
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "ecu-data", "fault-layouts.json")
SIM_SRC = os.environ.get("EDIABAS_SIM_PATH") or r"C:\EDIABAS\SIM"

# module id -> (SGBD, address). KOMBI, DSC and the DMEs first (operator, 2026-11-11), GS20 with them.
MODULES: dict[str, tuple[str, int]] = {
    "kombi46": ("KOMBI46", 0x80),
    "kombi46r": ("KOMBI46R", 0x80),
    "dsc_e46": ("DSC_E46", 0x56),
    "ascmk20": ("ASCMK20", 0x56),
    "ms420ds0": ("MS420DS0", 0x12),
    "ms430ds0": ("MS430DS0", 0x12),
    "bms43ds0": ("BMS43DS0", 0x12),
    "bms46ds0": ("BMS46DS0", 0x12),
    "bms46ds1": ("BMS46DS1", 0x12),
    "gs20": ("GS20", 0x32),
}


def exe() -> str:
    found = glob.glob(os.path.join(ROOT, "tools", "SgbdDump", "bin", "Release", "*", "SgbdDump.exe"))
    if not found:
        raise SystemExit("[FATAL] tools/SgbdDump/bin/Release/*/SgbdDump.exe is missing: build tools/SgbdDump first.")
    return found[0]


EXE = exe()
TRC = os.path.join(os.path.dirname(EXE), "trc", "ifh.trc")


def frame(addr: int, data: list[int], status: int = 0xA0) -> list[int]:
    body = [addr, 3 + len(data) + 1, status] + list(data)
    cs = 0
    for b in body:
        cs ^= b
    return body + [cs]


def hx(bs) -> str:
    return " ".join(f"{b:02X}" for b in bs)


def oracle_ident(sgbd: str, addr: int) -> list[int]:
    """An IDENT answer EdiabasLib's own group file assigns to this SGBD (variants.oracle.json), else a plain one."""
    path = os.path.join(ROOT, "public", "ecu-data", "variants.oracle.json")
    if os.path.exists(path):
        for cases in json.load(open(path, encoding="utf-8"))["groups"].values():
            for c in cases:
                if c.get("variant") == sgbd:
                    return [int(x, 16) for x in c["answer"].split()]
    return frame(addr, [0x30] * 18 + [0xFF] * 4 + [0x30] * 14)


def exec_job(sgbd: str, exchanges: list[tuple[list[int], list[int]]]) -> str:
    d = tempfile.mkdtemp(prefix="faultlayout")
    try:
        for f in os.listdir(SIM_SRC):
            shutil.copy(os.path.join(SIM_SRC, f), d)
        req, resp = [], []
        for i, (rq, rs) in enumerate(exchanges, 1):
            cs = 0
            for b in rq:
                cs ^= b
            c = lambda bs: ",".join(f"{b:02X}" for b in bs)
            req += [f"r{2 * i - 1} = {c(rq + [cs])}", f"r{2 * i} = {c(rq)}"]
            resp += [f"r{2 * i - 1} = {c(rs)}", f"r{2 * i} = {c(rs)}"]
        with open(os.path.join(d, sgbd.lower() + ".sim"), "w") as fh:
            fh.write("[REQUEST]\r\n" + "\r\n".join(req) + "\r\n[RESPONSE]\r\n" + "\r\n".join(resp) + "\r\n")
        if os.path.exists(TRC):
            os.remove(TRC)
        out = subprocess.run([EXE, "--exec", sgbd, "FS_LESEN", ""], capture_output=True, text=True,
                             env=dict(os.environ, EDIABAS_SIM_PATH=d), cwd=os.path.dirname(EXE), timeout=180)
        return out.stdout + out.stderr
    finally:
        shutil.rmtree(d, ignore_errors=True)


def last_send() -> list[int] | None:
    if not os.path.exists(TRC):
        return None
    m = re.findall(r"\(Send sim\): ([0-9A-F ]+)", open(TRC, encoding="latin-1").read())
    return [int(x, 16) for x in m[-1].split()] if m else None


def parse(out: str) -> list[dict]:
    """The job's fault records: one dict per F_ORT_NR, with the fields reported around it."""
    recs: list[dict] = []
    cur: dict = {}
    for line in out.splitlines():
        m = re.match(r"\s+(F_[A-Z0-9_]+)\s+= ?(.*)$", line)
        if not m:
            continue
        k, v = m.group(1), m.group(2).strip()
        if k == "F_ANZ_NR":
            continue
        if k in cur:
            recs.append(cur)
            cur = {}
        cur[k] = v
    if cur:
        recs.append(cur)
    return [r for r in recs if "F_ORT_NR" in r]


def present(r: dict) -> bool:
    if r.get("F_VORHANDEN", "0") not in ("0", ""):
        return True
    return any(re.search(r"momentan vorhanden", v) and not re.search(r"nicht", v) for k, v in r.items() if k.startswith("F_ART"))


class Probe:
    """The job's requests, learnt by answering each one it is stuck on."""

    def __init__(self, sgbd: str, addr: int):
        self.sgbd, self.addr = sgbd, addr
        self.quick: list[int] | None = None
        self.entries: list[int] | None = None
        self.ident: list[int] | None = None

    def run(self, entries: list[int], quick: list[int]) -> str:
        known: list[tuple[list[int], list[int]]] = []
        if self.ident:
            known.append((self.ident, oracle_ident(self.sgbd, self.addr)))
        if self.quick:
            known.append((self.quick, frame(self.addr, quick)))
        if self.entries:
            known.append((self.entries, frame(self.addr, entries)))
        for _ in range(6):
            out = exec_job(self.sgbd, known)
            if "FAILED" not in out:
                return out
            s = last_send()
            if s is None or any(r == s for r, _ in known):
                raise RuntimeError(f"{self.sgbd}: stuck on {hx(s or [])}: {out.strip()[-200:]}")
            if len(s) == 3 and s[1:] == [0x04, 0x00]:
                self.ident = s
                known.append((s, oracle_ident(self.sgbd, self.addr)))
            elif s[2:4] == [0x04, 0x01]:
                self.entries = s
                known.append((s, frame(self.addr, entries)))
            elif s[2:4] == [0x04, 0x00]:
                self.quick = s
                known.append((s, frame(self.addr, quick)))
            else:
                raise RuntimeError(f"{self.sgbd}: asks {hx(s)}, which this does not answer")
        raise RuntimeError(f"{self.sgbd}: did not finish")

    def records(self, entries: list[int], quick: list[int]) -> list[dict]:
        return parse(self.run(entries, quick))


def infer(sgbd: str, addr: int) -> dict:
    p = Probe(sgbd, addr)
    seq = list(range(0x11, 0x11 + 80))
    # The count: 2 in the quick test and 5 at the head of the entries. Which one the job used is the source.
    recs = p.records([5] + seq, [2])
    if p.quick is not None and len(recs) == 2:
        count = "quick"
    elif len(recs) == 5:
        count = "entries"
    else:
        count = "fill"
    codes = [int(r["F_ORT_NR"]) for r in recs]
    # The geometry from the same answer: the entries are [5, 0x11, 0x12, …], every byte different.
    payload = [5] + seq
    pos = [payload.index(c) if c in payload else None for c in codes[:2]]
    if None in pos or len(codes) < 2:
        raise RuntimeError(f"{sgbd}: could not place the codes {codes[:4]}")
    first, length = pos[0], pos[1] - pos[0]
    # Records start where the first one does, the code at its head; the check below holds that to the job.
    start, code_at = first, 0
    if not 0 <= code_at < length:
        raise RuntimeError(f"{sgbd}: code outside its record")
    rec0 = payload[start: start + length]
    hfk = recs[0].get("F_HFK", "")
    frequency, inverted = None, False
    if hfk.isdigit():
        v = int(hfk)
        if v in rec0:
            frequency = rec0.index(v)
        elif 0xFF - v in rec0:
            # Kept as its complement in the byte (DSC: 0x01 is 254 times).
            frequency, inverted = rec0.index(0xFF - v), True
    layout = {"count": count, "start": start, "length": length, "code": code_at, "frequency": frequency,
              "frequencyInverted": inverted, "emptyIfZero": [], "present": None}
    # Which zero byte makes the job skip a record (an empty slot): only where nothing counts the records.
    if count == "fill":
        full = [0x2A] + [0x11 + k for k in range(length - 1)]
        for at in range(length):
            rec = list(full)
            rec[at] = 0
            if not p.records(rec, [0]):
                layout["emptyIfZero"].append(at)
    # Which bit says "present now": each bit of each byte after the code, alone.
    for at in range(length):
        if at == code_at or at == layout["frequency"]:
            continue
        for bit in range(8):
            rec = [0] * length
            rec[code_at] = 0x2A
            rec[at] = 1 << bit
            data = ([1] if count == "entries" else [0] * start) + rec
            r = p.records(data, [1])
            if r and present(r[0]):
                layout["present"] = {"at": at, "mask": 1 << bit}
                break
        if layout["present"] or at >= 3:
            break
    layout["quick"] = hx(p.quick) if p.quick else None
    layout["entries"] = hx(p.entries) if p.entries else None
    return layout


def decode(layout: dict, quick: list[int] | None, entries: list[int]) -> list[tuple[int, int | None, bool | None]]:
    """The same reading the app does (packages/monitoring-engine/src/faultLayouts.ts)."""
    if layout["count"] == "quick":
        n = quick[0] if quick else 0
    elif layout["count"] == "entries":
        n = entries[0] if entries else 0
    else:
        n = (len(entries) - layout["start"]) // layout["length"]
    out = []
    for i in range(n):
        at = layout["start"] + i * layout["length"]
        rec = entries[at: at + layout["length"]]
        if len(rec) < layout["length"]:
            break
        if any(rec[z] == 0 for z in layout.get("emptyIfZero", [])):
            continue
        f = layout["frequency"]
        freq = None if f is None else (0xFF - rec[f] if layout.get("frequencyInverted") else rec[f])
        pr = layout["present"]
        out.append((rec[layout["code"]], freq, bool(rec[pr["at"]] & pr["mask"]) if pr else None))
    return out


def check(sgbd: str, addr: int, layout: dict, rounds: int = 6) -> int:
    rng = random.Random(f"{sgbd}-faults")
    p = Probe(sgbd, addr)
    for i in range(rounds + 4):
        edge = i >= rounds
        n = 0 if i == rounds else rng.randint(1, 3)
        # The last rounds hold zeros too: an empty answer, and records with zero bytes in them.
        recs = [(0 if edge and rng.random() < 0.4 else rng.randrange(1, 256)) for _ in range(n * layout["length"])]
        for k in range(n):
            if not (edge and rng.random() < 0.3):
                recs[k * layout["length"] + layout["code"]] = rng.randrange(1, 0xF0)
        if layout["count"] == "entries":
            data = [n] + [rng.randrange(0, 256) for _ in range(layout["start"] - 1)] + recs
        else:
            data = [rng.randrange(0, 256) for _ in range(layout["start"])] + recs
        quick = [n]
        want = decode(layout, quick, data)
        got = [(int(r["F_ORT_NR"]), int(r["F_HFK"]) if r.get("F_HFK", "").isdigit() else None, present(r)) for r in p.records(data, quick)]
        if layout["frequency"] is None:
            got = [(c, None, pr) for c, _, pr in got]
        if layout["present"] is None:
            got = [(c, f, None) for c, f, _ in got]
        if got != want:
            raise RuntimeError(f"{sgbd}: round {i}: EdiabasLib read {got}, the layout reads {want}")
    return rounds + 4


def main() -> int:
    names = sys.argv[1:]
    todo = {k: v for k, v in MODULES.items() if not names or v[0] in names or k in names}
    old = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {"modules": {}}
    mods = dict(old.get("modules", {}))
    for mid, (sgbd, addr) in todo.items():
        try:
            layout = infer(sgbd, addr)
            try:
                layout["checked"] = check(sgbd, addr, layout)
            except RuntimeError as e:
                # A "present" bit that held alone but not on random answers (the job combines bits): the codes
                # and frequencies are still checked without it, and "present" is then not claimed at all.
                if layout["present"] is None:
                    raise
                print(f"  {mid:10} present bit not confirmed ({e}); checking without it")
                layout["present"] = None
                layout["checked"] = check(sgbd, addr, layout)
            mods[mid] = {"sgbd": sgbd, **layout}
            print(f"  {mid:10} {json.dumps(layout)}")
        except Exception as e:  # noqa: BLE001 — a module whose layout is not proved is left out, and said so
            print(f"  {mid:10} NOT WRITTEN: {e}")
            mods.pop(mid, None)
    doc = {
        "schema": 1,
        "generatedAt": _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat(),
        "how": "each SGBD's own FS_LESEN run by EdiabasLib in simulation (tools/SgbdDump --exec); every layout agreed with it on random answers",
        "verifiedOnCar": False,
        "modules": dict(sorted(mods.items())),
    }
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"wrote {OUT} ({len(mods)} modules)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
