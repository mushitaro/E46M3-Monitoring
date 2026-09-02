#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  gen_adaptation_blocks.py — MSS54 適応ブロック表を TypeScript として生成
# ----------------------------------------------------------------------------
#  入力: 逆コンパイル済み DmeAdaptationProfiles.cs（オフセット/スケール）
#        ＋ $SGBD_DUMP_DIR/MSS54DS0.json（本物の独語名・単位・ジョブ）
#  出力: packages/ds2-mss54/src/adaptationBlocks.generated.ts
#
#  ## 2つの出所を突き合わせる理由
#
#  逆コンパイル側はオフセットとスケールを持つが、名前は第三者の英訳である。
#  SGBD 側は `STATUS_ADAPTIONSBLOCK_06/16/26/83` として **本物の独語名と単位**を
#  持つがオフセットを持たない。両方あって初めて「読めて、正しい名前で出せる」。
#
#  結合キーは `STAT_` + シンボルを大文字化して `[]` と `.` を平坦化 + `_WERT`:
#      laa_regler1  -> STAT_LAA_REGLER1_WERT
#      lu_adapt[0]  -> STAT_LU_ADAPT1_WERT      （0始まり → 1始まり）
#      ff.ff_rdy    -> STAT_FF_FF_RDY_WERT
#
#  ## 基数の罠（テストで固定する）
#
#  ジョブ名の数字は **16進**。`STATUS_ADAPTIONSBLOCK_06/16/26/83` は
#  selection 6 / 22 / 38 / **131**。ところが liveValueBlocks.generated.ts には
#  10進の selection 83（EGAS 計測値）が実在する。取り違えると
#  「ラムダ劣化の適応名がスロットル計測値に付く」という、最悪の種類の誤りになる。
#
#  ## 参照実装の欠陥を無言でコピーしない
#
#  (a) SGBD は LU_ADAPT1..8 / AUSS_SUM_ADAP0..7 / KA_ADAP_TZ0..7 と8気筒分を
#      宣言するが、C# 表は6で止まる。S54 は6気筒なので6が正しい。差異は
#      `divergences` に記録して残す（消すのではなく）。
#  (b) `lu_adapt[5]` のスケールだけ他の5本と10^5 ずれている
#      (2.384185791015625E-09 対 0.0002384185791)。SGBD は6本とも `in ppm` と
#      言っている。SGBD 側を採り、差異を記録する。
#
#  ⚠ 実車未検証。THIRD-PARTY-NOTICES.md §3 を参照。
# ============================================================================
from __future__ import annotations

import ast
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from sgbd import model  # noqa: E402

SRC = os.environ.get(
    "MSS54_ADAPTATIONS",
    r"C:\Users\kazuh\MSS54-DS2-Tool-Public-1.2.1\decompiled-source\Core\Mss54Ds2Tool.Core"
    r"\DmeAdaptationProfiles.cs",
)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import paths                                                # noqa: E402

DUMP = paths.require_dump_dir()   # リポジトリ外。理由は tools/paths.py
OUT = os.path.join(os.path.dirname(__file__), "..", "packages", "ds2-mss54", "src",
                   "adaptationBlocks.generated.ts")

# SGBD ジョブ名の16進サフィックス -> selection（10進）
SGBD_BLOCK_JOBS = {
    "STATUS_ADAPTIONSBLOCK_06": 0x06,   # 6
    "STATUS_ADAPTIONSBLOCK_16": 0x16,   # 22
    "STATUS_ADAPTIONSBLOCK_26": 0x26,   # 38
    "STATUS_ADAPTIONSBLOCK_83": 0x83,   # 131
}

# 既に移植済みのライブ値ブロック。適応ブロックと番号が衝突しないことを表明する。
LIVE_SELECTIONS = {2, 3, 4, 19, 21, 35, 83, 179}

FORMAT = {
    "Int7": "int7", "UInt8": "uint8", "UInt10": "uint10", "Int8": "int7",
    "Int15": "int15", "UInt16": "uint16", "Int31": "int31", "UInt32": "uint32",
}

BLOCK_RE = re.compile(
    r'new DmeAdaptationBlockDefinition\(\s*(\d+)\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(\d+)\s*,')
F_RE = re.compile(r"\bF\(")


def split_args(text: str, start: int) -> tuple[list[str], int]:
    """`(` の直後から対応する `)` までを引数に割る。文字列内のカンマは無視。"""
    depth, i, cur, args, in_str = 1, start, [], [], False
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == "\\":
                cur.append(ch); i += 1; cur.append(text[i])
            elif ch == '"':
                in_str = False; cur.append(ch)
            else:
                cur.append(ch)
        elif ch == '"':
            in_str = True; cur.append(ch)
        elif ch in "([":
            depth += 1; cur.append(ch)
        elif ch in ")]":
            depth -= 1
            if depth == 0:
                args.append("".join(cur).strip())
                return args, i + 1
            cur.append(ch)
        elif ch == "," and depth == 1:
            args.append("".join(cur).strip()); cur = []
        else:
            cur.append(ch)
        i += 1
    raise ValueError("unbalanced parentheses")


def unquote(s: str) -> str:
    return s[1:-1] if len(s) >= 2 and s[0] == '"' and s[-1] == '"' else s


def number(expr: str) -> float:
    """C# の数値リテラル式。`1.0 / 32.0` のような式が逆コンパイル結果に残る。
    ast にして数値と四則演算のノードだけ許可する（eval に文字列を渡さない）。"""
    node = ast.parse(expr.strip().rstrip("fFdDmM"), mode="eval").body

    def ev(n):
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return n.value
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.UAdd, ast.USub)):
            v = ev(n.operand)
            return v if isinstance(n.op, ast.UAdd) else -v
        if isinstance(n, ast.BinOp) and isinstance(n.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            a, b = ev(n.left), ev(n.right)
            return {ast.Add: a + b, ast.Sub: a - b, ast.Mult: a * b,
                    ast.Div: a / b}[type(n.op)]
        raise ValueError(f"unsupported numeric expression: {expr!r}")

    return ev(node)


def parse_static_block(src: str, start: int) -> list[dict]:
    """`new DmeAdaptationBlockDefinition(...)` の直後から F(...) を拾う。"""
    fields = []
    depth = 0
    i = start
    while i < len(src):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth <= 0:
                break
        m = F_RE.match(src, i)
        if m:
            args, end = split_args(src, m.end())
            fields.append(parse_field(args))
            i = end
            continue
        i += 1
    return fields


def parse_field(args: list[str]) -> dict:
    """F(symbol, name, offset, format, scale=1, unit="", group="", add=0, valueDescriptions=null)"""
    sym = unquote(args[0])
    name = unquote(args[1])
    offset = int(number(args[2]))
    fmt = FORMAT[args[3].split(".")[-1].strip()]
    scale = number(args[4]) if len(args) > 4 else 1.0
    unit = unquote(args[5]) if len(args) > 5 else ""
    group = unquote(args[6]) if len(args) > 6 else ""
    add = number(args[7]) if len(args) > 7 and args[7].strip() not in ("null", "") else 0.0
    return {"symbol": sym, "name": name, "offset": offset, "format": fmt,
            "scale": scale, "add": add, "unit": unit, "group": group}


def observation_fields() -> list[dict]:
    """`BuildObservationAdaptationFields()` はループで組み立てられるので、
    ソースを読むのではなく同じループをここで再現する。C# 側の 6 は S54 の
    気筒数であり、SGBD が宣言する 8 との差は下で記録する。"""
    out: list[dict] = []
    for i in range(6):
        out.append({"symbol": f"auss_sum_adap[{i}]", "name": f"Lifetime misfire counter cylinder {i+1}",
                    "offset": i * 4, "format": "uint32", "scale": 1.0, "add": 0.0,
                    "unit": "", "group": "Crank Wheel / Running Roughness"})
    for j in range(6):
        out.append({"symbol": f"auss_sum_dc[{j}]", "name": f"Driving-cycle misfire counter cylinder {j+1}",
                    "offset": 32 + j * 2, "format": "uint16", "scale": 1.0, "add": 0.0,
                    "unit": "", "group": "Crank Wheel / Running Roughness"})
    for k in range(6):
        out.append({"symbol": f"ka_adap_tz[{k}]", "name": f"Knock adaptation cylinder {k+1}",
                    "offset": 48 + k * 4, "format": "int31", "scale": 6.103515625e-06,
                    "add": 0.0, "unit": "deg KW", "group": "Knock Adaptation"})
    out += [
        {"symbol": "a_quer_l_sec", "name": "Left lateral acceleration counter", "offset": 80,
         "format": "uint16", "scale": 1.0, "add": 0.0, "unit": "s", "group": "Observation Counters"},
        {"symbol": "a_quer_r_sec", "name": "Right lateral acceleration counter", "offset": 82,
         "format": "uint16", "scale": 1.0, "add": 0.0, "unit": "s", "group": "Observation Counters"},
        {"symbol": "lu_st", "name": "Misfire detection release status", "offset": 84,
         "format": "uint8", "scale": 1.0, "add": 0.0, "unit": "",
         "group": "Crank Wheel / Rough Running"},
    ]
    return out


def sgbd_key(symbol: str) -> str:
    """`lu_adapt[0]` -> `STAT_LU_ADAPT1_WERT`（配列は0始まり→1始まり）、
    `ff.ff_rdy` -> `STAT_FF_FF_RDY_WERT`。"""
    s = re.sub(r"\[(\d+)\]", lambda m: str(int(m.group(1)) + 1), symbol)
    s = s.replace(".", "_")
    return "STAT_" + s.upper() + "_WERT"


def main() -> int:
    src = open(SRC, encoding="utf-8", errors="replace").read()
    dump = model.load(DUMP, "MSS54DS0")

    # --- SGBD 側: 適応ブロックのジョブから本物の独語名を引く ------------------
    sgbd_names: dict[int, dict[str, tuple[str, str]]] = {}
    for job_name, selection in SGBD_BLOCK_JOBS.items():
        job = dump.job(job_name)
        if not job:
            continue
        names = {}
        for r in job.results:
            if r.role != model.ROLE_VALUE:
                continue
            unit = next((x.comment for x in job.results
                         if x.name == r.name.replace("_WERT", "_EINH")), "")
            names[r.name] = (r.comment, unit)
        sgbd_names[selection] = names

    # --- 逆コンパイル側: オフセットとスケール --------------------------------
    blocks = []
    for m in BLOCK_RE.finditer(src):
        selection, name, group, expected = int(m.group(1)), m.group(2), m.group(3), int(m.group(4))
        fields = (observation_fields() if selection == 22
                  else parse_static_block(src, m.end()))
        blocks.append({"selection": selection, "name": name, "group": group,
                       "expectedLength": expected, "fields": fields})

    if not blocks:
        sys.stderr.write(f"[FATAL] no adaptation blocks parsed from {SRC}\n")
        return 1

    # --- 基数の表明 ----------------------------------------------------------
    sels = {b["selection"] for b in blocks}
    clash = sels & LIVE_SELECTIONS
    if clash:
        sys.stderr.write(
            f"[FATAL] adaptation selections {sorted(clash)} collide with live-value blocks.\n"
            "        STATUS_ADAPTIONSBLOCK_83 is selection 131 (0x83), NOT live block 83 (EGAS).\n")
        return 1

    # --- 突き合わせ ----------------------------------------------------------
    divergences: list[dict] = []
    matched = unmatched = 0
    for b in blocks:
        names = sgbd_names.get(b["selection"], {})
        for f in b["fields"]:
            key = sgbd_key(f["symbol"])
            hit = names.get(key)
            if hit:
                matched += 1
                f["sgbdResult"] = key
                if hit[0]:
                    f["de"] = hit[0]
                if hit[1]:
                    f["unitRes"] = key.replace("_WERT", "_EINH")
            else:
                unmatched += 1
        # SGBD が宣言していて逆コンパイル表に無いもの
        if names:
            have = {sgbd_key(f["symbol"]) for f in b["fields"]}
            missing = sorted(set(names) - have)
            if missing:
                divergences.append({
                    "selection": b["selection"],
                    "kind": "sgbd-declares-more",
                    "results": missing,
                    "note": "MSS54DS0 is the 8-cylinder-capable SGBD; the S54 is a six. "
                            "Recorded rather than dropped.",
                })

    # `lu_adapt[5]` のスケール異常
    for b in blocks:
        for f in b["fields"]:
            if f["symbol"] == "lu_adapt[5]" and abs(f["scale"] - 0.0002384185791) > 1e-12:
                divergences.append({
                    "selection": b["selection"], "kind": "scale-corrected",
                    "symbol": f["symbol"], "referenceScale": f["scale"],
                    "usedScale": 0.0002384185791,
                    "note": "The reference table gives lu_adapt[5] a scale 10^5 off its five "
                            "siblings; the SGBD calls all six 'in ppm'. SGBD wins.",
                })
                f["scale"] = 0.0002384185791

    # SGBD にジョブがあるのに逆コンパイル表にブロックが無いもの = 読めない。
    # 名前・独語文・単位は出せるがオフセットが無いので値は出せない。
    # 黙って消すと「そのブロックは存在しない」に見えるので、明示的に運ぶ。
    unreadable = []
    for job_name, selection in SGBD_BLOCK_JOBS.items():
        if selection in sels or selection not in sgbd_names:
            continue
        unreadable.append({
            "selection": selection,
            "sgbdJob": job_name,
            "results": sorted(sgbd_names[selection]),
            "note": "The SGBD declares this block and names its values, but no offset or "
                    "scale table exists for it. It can be listed, not read.",
        })

    total = sum(len(b["fields"]) for b in blocks)
    _emit(blocks, divergences, total, matched, unmatched, unreadable)
    for u in unreadable:
        print(f"  unreadable: selection {u['selection']} ({u['sgbdJob']}) "
              f"{len(u['results'])} named values, no offsets")
    print(f"  blocks={len(blocks)} fields={total} joined-to-SGBD={matched} unjoined={unmatched}")
    print(f"  selections={sorted(sels)} (no collision with live {sorted(LIVE_SELECTIONS)})")
    for d in divergences:
        print(f"  divergence: sel {d['selection']} {d['kind']} "
              f"{d.get('symbol') or len(d.get('results', []))}")
    return 0


def _emit(blocks, divergences, total, matched, unmatched, unreadable) -> None:
    def ts(v):
        return json.dumps(v, ensure_ascii=False)

    lines = [
        "// GENERATED by tools/gen_adaptation_blocks.py - do not edit by hand.",
        "//",
        "// MSS54 adaptation blocks: the values the DME LEARNS, as opposed to the live",
        "// values it measures. Read with control 0x0B, exactly like a live block - this",
        "// is a second TABLE, not a second code path.",
        "//",
        "// Two sources, joined field by field:",
        "//   offsets, formats and scales   decompiled DmeAdaptationProfiles.cs",
        "//   German names and units        SGBD STATUS_ADAPTIONSBLOCK_06/16/26/83",
        "//",
        "// The job-name suffixes are HEX. 06/16/26/83 are selections 6/22/38/131. Live",
        "// block 83 is decimal and is EGAS Measurements - a different thing entirely.",
        "//",
        "// NOT VERIFIED ON A VEHICLE.",
        "",
        "import type { FieldFormat } from '@tsunagi/ds2-core';",
        "",
        "export interface AdaptationField {",
        "    symbol: string;",
        "    name: string;",
        "    offset: number;",
        "    format: FieldFormat;",
        "    scale: number;",
        "    add: number;",
        "    unit: string;",
        "    group: string;",
        "    /** The SGBD result this joins to, when one exists. */",
        "    sgbdResult?: string;",
        "    /** The SGBD's own German name. Authoritative where present. */",
        "    de?: string;",
        "    /** The SGBD result carrying the unit, filled in by the ECU at run time. */",
        "    unitRes?: string;",
        "}",
        "",
        "export interface AdaptationBlock {",
        "    selection: number;",
        "    name: string;",
        "    group: string;",
        "    /** The reference's declared length. Advisory - block 6 declares 83 while its",
        "     *  own field table reaches offset 92, so minPayloadLength() is the real check. */",
        "    expectedLength: number;",
        "    /** The SGBD job that reads it, when one exists. Selection 131 has a job but",
        "     *  no offsets, so it can be listed and not read. */",
        "    sgbdJob?: string;",
        "    fields: readonly AdaptationField[];",
        "}",
        "",
        "/** Where this table knowingly differs from the decompiled reference. */",
        "export interface AdaptationDivergence {",
        "    selection: number;",
        "    kind: 'sgbd-declares-more' | 'scale-corrected';",
        "    symbol?: string;",
        "    results?: readonly string[];",
        "    referenceScale?: number;",
        "    usedScale?: number;",
        "    note: string;",
        "}",
        "",
        f"export const MSS54_ADAPTATION_DIVERGENCES: readonly AdaptationDivergence[] = {ts(divergences)};",
        "",
        "/** Blocks the SGBD names but that we have no offsets for. Listable, not readable.",
        " *  Present so the gap is visible rather than looking like the block does not exist. */",
        "export interface UnreadableAdaptationBlock {",
        "    selection: number;",
        "    sgbdJob: string;",
        "    results: readonly string[];",
        "    note: string;",
        "}",
        "",
        f"export const MSS54_ADAPTATION_UNREADABLE: readonly UnreadableAdaptationBlock[] = {ts(unreadable)};",
        "",
        "export const MSS54_ADAPTATION_BLOCKS: readonly AdaptationBlock[] = [",
    ]
    job_for = {v: k for k, v in SGBD_BLOCK_JOBS.items()}
    for b in blocks:
        lines.append("    {")
        lines.append(f"        selection: {b['selection']},")
        lines.append(f"        name: {ts(b['name'])},")
        lines.append(f"        group: {ts(b['group'])},")
        lines.append(f"        expectedLength: {b['expectedLength']},")
        if b["selection"] in job_for:
            lines.append(f"        sgbdJob: {ts(job_for[b['selection']])},")
        lines.append("        fields: [")
        for f in b["fields"]:
            parts = [f"symbol: {ts(f['symbol'])}", f"name: {ts(f['name'])}",
                     f"offset: {f['offset']}", f"format: {ts(f['format'])}",
                     f"scale: {f['scale']!r}", f"add: {f['add']!r}",
                     f"unit: {ts(f['unit'])}", f"group: {ts(f['group'])}"]
            for k in ("sgbdResult", "de", "unitRes"):
                if f.get(k):
                    parts.append(f"{k}: {ts(f[k])}")
            lines.append("            { " + ", ".join(parts) + " },")
        lines.append("        ],")
        lines.append("    },")
    lines += [
        "];",
        "",
        f"/** {total} fields across {len(blocks)} blocks; {matched} joined to an SGBD result, {unmatched} not. */",
        f"export const MSS54_ADAPTATION_FIELD_COUNT = {total};",
        "",
    ]
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    os.replace(tmp, OUT)


if __name__ == "__main__":
    sys.exit(main())
