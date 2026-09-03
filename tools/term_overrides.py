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
from terms import FAMILY_SGBDS, MODULES


def _load_all():
    """PHRASES（原文完全一致の訳）と TOKENS（独語トークン → (ja, en)。translate.DICT に
       無いキーだけ追加される）を全 terms/*.py から集める。"""
    merged, tokens, conflicts, scoped = {}, {}, [], {}
    for name in MODULES:
        try:
            mod = importlib.import_module(f"terms.{name}")
        except Exception as e:   # 編集中/構文エラーのファイルはスキップして警告（他の表は生かす）
            print(f"  !! term_overrides: terms/{name}.py を読めません: {e}", file=sys.stderr)
            continue
        for k, v in getattr(mod, "PHRASES", {}).items():
            if k in merged and merged[k] != v:
                conflicts.append((name, k))
            merged[k] = v
        # 系統の外にも同じ識別子がある分だけを SGBD 単位で引く。全体表に置くと
        # 他モジュールのラベルを名乗る（terms/__init__.py の FAMILY_SGBDS 参照）。
        for sgbd in FAMILY_SGBDS.get(name, ()):
            scoped.setdefault(sgbd, {}).update(getattr(mod, "SCOPED_PHRASES", {}))
        for k, v in getattr(mod, "TOKENS", {}).items():
            K = k.upper()
            if K in tokens and tokens[K] != v:
                conflicts.append((name, "TOKEN " + K))
                continue                      # トークンは先勝ち（common → ファイル名順）
            tokens[K] = v
    _report(conflicts)
    return merged, tokens, scoped


# 値の食い違う重複キーの台帳。
#
# ここは警告だった。毎回出る警告は信号ではない——48 件が常時出ていて、新しい 1 件が
# 増えても誰も気付かない。かといって 0 を要求すると落ちるだけで、族ごとに訳し分けたい
# 語を（PHRASES は文字列完全一致で全体に効くので）表現する場所が無い。
#
# なので件数ではなく個体を固定する。台帳に無い重複が出れば落ち、台帳にあって解消済みの
# ものは名指しで報告される。解消は普通のコミット、追加は台帳を編集する明示的な行為。
_LEDGER = os.path.join(os.path.dirname(__file__), "terms", "_duplicates.json")


def _tolerated():
    import json
    if not os.path.exists(_LEDGER):
        return []
    return sorted(json.load(open(_LEDGER, encoding="utf-8"))["tolerated"])


def _report(conflicts):
    now = sorted({f"{name}::{k}" for name, k in conflicts})
    known = _tolerated()
    gone = [c for c in known if c not in now]
    new = [c for c in now if c not in known]
    if gone:
        print(f"  -- term_overrides: 解消済みの重複 {len(gone)} 件。"
              f"tools/terms/_duplicates.json から消してください: {gone[:5]}", file=sys.stderr)
    if new:
        print(f"  !! term_overrides: 台帳に無い重複キーが {len(new)} 件:", file=sys.stderr)
        for c in new[:20]:
            print(f"      {c}", file=sys.stderr)
        raise SystemExit(
            "同じ独語に別の訳が二箇所あります。PHRASES は文字列完全一致で全体に効くので、"
            "どちらが出るかは読込順という無関係な理由で決まります。片方に寄せるか、"
            "族専用なら SCOPED_PHRASES へ移すか、意図した重複なら "
            "tools/terms/_duplicates.json に足してください。")


OVERRIDES, TOKENS, SCOPED = _load_all()


def lookup(text, lang, sgbd=None):
    """完全一致(strip後・大小文字区別あり)のみ有効。無ければ None。

    `sgbd` を渡すと、その ECU 専用の訳を先に見る。渡さない呼び出しは従来どおり
    全体表だけを見る——専用の訳は全体表に入っていないので、取り違えは起きない。"""
    v = SCOPED.get(sgbd, {}).get(text) if sgbd else None
    if v is None:
        v = OVERRIDES.get(text)
    return None if v is None else v[0 if lang == "ja" else 1]
