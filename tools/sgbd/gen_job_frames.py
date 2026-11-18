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
  - a choice (a table's rows — the catalogue's, or the table the comment names, from the SGBD's dump in
    SGBD_DUMP_DIR — an enumeration, the words the SGBD's comment lists or quotes, what follows its `=`,
    a range it writes as text, a length it asks for): every one;
  - a number: a spread over the type (0, 1, 2, … the type's ends, negatives where the type has them).
    The app may send a number between two tried values only when every tried value from one to the
    other agreed (agreedFrame.ts), so the spread is what opens a range;
  - free text and bytes: not handed (empty), as EDIABAS runs a job without that argument.
Choices are crossed (up to MAX_CHOICE_COMBOS, else each in turn with the others not handed); each number
varies one at a time from its first value, for every choice combination.

No car and no cable. What this proves is that the app builds the bytes BMW's job builds; whether a module
does what the job says is proved only on a car, and the app says so on every run.

Runs where EdiabasLib runs: the development PC (tools/SgbdDump), or Linux with SgbdDump built against
EdiabasLib's sources (SGBD_DUMP_EXE, EDIABAS_ECU_PATH = the data repository's sgbd/prg,
EDIABAS_SIM_PATH = its sgbd/sim).
    python tools/sgbd/gen_job_frames.py              # every module
    python tools/sgbd/gen_job_frames.py smg2 mss54   # some
    python tools/sgbd/gen_job_frames.py --changed    # only jobs new or tried with other values since
    python tools/sgbd/gen_job_frames.py --discover   # a job that refused every value: the table its trace looks up
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
DRIVE_CLASSES = ("test", "calibration", "unclassified", "protocol")
MAX_CHOICE_COMBOS = 600
MAX_SENDS = 16
WORKERS = int(os.environ.get("JOB_FRAMES_WORKERS", str(os.cpu_count() or 4)))
# --changed: only the jobs not run yet, or whose values to try have changed since.
CHANGED_ONLY = "--changed" in sys.argv

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


def dump_tables(sgbd: str) -> dict:
    """The SGBD's tables from its dump (SGBD_DUMP_DIR/<SGBD>.json), by upper-case name; empty without one."""
    d = os.environ.get("SGBD_DUMP_DIR", "")
    name = re.sub(r"\.prg$", "", sgbd, flags=re.I).upper()
    for f in (os.listdir(d) if d and os.path.isdir(d) else []):
        if f.upper() == name + ".JSON":
            return {k.upper(): v for k, v in json.load(open(os.path.join(d, f), encoding="utf-8")).get("tables", {}).items()}
    return {}


def table_values(comment: str, tables: dict) -> list[str]:
    """`table BITS NAME ART TEXT`: the rows of that table, by NAME where it has one, else the first column named."""
    m = re.search(r"table\s+(\w+)((?:\s+[A-Z_][A-Z0-9_]*)+)", comment)
    if not m or m.group(1).upper() not in tables:
        return []
    rows = tables[m.group(1).upper()]
    if not rows:
        return []
    head = [h.upper() for h in rows[0]]
    named = [c.upper() for c in m.group(2).split()]
    col = next((c for c in (["NAME"] if "NAME" in named else []) + named if c in head), None)
    if col is None:
        return []
    i = head.index(col)
    return [r[i] for r in rows[1:] if i < len(r) and r[i] and r[i] not in ("XY", "??", "--")][:64]


def values_of(cat: dict, arg: dict, tables: dict | None = None) -> tuple[str, list[str]]:
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
    from_table = table_values(comment, tables or {})
    if from_table:
        return "choice", list(dict.fromkeys(from_table))
    if arg.get("type") == "string":
        # `Frequenz in KHz 0 - 999999`: a number written as text.
        rng = re.search(r"(?<![\w.])(\d+)\s*-\s*(\d+)(?![\w.])", comment)
        if rng:
            lo, hi = int(rng.group(1)), int(rng.group(2))
            return "choice", list(dict.fromkeys(str(v) for v in (lo, lo + 1, (lo + hi) // 2, hi - 1, hi) if lo <= v <= hi))
        # `10 character string`: that many characters.
        chars = re.search(r"(\d+)\s*(?:character|Zeichen)", comment, re.I)
        if chars:
            return "choice", ["0" * int(chars.group(1))]
        quoted = re.findall(r"['\"]([^'\"\s]{1,24})['\"]", comment)
        # `Einmal = E oder Wiederholung = W`: what follows an equals sign.
        equals = re.findall(r"=\s*([A-Za-z0-9_]{1,24})\b", comment)
        words = re.findall(r"(?<![A-Za-z0-9_])([A-Z][A-Z0-9_]{2,})(?![A-Za-z0-9_])", comment)
        # `Oel_Reset, Weg_Reset, Zeit_Reset`; `links bzw. rechts`.
        joined = re.findall(r"(?<![A-Za-z0-9_])([A-Za-z]+_[A-Za-z0-9_]+)(?![A-Za-z0-9_])", comment)
        either = [w for pair in re.findall(r"(\w+)\s+bzw\.\s+(\w+)", comment) for w in pair]
        found = [w for w in dict.fromkeys(quoted + equals + joined + either + words) if w not in SKIP_WORDS]
        if found:
            return "choice", found
        # Free text or bytes: run as EDIABAS runs a job that is not handed this argument.
        return "choice", [""]
    kind = number_kind(arg)
    if kind:
        return "number", NUMBERS[kind]
    # Bytes: not handed, as for free text.
    return "choice", [""]


def cases_of(kinds: list[str], values: list[list[str]]) -> list[list[str]] | None:
    """Every choice crossed; each number in turn, from its first value. None if a text argument has no value to try."""
    if any(k == "text" for k in kinds):
        return None
    choice_idx = [i for i, k in enumerate(kinds) if k == "choice"]
    number_idx = [i for i, k in enumerate(kinds) if k == "number"]
    total = 1
    for i in choice_idx:
        total *= max(1, len(values[i]))
    if total <= MAX_CHOICE_COMBOS:
        combos = list(itertools.product(*[values[i] for i in choice_idx]))
    else:
        # Too many to cross (DSC's STEUERN_DIGITAL: fifteen components of sixteen): each choice in turn,
        # the first choice argument at its first value and the others not handed (EDIABAS's default).
        first = choice_idx[0]
        base = [values[first][0]] + ["" for _ in choice_idx[1:]]
        combos = [tuple(base)]
        for n, i in enumerate(choice_idx):
            for v in values[i]:
                c = list(base)
                c[n] = v
                combos.append(tuple(c))
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
    # The index names the file (MSS54DS0.prg); EdiabasLib and its simulation file go by the SGBD's name.
    sgbd = re.sub(r"\.prg$", "", sgbd, flags=re.I)
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
        tables = dump_tables(m["sgbd"])
        for j in jobs:
            tried = [values_of(cat, a, tables) for a in j["args"]]
            kinds = [k for k, _ in tried]
            values = [v for _, v in tried]
            cases = cases_of(kinds, values)
            key = f"{mid}:{j['id']}"
            if CHANGED_ONLY and key in data["jobs"] and data["jobs"][key].get("values") == values and data["jobs"][key].get("kinds") == kinds:
                continue
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


ARG_ERRORS = re.compile(r"ERROR_(SIGNAL|ARGUMENT|WRONG_ARGUMENT|BEREICH|SMC|IO_ID|PARAMETER)|wrong argument|BIP_0010", re.I)


def discover() -> None:
    """For a job EdiabasLib refused every value of, the table it looks the value up in: run it once with
    its trace, read the table it sets and the column it seeks, and run it again with that column's rows.
    What the job itself reads is the list of what it takes; nothing is guessed."""
    idx = {m["sgbd"]: m for m in index()["modules"]}
    dest = os.path.join(OUT, "job-frames.oracle.json")
    data = json.load(open(dest, encoding="utf-8"))
    for key, entry in list(data["jobs"].items()):
        cases = entry["cases"]
        # What INITIALISIERUNG sent heads every run's trace; it is not the job's.
        init = next((c["sends"] for c in data["jobs"].get(key.split(":")[0] + ":INITIALISIERUNG", {}).get("cases", []) if not c["args"]), [])
        own = [c["sends"][len(init):] if c["sends"][: len(init)] == init else c["sends"] for c in cases]
        if not cases or any(own) or not any(ARG_ERRORS.search(c.get("jobStatus") or "") for c in cases):
            continue
        m = idx.get(entry["sgbd"])
        if not m:
            continue
        job = key.split(":", 1)[1]
        sgbd = re.sub(r"\.prg$", "", m["sgbd"], flags=re.I)
        tables = dump_tables(m["sgbd"])
        kinds, values = list(entry["kinds"]), [list(v) for v in entry["values"]]
        choices = [k for k, kind in enumerate(kinds) if kind == "choice"]
        found_any = []
        # Argument by argument: run with what is found so far and a placeholder for the rest, and take
        # the lookup the job makes for this one (the n-th table it sets and seeks).
        def lookups(args: list[str]) -> list[tuple[str, str]]:
            work = tempfile.mkdtemp(prefix="discover")
            try:
                run_once(work, sgbd, job, args, [])
                trc = open(os.path.join(work, "trc", "ifh.trc"), encoding="latin-1").read()
            except OSError:
                trc = ""
            finally:
                shutil.rmtree(work, ignore_errors=True)
            return re.findall(r'tabset #"(\w+)".*?tabseek #"(\w+)"', trc.split(f"'{job}'")[-1], re.S)

        chosen: dict[int, str] = {}
        for n, i in enumerate(choices):
            base = lambda: [chosen.get(k, "X" if kinds[k] == "choice" else values[k][0]) for k in range(len(kinds))]
            pairs = lookups(base())
            # The arguments found so far may need a value that lets the job reach this one's lookup.
            if n >= len(pairs) and found_any:
                prev = found_any[-1]
                for v in values[prev]:
                    chosen[prev] = v
                    pairs = lookups(base())
                    if n < len(pairs):
                        break
            if n >= len(pairs):
                break
            t, col = pairs[n]
            rows = tables.get(t.upper())
            head = [h.upper() for h in rows[0]] if rows else []
            if col.upper() not in head:
                break
            c = head.index(col.upper())
            vals = [r[c] for r in rows[1:] if c < len(r) and r[c] and r[c] not in ("XY", "??", "--")][:64]
            if not vals:
                break
            values[i] = vals
            found_any.append(i)
            chosen[i] = vals[0]
        if not found_any:
            continue
        new_cases = cases_of(kinds, values) or []
        kwp = json.load(open(os.path.join(OUT, f"{m['id']}.telegrams.json"), encoding="utf-8")).get("framing") == "kwp-ds2"
        with cf.ThreadPoolExecutor(WORKERS) as ex:
            results = list(ex.map(lambda a: trace(m["sgbd"], m["address"], kwp, job, a), new_cases))
        data["jobs"][key] = {**entry, "values": values, "cases": results, "discovered": "its trace looks the values up in its own tables"}
        print(f"  {key}: {len(found_any)} argument(s), {len(results)} cases, {sum(1 for c in results if c['sends'])} with sends", flush=True)
    with open(dest + ".tmp", "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    os.replace(dest + ".tmp", dest)


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
    elif sys.argv[1:] == ["--discover"]:
        discover()
    else:
        main({a for a in sys.argv[1:] if not a.startswith("--")})
