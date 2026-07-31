# -*- coding: utf-8 -*-
# ============================================================================
#  term_overrides.py — tools/terms/*.py の厳選フレーズ表を統合し、
#  translate.py に「完全一致の最優先訳」を提供する薄いローダー。
#  ※ 翻訳内容そのものはここには置かない（tools/terms/ 配下が本体）。
# ============================================================================
import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from terms import MODULES


def _load_all():
    merged, conflicts = {}, []
    for name in MODULES:
        mod = importlib.import_module(f"terms.{name}")
        for k, v in getattr(mod, "PHRASES", {}).items():
            if k in merged and merged[k] != v:
                conflicts.append((name, k))
            merged[k] = v
    if conflicts:
        print(f"  !! term_overrides: {len(conflicts)}件の重複キー(値不一致・後勝ち)", file=sys.stderr)
        for name, k in conflicts[:20]:
            print(f"      {name}: {k!r}", file=sys.stderr)
    return merged


OVERRIDES = _load_all()


def lookup(text, lang):
    """完全一致(strip後・大小文字区別あり)のみ有効。無ければ None。"""
    v = OVERRIDES.get(text)
    return None if v is None else v[0 if lang == "ja" else 1]
