#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  detect_address.py — 退役。**負の結果として保存してある。**
# ----------------------------------------------------------------------------
#  ⚠ DEPRECATED — この方法は動かない。答えを出すが、その答えは間違っている。
#
#  既知 3 モジュール（MSS54DS0=0x12 / SMG2=0x32 / DSC_E46=0x56）で検証したところ
#  **3 件とも外れた**。BEST バイトコードのノイズが 0x40 / 0x70 という「もっとも
#  らしい」頻度の山を作り、正解より高い得点を出す。自信を持って誤答するので、
#  検証しなければ通ってしまう類の失敗である。
#
#  正しい取り方は `tools/dump_modules.py`——EdiabasLib に IDENT を実行させ、
#  `ifh.trc` に残った実送信テレグラム `(Send sim): 80 04 00` の先頭バイトを読む。
#  `_addresses.json` の 59 エントリはすべてそちら由来。
#
#  消さずに置いてあるのは、**同じ思い付きを次に持った人のため**である。静的解析で
#  アドレスが取れそうに見えるのは本当で、取れないことは測らないと分からない。
#  （`docs/PRESERVED.md` の負の結果の表にも載っている。）
#
#  以下、当時の説明:
# ----------------------------------------------------------------------------
#  原理: BEST/2 のジョブ・バイトコードは XOR 0xF7 でスクランブルされており、
#  復号すると各ジョブは DS2 要求テレグラム [addr][LL][cmd][data...] をリテラルで
#  組み立てている（E46M3-Diagnosis/tools/extract_telegrams.py と同じ観察）。
#  アドレスを知らない SGBD に対しては、全 256 通りの addr 候補それぞれについて
#  「[addr][妥当な長さ][既知の DS2 コマンド]」の並びが何回現れるかを数え、
#  最頻の addr を採用する。既知の3モジュール（MSS54DS0=0x12 / SMG2=0x32 /
#  DSC_E46=0x56）で検証してから他モジュールに使うこと（本ファイル末尾の self-test）。
#
#  使い方:  python tools/detect_address.py KOMBI46 LSZ ihka46_3 ...
#          → 各 SGBD について "name addr=0x80 hits=123 (next 0x12:4)" を出力
# ============================================================================
import os, sys, collections

ECU_DIR = os.environ.get("EDIABAS_ECU_DIR", r"C:\EDIABAS\ECU")
# DS2 制御バイト（extract_telegrams.py の CMD と同じ集合）
CMD = {0x00, 0x04, 0x05, 0x06, 0x07, 0x0A, 0x0B, 0x0C, 0x1A, 0x43, 0x53, 0x6C, 0x6D, 0x90, 0x91, 0x9E, 0x9F}
MIN_LEN, MAX_LEN = 4, 24

def detect(path):
    raw = open(path, "rb").read()
    dec = bytes(b ^ 0xF7 for b in raw)
    hits = collections.Counter()
    for i in range(len(dec) - 3):
        ll = dec[i + 1]
        if ll < MIN_LEN or ll > MAX_LEN: continue
        if dec[i + 2] not in CMD: continue
        hits[dec[i]] += 1
    # 0x00 と 0xF7(=XOR前の0x00) はノイズになりやすいので除外して順位付け
    ranked = [(a, n) for a, n in hits.most_common() if a not in (0x00, 0xF7, 0xFF)]
    return ranked

def resolve(name):
    for cand in (name, name + ".prg", name + ".PRG", name.upper() + ".prg", name.lower() + ".prg"):
        p = os.path.join(ECU_DIR, cand)
        if os.path.exists(p): return p
    raise FileNotFoundError(name)

if __name__ == "__main__":
    names = sys.argv[1:] or ["MSS54DS0", "SMG2", "DSC_E46"]
    for n in names:
        try:
            r = detect(resolve(n))
            top = r[0] if r else (None, 0)
            nxt = r[1] if len(r) > 1 else (None, 0)
            margin = (top[1] / nxt[1]) if nxt[1] else float("inf")
            print(f"{n:12} addr=0x{top[0]:02X} hits={top[1]:<5} next=0x{(nxt[0] or 0):02X}:{nxt[1]:<4} margin={margin:.1f}x")
        except Exception as e:
            print(f"{n:12} ERR {e}")
