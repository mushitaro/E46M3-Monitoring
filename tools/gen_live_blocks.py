#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  gen_live_blocks.py — MSS54 ライブ値ブロック表を TypeScript として生成
# ----------------------------------------------------------------------------
#  入力: MSS54-DS2-Tool-Public の逆コンパイル済み DmeLiveValueCatalog.cs
#  出力: packages/ds2-mss54/src/liveValueBlocks.generated.ts
#
#  8ブロック(selection 2/3/4/19/21/35/83/179)・213フィールド。
#  手で書き写すのではなく生成するのは、(a) 213件は必ず写し間違えるから、
#  (b) 元が更新されたときに差分で追随できるから。
#
#  ⚠ オフセット/スケールは「ECUについての事実」だが、出所は第三者ツールの
#     逆コンパイルである。THIRD-PARTY-NOTICES.md §3 を参照。
#     実車で検証するまでは未検証データとして扱うこと。
#
#  ## 名前だけは別の出所から取る
#
#  逆コンパイル側の `name` は第三者による英訳であって、ECU が名乗っている名前
#  ではない。SGBD は同じ量に **本物の独語名** を持っている。オフセットは
#  逆コンパイル側にしか無く、独語名は SGBD 側にしか無い。両方あって初めて
#  「読めて、正しい名前で出せる」——`gen_adaptation_blocks.py` と同じ作法。
#
#  結合は5段。各段の根拠と、**拒否した組も理由付きで**生成物に残す:
#
#   1. `BETRIEBSWTAB`（79行）— `TELEGRAM` 末尾2桁が selection、`BYTE - 3` が
#      オフセット。これが主経路。
#   2. `STAT_<SYMBOL>_WERT` という結果名を全ジョブから引く。`Ergebnis` のような
#      中身の無いコメントは弾く。`_EIN`（状態ビット）は**引かない**——`tl`
#      （Lastsignal＝負荷信号）に `STAT_TL_EIN`（Status Vollast＝全負荷状態）が
#      当たる。同名だが別物で、これを通すと嘘の名前が付く。
#   3. ブロック4のみ `BITS` 表 → `STATUS_DIGITAL` のコメント。ただし
#      **1バイトに名前付きビットが1本しか無いときだけ**。7バイトは複数ビットを
#      持ち、そこで1本を選ぶのは「そのバイトの名前」を騙ることになる。拒否を記録。
#   4. ブロック179は `LESEN_SYSTEMCHECK_LAUFUNRUHE` が読む。テレグラム
#      `12 05 0b b3` を抽出して確認しており、推測ではない。ジョブのコメントは
#      「点火順（1-5-3-6-2-4）ではなく物理気筒順」と明言している——値の並びを
#      決める事実なので、そのまま運ぶ。
#   5. 兄弟ブロック伝播。10シンボルが2ブロックに出る。**参照名が完全一致する
#      ときだけ**独語を渡す。`ti_ausblend_ist` はブロック4で "Injection channels"、
#      19で "Injection blanking counter actual" ——同じシンボルの別物である。
#      拒否は両方の名前ごと記録する（手書き時にそこを見れば足りる）。
# ============================================================================
import ast
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from sgbd import model  # noqa: E402
from extract_telegrams import extract as extract_telegrams  # noqa: E402
from terms.live_channels import BLOCK_NAMES, LIVE_CHANNELS  # noqa: E402

SRC = os.environ.get(
    "MSS54_CATALOG",
    r"C:\Users\kazuh\MSS54-DS2-Tool-Public-1.2.1\decompiled-source\Core\Mss54Ds2Tool.Core\DmeLiveValueCatalog.cs",
)
DUMP = os.path.join(os.path.dirname(__file__), "SgbdDump", "out")
ECU_DIR = os.environ.get("EDIABAS_ECU_DIR", r"C:\EDIABAS\ECU")
SGBD_PRG = "MSS54DS0.prg"
SGBD_ADDR = 0x12
OUT = os.path.join(os.path.dirname(__file__), "..", "packages", "ds2-mss54", "src",
                   "liveValueBlocks.generated.ts")

# `BETRIEBSWTAB` の1行だけ LNAME が隣の行のものになっている。
# `ll_abw`（ラフラン気筒別偏差）に "Soll Strom Servotronikventil"
# （サーボトロニック弁の目標電流）が入っている。行そのものが壊れているので、
# grep できる形で名指しして除外する——静かに落とすと理由が消える。
CORRUPT_ROWS = {("12050B15", "ll_abw")}

# 中身を持たない結果コメント。これを名前として採ると「結果」という名前の
# チャンネルが並ぶ。
PLACEHOLDER_COMMENTS = {"", "ergebnis", "status als wert", "status als text"}

BLOCK_RE = re.compile(
    r'new DmeLiveValueBlockDefinition\(\s*(\d+)\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*(\d+)\s*,')
# ヘルパー呼び出しと、ヘルパーを介さない生コンストラクタの両方を拾う。
# 生の形は VANOS ブロックの gks_roh / psau_roh の2件だけだが、
# 取りこぼすと 213 → 211 になり件数ガードで止まる（実際に止まった）。
CALL_RE = re.compile(r'\b(A|S|U8|I7|U16|I15|new DmeLiveValueFieldDefinition)\(')

# helper -> format
FORMAT = {"A": "uint10", "S": "uint8", "U8": "uint8", "I7": "int7", "U16": "uint16", "I15": "int15"}

# DmeLiveValueFieldFormat.X -> FieldFormat
RAW_FORMAT = {
    "Int7": "int7", "UInt8": "uint8", "UInt10": "uint10",
    "Int15": "int15", "UInt16": "uint16", "Int31": "int31", "UInt32": "uint32",
}


def split_args(text, start):
    """`(` の直後から始めて、対応する `)` までを引数リストに割る。
       文字列リテラル内のカンマは無視する。"""
    depth, i, cur, args, in_str = 1, start, [], [], False
    while i < len(text):
        c = text[i]
        if in_str:
            if c == '\\':
                cur.append(c)
                i += 1
                cur.append(text[i])
            elif c == '"':
                in_str = False
                cur.append(c)
            else:
                cur.append(c)
        elif c == '"':
            in_str = True
            cur.append(c)
        elif c == '(':
            depth += 1
            cur.append(c)
        elif c == ')':
            depth -= 1
            if depth == 0:
                args.append(''.join(cur).strip())
                return args, i + 1
            cur.append(c)
        elif c == ',' and depth == 1:
            args.append(''.join(cur).strip())
            cur = []
        else:
            cur.append(c)
        i += 1
    raise ValueError('unbalanced parentheses')


def unquote(s):
    return s[1:-1] if len(s) >= 2 and s[0] == '"' and s[-1] == '"' else s


def number(expr):
    """C# の数値リテラル式を評価する。逆コンパイル結果には `1.0 / 32.0` や
       `0.75 / 256.0` のような式がそのまま残っている。
       ast で構文木にしてから、数値リテラルと四則演算のノードだけを許可する
       （eval に文字列を渡さない）。"""
    node = ast.parse(expr.strip().rstrip("fFdDmM"), mode="eval").body

    def ev(n):
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return float(n.value)
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.UAdd, ast.USub)):
            v = ev(n.operand)
            return v if isinstance(n.op, ast.UAdd) else -v
        if isinstance(n, ast.BinOp) and isinstance(n.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            a, b = ev(n.left), ev(n.right)
            if isinstance(n.op, ast.Add):
                return a + b
            if isinstance(n.op, ast.Sub):
                return a - b
            if isinstance(n.op, ast.Mult):
                return a * b
            return a / b
        raise ValueError(f"unsupported numeric expression: {expr!r}")

    return ev(node)


def parse(text):
    # 表の後ろには `private static DmeLiveValueFieldDefinition A(string symbol, ...)`
    # というヘルパー定義が並んでいる。CALL_RE はそれも拾ってしまい `int offset` を
    # オフセットとして食べる。表の終わりで切る。
    cut = text.find("private static DmeLiveValueFieldDefinition")
    if cut != -1:
        text = text[:cut]

    blocks = []
    for m in BLOCK_RE.finditer(text):
        selection, name, group, length = int(m.group(1)), m.group(2), m.group(3), int(m.group(4))
        blocks.append({"selection": selection, "name": name, "group": group,
                       "expectedLength": length, "start": m.end(), "fields": []})
    # 各ブロックの範囲は次のブロック開始まで
    for i, b in enumerate(blocks):
        end = blocks[i + 1]["start"] if i + 1 < len(blocks) else len(text)
        segment = text[b["start"]:end]
        for cm in CALL_RE.finditer(segment):
            helper = cm.group(1)
            args, _ = split_args(segment, cm.end())
            symbol, name = unquote(args[0]), unquote(args[1])
            offset = int(args[2])
            if helper == "new DmeLiveValueFieldDefinition":
                # (symbol, name, offset, DmeLiveValueFieldFormat.X, scale, add, unit, group)
                fmt_name = args[3].rsplit(".", 1)[-1].strip()
                fmt = RAW_FORMAT[fmt_name]
                scale = number(args[4]) if len(args) > 4 else 1.0
                add = number(args[5]) if len(args) > 5 else 0.0
                unit = unquote(args[6]) if len(args) > 6 else ""
                group = unquote(args[7]) if len(args) > 7 else ""
                b["fields"].append({
                    "symbol": symbol, "name": name, "offset": offset,
                    "format": fmt, "scale": scale, "add": add,
                    "unit": unit, "group": group,
                })
                continue
            if helper == "A":
                # A() は mV/bit を渡し、内部で /1000 して V にする
                scale = number(args[3]) / 1000.0
                add, unit, group = 0.0, "V", "Analog Inputs"
            elif helper == "S":
                scale, add, unit, group = 1.0, 0.0, "", "Status"
            else:
                scale = number(args[3]) if len(args) > 3 else 1.0
                unit = unquote(args[4]) if len(args) > 4 else ""
                add = number(args[5]) if len(args) > 5 else 0.0
                group = unquote(args[6]) if len(args) > 6 else ""
            b["fields"].append({
                "symbol": symbol, "name": name, "offset": offset,
                "format": FORMAT[helper], "scale": scale, "add": add,
                "unit": unit, "group": group,
            })
        del b["start"]
    return blocks


def live_selections_of(job_name, telegrams, live):
    """そのジョブが読む **ライブ** ブロックの selection を、テレグラムから全部返す。

    `12 05 0b <sel> <ck>` の 0x0b が READ_IO_STATUS。推測ではなくバイト列。

    「最初の 0x0b」を採ってはいけない。`LESEN_SYSTEMCHECK_LAUFUNRUHE` は
    `0b 16`（適応ブロック 0x16 = selection 22）と `0b b3`（ライブ 179）の
    2本を持ち、先頭は適応側である。ライブブロックのものだけに絞り、それでも
    複数残るなら結合しない——どちらか選ぶ根拠が無い。
    """
    out = []
    for tel in telegrams.get(job_name, []):
        h = tel["hex"].split()
        if len(h) >= 4 and h[2] == "0b":
            sel = int(h[3], 16)
            if sel in live and sel not in out:
                out.append(sel)
    return out


def join_german(blocks, dump, telegrams):
    """独語名を5段で結合する。返り値は (件数の内訳, 拒否記録)。

    `blocks` の各 field をその場で書き換える（`de` / `deSource` / `sgbdRow`）。
    """
    index = {b["selection"]: b for b in blocks}
    counts = {}
    refusals = []

    def take(selection, field, source, text, row=None):
        if not text or "de" in field:
            return False
        field["de"] = text
        field["deSource"] = source
        if row:
            field["sgbdRow"] = row
        counts[source] = counts.get(source, 0) + 1
        return True

    # --- 1. BETRIEBSWTAB: selection はテレグラム末尾、オフセットは BYTE-3 -----
    tab = dump.table("BETRIEBSWTAB")
    for row in (tab.dicts() if tab else []):
        if (row["TELEGRAM"], row["NAME"]) in CORRUPT_ROWS:
            refusals.append({
                "kind": "corrupt-source-row",
                "sgbdRow": f"BETRIEBSWTAB.{row['NAME']}",
                "why": f"LNAME is {row['LNAME']!r}, which belongs to a different quantity. "
                       "The row is wrong at the source; excluded by name rather than silently.",
            })
            continue
        try:
            selection = int(row["TELEGRAM"][-2:], 16)
            offset = int(row["BYTE"]) - 3
        except ValueError:
            continue
        block = index.get(selection)
        if not block:
            continue                       # adaptation blocks and 8-cylinder rows
        for field in block["fields"]:
            if field["offset"] == offset:
                take(selection, field, "betriebswtab", row["LNAME"],
                     f"BETRIEBSWTAB.{row['NAME']}")

    # --- 2. STAT_<SYMBOL>_WERT をあらゆるジョブの結果から ---------------------
    results = {}
    for job in dump.jobs:
        for r in job.results:
            if (r.role == model.ROLE_VALUE and r.name.endswith("_WERT")
                    and r.comment.strip().lower() not in PLACEHOLDER_COMMENTS):
                results.setdefault(r.name, (job.name, r.comment))
    for block in blocks:
        for field in block["fields"]:
            key = f"STAT_{field['symbol'].upper()}_WERT"
            hit = results.get(key)
            if hit:
                take(block["selection"], field, "job-result", hit[1], f"{hit[0]}.{key}")

    # --- 3. ブロック4のビット。1バイト1ビットのときだけ ----------------------
    bits = {}
    for row in (dump.table("BITS").dicts() if dump.table("BITS") else []):
        bits.setdefault(int(row["BYTE"]), []).append(row["NAME"])
    digital = {r.name: r.comment for r in dump.job("STATUS_DIGITAL").results} \
        if dump.job("STATUS_DIGITAL") else {}
    block4 = index.get(4)
    for field in (block4["fields"] if block4 else []):
        names = bits.get(field["offset"], [])
        if len(names) == 1:
            take(4, field, "status-bits", digital.get(f"STAT_{names[0]}_EIN"),
                 f"STATUS_DIGITAL.STAT_{names[0]}_EIN")
        elif len(names) > 1 and "de" not in field:
            refusals.append({
                "kind": "byte-carries-several-bits",
                "selection": 4, "symbol": field["symbol"], "name": field["name"],
                "candidates": names,
                "why": "The SGBD names one bit per row; this byte carries several. "
                       "Any one of their names would be a claim about the whole byte.",
            })

    # --- 4. ブロック179: それを読むジョブから ---------------------------------
    # 気筒の並びはジョブのコメントが明言している。値の読み方を決める事実。
    lu_name = "LESEN_SYSTEMCHECK_LAUFUNRUHE"
    lu_job = dump.job(lu_name)
    lu_selections = live_selections_of(lu_name, telegrams, set(index))
    if lu_job and len(lu_selections) == 1:
        lu_selection = lu_selections[0]
        fields = index[lu_selection]["fields"]
        values = [r for r in lu_job.results if r.role == model.ROLE_VALUE]
        if len(values) == len(fields):
            for i, (field, result) in enumerate(zip(fields, values)):
                take(lu_selection, field, "reader-job",
                     f"Segmentzeitabweichung des Geberrades, Zylinder {i + 1} "
                     f"(physikalische Zylinderanordnung, NICHT Zuendreihenfolge)",
                     f"{lu_name}.{result.name}")
        else:
            refusals.append({
                "kind": "reader-job-arity",
                "selection": lu_selection,
                "why": f"{lu_name} declares {len(values)} values for {len(fields)} "
                       "fields; a positional join needs them equal.",
            })
    elif lu_job:
        refusals.append({
            "kind": "reader-job-ambiguous",
            "candidates": [str(s) for s in lu_selections],
            "why": f"{lu_name} reads {len(lu_selections)} live blocks; a positional "
                   "join needs exactly one.",
        })

    # --- 5. 兄弟ブロック伝播。参照名が完全一致するときだけ --------------------
    by_symbol = {}
    for block in blocks:
        for field in block["fields"]:
            by_symbol.setdefault(field["symbol"], []).append((block["selection"], field))
    for symbol, entries in by_symbol.items():
        if len(entries) < 2:
            continue
        for selection, field in entries:
            if "de" in field:
                continue
            for other_sel, other in entries:
                if other_sel == selection or "de" not in other:
                    continue
                if other["name"] == field["name"]:
                    take(selection, field, "sibling-block", other["de"],
                         other.get("sgbdRow"))
                    break
                refusals.append({
                    "kind": "sibling-name-differs",
                    "selection": selection, "symbol": symbol, "name": field["name"],
                    "siblingSelection": other_sel, "siblingName": other["name"],
                    "why": "Same symbol in two blocks under different reference names. "
                           "They may or may not be the same quantity; this refuses to decide.",
                })

    return counts, refusals


def apply_japanese(blocks):
    """手書きの日本語名を貼る。欠けていたら **止める**。

    生成器が黙って英語のまま通せば、UI は日本語の見出しの下に第三者の英訳を
    並べる。それは「訳が無い」ことを隠す。1件でも欠けたら非ゼロ終了にする。
    """
    missing, extra = [], set(LIVE_CHANNELS)
    for block in blocks:
        for field in block["fields"]:
            key = (block["selection"], field["symbol"])
            extra.discard(key)
            ja = LIVE_CHANNELS.get(key)
            if not ja:
                missing.append(f"({block['selection']}, {field['symbol']!r})  {field['name']}")
                continue
            field["ja"] = ja
        names = BLOCK_NAMES.get(block["selection"])
        if names:
            block["ja"], block["nameEn"] = names
        else:
            missing.append(f"block {block['selection']}  {block['name']}")
    return missing, sorted(extra)


def num(v):
    """スケールを TS のリテラルとして出す。丸めない — 2進で表せる値はそのまま、
       表せない値も repr の往復で桁を落とさない。"""
    if v == int(v):
        return str(int(v))
    return repr(v)


def emit(blocks, counts, refusals):
    total = sum(len(b["fields"]) for b in blocks)
    with_de = sum(1 for b in blocks for f in b["fields"] if f.get("de"))
    lines = [
        "// ============================================================================",
        "//  GENERATED FILE — do not edit by hand.",
        "//  Regenerate with: python tools/gen_live_blocks.py",
        "// ============================================================================",
        "//",
        "//  MSS54 live-measurement block layouts: offsets, formats, scaling.",
        f"//  {len(blocks)} blocks, {total} fields.",
        "//",
        "//  A block is read with DS2 control 0x0B (READ_IO_STATUS) plus the selection",
        "//  byte, e.g. selection 35 (VANOS) is `12 05 0B 23 3F`. The whole block comes",
        "//  back in one response and every field below is an offset into that payload.",
        "//",
        "//  PROVENANCE: derived from the decompiled DmeLiveValueCatalog.cs of a",
        "//  third-party tool. Byte offsets and scaling are arguably facts about the",
        "//  ECU rather than creative expression, but the route by which they were",
        "//  obtained is a decompilation — see THIRD-PARTY-NOTICES.md §3.",
        "//",
        "//  NOT VERIFIED ON A VEHICLE. `expectedLength` below is the reference's",
        "//  declared block length and is advisory only: validate a response against",
        "//  minPayloadLength(fields) instead, because a declared length can be stale",
        "//  while the field table is not (the reference contains exactly that case).",
        "// ============================================================================",
        "",
        "import type { FieldDef } from '@tsunagi/ds2-core';",
        "",
        "/** How a field's German name was obtained. See the generator's header. */",
        "export type LiveJoinSource =",
        "    | 'betriebswtab'    // BETRIEBSWTAB row matched on (selection, offset)",
        "    | 'job-result'      // a STAT_<SYMBOL>_WERT result somewhere in the SGBD",
        "    | 'status-bits'     // BITS -> STATUS_DIGITAL, only where the byte holds one bit",
        "    | 'reader-job'      // the job whose telegram reads this block",
        "    | 'sibling-block';  // the same symbol in another block, same reference name",
        "",
        "export interface LiveValueField extends FieldDef {",
        "    /**",
        "     * Name from the reference catalog. English, and a THIRD PARTY's English —",
        "     * not what the ECU calls this quantity. `de` is.",
        "     */",
        "    name: string;",
        "    /**",
        "     * Japanese name, hand-written in `tools/terms/live_channels.py`.",
        "     *",
        "     * Required, and the generator exits non-zero if any channel lacks one.",
        "     * Machine translation is not an option here: 127 of the 213 have no",
        "     * German to translate FROM, and decomposing the ones that do put",
        "     * `Luftmasse` (air MASS) into Japanese as electrical ground.",
        "     */",
        "    ja: string;",
        "    unit: string;",
        "    group: string;",
        "    /** The SGBD's own German, where a join was possible. Absent means none was. */",
        "    de?: string;",
        "    /** Present exactly when `de` is. */",
        "    deSource?: LiveJoinSource;",
        "    /** The SGBD row or result `de` came from, so it can be checked. */",
        "    sgbdRow?: string;",
        "}",
        "",
        "/** A join that had evidence and was refused, with the reason. */",
        "export interface LiveJoinRefusal {",
        "    kind: string;",
        "    selection?: number;",
        "    symbol?: string;",
        "    name?: string;",
        "    candidates?: readonly string[];",
        "    siblingSelection?: number;",
        "    siblingName?: string;",
        "    sgbdRow?: string;",
        "    why: string;",
        "}",
        "",
        "export interface LiveValueBlock {",
        "    /** Selection byte sent with DS2 control 0x0B. */",
        "    selection: number;",
        "    /** Block name, hand-written. A block is one round trip, so this is a cost label. */",
        "    name: string;",
        "    ja: string;",
        "    group: string;",
        "    /** The reference's declared length. Advisory — see the header note. */",
        "    expectedLength: number;",
        "    fields: readonly LiveValueField[];",
        "}",
        "",
        "export const MSS54_LIVE_BLOCKS: readonly LiveValueBlock[] = [",
    ]
    for b in blocks:
        lines.append("    {")
        lines.append(f"        selection: {b['selection']},")
        lines.append("        name: %s," % json_str(b["nameEn"]))
        lines.append("        ja: %s," % json_str(b["ja"]))
        lines.append(f"        group: {b['group']!r},".replace("'", '"', 2))
        lines.append(f"        expectedLength: {b['expectedLength']},")
        lines.append("        fields: [")
        for f in b["fields"]:
            tail = ""
            if f.get("de"):
                tail = ", de: %s, deSource: '%s'" % (json_str(f["de"]), f["deSource"])
                if f.get("sgbdRow"):
                    tail += ", sgbdRow: %s" % json_str(f["sgbdRow"])
            lines.append(
                "            { symbol: %s, name: %s, ja: %s, offset: %d, format: '%s', scale: %s, add: %s, unit: %s, group: %s%s },"
                % (json_str(f["symbol"]), json_str(f["name"]), json_str(f["ja"]),
                   f["offset"], f["format"],
                   num(f["scale"]), num(f["add"]), json_str(f["unit"]), json_str(f["group"]), tail)
            )
        lines.append("        ],")
        lines.append("    },")
    lines.append("];")
    lines.append("")
    lines.append("export const MSS54_LIVE_FIELD_COUNT = %d;" % total)
    lines.append("")
    lines.append("/**")
    lines.append(" * How much of the table carries the ECU's own German, and by which route.")
    lines.append(" *")
    lines.append(" * Published rather than kept in a commit message: the number is the honest")
    lines.append(" * answer to 'are these names real', and it has to be able to go down as well")
    lines.append(" * as up when the joins change.")
    lines.append(" */")
    lines.append("export const MSS54_LIVE_COVERAGE = {")
    lines.append("    fields: %d," % total)
    lines.append("    withGerman: %d," % with_de)
    lines.append("    bySource: {")
    for src in sorted(counts):
        lines.append("        '%s': %d," % (src, counts[src]))
    lines.append("    },")
    lines.append("} as const;")
    lines.append("")
    lines.append("/**")
    lines.append(" * Joins that had evidence and were refused.")
    lines.append(" *")
    lines.append(" * NOT the list of fields without German — most of those simply have no SGBD")
    lines.append(" * row at all. These are the ones where something plausible was available and")
    lines.append(" * taking it would have asserted more than the source supports. Each is a")
    lines.append(" * place a human should look when writing the names by hand.")
    lines.append(" */")
    lines.append("export const MSS54_LIVE_JOIN_REFUSALS: readonly LiveJoinRefusal[] = [")
    for r in refusals:
        parts = []
        for key in ("kind", "selection", "symbol", "name", "candidates",
                    "siblingSelection", "siblingName", "sgbdRow", "why"):
            if key not in r:
                continue
            v = r[key]
            if isinstance(v, int):
                parts.append("%s: %d" % (key, v))
            elif isinstance(v, list):
                parts.append("%s: [%s]" % (key, ", ".join(json_str(x) for x in v)))
            else:
                parts.append("%s: %s" % (key, json_str(v)))
        lines.append("    { %s }," % ", ".join(parts))
    lines.append("];")
    lines.append("")
    return "\n".join(lines)


def json_str(s):
    return '"' + s.replace('\\', '\\\\').replace('"', '\\"') + '"'


if __name__ == "__main__":
    if not os.path.exists(SRC):
        sys.exit(f"[FATAL] catalog not found: {SRC}\nSet MSS54_CATALOG to override.")
    blocks = parse(open(SRC, encoding="utf-8", errors="replace").read())
    if not blocks:
        sys.exit("[FATAL] no blocks parsed — the catalog format changed")
    total = sum(len(b["fields"]) for b in blocks)
    # 参照実装の申告フィールド数と突き合わせる（配列サイズが .cs に書いてある）
    declared = [int(n) for n in re.findall(r'DmeLiveValueFieldDefinition\[(\d+)\]',
                                           open(SRC, encoding="utf-8", errors="replace").read())]
    if declared and sum(declared) != total:
        sys.exit(f"[FATAL] parsed {total} fields but the source declares {sum(declared)} "
                 f"({declared}). Refusing to emit a partial table.")

    # --- 独語名の結合 --------------------------------------------------------
    dump = model.load(DUMP, "MSS54DS0")
    prg = os.path.join(ECU_DIR, SGBD_PRG)
    if not os.path.exists(prg):
        sys.exit(f"[FATAL] SGBD binary not found: {prg}\nSet ECU_DIR to override.")
    telegrams = extract_telegrams(prg, SGBD_ADDR)
    counts, refusals = join_german(blocks, dump, telegrams)
    with_de = sum(1 for b in blocks for f in b["fields"] if f.get("de"))

    # --- 手書きの日本語名。1件でも欠けたら書き出さない ------------------------
    missing, extra = apply_japanese(blocks)
    if extra:
        sys.stderr.write(
            "[FATAL] tools/terms/live_channels.py has %d entry/entries for channels that "
            "do not exist:\n" % len(extra)
            + "".join(f"    {k}\n" for k in extra))
        sys.exit(1)
    if missing:
        sys.stderr.write(
            "[FATAL] %d channel(s)/block(s) have no Japanese name. Add them to "
            "tools/terms/live_channels.py:\n" % len(missing)
            + "".join(f"    {m}\n" for m in missing))
        sys.exit(1)

    dest = os.path.abspath(OUT)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(emit(blocks, counts, refusals))
    os.replace(tmp, dest)
    for b in blocks:
        named = sum(1 for f in b["fields"] if f.get("de"))
        print(f"  selection {b['selection']:>3}  {b['name']:<40} {len(b['fields']):>3} fields  "
              f"{named:>3} with German  (declared length {b['expectedLength']})")
    print(f"wrote {total} fields across {len(blocks)} blocks -> {os.path.relpath(dest)}")
    print(f"  Japanese: {total}/{total} (hand-written; missing is fatal)")
    print(f"  German:   {with_de}/{total}  {counts}")
    print(f"  refused with reason: {len(refusals)}")
    # 独語が無いチャンネルは、日本語名を SGBD と突き合わせて検算できない。
    # 訳が無いのではなく、裏取りの相手がいない。件数を出しておく。
    if with_de < total:
        print(f"  note: {total - with_de} field(s) have no SGBD German to check "
              "their Japanese against.")
