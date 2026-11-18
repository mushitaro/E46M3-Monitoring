#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""What each job that drives something sends — run by EdiabasLib, as BMW's own job runner would.
`public/ecu-data/job-frames.oracle.json`.

The owner decided (2026-11-15) which jobs run on the car, and (2026-11-18) that every job the table
opens must run: with or without values, one frame or several, on every module the app carries (the
E46 M3's and the non-M3 E46's, the DSC MK60 included). The app builds what it sends by running the
module's own SGBD code (packages/monitoring-engine/src/sgbd/jobFrame.ts). Before any of it goes to a car,
each frame the app builds must be the frame EdiabasLib builds for the same values and the same answers:
this file is that answer, and the app opens only what the two agree on
(packages/monitoring-engine/src/sgbd/agreedFrame.ts).

For each job (every job that is not a read and not a write: test, calibration, unclassified) and its
values, this
  1. runs the job in EdiabasLib's simulation (`SgbdDump --exec <SGBD> <JOB> "<a;b;c>"`) with a
     throwaway simulation file that answers every request seen so far: an IDENT with the answer the
     group file assigns to this SGBD (variants.oracle.json), anything else with a bare positive answer
     (DS2: `<addr> 04 A0`; KWP on DS2: `B8 F1 <target> 01 <SID+40>`, the local id echoed);
  2. reads the frame it sent next from EdiabasLib's trace, adds it with its answer, and runs again, until
     the job sends nothing new or MAX_SENDS is reached;
  3. records the frames and the answers, in order, and how the job ended.

Values tried, per argument:
  - a choice (a table's rows, an enumeration, the words the SGBD's comment lists): every one;
  - a number: a spread over the type (0, 1, 2, … the type's ends, negatives where the type has them).
    The app may send a number between two tried values only when every tried value from one to the
    other agreed (agreedFrame.ts), so the spread is what opens a range;
  - free text and binary: not tried — those jobs stay closed and the coverage test says why.
Choices are crossed (up to MAX_CHOICE_COMBOS); each number varies one at a time from its first value,
for every choice combination.

No car and no cable. What this proves is that the app builds the bytes BMW's job builds; whether a module
does what the job says is proved only on a car, and the app says so on every run.

Runs where EdiabasLib runs: the development PC (tools/SgbdDump), or Linux with SgbdDump built against
EdiabasLib's sources (SGBD_DUMP_EXE, EDIABAS_ECU_PATH = the data repository's sgbd/prg,
EDIABAS_SIM_PATH = its sgbd/sim).
    python tools/sgbd/gen_job_frames.py              # every module
    python tools/sgbd/gen_job_frames.py smg2 mss54   # some
    python tools/sgbd/gen_job_frames.py --recheck    # again, two at a time, the runs that met no answer
EdiabasLib's simulation answers on a clock: on a loaded machine a run can end without its answer
(EDIABAS_IFH_0009). That only ever closes a job (fewer frames than the job sends do not agree), and
`--recheck` runs those again on a quiet machine; run it after every full run.
"""
from __future__ import annotations

import concurrent.futures as cf
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

from gen_fault_layouts import EXE, SIM_SRC, frame, oracle_ident  # noqa: E402

# The same rule as packages/monitoring-engine/src/policy.ts and tools/gen_sgbd_results.py.
WRITES = re.compile(r"SCHREIBEN|^WRITE_|_WRITE_|CODIER|FLASH|BAUDRATE|PRUEFSTEMPEL|ZIF_BACKUP|SET_EDIC|NAVDVDPIN")
DRIVE_CLASSES = ("test", "calibration", "unclassified")
MAX_CHOICE_COMBOS = 600
MAX_SENDS = 16
WORKERS = int(os.environ.get("JOB_FRAMES_WORKERS", str(os.cpu_count() or 4)))

# A spread over each numeric type. The ends of the type are in it, so a range the app opens is bounded
# by values EdiabasLib was run with.
NUMBERS = {
    "byte": ["0", "1", "2", "10", "100", "127", "128", "200", "254", "255"],
    "int": ["0", "1", "2", "10", "100", "255", "256", "1000", "32767", "65535", "-1", "-100", "-32768"],
    "long": ["0", "1", "2", "100", "65535", "65536", "2147483647", "-1", "-2147483648"],
    "real": ["0", "1", "2", "0.5", "12.75", "100", "-1", "-12.75"],
}
SKIP_WORDS = {"ECU", "SGBD", "ACHTUNG", "INFO", "BYTE", "WORD", "HEX", "ASCII", "BCD", "INT", "LONG", "REAL", "STRING"}


def index() -> dict:
    return json.load(open(os.path.join(OUT, "index.json"), encoding="utf-8"))


def text_of(cat: dict, ref) -> str:
    if isinstance(ref, int) and 0 <= ref < len(cat.get("texts", [])):
        t = cat["texts"][ref]
        return f"{t.get('de', '')} / {t.get('en', '')}"
    return ""


def number_kind(arg: dict) -> str | None:
    t, k = arg.get("type", ""), arg.get("kind", "")
    if t == "real":
        return "real"
    if t in ("long", "unsigned long"):
        return "long"
    if t in ("unsigned char",) or k == "byte" and t != "string":
        return "byte"
    if t in ("int", "unsigned int"):
        return "byte" if k == "byte" else "int"
    return None


def values_of(cat: dict, arg: dict) -> tuple[str, list[str]]:
    """How an argument is tried — 'choice', 'number' or 'text' — and the values to try."""
    if arg.get("options"):
        # An option drawn from a table names its row: the job looks the name up (SMG II's STELLGLIEDER:
        # STELLGLIED "HYDROPUMPE", PIN 0x05 — the argument is the name). Both are tried, the name first.
        out = []
        for o in arg["options"]:
            note = (o.get("note") or "").strip()
            if arg.get("optionsFrom", {}).get("table") and re.fullmatch(r"[A-Z][A-Z0-9_]+", note):
                out.append(note)
            out.append(o["value"])
        return "choice", list(dict.fromkeys(out))
    comment = text_of(cat, arg.get("comment"))
    if arg.get("type") == "string":
        quoted = re.findall(r"'([^'\s]{1,24})'", comment)
        words = re.findall(r"(?<![A-Za-z0-9_])([A-Z][A-Z0-9_]{2,})(?![A-Za-z0-9_])", comment)
        found = [w for w in dict.fromkeys(quoted + words) if w not in SKIP_WORDS]
        if found:
            return "choice", found
        return "text", []
    kind = number_kind(arg)
    if kind:
        return "number", NUMBERS[kind]
    return "text", []


def cases_of(kinds: list[str], values: list[list[str]]) -> list[list[str]] | None:
    """Every choice crossed; each number in turn, from its first value. None if a text argument has no value to try."""
    if any(k == "text" for k in kinds):
        return None
    choice_idx = [i for i, k in enumerate(kinds) if k == "choice"]
    number_idx = [i for i, k in enumerate(kinds) if k == "number"]
    combos = list(itertools.islice(itertools.product(*[values[i] for i in choice_idx]), MAX_CHOICE_COMBOS))
    out: list[list[str]] = []
    for combo in combos or [()]:
        base = [values[i][0] if values[i] else "" for i in range(len(kinds))]
        for i, v in zip(choice_idx, combo):
            base[i] = v
        out.append(list(base))
        for i in number_idx:
            for v in values[i][1:]:
                c = list(base)
                c[i] = v
                out.append(c)
    return [list(x) for x in dict.fromkeys(tuple(c) for c in out)]


def strip_checksum(b: list[int]) -> list[int]:
    """A frame from the trace without its XOR checksum. Older EdiabasLib traces carry it, newer do not.

    The frame's own length says which: DS2 counts every byte in its second byte, KWP on DS2 counts the
    data in its fourth (header 4 + data + checksum). A checksum of 0x00 makes the XOR test ambiguous."""
    if len(b) >= 4 and b[0] == 0xB8:
        whole = b[3] + 5
    elif len(b) >= 2:
        whole = b[1]
    else:
        return b
    return b[:-1] if len(b) == whole else b


def with_checksum(b: list[int]) -> list[int]:
    x = 0
    for v in b:
        x ^= v
    return b + [x]


def answer_to(sgbd: str, addr: int, kwp: bool, rq: list[int]) -> list[int]:
    if kwp:
        # B8 <target> F1 LL <SID> <data…>: a positive answer echoes the SID + 0x40 and the local id.
        sid = rq[4] if len(rq) > 4 else 0
        data = [(sid + 0x40) & 0xFF] + rq[5:6]
        return with_checksum([0xB8, 0xF1, rq[1] if len(rq) > 1 else 0x29, len(data)] + data)
    if len(rq) >= 3 and rq[2] == 0x00:
        return oracle_ident(sgbd, addr)
    return frame(addr, [])


def run_once(work: str, sgbd: str, job: str, args: list[str], known: list[tuple[list[int], list[int]]]) -> tuple[str, list[int] | None]:
    sim = os.path.join(work, "sim")
    shutil.rmtree(sim, ignore_errors=True)
    os.makedirs(sim)
    for f in os.listdir(SIM_SRC):
        shutil.copy(os.path.join(SIM_SRC, f), sim)
    req, resp = [], []
    c = lambda bs: ",".join(f"{b:02X}" for b in bs)
    for i, (rq, rs) in enumerate(known, 1):
        req += [f"r{2 * i - 1} = {c(with_checksum(rq))}", f"r{2 * i} = {c(rq)}"]
        resp += [f"r{2 * i - 1} = {c(rs)}", f"r{2 * i} = {c(rs)}"]
    with open(os.path.join(sim, sgbd.lower() + ".sim"), "w") as fh:
        fh.write("[REQUEST]\r\n" + "\r\n".join(req) + "\r\n[RESPONSE]\r\n" + "\r\n".join(resp) + "\r\n")
    trc = os.path.join(work, "trc", "ifh.trc")
    if os.path.exists(trc):
        os.remove(trc)
    try:
        out = subprocess.run([EXE, "--exec", sgbd, job, ";".join(args), "--string"], capture_output=True, text=True,
                             env=dict(os.environ, EDIABAS_SIM_PATH=sim), cwd=work, timeout=180)
        text = out.stdout + out.stderr
    except subprocess.TimeoutExpired:
        text = "TIMEOUT"
    sends = []
    if os.path.exists(trc):
        sends = re.findall(r"\(Send sim\): ([0-9A-F ]+)", open(trc, encoding="latin-1").read())
    nxt = None
    if len(sends) > len(known):
        nxt = strip_checksum([int(x, 16) for x in sends[len(known)].split()])
    return text, nxt


def trace(sgbd: str, addr: int, kwp: bool, job: str, args: list[str]) -> dict:
    work = tempfile.mkdtemp(prefix="jobframes")
    try:
        known: list[tuple[list[int], list[int]]] = []
        end = ""
        for _ in range(MAX_SENDS):
            end, nxt = run_once(work, sgbd, job, args, known)
            if nxt is None or any(nxt == k for k, _ in known):
                break
            known.append((nxt, answer_to(sgbd, addr, kwp, nxt)))
        status = re.search(r"JOB_STATUS\s*=\s*(.*)", end)
        failed = re.search(r"FAILED: (.*)", end)
        hx = lambda bs: " ".join(f"{b:02x}" for b in bs)
        return {
            "args": args,
            "sends": [hx(with_checksum(rq)) for rq, _ in known],
            "answers": [hx(rs) for _, rs in known],
            "jobStatus": status.group(1).strip() if status else (failed.group(1).strip()[:120] if failed else None),
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


def jobs_of(mid: str) -> tuple[dict, list[dict]]:
    cat = json.load(open(os.path.join(OUT, f"{mid}.jobs.json"), encoding="utf-8"))
    jobs = [j for j in cat["jobs"] if j.get("class") in DRIVE_CLASSES and not WRITES.search(j["id"])]
    return cat, jobs


def main(only: set[str]) -> None:
    idx = index()
    dest = os.path.join(OUT, "job-frames.oracle.json")
    data = json.load(open(dest, encoding="utf-8")) if os.path.exists(dest) else {"schema": 2, "jobs": {}}
    data["schema"] = 2
    work: list[tuple[str, dict, dict, list[str], list[list[str]], list[list[str]]]] = []
    for m in idx["modules"]:
        mid = m["id"]
        if only and mid not in only:
            continue
        tel = os.path.join(OUT, f"{mid}.telegrams.json")
        if not os.path.exists(tel):
            continue
        kwp = json.load(open(tel, encoding="utf-8")).get("framing") == "kwp-ds2"
        cat, jobs = jobs_of(mid)
        for j in jobs:
            tried = [values_of(cat, a) for a in j["args"]]
            kinds = [k for k, _ in tried]
            values = [v for _, v in tried]
            cases = cases_of(kinds, values)
            key = f"{mid}:{j['id']}"
            if cases is None:
                data["jobs"][key] = {"sgbd": m["sgbd"], "kinds": kinds, "values": values, "cases": [],
                                     "untried": "an argument takes free text or bytes: no value to run it with"}
                continue
            work.append((key, m, {"kwp": kwp}, kinds, values, cases))
    total = sum(len(w[5]) for w in work)
    print(f"{len(work)} jobs, {total} cases, {WORKERS} workers")
    done = 0
    with cf.ThreadPoolExecutor(WORKERS) as ex:
        for key, m, opt, kinds, values, cases in work:
            job = key.split(":", 1)[1]
            results = list(ex.map(lambda a: trace(m["sgbd"], m["address"], opt["kwp"], job, a), cases))
            data["jobs"][key] = {"sgbd": m["sgbd"], "kinds": kinds, "values": values, "cases": results}
            done += len(cases)
            print(f"  [{done}/{total}] {key}: {len(results)} cases, {sum(1 for c in results if c['sends'])} with sends", flush=True)
    data["generatedAt"] = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
    data["how"] = ("each job run by EdiabasLib in simulation (SgbdDump --exec) with the values shown; "
                   "IDENT answered as the group file assigns, everything else with a bare positive answer; "
                   "sends (checksum included) and the answers given, recorded from EdiabasLib's trace, in order")
    with open(dest + ".tmp", "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    os.replace(dest + ".tmp", dest)
    print(f"wrote {dest}: {len(data['jobs'])} jobs")


def recheck() -> None:
    """Runs again, two at a time, every case whose run ended without an answer (EDIABAS_IFH_0009) or timed
    out. Many runs at once on a loaded machine can starve the simulation of its time; a case that ends
    the same way again is kept as it is."""
    idx = {m["sgbd"]: m for m in index()["modules"]}
    dest = os.path.join(OUT, "job-frames.oracle.json")
    data = json.load(open(dest, encoding="utf-8"))
    todo = []
    for key, entry in data["jobs"].items():
        m = idx.get(entry["sgbd"])
        if not m:
            continue
        kwp = json.load(open(os.path.join(OUT, f"{m['id']}.telegrams.json"), encoding="utf-8")).get("framing") == "kwp-ds2"
        for i, c in enumerate(entry["cases"]):
            if re.search(r"IFH_0009|TIMEOUT", c.get("jobStatus") or ""):
                todo.append((key, i, m, kwp))
    print(f"{len(todo)} cases to run again")
    with cf.ThreadPoolExecutor(2) as ex:
        runs = ex.map(lambda t: trace(t[2]["sgbd"], t[2]["address"], t[3], t[0].split(":", 1)[1], data["jobs"][t[0]]["cases"][t[1]]["args"]), todo)
        changed = 0
        for (key, i, _, _), r in zip(todo, runs):
            if r != data["jobs"][key]["cases"][i]:
                changed += 1
            data["jobs"][key]["cases"][i] = r
    print(f"{changed} changed")
    with open(dest + ".tmp", "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    os.replace(dest + ".tmp", dest)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1:] == ["--recheck"]:
        recheck()
    else:
        main(set(sys.argv[1:]))
