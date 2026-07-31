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
# ============================================================================
import ast
import os
import re
import sys

SRC = os.environ.get(
    "MSS54_CATALOG",
    r"C:\Users\kazuh\MSS54-DS2-Tool-Public-1.2.1\decompiled-source\Core\Mss54Ds2Tool.Core\DmeLiveValueCatalog.cs",
)
OUT = os.path.join(os.path.dirname(__file__), "..", "packages", "ds2-mss54", "src",
                   "liveValueBlocks.generated.ts")

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


def num(v):
    """スケールを TS のリテラルとして出す。丸めない — 2進で表せる値はそのまま、
       表せない値も repr の往復で桁を落とさない。"""
    if v == int(v):
        return str(int(v))
    return repr(v)


def emit(blocks):
    total = sum(len(b["fields"]) for b in blocks)
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
        "export interface LiveValueField extends FieldDef {",
        "    /** Human-readable name from the reference catalog. */",
        "    name: string;",
        "    unit: string;",
        "    group: string;",
        "}",
        "",
        "export interface LiveValueBlock {",
        "    /** Selection byte sent with DS2 control 0x0B. */",
        "    selection: number;",
        "    name: string;",
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
        lines.append(f"        name: {b['name']!r},".replace("'", '"', 2))
        lines.append(f"        group: {b['group']!r},".replace("'", '"', 2))
        lines.append(f"        expectedLength: {b['expectedLength']},")
        lines.append("        fields: [")
        for f in b["fields"]:
            lines.append(
                "            { symbol: %s, name: %s, offset: %d, format: '%s', scale: %s, add: %s, unit: %s, group: %s },"
                % (json_str(f["symbol"]), json_str(f["name"]), f["offset"], f["format"],
                   num(f["scale"]), num(f["add"]), json_str(f["unit"]), json_str(f["group"]))
            )
        lines.append("        ],")
        lines.append("    },")
    lines.append("];")
    lines.append("")
    lines.append("export const MSS54_LIVE_FIELD_COUNT = %d;" % total)
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

    dest = os.path.abspath(OUT)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(emit(blocks))
    os.replace(tmp, dest)
    for b in blocks:
        print(f"  selection {b['selection']:>3}  {b['name']:<28} {len(b['fields']):>3} fields  "
              f"(declared length {b['expectedLength']})")
    print(f"wrote {total} fields across {len(blocks)} blocks -> {os.path.relpath(dest)}")
