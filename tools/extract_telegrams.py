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

def arg_counts(prg: str) -> dict[str, int]:
    """ジョブ名 → SGBD が宣言する引数の個数。

    テンプレートのデータ部が何バイトあるかと突き合わせるために要る。
    ここだけが `.prg` の外を見る——ダンプ（`$SGBD_DUMP_DIR/<SGBD>.json`）は
    `SgbdDump.exe` が EDIABAS 自身に問い合わせて書いたもので、引数リストは
    そこにしかない。ダンプが無ければ空を返す（突き合わせ結果は `null` になり、
    「一致しなかった」ではなく「照合していない」と読める）。"""
    stem = os.path.splitext(os.path.basename(prg))[0]
    d = paths.SGBD_DUMP_DIR
    if not os.path.isdir(d):
        return {}
    hit = next((f for f in os.listdir(d) if f.lower() == f"{stem.lower()}.json"), None)
    if hit is None:
        return {}
    with open(os.path.join(d, hit), encoding="utf-8") as f:
        dump = json.load(f)
    return {j["job"]: len(j.get("args") or []) for j in dump.get("jobs", [])}


# ============================================================================
#  コマンドバイト表は「名前」であって「フィルタ」ではない
# ----------------------------------------------------------------------------
#  以前ここは 18 個の白リストで、リストに無いコマンドのフレームは**捨てられて**
#  いた。その表は MSS54 の形で書かれていたので、他モジュール固有のコマンドが
#  黙って消えていた。全 51 モジュールで測った実害:
#
#      テレグラムを 1 件も持たないが、白リストを外せば得られるジョブ: 317
#      白リスト外のコマンド（使うジョブ数）: 0x70:90 0x08:56 0x0e:29 0x0f:22
#                                             0x1d:19 0x1c:18 0x1b:14 0x30:12 …
#
#  最悪だったのは SMG II の試験プログラムで、`TESTPRG_STARTEN`(0x32)・
#  `TESTPRG_STOP`(0x33)・`ANSTEUERUNG_VORBEREITEN`(0x60)・
#  `ADAPTIONSWERTE_LESEN`(0x40) が全部落ちていた。つまり「フレームが無い」は
#  世界についての事実ではなく、この表についての事実だった。
#
#  **`0x0d` と `0x14` は `runGate.READ_ONLY_CONTROLS` に載っている読取なのに、
#  ここには無かった。** 送ってよいと宣言しているコマンドのフレームを、抽出器が
#  捨てていたということ。
#
#  安全境界はここではない。実車に何を送ってよいかを決めるのは
#  `src/lib/runGate.ts` の `READ_ONLY_CONTROLS`（10 個の読取コマンド）ひとつで、
#  ここにフレームが増えても実車で撃てるものは 1 件も増えない——増えるのは
#  「何を送ることになるのか画面に出せる」ジョブの数である。
# ============================================================================
CMD = {
    0x00: "identification", 0x04: "read fault memory", 0x05: "CLEAR fault memory",
    0x06: "read memory", 0x07: "write memory", 0x0A: "coding checksum",
    0x0B: "read status/IO block", 0x0C: "IO control (actuator)",
    0x0D: "read system addresses", 0x14: "read shadow fault memory",
    0x1A: "read ident",
    0x43: "CLEAR adaptations", 0x53: "mfr-specific data", 0x6C: "EWS init",
    0x6D: "EWS status", 0x90: "login (seed/key)", 0x91: "baud switch",
    0x9E: "keepalive", 0x9F: "end diagnostics",
    # 以下は本 repo の実測で名前が付いたもの。根拠は「そのコマンドを含む
    # フレームが、その名前のジョブのコード領域にだけ現れる」こと。推測で
    # 名前を付けたものはひとつも無い——名前が付かないものは付けずに出す。
    0x32: "start test program",       # SMG2 TESTPRG_STARTEN
    0x33: "stop test program",        # SMG2 TESTPRG_STOP
    0x40: "read adaptation values",   # SMG2 ADAPTIONSWERTE_LESEN
    0x60: "prepare actuation",        # SMG2 ANSTEUERUNG_VORBEREITEN
}

# テレグラム長の窓。4未満は不正、24超はリテラルの偶然一致がほとんど。
MIN_LEN, MAX_LEN = 4, 24

# ASCII の文字列リテラルが、たまたまアドレスバイトで始まってしまう事故。
# `32 0a 52 45 53 55 4c 54 3a 0b` は "RESULT:" であってテレグラムではない。
# 51 モジュールで 94 件。名前の付いたコマンドは通す（`0x53` は 'S' でもある）。
MIN_ASCII_RUN = 3


def looks_like_text(payload: bytes) -> bool:
    return len(payload) >= MIN_ASCII_RUN and all(0x20 <= b < 0x7F for b in payload)


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


# ============================================================================
#  最初の送信を、ジョブの先頭から読む（分岐の無い道だけ）
# ----------------------------------------------------------------------------
#  リテラルの走査は「ひな形」しか見えない。SMG II の状態読取 4 ジョブは同じ
#  `32 05 0B 03` を文字列レジスタに置き、**送る前に 4 バイト目を書き換える**:
#
#      move S1, {32 05 0b 03} / move S6, S1 / move L0, #4 / move S6[L1], B0 / xsend S2, S6
#
#  走査はこれを 4 ジョブ共有のテレグラム（`shared`）と読み、どれも送れなかった。
#  ここではジョブの先頭から最初の `xsend` までを命令ごとに読み、レジスタの中身を
#  追って、実際に送られるバイトを出す。
#
#  命令の形（命令 1 バイト、アドレッシング 1 バイト＝上位が第 1・下位が第 2
#  オペランド、続いてオペランド）と命令番号は、実車の EdiabasLib トレース
#  （データリポジトリ `evidence/ifh.trc`、MSS54DS0 の IDENT）の番地と命令名を
#  `MSS54DS0.prg` のバイトに突き合わせて確かめたもの。オペランドの長さは
#  アドレッシングだけで決まるので、知らない命令でも読み飛ばしは狂わない——が、
#  読み飛ばさない。**分かっている命令だけの、分岐の無い道**でなければ結果を
#  出さず、そのジョブは今までどおり走査の結果のまま残る。条件分岐・サブルーチン・
#  引数の読み出し・知らない命令のどれかに当たったら、そこで「分からない」。
# ============================================================================
OP_MOVE, OP_CLEAR, OP_NOP, OP_PUSH, OP_POP, OP_XSEND = 0x00, 0x01, 0x1C, 0x1E, 0x1F, 0x2A
OP_JUMP, OP_JZ, OP_JNZ, OP_ETAG = 0x0B, 0x10, 0x11, 0x41
# 結果を出すだけの命令（ergb ergw ergd ergi ergr ergs ergy）。送るバイトには触れない。
OP_ERG = {0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3F}

# オペランドの長さ（アドレッシングの値 → バイト数）。8（文字列リテラル）だけは
# 2 バイトの長さ＋本体。
_ARG_LEN = {0: 0, 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 2, 7: 4,
            9: 3, 10: 2, 11: 4, 12: 5, 13: 4, 14: 4, 15: 3}
_S_REGS = range(0x1C, 0x24)          # S0..S7


def _num_span(reg):
    """数値レジスタ → (バイトレジスタ上の先頭, 幅)。B0..BF / I0..I7 / L0..L3。"""
    if 0x00 <= reg <= 0x0F:
        return reg, 1
    if 0x10 <= reg <= 0x17:
        return (reg - 0x10) * 2, 2
    if 0x18 <= reg <= 0x1B:
        return (reg - 0x18) * 4, 4
    return None


def first_send(dec, start, end, addr):
    """ジョブの先頭から最初の xsend までを読み、送られるバイト（チェックサム抜き）と、
    そのバイトの元になったひな形リテラルの位置を返す。確かめられなければ None。"""
    regs = [None] * 16                # バイトレジスタ。None は「分からない」
    sreg = {}                         # 文字列レジスタ → bytearray（無ければ分からない）
    origin = {}                       # 文字列レジスタ → 中身の元になったリテラルの位置
    stack = []
    z = None                          # ゼロフラグ。None は「分からない」
    p = start
    steps = 0

    def get(reg):
        span = _num_span(reg)
        if span is None:
            return None
        vals = regs[span[0]:span[0] + span[1]]
        if any(v is None for v in vals):
            return None
        return int.from_bytes(bytes(vals), "little")

    def put(reg, value):
        span = _num_span(reg)
        if span is None:
            return False
        for k in range(span[1]):
            regs[span[0] + k] = None if value is None else (value >> (8 * k)) & 0xFF
        return True

    while p + 2 <= end:
        steps += 1
        if steps > 10000:
            return None
        op, mode = dec[p], dec[p + 1]
        m0, m1 = mode >> 4, mode & 0x0F
        q = p + 2
        args = []
        for m in (m0, m1):
            if m == 8:
                if q + 2 > end:
                    return None
                n = struct.unpack_from("<H", dec, q)[0]
                args.append((q + 2, bytes(dec[q + 2:q + 2 + n])))
                q += 2 + n
            elif m in _ARG_LEN:
                args.append((q, bytes(dec[q:q + _ARG_LEN[m]])))
                q += _ARG_LEN[m]
            else:
                return None
        if q > end:
            return None
        (_, a0), (pos1, a1) = args

        if op == OP_NOP and mode == 0:
            pass
        elif op == OP_CLEAR and m1 == 0 and m0 == 1 and a0[0] in _S_REGS:
            sreg[a0[0]] = bytearray()
            origin.pop(a0[0], None)
        elif op == OP_CLEAR and m1 == 0 and m0 in (2, 3, 4):
            if not put(a0[0], 0):
                return None
        elif op == OP_PUSH and m1 == 0 and m0 == 7:
            stack.append(struct.unpack("<I", a0)[0])
        elif op == OP_PUSH and m1 == 0 and m0 == 4:
            stack.append(get(a0[0]))
        elif op == OP_POP and m1 == 0 and m0 == 4:
            if not stack:
                return None
            v = stack.pop()
            if not put(a0[0], v):
                return None
            z = None if v is None else v == 0
        elif op == OP_ETAG and m0 == 7:
            # 結果を求められていなければ飛ぶ。EDIABAS は既定で全部の結果を求めるので、飛ばない。
            pass
        elif op in OP_ERG:
            pass
        elif op == OP_JUMP and m0 == 7:
            q = q + struct.unpack("<i", a0)[0]
        elif op in (OP_JZ, OP_JNZ) and m0 == 7:
            if z is None:
                return None
            if z == (op == OP_JZ):
                q = q + struct.unpack("<i", a0)[0]
        elif op == OP_MOVE and m0 == 1 and a0[0] in _S_REGS and m1 == 8:
            sreg[a0[0]] = bytearray(a1)
            origin[a0[0]] = pos1
        elif op == OP_MOVE and m0 == 1 and a0[0] in _S_REGS and m1 == 1 and a1[0] in _S_REGS:
            if a1[0] in sreg:
                sreg[a0[0]] = bytearray(sreg[a1[0]])
            else:
                sreg.pop(a0[0], None)
            if a1[0] in origin:
                origin[a0[0]] = origin[a1[0]]
            else:
                origin.pop(a0[0], None)
        elif op == OP_MOVE and m0 == 4 and m1 == 7:
            if not put(a0[0], struct.unpack("<I", a1)[0]):
                return None
        elif op == OP_MOVE and m0 == 10 and m1 == 2 and a0[0] in _S_REGS:
            # S[Ln] <- Bn：ひな形の 1 バイトを書き換える。位置か値が分からない、
            # あるいは今の長さの外なら、その文字列は「分からない」。
            idx, val, s = get(a0[1]), get(a1[0]), sreg.get(a0[0])
            if s is None or idx is None or val is None or idx >= len(s):
                sreg.pop(a0[0], None)
            else:
                s[idx] = val
        elif op == OP_XSEND and m0 == 1:
            if m1 == 8:
                sent, src = a1, pos1
            elif m1 == 1 and a1[0] in sreg and a1[0] in origin:
                sent, src = bytes(sreg[a1[0]]), origin[a1[0]]
            else:
                return None
            # 形の確かめ：宛先、長さ（チェックサム込みの全長）、窓。
            if len(sent) < 3 or sent[0] != addr or sent[1] != len(sent) + 1:
                return None
            if not MIN_LEN <= sent[1] <= MAX_LEN:
                return None
            return sent, src
        else:
            return None                # 分岐・呼び出し・引数・知らない命令
        if not start <= q < end:
            return None
        p = q
    return None


def owner(jobs, pos):
    name = "?"
    for off, nm in jobs:
        if off <= pos:
            name = nm
        else:
            break
    return name


def extract(path, addr, arg_counts=None, resolve_first_send=False):
    arg_counts = arg_counts or {}
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
        stored = dec[i:i + ll - 1]          # チェックサム抜きのテレグラム
        if len(stored) < 3:
            continue
        # 名前の付かないコマンドは、ペイロードが可読 ASCII なら文字列リテラル
        # として捨てる。名前が付いているものは通す（下の表を参照）。
        if cmd not in CMD and looks_like_text(stored[3:]):
            continue
        tel = stored + bytes([xorck(stored)])
        seen.setdefault((owner(jobs, i), tel), 0)
        seen[(owner(jobs, i), tel)] += 1

    # 最初の送信が確かめられたジョブは、道の上のひな形をその結果で置き換える。
    # ひな形と同じバイトが送られるジョブ（書き換えの無いもの）は何も変わらない。
    #
    # 直すのは、走査がこのジョブのものとして既に拾っていたひな形だけ。走査が何も
    # 拾わなかったジョブ（宛先を `FF` で置いて後から埋めるひな形など）に新しい行を
    # 足すことはしない——それは IDENT・消去・ハートビートの行を増やし、
    # `moduleProtocol` が車に送るものを変えるので、モジュールごとに別に決める。
    # 共有の度合いは、置き換える前の走査で数える。あるジョブのひな形を置き換えたせいで、
    # 同じひな形を持つ別のジョブ（引数で組むもの）が「1 ジョブだけのもの」に見えては困る。
    scraped_sharers = {}
    for (job, tel) in seen:
        scraped_sharers.setdefault(tel, set()).add(job)
    resolved = {}
    for k, (off, name) in enumerate(jobs if resolve_first_send else []):
        end = jobs[k + 1][0] if k + 1 < len(jobs) else len(dec)
        hit = first_send(dec, off, end, addr)
        if hit is None:
            continue
        sent, src = hit
        template = dec[src:src + dec[src + 1] - 1] if dec[src] == addr else b""
        key = (name, template + bytes([xorck(template)]))
        if key not in seen:
            continue
        tel = sent + bytes([xorck(sent)])
        resolved[name] = tel
        if key[1] != tel:
            seen[key] -= 1
            if seen[key] == 0:
                del seen[key]
            seen.setdefault((name, tel), 1)

    byjob = {}
    for (job, tel), count in seen.items():
        byjob.setdefault(job, []).append((tel, count))

    # 同一テレグラムを何ジョブが共有しているか＝テンプレートの度合い
    shared = {}
    for job, tels in byjob.items():
        for tel, _ in tels:
            shared.setdefault(tel, set()).add(job)
    for tel, jobs_ in scraped_sharers.items():
        if tel in shared:
            # ほかのジョブがこのバイトをひな形として書き換えて送るなら、これはひな形でもある。
            shared[tel] |= {j for j in jobs_ if j in resolved and resolved[j] != tel}

    out = {}
    for job, tels in sorted(byjob.items()):
        entries = []
        for tel, count in sorted(set(tels)):
            sharers = len(shared[tel])
            if resolved.get(job) == tel and len(tels) == 1:
                # 先頭から読んで、このジョブが送るのはこれだと確かめた。フレームが 1 本だけの
                # ジョブに限る：FS_LOESCHEN のように最初に IDENT を送ってから本題を送るジョブで、
                # 最初の IDENT を「このジョブの電文」と格上げしない。
                confidence = "single"
            elif sharers > 1:
                confidence = "shared"
            elif len(tels) > 1:
                confidence = "multiple"
            else:
                confidence = "single"
            payload = len(tel) - 4          # addr, len, cmd, …payload…, checksum
            declared = arg_counts.get(job)
            entries.append({
                "hex": tel.hex(" "),
                "cmd": tel[2],
                # 名前が付かないものは `null`。以前は `"?"` を書いていたが、
                # それは「調べたが分からない」と「表に無い」を同じ字面にする。
                "cmdName": CMD.get(tel[2]),
                "named": tel[2] in CMD,
                "occurrences": count,
                "sharedWithJobs": sharers - 1,
                "confidence": confidence,
                # 引数との突き合わせ。白リストとは**独立した**裏付けで、
                # 引数値から実フレームを組む根拠でもある: SGBD が 2 引数と
                # 宣言し、テンプレートのデータ部が 2 バイトなら、その 2 バイトが
                # その 2 引数である。`declaredArgs` が null なのはダンプに
                # そのジョブが無い場合（抽出器はジョブ表を .prg から読むので、
                # ダンプ側に無い名前が出ることがある）。
                "payloadBytes": payload,
                "declaredArgs": declared,
                "argsAgree": None if declared is None else declared == payload,
            })
            # このジョブが最初に送るフレームだと、先頭からの読みで確かめたもの。
            if resolved.get(job) == tel and len(tels) == 1:
                entries[-1]["firstSend"] = True
        out[job] = entries
    return out


#  DS2 の上に KWP2000 の形の電文を載せるモジュール（`B8 <宛先> F1 LL <SID> …`）。上の静的抽出は
#  DS2 の形（宛先・長さ・コマンド）で読むので、これには使えない——DSC_MK60 では書き込みジョブの
#  断片を拾っていた。代わりに、データリポジトリの実行トレース（EDIABAS のシミュレーションで、各ジョブが
#  最初に送ったフレーム）から、**読み取りだけ**（IDENT と FS_LESEN）を表にする。
KWP_ON_DS2 = {"dsc_mk60": ("DSC_MK60", ("IDENT", "FS_LESEN"))}

#  最初の送信を先頭から読んで、ひな形を直すモジュール（`first_send`）。モジュールごとに
#  結果を見てから足す：表が変わると、そのモジュールで送れるものが変わる。
#  SMG II（2026-11-12）：状態読取の 4 ジョブが `32 05 0B 03` を共有して見えていたのは、
#  3 ジョブが 4 バイト目を 04・02・05 に書き換えてから送るため。
FIRST_SEND = {"smg2"}
DUMP_DIR = os.environ.get("SGBD_DUMP_DIR", r"C:\EDIABAS-derived\sgbd-dumps")


def kwp_table(mid: str, prg: str, addr: int) -> dict:
    stem, jobs = KWP_ON_DS2[mid]
    traced = json.load(open(os.path.join(DUMP_DIR, f"{stem}.telegrams.json"), encoding="utf-8"))
    out = {}
    for job in jobs:
        e = traced["executed"][job]
        wire = [int(b, 16) for b in e["wire"].split()]
        # 線上の形の確かめ：先頭が線上の宛先、4 バイト目がデータ長、末尾が XOR。
        assert wire[0] == addr and wire[3] == len(wire) - 5, (mid, job, e["wire"])
        x = 0
        for b in wire[:-1]:
            x ^= b
        assert x == wire[-1], (mid, job, e["wire"])
        out[job] = [{
            "hex": " ".join(f"{b:02x}" for b in wire), "cmd": wire[4],
            "cmdName": e["service"].split(",")[0], "named": True, "occurrences": 1,
            "sharedWithJobs": 0, "confidence": "single", "payloadBytes": wire[3] - 1,
            "declaredArgs": 0, "argsAgree": True, "framing": "kwp-ds2",
        }]
    return {"module": mid, "sgbd": prg, "address": addr, "framing": "kwp-ds2",
            "source": f"execution trace in EDIABAS simulation ({stem}.telegrams.json); reads only", "jobs": out}


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
            kwp = mid in KWP_ON_DS2
            table = kwp_table(mid, prg, addr) if kwp else None
            data = table["jobs"] if kwp else extract(path, addr, arg_counts(prg), mid in FIRST_SEND)
            dest = os.path.join(OUT, f"{mid}.telegrams.json")
            tmp = dest + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(table if kwp else {
                    "module": mid, "sgbd": prg, "address": addr,
                    "source": "static extraction of XOR-0xF7 job bytecode (NOT an execution trace)" + (
                        "; `firstSend` marks a frame read instruction by instruction from the job's "
                        "start to its first send, on a path with no branch" if mid in FIRST_SEND else ""),
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
