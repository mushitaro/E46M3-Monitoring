# ============================================================================
#  paths.py — 生成器が読む「我々のものでない成果物」の在り処、一箇所。
# ----------------------------------------------------------------------------
#  SGBD ダンプはかつて tools/SgbdDump/out/ にあり、.gitignore は `/out/` を
#  **アンカー付き**にして「Next の out/ は無視、SgbdDump の out/ は追跡」を
#  意図的に成立させていた。このリポジトリが public になったことでその意図は
#  逆転した — ダンプは BMW の SGBD (C:\EDIABAS\ECU\*.prg) 由来であり、
#  我々が再配布できるものではない (THIRD-PARTY-NOTICES.md §3.1)。
#
#  そこで置き場をリポジトリ木の**外**に出した。gitignore に足すだけでは足りない:
#  木の中にあって決してコミットしてはならないパスは、`git add -A` 一回で終わる罠で、
#  その罠は「気をつける」以外の防ぎ方が無い。外に出せば構造として起こらない。
#
#  既定値は C:\EDIABAS そのものの隣。docs/REFERENCES.md が既に
#  「我々のものでない BMW ツールチェーン成果物」の置き場として確立している区画。
#  上書きは SGBD_DUMP_DIR 環境変数で（CI と他マシンのため）。
#
#  ここを読む側: gen_ecu_data.py / extract_telegrams.py / verify_ecu_data.py /
#  check_references.py / dump_modules.py、および C# 側の SgbdDump/Program.cs
#  （同じ環境変数と同じ既定値を独立に実装している。片方だけ変えないこと）。
# ============================================================================
from __future__ import annotations

import os

DEFAULT_SGBD_DUMP_DIR = r"C:\EDIABAS-derived\sgbd-dumps"

SGBD_DUMP_DIR = os.environ.get("SGBD_DUMP_DIR") or DEFAULT_SGBD_DUMP_DIR


def require_dump_dir() -> str:
    """存在確認つきで返す。生成器が「0 件見つかりました」で正常終了するより、
    ここで落ちたほうが安い — 何も測らなかった検査は、合格した検査に見える。"""
    if not os.path.isdir(SGBD_DUMP_DIR):
        raise SystemExit(
            f"[FATAL] SGBD dump directory not found: {SGBD_DUMP_DIR}\n"
            f"        Set SGBD_DUMP_DIR, or run tools/dump_modules.py to create it.\n"
            f"        These dumps are NOT in this repository — see docs/PRESERVED.md."
        )
    return SGBD_DUMP_DIR
