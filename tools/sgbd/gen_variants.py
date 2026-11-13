#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""IDENT の答えから、そのアドレスにいる SGBD（変種）を選ぶ規則を、グループファイルから作る。

    python tools/sgbd/gen_variants.py           # 生成し、EDIABAS 自身の選び方と突き合わせる
    python tools/sgbd/gen_variants.py --check   # 突き合わせだけ（書かない）

出力（どちらも BMW のグループファイル由来なので public/ecu-data/、つまり非公開のデータ repo へ）:

    public/ecu-data/variants.json         アドレスごとの選び方（packages/monitoring-engine/src/variants.ts が読む）
    public/ecu-data/variants.oracle.json  突き合わせた答えと、EDIABAS が選んだ変種（TS の試験が読む）

## なぜ「選び方」を手で書き、表をグループファイルから取るのか

EDIABAS は `D_00xx.grp` の IDENTIFIKATION（BEST/2 のバイトコード）を走らせて変種を決める。
その手続きはグループごとに違い（`D_0012` は部品番号→HW＋診断インデックス→HW の順に三つの表を引く。
`D_0032` は HW が "22" のときだけ別の分岐を持ち、見つからなければ表の最後の行 "XYZ" になる）、
バイトコードを一般に TS へ移す道（インタプリタ）は大きすぎる。そこで:

  1. どのバイトをどの順にどの表で引くかは、逆アセンブル（EdiabasLib の Tools/BESTDIS）を読んで
     下の RULES に書く。人（LLM）が読んだもの。
  2. 表の中身はグループファイルから取る（`SgbdDump --tables`）。手で写さない。
  3. **決めるのは EDIABAS**。答えの束（表の全行・小文字・ゼロ・短い答え・否定応答・乱数）を作り、
     `SgbdDump --ident` で EdiabasLib にグループファイルそのもの（BMW のバイトコード）を走らせ、
     RULES の評価と一件でも食い違えば非ゼロで終わる。食い違ったまま書き出す道は無い。

選び方は三つの形で書く。表引き（D_0012・D_0032：答えの区間を文字にして表の行と比べる）、
バイトの範囲（D_0080：答えの 1 バイトを BCD の数として読み、どの範囲に入るか）、バイトのマスク
（D_0080：答えの 1 バイトの上位 4 ビットが D か）。どれも逆アセンブルを読んで書き、EDIABAS と突き合わせる。

RULES に無いアドレスは「選び方が無い」のであって、「何でもよい」のではない。アプリはそのアドレスの
変種を「?」のまま扱い、非 M3 の車では IDENT のほかに何も送らない（packages/monitoring-engine/src/variants.ts）。

## 答えの番地

答えはケーブルから来たままのテレグラム全体（アドレス、長さ、状態 0xA0、データ、チェックサム）。
グループのバイトコードも同じ S2 全体を添字で読むので、番地はそのまま一致する。
DS2 の IDENT の答えでは 3..9 が部品番号（7 桁）、10..11 が HW、14..15 が診断インデックス。
メーター（KOMBI）の IDENT は並びが違い、BCD で 3..6 が部品番号、7 が HW、8 が COD、9 が診断インデックス
（KOMBI46・KOMBI46R の IDENT ジョブ）。D_0080 はこの 9 番を数として読む。
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import json
import os
import random
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
SG = os.path.join(TOOLS, "SgbdDump")
ECU_DATA = os.path.join(TOOLS, "..", "public", "ecu-data")

# ---------------------------------------------------------------------------
#  選び方。Choice は SGBD 名（文字列）、さらに引く Lookup、または None（何も選ばない）。
#  Lookup = {"key": [[start, len], …], "table": 表名, "keyCol": 列, "valCol": 列,
#            "first": [[キー, Choice], …]（表より先に見る行）, "else": Choice}
#  キーは各区間を文字列にして（NUL で切る）つないだもの。表の比較は大文字小文字を区別しない
#  （EDIABAS の tabseek。突き合わせで確かめている）。重複キーは先の行が勝つ。
# ---------------------------------------------------------------------------
RULES: dict[str, dict] = {
    # エンジン。D_0012 IDENTIFIKATION の DS2 の道（答えの [2] が 0xA0）:
    #   S4 = 答え[3..9]（部品番号）で HW7_Tabelle、
    #   なければ S7 = 答え[10..11] + 答え[14..15]（HW＋診断インデックス）で HW2_DIAG_Tabelle、
    #   なければ S5 = 答え[10..11]（HW）で HW2_Tabelle、なければ選ばない（フラグが 0 のまま eoj）。
    #   0xA0 でなければ KWP2000 の道（B8 12 F1 …、ME9・MS45）。それはこの段では送らない。
    "D_0012": {
        "address": 0x12,
        "choose": {
            "key": [[3, 7]], "table": "HW7_TABELLE", "keyCol": "HARDWARENR", "valCol": "VARIANTE",
            "else": {
                "key": [[10, 2], [14, 2]], "table": "HW2_DIAG_TABELLE", "keyCol": "HW2_DIAG_INDEX", "valCol": "VARIANTE",
                "else": {
                    "key": [[10, 2]], "table": "HW2_TABELLE", "keyCol": "HW2", "valCol": "VARIANTE",
                    "else": None,
                },
            },
        },
        "unknown": [],
    },
    # 変速機。D_0032 IDENTIFIKATION の DS2 の道:
    #   S6 = 答え[10..11]（HW）。"22" なら答え[14] が '1' か '4' で GS836、ほかは GS832。
    #   それ以外は SGBD 表を LI_NR で引く。見つからなければ表の最後の行（"XX" → "XYZ"）。
    "D_0032": {
        "address": 0x32,
        "choose": {
            "key": [[10, 2]], "table": "SGBD", "keyCol": "LI_NR", "valCol": "SGBD_NAME",
            "first": [["22", {"key": [[14, 1]], "first": [["1", "GS836"], ["4", "GS836"]], "else": "GS832"}]],
            "else": "XYZ",
        },
        # 表の最後の行の名前。SGBD ではなく「見つからない」の印。
        "unknown": ["XYZ"],
    },
    # メーター。D_0080 IDENTIFIKATION（rev 1.61）の DS2 の道:
    #   答えの [2] が 0xA0 でなければ通信の設定を変えて IDENT を送り直す（この段の答えは同じなので、選ばない）。
    #   n = 答え[9]（診断インデックス）を BCD として読んだ数（上位 4 ビット×10＋下位 4 ビット。A–F もそのまま足す）。
    #   答え[3] の上位 4 ビットが D なら、n が 1・2 か 80..84 のとき KOMBIR40、ほかは選ばない。
    #   そうでなければ n の範囲を上から順に見る（最初に当たったもの）。どれにも当たらなければ選ばない。
    #   逆アセンブル: EdiabasLib の Tools/BESTDIS で D_0080.grp を読んだもの。
    "D_0080": {
        "address": 0x80,
        "choose": {
            "byte": 3, "mask": 0xF0, "equals": 0xD0,
            "then": {"byte": 9, "read": "bcd", "ranges": [[1, 2, "KOMBIR40"], [80, 84, "KOMBIR40"]], "else": None},
            "else": {
                "byte": 9, "read": "bcd",
                "ranges": [
                    [85, 86, "KOMBIR50"], [87, 89, "KOMBI50F"], [95, 99, "KOMBIL50"], [65, 69, "KOMBIL30"],
                    [70, 79, "KOMBIR30"], [1, 4, "IKE"], [5, 14, "IKI"], [20, 29, "KOMBI85"],
                    [30, 31, "KOMBI39"], [32, 40, "KOMBI39C"], [41, 47, "KOMBI52"], [48, 53, "KOMBI46"],
                    [54, 64, "KOMBI46R"], [90, 94, "KOMBI36C"],
                ],
                "else": None,
            },
        },
        "unknown": [],
    },
}

POSITIVE = 0xA0


def exe() -> str:
    found = glob.glob(os.path.join(SG, "bin", "Release", "*", "SgbdDump.dll"))
    if not found:
        sys.exit("[FATAL] SgbdDump が無い。tools/SgbdDump で dotnet build -c Release"
                 "（EdiabasLib は GPLv3。バイナリは再配布しない——THIRD-PARTY-NOTICES.md §2）")
    return found[0]


def sgbd_dump(args: list[str]) -> str:
    r = subprocess.run(["dotnet", exe()] + args, cwd=SG, capture_output=True, text=True,
                       encoding="utf-8", errors="replace", timeout=3600)
    if r.returncode != 0:
        sys.exit(f"[FATAL] SgbdDump {' '.join(args[:2])}: {r.stderr.strip() or r.stdout.strip()}")
    return r.stdout


def tables_of(group: str) -> dict:
    return json.loads(sgbd_dump(["--tables", group]))


# ---- 規則を表で埋める -----------------------------------------------------------

def resolve(choice, tables: dict):
    """RULES の Choice を、表の行を埋め込んだ自己完結の形にする（アプリはグループファイルを持たない）。"""
    if choice is None or isinstance(choice, str):
        return choice
    if "mask" in choice:
        return {"byte": choice["byte"], "mask": choice["mask"], "equals": choice["equals"],
                "then": resolve(choice["then"], tables), "else": resolve(choice.get("else"), tables)}
    if "ranges" in choice:
        return {"byte": choice["byte"], "read": choice["read"],
                "ranges": [[lo, hi, resolve(v, tables)] for lo, hi, v in choice["ranges"]],
                "else": resolve(choice.get("else"), tables)}
    rows: list = [[k, resolve(v, tables)] for k, v in choice.get("first", [])]
    if "table" in choice:
        table = tables["tables"].get(choice["table"])
        if not table:
            sys.exit(f"[FATAL] {tables['group']}: 表 {choice['table']} が無い")
        head, body = table[0], table[1:]
        ki, vi = head.index(choice["keyCol"]), head.index(choice["valCol"])
        default_row = body[-1] if body and body[-1][ki].upper() == "XX" else None
        for row in body:
            if row is default_row:
                continue   # 既定の行は else が表す
            rows.append([row[ki], row[vi]])
    return {"key": choice["key"], "rows": rows, "else": resolve(choice.get("else"), tables)}


# ---- 評価（packages/monitoring-engine/src/variants.ts の chooseVariant と同じ規則） ----------------------

def key_of(answer: bytes, slices) -> str:
    out = ""
    for s, l in slices:
        part = answer[s:s + l]
        z = part.find(b"\x00")
        out += (part if z < 0 else part[:z]).decode("latin-1")
    return out


def bcd(b: int) -> int:
    """BEST/2 の D_0080 の読み方: 上位 4 ビット×10＋下位 4 ビット（A–F も数のまま）。"""
    return (b >> 4) * 10 + (b & 0x0F)


def evaluate(choice, answer: bytes):
    while isinstance(choice, dict):
        if "mask" in choice or "ranges" in choice:
            # 答えの外のバイトは読めない。そのときは選ばない（短い答えの突き合わせで確かめる）。
            if choice["byte"] >= len(answer):
                return None
            b = answer[choice["byte"]]
            if "mask" in choice:
                choice = choice["then"] if (b & choice["mask"]) == choice["equals"] else choice["else"]
            else:
                n = bcd(b)
                choice = next((v for lo, hi, v in choice["ranges"] if lo <= n <= hi), choice["else"])
            continue
        k = key_of(answer, choice["key"]).upper()
        hit = next((v for rk, v in choice["rows"] if rk.upper() == k), "__miss__")
        choice = choice["else"] if hit == "__miss__" else hit
    return choice


def choose(rule: dict, answer: bytes):
    if len(answer) < 3 or answer[0] != rule["address"] or answer[2] != POSITIVE:
        return None
    # 区間が答えの外に出ても EDIABAS は落ちない。届いた分だけで引く（短い答えの突き合わせで確かめた）。
    return evaluate(rule["choose"], answer)


# ---- 突き合わせる答えの束 ----------------------------------------------------------

def frame(address: int, status: int, data: bytes) -> bytes:
    body = bytearray([address, 0, status]) + bytearray(data) + b"\x00"
    body[1] = len(body)
    cs = 0
    for b in body[:-1]:
        cs ^= b
    body[-1] = cs
    return bytes(body)


def base_data() -> bytearray:
    # 部品番号 7、HW 2、COD 2、診断 2、BUS 2、日付 4（FF）、残り。長さは実車の MSS54 の答えと同じ 42。
    d = bytearray(b"0000000" + b"00" + b"00" + b"00" + b"60" + b"\xff" * 4 + b"00001158520401" + b"\xff" * 9)
    assert len(d) == 42
    return d


def bytes_read(choice) -> set[int]:
    """マスクや範囲で数として読む、答えのバイトの番地。"""
    if not isinstance(choice, dict):
        return set()
    if "mask" in choice:
        return {choice["byte"]} | bytes_read(choice["then"]) | bytes_read(choice["else"])
    if "ranges" in choice:
        return {choice["byte"]} | {b for _, _, v in choice["ranges"] for b in bytes_read(v)} | bytes_read(choice["else"])
    return {b for _, v in choice["rows"] for b in bytes_read(v)} | bytes_read(choice["else"])


def keys_in(choice) -> list[tuple[list, str]]:
    out = []
    if isinstance(choice, dict) and "mask" in choice:
        return keys_in(choice["then"]) + keys_in(choice["else"])
    if isinstance(choice, dict) and "ranges" in choice:
        return [kv for _, _, v in choice["ranges"] for kv in keys_in(v)] + keys_in(choice["else"])
    if isinstance(choice, dict):
        for k, v in choice["rows"]:
            out.append((choice["key"], k))
            out += keys_in(v)
        out += keys_in(choice["else"])
    return out


def put(data: bytearray, slices, key: str) -> bool:
    i = 0
    for s, l in slices:
        part = key[i:i + l]
        if len(part) != l:
            return False
        data[s - 3:s - 3 + l] = part.encode("latin-1")
        i += l
    return i == len(key)


def corpus(rule: dict, n_random: int, seed: int) -> list[bytes]:
    rng = random.Random(seed)
    a = rule["address"]
    out: list[bytes] = [frame(a, POSITIVE, bytes(base_data()))]
    for slices, key in keys_in(rule["choose"]):
        for k in {key, key.lower()}:
            d = base_data()
            if put(d, slices, k):
                out.append(frame(a, POSITIVE, bytes(d)))
                # 同じ鍵に、ほかの区間を乱数にしたもの（先の表が拾うか）
                d2 = bytearray(d)
                for j in range(len(d2)):
                    if rng.random() < 0.15:
                        d2[j] = ord(rng.choice("0123456789ABCDEF"))
                out.append(frame(a, POSITIVE, bytes(d2)))
    # 数として読むバイト（D_0080 の 3 と 9）: 9 は 0..255 の全部を、3 はマスクの内と外の値と組にして。
    numeric = bytes_read(rule["choose"])
    if numeric:
        firsts = sorted({0x00, 0x09, 0x39, 0xC9, 0xD0, 0xD9, 0xDF, 0xE0} if 3 in numeric else {base_data()[0]})
        for b3 in firsts:
            for b9 in range(256):
                d = base_data()
                d[0] = b3
                if 9 in numeric:
                    d[6] = b9
                out.append(frame(a, POSITIVE, bytes(d)))
    alphabet = "0123456789ABCDEFGHJKLXZabcdef"
    for _ in range(n_random):
        d = base_data()
        for j in range(19):
            r = rng.random()
            d[j] = 0 if r < 0.02 else 0xFF if r < 0.04 else ord(rng.choice(alphabet))
        out.append(frame(a, POSITIVE, bytes(d)))
    # 否定応答、短い答え（3 と 9 の手前で切れるものも）
    out.append(frame(a, 0xA1, bytes(base_data())))
    out.append(frame(a, 0xA2, bytes(base_data())))
    for cut in (0, 1, 6, 7, 9, 11, 12, 13):
        out.append(frame(a, POSITIVE, bytes(base_data()[:cut])))
    seen, uniq = set(), []
    for f in out:
        if f not in seen:
            seen.add(f)
            uniq.append(f)
    return uniq


def oracle(group: str, answers: list[bytes]) -> list[str | None]:
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="ascii") as fh:
        for f in answers:
            fh.write(" ".join(f"{b:02X}" for b in f) + "\n")
        path = fh.name
    try:
        lines = [json.loads(l) for l in sgbd_dump(["--ident", group, path]).splitlines() if l.startswith("{")]
    finally:
        os.unlink(path)
    if len(lines) != len(answers):
        sys.exit(f"[FATAL] {group}: 答え {len(answers)} 件に、EDIABAS の結果 {len(lines)} 件")
    return [l.get("variant") or None for l in lines]


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="突き合わせだけ（書かない）")
    ap.add_argument("--random", type=int, default=400, help="グループごとの乱数の答えの数")
    args = ap.parse_args()

    groups, checked, fails = [], [], []
    for name, spec in RULES.items():
        tables = tables_of(name)
        rule = {"address": spec["address"], "group": name, "groupSha256": tables["sha256"],
                "positive": POSITIVE, "choose": resolve(spec["choose"], tables), "unknown": spec["unknown"]}
        answers = corpus(rule, args.random, seed=spec["address"])
        said = oracle(name, answers)
        bad = 0
        for f, ed in zip(answers, said):
            ours = choose(rule, f)
            if (ours or None) != ed:
                bad += 1
                if bad <= 10:
                    fails.append(f"{name}: {' '.join(f'{b:02X}' for b in f)}  EDIABAS={ed}  規則={ours}")
            checked.append({"answer": " ".join(f"{b:02X}" for b in f), "variant": ed})
        print(f"{name}: {len(answers)} 件の答え、EDIABAS と食い違い {bad} 件")
        groups.append(rule)

    if fails:
        print("\n".join(fails))
        sys.exit("[FAIL] 規則が EDIABAS の選び方と食い違う。RULES を直す（書き出さない）")
    if args.check:
        return

    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    os.makedirs(ECU_DATA, exist_ok=True)
    with open(os.path.join(ECU_DATA, "variants.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"schema": 1, "generatedAt": now, "how": "tools/sgbd/gen_variants.py", "groups": groups},
                  fh, ensure_ascii=False, indent=1)
        fh.write("\n")
    by_group = {}
    for g in groups:
        by_group[g["group"]] = [c for c in checked if int(c["answer"][:2], 16) == g["address"]]
    with open(os.path.join(ECU_DATA, "variants.oracle.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"schema": 1, "generatedAt": now,
                   "how": "EdiabasLib ran each group file's IDENTIFIKATION on each answer in simulation (tools/SgbdDump --ident)",
                   "groups": by_group}, fh, ensure_ascii=False, indent=0)
        fh.write("\n")
    print(f"wrote variants.json ({len(groups)} groups) and variants.oracle.json ({len(checked)} answers)")


if __name__ == "__main__":
    main()
