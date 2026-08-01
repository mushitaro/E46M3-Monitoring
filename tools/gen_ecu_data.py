#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  gen_ecu_data.py — SGBD ダンプ → public/ecu-data/<module>.jobs.json (schema 2)
# ----------------------------------------------------------------------------
#  gen_from_dump.py を置き換える。差分は3つ:
#
#  1. **全323ジョブを出す。** 旧版は正規表現で 192 件を捨てていた（うち 38 件は
#     理由の記述すらなし）。二次空気・タンクリーク・DMTL・TEV の SYSTEMCHECK 11 件
#     ——オーナーが最も知りたい排ガス検査——が丸ごと不可視だった。
#     捨てる代わりに分類する。見せる/見せないは UI のファセットの仕事。
#
#  2. **結果(_RESULTS)を出す。** 旧版はジョブの引数だけを出し、結果を一切
#     出していなかった。「ジョブの中身を漏れなく」の中身がこれ。
#
#  3. **分類は tools/sgbd/classify.py の1箇所から来る。** 旧版はここに3つ、
#     TypeScript 側に3つ、計6つの正規表現があって食い違っていた。
#
#  実行:  python tools/gen_ecu_data.py
# ============================================================================
from __future__ import annotations

import dataclasses
import datetime
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(__file__))
from sgbd import classify, model, specs                      # noqa: E402
from sgbd.model import ROLE_TEXT, ROLE_UNIT, ROLE_VALUE      # noqa: E402
from translate import leftover_ratio, translate              # noqa: E402

HERE = os.path.dirname(__file__)
DUMP = os.path.join(HERE, "SgbdDump", "out")
OUT = os.path.join(HERE, "..", "public", "ecu-data")
GENERATOR = "tools/gen_ecu_data.py"
SCHEMA = 2

# id : (ダンプ名, (ja名, en名), DS2アドレス, SGBDファイル)
MODULES = {
    "mss54": ("MSS54DS0", ("MSS54 (S54 / E46 M3 エンジン)", "MSS54 (S54 / E46 M3 Engine)"), 0x12, "MSS54DS0.prg"),
    "smg2": ("SMG2", ("SMG II (E46 M3 変速機)", "SMG II (E46 M3 Gearbox)"), 0x32, "SMG2.prg"),
    # E46 の DSC は DSC_E46.prg が正（汎用 dsc_mk60.prg ではない）。
    "dsc_mk60": ("DSC_E46", ("DSC (E46 M3)", "DSC (E46 M3)"), 0x56, "DSC_E46.prg"),
}

# 汎用すぎて情報価値のない説明文（この場合は識別子から作る方が良い）
GENERIC = {"", "ergebnis", "result", "wert", "value", "status", "job"}


def lbl_for(name: str, comment: str | None) -> tuple[str, str, dict | None]:
    """ラベルと説明を分離して生成。gen_from_dump.py から移設（唯一の流用箇所）。

    ラベルは「comment翻訳」と「識別子分解」の2候補を作り、未訳の独語が占める割合が
    小さい方を採る。同点なら短い方（ラベルの簡潔性優先）。
    説明は SGBD の原文(de) を必ず保持する——ja/en は機械翻訳で、アクチュエータ名の
    自信満々の誤訳は操作事故に直結する（DSC の STEUERN_DIGITAL が「デジタル」）。
    """
    c = (comment or "").strip()
    meaningful = bool(c) and c.lower() not in GENERIC and len(c) > 3

    base = re.sub(r"_(WERT)$", "", name)
    ja_id, en_id = translate(base, "ja"), translate(base, "en")

    if meaningful:
        ja_c, en_c = translate(c, "ja", decompose=False), translate(c, "en", decompose=False)
        score_c, score_id = leftover_ratio(c, decompose=False), leftover_ratio(base, decompose=True)
        if score_c < score_id:
            ja, en = ja_c, en_c
        elif score_id < score_c:
            ja, en = ja_id, en_id
        else:
            ja, en = (ja_c, en_c) if len(ja_c) <= len(ja_id) else (ja_id, en_id)
    else:
        ja, en = ja_id, en_id

    desc = (
        {"de": c, "ja": translate(c, "ja", decompose=False), "en": translate(c, "en", decompose=False)}
        if meaningful
        else None
    )
    return ja, en, desc


class TextPool:
    """三言語テキストの intern。

    2311 結果に対して別名 1555・別文 1010。素で埋め込むと3ファイル合計が約3.5倍、
    intern すれば約1.6倍。静的配信でモジュール切替のたびに取得するので効く。
    """

    def __init__(self) -> None:
        self._index: dict[str, int] = {}
        self.items: list[dict] = []

    def ref(self, de: str | None, ja: str | None = None, en: str | None = None) -> int | None:
        de = (de or "").strip()
        if not de:
            return None
        key = de
        hit = self._index.get(key)
        if hit is not None:
            return hit
        entry = {
            "de": de,
            "ja": ja if ja is not None else translate(de, "ja", decompose=False),
            "en": en if en is not None else translate(de, "en", decompose=False),
        }
        self._index[key] = len(self.items)
        self.items.append(entry)
        return self._index[key]


def fault_table(dump: model.SgbdDump, pool: TextPool) -> list[dict]:
    """FORTTEXTE = コード付き故障本文。

    旧版は `.prg` を 0xF7 で XOR して印字可能文字列を拾い `txt[:250]` で打ち切って
    いた——コードが付かず、MSS54 と SMG2 はちょうど 250 件、つまり切り捨て済み。
    FORTTEXTE は SGBD が持つ本物の対応表で、MSS54 版は各故障に対してどの環境
    条件（フリーズフレーム項目）が意味を持つかまで持っている。
    """
    t = dump.table("FORTTEXTE")
    if not t:
        return []
    out = []
    for row in t.dicts():
        code = (row.get("ORT") or "").strip()
        text = (row.get("ORTTEXT") or "").strip()
        if not code or not text:
            continue
        entry = {"code": code, "text": pool.ref(text)}
        # UW_1..UW_4 = この故障で意味を持つ環境条件の番号（MSS54 のみ）
        uw = [row[k].strip() for k in ("UW_1", "UW_2", "UW_3", "UW_4") if row.get(k, "").strip()]
        if uw:
            entry["env"] = uw
        out.append(entry)
    return out


def env_fields(dump: model.SgbdDump, pool: TextPool) -> list[dict]:
    """FUMWELTTEXTE = フリーズフレームのデコード表。

    MSS54 版は `UWF_A`/`UWF_B` を持つ（値 = raw * A + B）。診断ペインが
    `20 40 60 80` という生バイトを出しているのは、この表が無かったから。
    SMG2 は `UW_MULT`/`UW_DIV`/`UW_ADD`、DSC は係数を持たない——3者で列が違う。
    """
    t = dump.table("FUMWELTTEXTE")
    if not t:
        return []
    out = []
    for row in t.dicts():
        nr = (row.get("UWNR") or "").strip()
        text = (row.get("UWTEXT") or "").strip()
        if not nr or not text:
            continue
        # 分解翻訳を使う。フリーズフレームの項目名は文ではなく短い名詞句で、
        # `Kuehlwassertemp.` は KUEHLWASSER + TEMP に割らないと独語のまま出る
        # ——そしてこれは診断画面の見出しとして最前面に出る文字列である。
        e: dict = {"code": nr, "text": pool.ref(text, translate(text, "ja"), translate(text, "en"))}
        unit = (row.get("UW_EINH") or "").strip()
        if unit and unit != "-":
            e["unit"] = unit
        if row.get("UWF_A"):                       # MSS54: value = raw*A + B
            try:
                e["scale"], e["add"] = float(row["UWF_A"]), float(row.get("UWF_B") or 0)
            except ValueError:
                pass
        elif row.get("UW_MULT"):                   # SMG2: value = raw*MULT/DIV + ADD
            try:
                mult, div = float(row["UW_MULT"]), float(row.get("UW_DIV") or 1)
                e["scale"] = mult / div if div else mult
                e["add"] = float(row.get("UW_ADD") or 0)
            except (ValueError, ZeroDivisionError):
                pass
        if row.get("UW_TYP", "").strip() not in ("", "--"):
            e["type"] = row["UW_TYP"].strip()
        out.append(e)
    return out


def status_vocabularies(dump: model.SgbdDump, pool: TextPool) -> dict[str, list[dict]]:
    """ECU が返すステータスコードの語彙表。

    `TEVSTATUS` / `SLSSTATUS` / `LDPSTATUS` は SYSTEMCHECK 群（TEV機能・二次空気・
    タンクリーク/DMTL）の判定文で、これが「どうなれば正常か」の答えそのもの。
    計画では手書きが必要と見積もっていたが、ECU が自分の言葉を持っていた。
    `JOBRESULT` / `IORESULT` / `PROGRESULT` は汎用の応答コード。
    """
    out: dict[str, list[dict]] = {}
    for name in ("JOBRESULT", "IORESULT", "PROGRESULT", "TEVSTATUS", "SLSSTATUS", "LDPSTATUS",
                 "STATTESTTEXTE", "FEHLERURSACHE"):
        t = dump.table(name)
        if not t:
            continue
        rows = []
        for row in t.dicts():
            code = (row.get("SB") or row.get("FEHLER") or "").strip()
            text = (row.get("STATUS_TEXT") or row.get("URSACHE") or "").strip()
            if not code or not text:
                continue
            e: dict = {"code": code, "text": pool.ref(text)}
            cond = (row.get("COND") or "").strip()
            if cond:
                # BRK=中断 / WAIT=待機 / STATE=進行中 / RSLT=判定
                e["cond"] = cond
            rows.append(e)
        if rows:
            out[name.lower()] = rows
    return out


@dataclasses.dataclass(frozen=True)
class ArgTable:
    """引数 1 つと、その選択肢を供給する SGBD テーブルの結び付け。"""

    table: str
    value_col: str
    note_col: str | None = None
    #「この値までが有効」と SGBD 自身が述べている場合の上限。以降の行は落とし、
    # 落としたことを生成物に記録する。黙って切らない。
    max_value: str | None = None
    # 除外する値（機能を持たないパディング行）。
    drop_values: tuple[str, ...] = ()
    # なぜこの表なのか。SGBD の文言を引く。
    why: str = ""


# 引数名 **だけ** で表を引くと壊れる。`TRIG_SCHREIBEN` の `ORT1`/`ORT2` は
# 車輪アドレスと閾値コードで、`STEUERN_DIGITAL` の `ORT1..ORT15`（電磁弁）とは
# 何の関係も無い。実際、名前だけで引いていたせいで、車輪アドレスを求める引数に
# 「EVVL / Pumpe / V_Pumpe」という電磁弁一覧が出ていた。
# よって **(ジョブ, 引数)** で引く。
ARG_TABLES: dict[tuple[str, str], ArgTable] = {
    ("TRIG_SCHREIBEN", "ORT1"): ArgTable(
        "RAEDER", "RAD_NAME", "ADRESSE",
        why="TRIG_SCHREIBEN は結果に RAD_ADRESSE『Adresse des betreffenden Rades』を返す"),
    ("TRIG_SCHREIBEN", "ORT2"): ArgTable(
        "TRIGGERSCHWELLE", "TRIG_WERT", "USS",
        why="車輪速センサのトリガ閾値。USS 列が mV"),
    # SGBD の逐語: "0 = Neutral, 1-6 = Gang 1-6, 7 = Rueckwaertsgang"。
    # 表は 0x0F まで続くが、それはメーター表示用の値であって投入可能なギアではない。
    ("TESTPRG_STARTEN", "AUSWAHLBYTE"): ArgTable(
        "GANGANZEIGE", "WERT", "ANZEIGE_TEXT", max_value="0x07",
        why="SGBD 逐語: 0 = Neutral, 1-6 = Gang 1-6, 7 = Rueckwaertsgang"),
    ("TESTPRG_STARTEN", "TESTPRG_NR"): ArgTable(
        "TESTPRG", "TESTPRG_NR", "TESTPRG_NAME",
        why="SGBD 逐語: siehe table Testprg TESTPRG_NR TESTPRG_NAME"),
    ("STEUERN_STELLGLIED", "STELLGL"): ArgTable(
        "STELLGLIEDER", "PIN", "STELLGLIED",
        why="SGBD 逐語: Anzusteuerndes Stellglied"),
}

# `STEUERN_DIGITAL` は ORT1..ORT15 の 15 スロットで電磁弁を直接指定する。
# SGBD のパラメータ一覧はこの表の順そのもの。
# `XYZ` の 2 行は BITWERT が 0x00 ——何も駆動しないパディングで、選択肢に出すと
# 「何もしないビット」を 2 回選べる UI になる。
_STEUERN_DIGITAL_ARG = ArgTable(
    "STEUERN", "STEUER_I_O", None, drop_values=("XYZ",),
    why="SGBD 逐語: Parameterliste: E oder W,EVVL,AVVL,EVVR,AVVR,EVHL,AVHL,EVHR,AVHR,"
        "Pumpe,SV1,SV2,EUV1,EUV2,V_PUMPE")


def arg_options(dump: model.SgbdDump, job_name: str, arg_name: str) -> tuple[list[dict], dict] | None:
    """引数の選択肢を SGBD テーブルから引く。返り値は (選択肢, 由来)。

    推測で選択肢を作らない——存在しないピンを叩ける UI になる。表が無ければ
    自由入力欄のままにする方が、それらしい嘘の一覧より安全である。
    """
    spec = ARG_TABLES.get((job_name.upper(), arg_name.upper()))
    if spec is None and job_name.upper() == "STEUERN_DIGITAL" and arg_name.upper().startswith("ORT"):
        spec = _STEUERN_DIGITAL_ARG
    if spec is None:
        return None
    t = dump.table(spec.table)
    if not t:
        return None

    opts: list[dict] = []
    dropped: list[str] = []
    past_max = False
    for row in t.dicts():
        value = (row.get(spec.value_col) or "").strip()
        if not value:
            continue
        note = (row.get(spec.note_col) or "").strip() if spec.note_col else ""
        label = f"{value} {note}".strip()
        if value in spec.drop_values:
            dropped.append(f"{label} (駆動対象なし)")
            continue
        if past_max:
            dropped.append(label)
            continue
        # 電磁弁の表はビット割当そのものが注記になる。
        if spec.table == "STEUERN":
            note = f"byte {row.get('BYTE')} bit {row.get('BITWERT')}"
        opts.append({"value": value, "note": note} if note else {"value": value})
        if spec.max_value is not None and value == spec.max_value:
            past_max = True

    if not opts:
        return None
    origin = {"table": spec.table, "why": spec.why}
    if dropped:
        origin["dropped"] = dropped
    return opts, origin


def build(mid: str, dumpname: str, name: tuple[str, str], addr: int, prg: str) -> dict:
    d = model.load(DUMP, dumpname)
    pool = TextPool()
    jobs_out: list[dict] = []

    for j in d.jobs:
        cls = classify.classify(dumpname, j.name, j.comment, [a.name for a in j.args])
        ja, en, desc = lbl_for(j.name, j.comment)

        args_out = []
        for a in j.args:
            entry: dict = {"name": a.name, "type": a.type, "kind": a.kind}
            ref = pool.ref(a.comment)
            if ref is not None:
                entry["comment"] = ref
            picked = arg_options(d, j.name, a.name)
            if picked:
                entry["options"], entry["optionsFrom"] = picked
                entry["kind"] = model.ARG_ENUM
            args_out.append(entry)

        results_out = []
        cross: list[dict] = []
        for r in j.results:
            entry: dict = {"name": r.name, "type": r.type, "role": r.role}
            ref = pool.ref(r.comment)
            if ref is not None:
                entry["comment"] = ref
            if r.value_of:
                entry["valueOf"] = r.value_of
            if r.when_arg:
                entry["whenArg"] = {"arg": r.when_arg[0], "values": r.when_arg[1],
                                    "provenance": "inferred"}
            if r.role == ROLE_VALUE:
                # 宣言されている単位結果・平文結果へのリンク
                for suffix, key in (("_EINH", "unitRes"), ("_TEXT", "textRes")):
                    companion = r.name + suffix
                    if any(x.name == companion for x in j.results):
                        entry[key] = companion
                spec = specs.parse_spec(r.comment)
                if spec:
                    entry["spec"] = {k: v for k, v in {
                        "min": spec.min, "max": spec.max, "default": spec.default,
                        "always": spec.always, "unit": spec.unit,
                        "source": pool.ref(spec.source), "provenance": "sgbd-comment",
                    }.items() if v is not None}
                cf = specs.parse_cross_field(r.name, r.comment, specs.CLUTCH_ABBREV)
                if cf and not any(c["between"] == list(cf.between) for c in cross):
                    cross.append({"between": list(cf.between), "relation": cf.relation,
                                  "min": cf.min, "max": cf.max, "unit": cf.unit,
                                  "source": pool.ref(cf.source), "provenance": "sgbd-comment"})
            results_out.append(entry)

        # SGBD が規定値を **単位行のコメント側** に書いている場合がある
        # (`KORR_SW_EVEN_EINH`: "Korrekturfaktor SW Ende gerade Einheit /
        #  Default: 0 (Ink)remente")。値行に spec が無ければそちらへ移す——
        # 単位行に付いたままだと、値の範囲としては誰にも読まれない。
        by_name = {e["name"]: e for e in results_out}
        for r in j.results:
            if r.role not in (ROLE_UNIT, ROLE_TEXT) or not r.value_of:
                continue
            target = by_name.get(r.value_of)
            if target is None or "spec" in target:
                continue
            spec = specs.parse_spec(r.comment)
            if not spec:
                continue
            target["spec"] = {k: v for k, v in {
                "min": spec.min, "max": spec.max, "default": spec.default,
                "always": spec.always, "unit": spec.unit,
                "source": pool.ref(spec.source), "provenance": "sgbd-comment",
            }.items() if v is not None}

        job: dict = {
            "id": j.name,
            "ja": ja,
            "en": en,
            "class": cls.cls,
            "audience": cls.audience,
            "system": cls.system,
            "risk": cls.risk,
            "riskProvenance": cls.provenance,
            "op": {k: v for k, v in {
                "kind": cls.kind,
                "actor": cls.actor,
                "termination": cls.termination,
                "resultDelivery": cls.result_delivery,
                "prerequisiteJobs": cls.prerequisite_jobs or None,
                "stopJob": cls.stop_job,
                "resultJob": cls.result_job,
                "ecuTimeoutSec": cls.ecu_timeout_sec,
                "maxHoldSec": cls.max_hold_sec,
                "irreversible": cls.irreversible,
                "provenance": cls.provenance,
            }.items() if v is not None},
            "preconditions": cls.preconditions,
            "args": args_out,
            "results": results_out,
        }
        if desc:
            job["desc"] = pool.ref(desc["de"], desc["ja"], desc["en"])
        if cross:
            job["crossFieldConstraints"] = cross
        if cls.note:
            job["note"] = cls.note
        jobs_out.append(job)

    if len(jobs_out) != d.job_count:
        raise SystemExit(f"{mid}: emitted {len(jobs_out)} jobs from a dump declaring {d.job_count}")

    prof = {
        "schema": SCHEMA,
        "id": mid,
        "name": name[0],
        "name_en": name[1],
        "sgbd": prg,
        "address": addr,
        "verified": False,
        # 古いダンプから生成したことを黙って出荷できないようにする
        "generatedFrom": {
            "dump": dumpname + ".json",
            "dumpSha256": d.sha256,
            "generator": GENERATOR,
            "generatedAt": datetime.datetime.now(datetime.timezone.utc)
            .replace(microsecond=0).isoformat(),
        },
        "jobCount": d.job_count,
        "texts": pool.items,
        "jobs": jobs_out,
        "faultText": fault_table(d, pool),
        "envFields": env_fields(d, pool),
        "vocabularies": status_vocabularies(d, pool),
        "source": "EdiabasLib _JOBS/_ARGUMENTS/_RESULTS + SGBD tables (authoritative)",
    }
    _write_json(os.path.join(OUT, mid + ".jobs.json"), prof)

    by_class: dict[str, int] = {}
    for job in jobs_out:
        by_class[job["class"]] = by_class.get(job["class"], 0) + 1
    return {
        "id": mid, "name": name[0], "name_en": name[1], "sgbd": prg,
        "jobs": d.job_count, "results": sum(len(x["results"]) for x in jobs_out),
        "faults": len(prof["faultText"]), "envFields": len(prof["envFields"]),
        "byClass": by_class,
    }


def _write_json(path: str, obj) -> None:
    """原子的書込。indent=1 は装飾ではない——これらはコミットされ、差分として
    レビューされる。1物理行で書くと 166 KB が「1行変更」に見え、ジョブを黙って
    落とした再生成とラベルを直した再生成が区別できなくなる。"""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, path)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    idx, failed = [], []
    for mid, (dumpname, nm, addr, prg) in MODULES.items():
        try:
            r = build(mid, dumpname, nm, addr, prg)
            idx.append(r)
            print(f"  {mid:10} jobs={r['jobs']:<4} results={r['results']:<5} "
                  f"faults={r['faults']:<4} env={r['envFields']:<3} {r['byClass']}")
        except Exception as e:
            failed.append((mid, e))
            print(f"  {mid:10} ERR {e}")

    # 失敗したモジュールが index から消える一方で古い <id>.json が残り、しかも
    # exit 0 だったため CI が通り、アプリだけが黙ってモジュールを失っていた。
    if failed:
        sys.stderr.write(
            f"\n[FATAL] {len(failed)} module(s) failed: " + ", ".join(m for m, _ in failed)
            + "\nindex.json was NOT rewritten.\n")
        sys.exit(1)

    _write_json(os.path.join(OUT, "index.json"), idx)
    total = sum(r["jobs"] for r in idx)
    print(f"wrote {len(idx)} profiles, {total} jobs total")
    if total != 323:
        sys.stderr.write(f"[FATAL] expected 323 jobs across all modules, got {total}\n")
        sys.exit(1)
