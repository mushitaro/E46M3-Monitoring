#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  gen_icons.py — PWA アイコン(PNG)を public/icon.svg と同じ幾何から生成
# ----------------------------------------------------------------------------
#  Chrome のインストール要件と Android ランチャー互換のため 192/512 の PNG が
#  実質必須。iOS Safari と一部 Android ランチャーは SVG マニフェストアイコンを
#  解釈しないため、SVG 1枚では足りない（旧アプリはそれだった）。
#
#  依存を足さずに済ませるため、zlib と struct だけで PNG を書く。
#  中央のストライプは #9B84E8。ロゴネイビー #2B115A は黒地 1.33:1 で、
#  ファビコンサイズでは「隙間」に見える（color-system.md の contrast ledger）。
# ============================================================================
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "public")

BLACK = (0x00, 0x00, 0x00)
BLUE = (0x00, 0x8A, 0xC9)
VIOLET = (0x9B, 0x84, 0xE8)
RED = (0xF1, 0x1A, 0x22)

# public/icon.svg の path と同じ形（viewBox 0 0 32 32 を正規化した座標）。
# 各ストライプは (下端x, 上端x) の平行四辺形。上に行くほど右へ寄る。
STRIPES = [
    ((2 / 32, 8 / 32), (10 / 32, 16 / 32), BLUE),
    ((10 / 32, 16 / 32), (18 / 32, 24 / 32), VIOLET),
    ((18 / 32, 24 / 32), (26 / 32, 32 / 32), RED),
]
TOP, BOTTOM = 2 / 32, 30 / 32


def render(size):
    """4x スーパーサンプリングしてから平均。斜めのエッジがジャギらないように。"""
    ss = 4
    n = size * ss
    acc = [[[0, 0, 0] for _ in range(size)] for _ in range(size)]

    for sy in range(n):
        y = sy / n
        # y=BOTTOM で下端、y=TOP で上端。傾きは線形補間。
        if y < TOP or y > BOTTOM:
            frac = None
        else:
            frac = (BOTTOM - y) / (BOTTOM - TOP)  # 0=下端, 1=上端
        for sx in range(n):
            x = sx / n
            color = BLACK
            if frac is not None:
                for (b0, b1), (t0, t1), c in STRIPES:
                    x0 = b0 + (t0 - b0) * frac
                    x1 = b1 + (t1 - b1) * frac
                    if x0 <= x < x1:
                        color = c
                        break
            px = acc[sy // ss][sx // ss]
            px[0] += color[0]
            px[1] += color[1]
            px[2] += color[2]

    total = ss * ss
    raw = bytearray()
    for row in acc:
        raw.append(0)  # filter type 0
        for px in row:
            raw += bytes((px[0] // total, px[1] // total, px[2] // total))
    return bytes(raw)


def png(size, data):
    def chunk(tag, payload):
        return (struct.pack(">I", len(payload)) + tag + payload
                + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit truecolour
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(data, 9))
            + chunk(b"IEND", b""))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for size in (192, 512):
        dest = os.path.abspath(os.path.join(OUT, f"icon-{size}.png"))
        with open(dest, "wb") as f:
            f.write(png(size, render(size)))
        print(f"  wrote {os.path.relpath(dest)}  ({size}x{size})")
    print("done")
