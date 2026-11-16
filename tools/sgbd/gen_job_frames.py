#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""What each job that takes values sends for each value — run by EdiabasLib, as BMW's own job runner would.
`public/ecu-data/job-frames.oracle.json`.

The owner decided (2026-11-15) that the jobs that drive something run on the car with values chosen on the
screen (SMG II's STEUERN_STELLGLIED: which actuator, active or not; the DME's pin forcing; the resets that
name what they reset). The app builds those frames by running the module's own SGBD code
(packages/monitoring-engine/src/sgbd/jobFrame.ts). Before any of them goes to a car, each frame the app
builds must be the frame EdiabasLib builds for the same values: this file is that answer, and the app opens
only the jobs and values on which the two agree (packages/monitoring-engine/src/sgbd/jobFrames.test.ts).

For each job (the same set tools/gen_sgbd_results.py carries: takes values; test, calibration or
unclassified; a name that does not write) and each combination of its values (every combination up to
MAX_COMBOS, else one value changed at a time from the first of each), this
  1. runs the job in EdiabasLib's simulation (`tools/SgbdDump --exec <SGBD> <JOB> "<a;b;c>"`) with a
     throwaway simulation file that answers every request seen so far: an IDENT with the answer the group
     file assigns to this SGBD (variants.oracle.json), anything else with a bare positive answer;
  2. reads the frame it sent next from EdiabasLib's trace, adds it with its answer, and runs again, until the
     job sends nothing new or MAX_SENDS is reached;
  3. records the frames, in order, and how the job ended.
No car and no cable. What this proves is that the app builds the bytes BMW's job builds; whether a module
does what the job says is proved only on a car, and the app says so on every run.

Runs on the development PC (Windows, EdiabasLib built into tools/SgbdDump, the SGBDs in EDIABAS_ECU_DIR).
    python tools/sgbd/gen_job_frames.py              # every module
    python tools/sgbd/gen_job_frames.py smg2 mss54   # some
"""
from __future__ import annotations

import datetime as _dt
import itertools
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "public", "ecu-data")
sys.path.insert(0, os.path.join(ROOT, "tools"))
sys.path.insert(0, os.path.join(ROOT, "tools", "sgbd"))

from gen_fault_layouts import EXE, SIM_SRC, TRC, frame, hx, oracle_ident  # noqa: E402

# The same rule as packages/monitoring-engine/src/policy.ts and tools/gen_sgbd_results.py.
WRITES = re.compile(r"SCHREIBEN|^WRITE_|_WRITE_|CODIER|FLASH|BAUDRATE|PRUEFSTEMPEL|ZIF_BACKUP|SET_EDIC|NAVDVDPIN")
MAX_COMBOS = 200
MAX_SENDS = 8
NUMERIC_SAMPLES = ["0", "1", "100"]


def index() -> dict:
    return json.load(open(os.path.join(OUT, "index.json"), encoding="utf-8"))


def text_of(cat: dict, ref) -> str:
    if isinstance(ref, int) and 0 <= ref < len(cat.get("texts", [])):
        t = cat["texts"][ref]
        return f"{t.get('de', '')} / {t.get('en', '')}"
    return ""


def values_of(cat: dict, arg: dict) -> list[str]:
    """The values to try for one argument: its options, else the upper-case words its comment lists, else numbers."""
    if arg.get("options"):
        # An option drawn from a table names its row: the job looks the name up (SMG II's STELLGLIEDER:
        # STELLGLIED "HYDROPUMPE", PIN 0x05 — the argument is the name). Both are tried, the name first.
        out = []
        for o in arg["options"]:
            note = (o.get("note") or "").strip()
            if arg.get("optionsFrom", {}).get("table") and re.fullmatch(r"[A-Z][A-Z0-9_]+", note):
                out.append(note)
            out.append(o["value"])
        return list(dict.fromkeys(out))
    words = re.findall(r"(?<![A-Za-z0-9_])([A-Z][A-Z0-9_]{2,})(?![A-Za-z0-9_])", text_of(cat, arg.get("comment")))
    words = [w for w in dict.fromkeys(words) if w not in {"ECU", "SGBD", "ACHTUNG", "INFO", "BYTE"}]
    if words and arg.get("type") == "string":
        return words
    return NUMERIC_SAMPLES


def combos(values: list[list[str]]) -> list[list[str]]:
    total = 1
    for v in values:
        total *= max(1, len(v))
    if total <= MAX_COMBOS:
        return [list(c) for c in itertools.product(*values)]
    base = [v[0] for v in values]
    out = [base]
    for i, vs in enumerate(values):
        for x in vs[1:]:
            c = list(base)
            c[i] = x
            out.append(c)
    return out


def run_once(sgbd: str, job: str, args: list[str], known: list[tuple[list[int], list[int]]]) -> tuple[str, list[int] | None]:
    d = tempfile.mkdtemp(prefix="jobframes")
    try:
        for f in os.listdir(SIM_SRC):
            shutil.copy(os.path.join(SIM_SRC, f), d)
        req, resp = [], []
        for i, (rq, rs) in enumerate(known, 1):
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
        out = subprocess.run([EXE, "--exec", sgbd, job, ";".join(args), "--string"], capture_output=True, text=True,
                             env=dict(os.environ, EDIABAS_SIM_PATH=d), cwd=os.path.dirname(EXE), timeout=180)
        sends = []
        if os.path.exists(TRC):
            sends = re.findall(r"\(Send sim\): ([0-9A-F ]+)", open(TRC, encoding="latin-1").read())
        # The frame sent after the known ones. EdiabasLib's trace shows it without the checksum the
        # interface appends (SMG II's ADAPTIONSWERTE_LOESCHEN: "32 05 43 00" for 0, "32 05 43 01" for 1),
        # so nothing is cut off: cutting the last byte lost every frame's last value.
        nxt = None
        if len(sends) > len(known):
            nxt = [int(x, 16) for x in sends[len(known)].split()]
        return out.stdout + out.stderr, nxt
    finally:
        shutil.rmtree(d, ignore_errors=True)


def answer_to(sgbd: str, addr: int, rq: list[int]) -> list[int]:
    if len(rq) >= 3 and rq[2] == 0x00:
        return oracle_ident(sgbd, addr)
    return frame(addr, [])


def trace(sgbd: str, addr: int, job: str, args: list[str]) -> dict:
    known: list[tuple[list[int], list[int]]] = []
    end = ""
    for _ in range(MAX_SENDS):
        end, nxt = run_once(sgbd, job, args, known)
        if nxt is None or any(nxt == k for k, _ in known):
            break
        known.append((nxt, answer_to(sgbd, addr, nxt)))
    status = re.search(r"JOB_STATUS\s*=\s*(.*)", end)
    sends = []
    for rq, _ in known:
        cs = 0
        for b in rq:
            cs ^= b
        sends.append(hx(rq + [cs]).lower())
    return {"args": args, "sends": sends, "jobStatus": status.group(1).strip() if status else None}


def jobs_of(mid: str) -> tuple[dict, list[dict]]:
    cat = json.load(open(os.path.join(OUT, f"{mid}.jobs.json"), encoding="utf-8"))
    jobs = [j for j in cat["jobs"]
            if j.get("args") and j.get("class") in ("test", "calibration", "unclassified") and not WRITES.search(j["id"])]
    return cat, jobs


def main(only: set[str]) -> None:
    idx = index()
    dest = os.path.join(OUT, "job-frames.oracle.json")
    data = json.load(open(dest, encoding="utf-8")) if os.path.exists(dest) else {"schema": 1, "jobs": {}}
    for m in idx["modules"]:
        mid = m["id"]
        if m.get("fit") == "nonm3" or (only and mid not in only):
            continue
        tel = os.path.join(OUT, f"{mid}.telegrams.json")
        if not os.path.exists(tel) or json.load(open(tel, encoding="utf-8")).get("framing") == "kwp-ds2":
            continue
        cat, jobs = jobs_of(mid)
        for j in jobs:
            values = [values_of(cat, a) for a in j["args"]]
            cases = [trace(m["sgbd"], m["address"], j["id"], c) for c in combos(values)]
            data["jobs"][f"{mid}:{j['id']}"] = {"sgbd": m["sgbd"], "values": values, "cases": cases}
            print(f"  {mid}.{j['id']}: {len(cases)} cases, {sum(1 for c in cases if c['sends'])} with sends")
    data["generatedAt"] = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
    data["how"] = ("each job run by EdiabasLib in simulation (tools/SgbdDump --exec) with the values shown; "
                   "IDENT answered as the group file assigns, everything else with a bare positive answer; "
                   "sends recorded from EdiabasLib's trace, in order")
    with open(dest + ".tmp", "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    os.replace(dest + ".tmp", dest)
    print(f"wrote {dest}: {len(data['jobs'])} jobs")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main(set(sys.argv[1:]))
