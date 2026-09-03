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
from translate import authored, leftover_ratio, translate    # noqa: E402
import paths                                                # noqa: E402

HERE = os.path.dirname(__file__)
DUMP = paths.require_dump_dir()   # リポジトリ外。理由は tools/paths.py
OUT = os.path.join(HERE, "..", "public", "ecu-data")
GENERATOR = "tools/gen_ecu_data.py"
SCHEMA = 2

# ============================================================================
#  モジュール表 — 3 から 51 へ。
# ----------------------------------------------------------------------------
#  INPA の E46 メニュー × M3 の装備で列挙する。同じ物理モジュールに SGBD の
#  世代違いがある場合（IHKA46 / _2 / _3 等）は INPA と同様に別エントリとして
#  持ち、fit / note で年式・装備を示す。利用者が車両で選ぶ。
#
#  除外したものと理由は docs/FITMENT.md にある。理由の書かれていない除外は
#  一つも残さない——ASCMK20 が「従来決定どおり」だけで 50 モジュールから
#  外れていた実例があり、実際には 0x56 で唯一トレース検証されているのは
#  そちらだった。
#
#  addr は _addresses.json（EdiabasLib の実送信テレグラム）と突き合わせる。
#  食い違ったらトレースが勝つ。宣言はいくらでも間違えられるが、送られた
#  バイトは間違えようがない。
# ============================================================================
GROUPS = [
    ("engine",     "エンジン",   "Engine"),
    ("drivetrain", "駆動系",     "Drivetrain"),
    ("chassis",    "シャシ",     "Chassis"),
    ("safety",     "安全・保安", "Safety & security"),
    ("body",       "ボディ電装", "Body electronics"),
    ("comfort",    "快適装備",   "Comfort"),
    ("comm",       "通信・AV",   "Communication / AV"),
]

FIT = {
    "std":    ("標準",            "standard"),
    "smg":    ("SMG 車",          "SMG cars"),
    "opt":    ("オプション装備",   "optional equipment"),
    "cabrio": ("カブリオレ",       "convertible"),
    "early":  ("前期型",          "early cars"),
    "late":   ("後期型",          "later cars"),
    "jp":     ("日本仕様",         "Japan market"),
}

def M(dump, ja, en, addr, group, fit, note_ja="", note_en="", prg=None):
    return dict(dump=dump, ja=ja, en=en, addr=addr, group=group, fit=fit,
                note_ja=note_ja, note_en=note_en, prg=prg or (dump + ".prg"))

MODULES = {
    # --- engine / drivetrain / chassis ------------------------------------------
    "mss54":    M("MSS54DS0", "MSS54 (S54 / E46 M3 エンジン)", "MSS54 (S54 / E46 M3 Engine)", 0x12, "engine", "std"),
    "smg2":     M("SMG2",     "SMG II (E46 M3 変速機)",        "SMG II (E46 M3 Gearbox)",     0x32, "drivetrain", "smg"),
    # 0x56 は年式で中身が入れ替わる。前期は ASCMK20.prg、後期は DSC_E46.prg。同時装着は無い。
    # 旧 id は "dsc_mk60" だった。DSC_E46.prg を指しながら MK60 を名乗っており、MK20 の車では
    # 持っていない部品番号を主張することになる。
    # 年式は名前に書かない。fit が言うので、書くと選択肢が "ABS/ASC MK20 (early cars)
    # — early cars" になる。名前は ECU が何か、fit はどの車が積んでいるか。
    "ascmk20":  M("ASCMK20",  "ABS/ASC MK20",                  "ABS/ASC MK20",                0x56, "chassis", "early",
                  "6 km/h 超では診断不可（ECU の COMMENT より）", "no diagnosis above 6 km/h (from the ECU's own COMMENT)"),
    "dsc_e46":  M("DSC_E46",  "DSC (E46)",                     "DSC (E46)",                   0x56, "chassis", "late"),
    "lws5":     M("LWS5",     "舵角センサ LWS5",                "Steering angle sensor LWS5",  0x57, "chassis", "std", "DSC MK60 と対", "paired with DSC MK60"),
    "rdc":      M("RDC",      "タイヤ空気圧 RDC",               "Tyre pressure control RDC",   0x70, "chassis", "opt"),
    # --- safety & security -------------------------------------------------------
    "mrs3":     M("MRS3",     "エアバッグ MRS3",                "Airbag MRS3",                 0xA4, "safety", "early", "〜03/2003", "up to 03/2003"),
    "mrs4":     M("MRS4",     "エアバッグ MRS4",                "Airbag MRS4",                 0xA4, "safety", "late",  "03/2003〜", "from 03/2003"),
    "ueb2":     M("UEB2",     "ロールオーバー保護 UEB2",        "Rollover protection UEB2",    0x9E, "safety", "cabrio"),
    "ews3":     M("EWS3",     "イモビライザ EWS 3.3",           "Immobiliser EWS 3.3",         0x44, "safety", "std"),
    "ews3d":    M("EWS3D",    "イモビライザ EWS 3.3D",          "Immobiliser EWS 3.3D",        0x44, "safety", "late"),
    # --- body electronics ---------------------------------------------------------
    "zke5":     M("ZKE5",     "ボディ電装 GM5 (ZKE5)",          "Body electronics GM5 (ZKE5)", 0x00, "body", "std"),
    "zke5_s12": M("ZKE5_S12", "ボディ電装 GM5 (ZKE5 S12)",      "Body electronics GM5 (S12)",  0x00, "body", "late"),
    "kombi46":  M("KOMBI46",  "メーターパネル KOMBI",           "Instrument cluster KOMBI",    0x80, "body", "std"),
    "kombi46r": M("KOMBI46R", "メーターパネル KOMBI (Redesign)", "Instrument cluster (Redesign)", 0x80, "body", "late", "後期型メーター", "facelift cluster"),
    "lsz":      M("LSZ",      "ライトスイッチセンター LSZ",     "Light switch centre LSZ",     0xD0, "body", "std"),
    "lsz_2":    M("LSZ_2",    "ライトスイッチセンター LSZ_2",   "Light switch centre LSZ_2",   0xD0, "body", "late"),
    "mfl":      M("MFL",      "マルチファンクションステアリング MFL", "Multifunction steering wheel MFL", 0x50, "body", "std"),
    "mfl2":     M("MFL2",     "マルチファンクションステアリング MFL2", "Multifunction steering wheel MFL2", 0x50, "body", "late"),
    "szm46":    M("SZM46",    "センターコンソールスイッチ SZM", "Centre console switch centre SZM", 0xF5, "body", "std"),
    "aic":      M("AIC",      "レインセンサ AIC",               "Rain sensor AIC",             0xE8, "body", "early"),
    "rls_ds2":  M("RLS_DS2",  "レイン/ライトセンサ RLS",        "Rain/light sensor RLS",       0xE8, "body", "late"),
    "alc_ds2":  M("ALC_DS2",  "アダプティブライト ALC",         "Adaptive light control ALC",  0x66, "body", "opt"),
    "xenon_l":  M("XENON_L",  "キセノン 左",                    "Xenon left",                  0x98, "body", "opt"),
    "xenon_r":  M("XENON_R",  "キセノン 右",                    "Xenon right",                 0x86, "body", "opt"),
    "cvm_ii":   M("CVM_II",   "ソフトトップ CVM II",            "Convertible top module CVM II", 0x9C, "body", "cabrio"),
    # --- comfort -----------------------------------------------------------------
    "ihka46":   M("IHKA46",   "エアコン IHKA",                  "Climate control IHKA",        0x5B, "comfort", "early", "〜PU98", "up to PU98"),
    "ihka46_2": M("IHKA46_2", "エアコン IHKA (PU98/99)",        "Climate control IHKA (PU98/99)", 0x5B, "comfort", "std"),
    "ihka46_3": M("IHKA46_3", "エアコン IHKA (PU03/2003)",      "Climate control IHKA (PU03/2003)", 0x5B, "comfort", "late"),
    "pdce38":   M("PDCE38",   "パークディスタンス PDC",         "Park distance control PDC",   0x60, "comfort", "opt"),
    "pdcact":   M("PDCACT",   "パークディスタンス PDC (ACT)",   "Park distance control PDC (ACT)", 0x60, "comfort", "opt"),
    "shd46":    M("SHD46",    "サンルーフ SHD",                 "Sunroof SHD",                 0x08, "comfort", "opt"),
    "shd46_2":  M("SHD46_2",  "サンルーフ SHD (2)",             "Sunroof SHD (2)",             0x08, "comfort", "opt"),
    "sm46_4":   M("SM46_4",   "シートメモリ 運転席",            "Seat memory, driver",         0x72, "comfort", "opt"),
    "sm46c_5":  M("SM46C_5",  "シートメモリ 運転席 (カブリオレ)", "Seat memory, driver (convertible)", 0x72, "comfort", "cabrio"),
    "b_sm46_4": M("B_SM46_4", "シートメモリ 助手席",            "Seat memory, passenger",      0xDA, "comfort", "opt"),
    "spm46ft":  M("SPM46FT",  "ミラーメモリ 運転席ドア",        "Mirror memory, driver door",  0x9B, "comfort", "opt"),
    "spm46bt":  M("SPM46BT",  "ミラーメモリ 助手席ドア",        "Mirror memory, passenger door", 0x51, "comfort", "opt"),
    # --- communication / AV -------------------------------------------------------
    "radio":    M("RADIO",    "ラジオ",                         "Radio",                       0x68, "comm", "opt"),
    "bmbt46rn": M("BMBT46RN", "ボードモニター (Radio Nav)",     "On-board monitor (Radio Nav)", 0xF0, "comm", "opt"),
    "bmbt46tn": M("BMBT46TN", "ボードモニター (Top Nav)",       "On-board monitor (Top Nav)",  0xF0, "comm", "opt"),
    "bmbt_mir": M("BMBT_MIR", "ボードモニター MIR",             "On-board monitor MIR",        0xF0, "comm", "opt"),
    "bm46wide": M("BM46WIDE", "ワイドスクリーンモニター",       "Widescreen monitor",          0xF0, "comm", "opt"),
    "cdc_46":   M("CDC_46",   "CDチェンジャー",                 "CD changer",                  0x76, "comm", "opt"),
    "navmk3":   M("NAVMK3",   "ナビゲーション MK3",             "Navigation computer MK3",     0x7F, "comm", "opt"),
    "navmk4":   M("NAVMK4",   "ナビゲーション MK4",             "Navigation computer MK4",     0x7F, "comm", "opt"),
    "navmk4_2": M("NAVMK4_2", "ナビゲーション MK4 (2)",         "Navigation computer MK4 (2)", 0x7F, "comm", "opt"),
    "nav_jap":  M("NAV_JAP",  "日本仕様ナビゲーション",         "Japan navigation system",     0xBB, "comm", "jp"),
    "ses":      M("SES",      "音声入力 SES",                   "Speech input SES",            0xB0, "comm", "opt"),
    "telefon":  M("TELEFON",  "電話",                           "Telephone",                   0xC8, "comm", "opt"),
    "videomod": M("VIDEOMOD", "ビデオモジュール",               "Video module",                0xED, "comm", "opt"),
}

GROUP_TEXT = {key: (ja, en) for key, ja, en in GROUPS}

# アプリが <id>.jobs.json の隣で取りにいくファイル。実在するものだけを index に載せる。
# 接尾辞の規則ではなくファイル名そのものを並べる: smg2-workflows.json だけ命名が違い、
# 規則を書けばその規則を間違える側が必ず出る。
SIDECAR_NAMES = ("{id}.telegrams.json", "{id}.jobtext.json", "{id}.hydraulics.json",
                 "{id}-workflows.json")


def sidecars_for(mid: str) -> list[str]:
    return [n.format(id=mid) for n in SIDECAR_NAMES
            if os.path.exists(os.path.join(OUT, n.format(id=mid)))]


# 生成物の員数台帳。ジョブが黙って消えないことが不変条件で、総数はその見張り。
# 増減そのものは正当でありうる（モジュールを足せば増える）ので、禁止ではなく
# 「意図した変更か」を問う: --write-counts を付けた実行だけが台帳を書き換える。
COUNTS = os.path.join(HERE, "ecu_data_counts.json")

# 汎用すぎて情報価値のない説明文（この場合は識別子から作る方が良い）

GENERIC = {"", "ergebnis", "result", "wert", "value", "status", "job"}

# 値域だけを述べた説明文（"0 oder 1" / "-32 bis 31" / "0-255 bzw. 0x00-0xFF" 等）。
# 「その値が何か」を一切語らないのでラベルには使えない。しかも完全に訳せてしまうため
# leftover_ratio() では識別子分解に勝ってしまい、そのまま採ると「0または1」という
# ラベルが出る。3 モジュールでは当たらなかったが、ボディ系に当たった瞬間に出る。
# 値域そのものは実機読取時の判断材料なので desc としては残す。
# ※ 数値と接続語だけの文字列のみが対象。単位や語が付くもの（"0 bis 255 s" /
#   "8 Byte" / "1 wenn Okay"）は情報があるので対象外。
_NUM = r"[+-]?(?:0[xX][0-9A-Fa-f]+|\d+)"
_RSEP = r"(?:\s*(?:oder|bis|und|bzw\.?|[-–/,])\s*|\s*\.{2,3}\s*)"
GENERIC_RANGE = re.compile(rf"^{_NUM}(?:{_RSEP}{_NUM})+$", re.I)


# MSS54 のコメントは末尾に測定値の内部名を付ける（"エンジン回転数 n / MW_N"）。
# これはラベルではなく識別子で、識別子は識別子スロットに出る。ラベルから落として
# desc には残す——捨てるのではなく、置く場所を選んでいる。
#
# 訳した「後」に落とす。原文から先に落とすとフレーズ表の完全一致が外れ、人の書いた
# 訳がまるごと効かなくなる。
_INTERNAL_NAME = re.compile(r"\s*/\s*MW_[A-Z0-9_]+\s*$")


def _drop_internal_name(text: str) -> str:
    stripped = _INTERNAL_NAME.sub("", text)
    # 内部名しか無かった場合は落とさない。空のラベルより内部名のほうがまだ何かを言う。
    return stripped or text


def lbl_for(name: str, comment: str | None, sgbd: str | None = None) -> tuple[str, str, dict | None]:
    """ラベルと説明を分離して生成。gen_from_dump.py から移設（唯一の流用箇所）。

    ラベルは「comment翻訳」と「識別子分解」の2候補を作り、未訳の独語が占める割合が
    小さい方を採る。同点なら短い方（ラベルの簡潔性優先）。
    説明は SGBD の原文(de) を必ず保持する——ja/en は機械翻訳で、アクチュエータ名の
    自信満々の誤訳は操作事故に直結する（DSC の STEUERN_DIGITAL が「デジタル」）。
    """
    c = (comment or "").strip()
    keep = bool(c) and c.lower() not in GENERIC and len(c) > 3
    # 値域だけの説明文は desc には残すが、ラベル候補にはしない（GENERIC_RANGE 参照）。
    meaningful = keep and not GENERIC_RANGE.match(c)

    base = re.sub(r"_(WERT)$", "", name)
    ja_id, en_id = translate(base, "ja", sgbd=sgbd), translate(base, "en", sgbd=sgbd)

    if meaningful:
        ja_c = _drop_internal_name(translate(c, "ja", decompose=False, sgbd=sgbd))
        en_c = _drop_internal_name(translate(c, "en", decompose=False, sgbd=sgbd))
        score_c = leftover_ratio(c, decompose=False, sgbd=sgbd)
        score_id = leftover_ratio(base, decompose=True, sgbd=sgbd)
        if score_c < score_id:
            ja, en = ja_c, en_c
        elif score_id < score_c:
            ja, en = ja_id, en_id
        else:
            # 同点のときだけ、人の書いた訳を優先する。
            #
            # 同点は「両方きれいに訳せた」の意味で、そこで短いほうを採る規則は、族別
            # トークンを足した瞬間に壊れた: VA/HA/SIM が訳せるようになって識別子分解が
            # 満点になり、DSC_SIM_VA の authored な「STEUERN_DIGITAL 経由で駆動し、
            # そのまま保持する（解除ジョブなし）」——ラッチすることを述べた唯一の文——が
            # 短さで負けた。
            #
            # 得点そのものは触らない。負けている authored 訳まで拾い上げると、識別子が
            # EINLASS（吸気）のジョブに SGBD コメント由来の「排気」が付くような反転が
            # 出る（実測: STATUS_VANOS_NW_LAGE_EINLASS_BANK_1）。
            # 片方だけが authored のときに限る。両方 authored（説明文にも識別子にも
            # 人の書いた訳がある）なら出所では選べないので、従来どおり短いほうを採る
            # ——DSC の STEUERN_DIGITAL は両方あり、説明文のほうは電磁弁 15 枠の
            # 引数リストそのものなので、出所だけで選ぶとラベルが表になる。
            auth_c, auth_id = authored(c, sgbd), authored(base, sgbd)
            if auth_c and not auth_id:
                ja, en = ja_c, en_c
            elif auth_id and not auth_c:
                ja, en = ja_id, en_id
            else:
                ja, en = (ja_c, en_c) if len(ja_c) <= len(ja_id) else (ja_id, en_id)
    else:
        ja, en = ja_id, en_id

    desc = (
        {"de": c, "ja": translate(c, "ja", decompose=False, sgbd=sgbd),
         "en": translate(c, "en", decompose=False, sgbd=sgbd)}
        if keep
        else None
    )
    return ja, en, desc


class TextPool:
    """三言語テキストの intern。

    2311 結果に対して別名 1555・別文 1010。素で埋め込むと3ファイル合計が約3.5倍、
    intern すれば約1.6倍。静的配信でモジュール切替のたびに取得するので効く。
    """

    def __init__(self, sgbd: str | None = None) -> None:
        self._index: dict[str, int] = {}
        self.items: list[dict] = []
        # どの ECU のテキストを溜めているか。族専用の訳を引くのに要る——このプールは
        # 故障本文・フリーズフレーム見出し・語彙表・引数コメントの全部を通るので、
        # ここが ECU を知らないと、そのどれもが他モジュールの訳を名乗りうる。
        self.sgbd = sgbd

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
            "ja": ja if ja is not None else translate(de, "ja", decompose=False, sgbd=self.sgbd),
            "en": en if en is not None else translate(de, "en", decompose=False, sgbd=self.sgbd),
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
        e: dict = {"code": nr, "text": pool.ref(text, translate(text, "ja", sgbd=pool.sgbd),
                                                translate(text, "en", sgbd=pool.sgbd))}
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


@dataclasses.dataclass(frozen=True)
class ArgComment:
    """選択肢が表ではなく **引数コメントの散文の中** に列挙されている場合。"""

    pattern: str   # 名前付きグループ value（必須）と note（任意）を持つこと
    why: str


# 全 323 ジョブ中、SGBD が値を散文で列挙しているのはこの 4 引数だけである
# （`kind == enum` かつ表を持たないものを数えた）。総称の正規表現を 323 件に
# 当てるのではなく (ジョブ, 引数) で明示的に引くのは、当たりどころを間違えると
# 選択肢に嘘が混じるからで、`ADAPTIONSWERT_LOESCHEN` がその実例になっている——
# コメントの後半 2 行は "Hinweis:" で始まる注意書きで、値ではない。
# ここでは `, Argument: <数字>` を必須にすることでそれらが選択肢に化けない。
ARG_COMMENT_OPTIONS: dict[tuple[str, str], ArgComment] = {
    # "Adaptionswerte Kupplung lesen, Argument: 0 /
    #  Adaptionswerte Getriebe lesen, Argument: 1 /
    #  Getriebedaten lesen,           Argument: 2"
    # 引数 2 は SGBD がこう明記しているのに、選択肢が無いため UI では
    # 自由入力欄で、存在すら見えなかった。INPA は 0/1/2 を実際に呼んでいる。
    ("ADAPTIONSWERTE_LESEN", "ADAPTION_LESEN"): ArgComment(
        r"(?P<note>[^/]+?)\s*,\s*Argument:\s*(?P<value>\d+)",
        why="SGBD 逐語: Adaptionswerte Kupplung lesen, Argument: 0 / "
            "Adaptionswerte Getriebe lesen, Argument: 1 / Getriebedaten lesen, Argument: 2"),
    # "Kupplungskennlinie loeschen, Argument: 0 /
    #  Getriebedaten loeschen,      Argument: 1 / Hinweis: ... / ..."
    ("ADAPTIONSWERTE_LOESCHEN", "ADAPTIONSWERT_LOESCHEN"): ArgComment(
        r"(?P<note>[^/]+?)\s*,\s*Argument:\s*(?P<value>\d+)",
        why="SGBD 逐語: Kupplungskennlinie loeschen, Argument: 0 / "
            "Getriebedaten loeschen, Argument: 1"),
    # "Argument: 0=inaktiv / 1=aktiv"
    ("CODIERDATEN_SCHREIBEN", "AKTIVIERUNG"): ArgComment(
        r"(?P<value>\d+)\s*=\s*(?P<note>\w+)",
        why="SGBD 逐語: Argument: 0=inaktiv / 1=aktiv"),
    # "Codierdaten fuer Auswahl: / Argument: ROLLENBETRIEB / oder: RADABRISS / ..."
    # 値は記号名。以降の解説文は小文字混じりなので大文字だけの語に限れば拾わない。
    ("CODIERDATEN_SCHREIBEN", "CODIERUNG"): ArgComment(
        r"(?:Argument|oder)\s*:\s*(?P<value>[A-Z][A-Z_]{3,})",
        why="SGBD 逐語: Argument: ROLLENBETRIEB / oder: RADABRISS"),
}


def comment_options(job_name: str, arg_name: str, comment: str) -> tuple[list[dict], dict] | None:
    """SGBD が引数コメントに書き並べた値を選択肢にする。返り値は (選択肢, 由来)。"""
    spec = ARG_COMMENT_OPTIONS.get((job_name.upper(), arg_name.upper()))
    if spec is None or not comment:
        return None
    opts: list[dict] = []
    seen: set[str] = set()
    for m in re.finditer(spec.pattern, comment):
        value = m.group("value").strip()
        if value in seen:
            continue
        seen.add(value)
        note = (m.groupdict().get("note") or "").strip()
        opts.append({"value": value, "note": note} if note else {"value": value})
    if not opts:
        return None
    # `table` は付けない——表から来ていないから。UI はその不在を見て
    # 「コメント由来」と表示する。存在しない表の名前を書かない。
    return opts, {"why": spec.why}


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


def load_addresses() -> dict:
    """DS2 アドレスの実測。tools/dump_modules.py が EdiabasLib の実送信テレグラム
    "(Send sim): 56 04 00" から取ったもので、59 モジュール分ある。

    無い場合は空で返す——宣言だけで生成はできる。ただしその場合、アドレスは
    「誰かがそう書いた」以上の根拠を持たない。"""
    p = os.path.join(DUMP, "_addresses.json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}


def build(mid: str, m: dict, addrs: dict) -> dict:
    dumpname, prg = m["dump"], m["prg"]
    name = (m["ja"], m["en"])
    addr = m["addr"]
    # トレースが勝つ。黙って直さず、必ず出す——アドレスが変わったということは、
    # これまでとは別の ECU と話していたか、これから別の ECU と話すということ。
    a = addrs.get(dumpname, {})
    if a.get("addr") is not None and a["addr"] != addr:
        print(f"  !! {mid}: MODULES addr 0x{addr:02X} != trace 0x{a['addr']:02X} (trace wins)")
        addr = a["addr"]
    ecu_desc = (a.get("info") or {}).get("ECU", "")
    d = model.load(DUMP, dumpname)
    pool = TextPool(dumpname)
    jobs_out: list[dict] = []

    for j in d.jobs:
        cls = classify.classify(dumpname, j.name, j.comment, [a.name for a in j.args])
        ja, en, desc = lbl_for(j.name, j.comment, dumpname)

        args_out = []
        for a in j.args:
            entry: dict = {"name": a.name, "type": a.type, "kind": a.kind}
            ref = pool.ref(a.comment)
            if ref is not None:
                entry["comment"] = ref
            picked = arg_options(d, j.name, a.name) or comment_options(j.name, a.name, a.comment)
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
                "stopArgs": cls.stop_args,
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
        "addressHex": f"0x{addr:02X}",
        "group": m["group"],
        "groupJa": GROUP_TEXT[m["group"]][0],
        "groupEn": GROUP_TEXT[m["group"]][1],
        "fit": m["fit"],
        "fitJa": FIT[m["fit"]][0],
        "fitEn": FIT[m["fit"]][1],
        "note": m["note_ja"],
        "note_en": m["note_en"],
        # ECU 自身が INFO ジョブで名乗る文字列。ダンプがどの実機系列のものかを
        # 言える唯一の欄で、"ABS/ASC, ITT_Industries, MK20E_I, E36,E46" のように
        # 型式まで入る。トレースが無いモジュールでは空。
        "ecuDesc": ecu_desc,
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
        "address": addr, "addressHex": f"0x{addr:02X}",
        "group": m["group"], "fit": m["fit"],
        "note": m["note_ja"], "note_en": m["note_en"], "ecuDesc": ecu_desc,
        "jobs": d.job_count, "results": sum(len(x["results"]) for x in jobs_out),
        "faults": len(prof["faultText"]), "envFields": len(prof["envFields"]),
        "byClass": by_class,
        "roles": _count_roles(jobs_out),
        "unclassified": sum(1 for j in jobs_out if j["class"] == "unclassified"),
        # 実在するサイドカーを名指しする。無いと 51 モジュールで毎セッション
        # 100 回超の 404 を取りに行く（現に mss54.hydraulics.json がそうなっていた）。
        # 接尾辞ではなく FILE NAME を並べるのは、smg2-workflows.json だけ命名が
        # 違うから——規則を書くと、その規則を間違える側が必ず出る。
        "sidecars": sidecars_for(mid),
    }


def _count_roles(jobs_out: list[dict]) -> dict[str, int]:
    n: dict[str, int] = {}
    for j in jobs_out:
        for r in j["results"]:
            n[r["role"]] = n.get(r["role"], 0) + 1
    return n


def _write_json(path: str, obj) -> None:
    """原子的書込。indent=1 は装飾ではない——これらはコミットされ、差分として
    レビューされる。1物理行で書くと 166 KB が「1行変更」に見え、ジョブを黙って
    落とした再生成とラベルを直した再生成が区別できなくなる。"""
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, path)


def check_counts(idx: list[dict], write: bool) -> int:
    """員数を、コミットされた台帳と突き合わせる。

    ここに 323 というリテラルがあった。それはスナップショットであって不変条件ではなく、
    モジュールが 3 から 51 になった時点で意味を失う。本当の不変条件は build() が
    モジュール毎に見ている「出力ジョブ数 == ダンプの jobCount」で、この台帳はその上に
    載る二段目——生成器の設定が変わって全体が動いたことを、差分として見せる。"""
    now = {r["id"]: {"jobs": r["jobs"], "results": r["results"]} for r in idx}
    roles: dict[str, int] = {}
    for r in idx:
        for k, v in r["roles"].items():
            roles[k] = roles.get(k, 0) + v
    if write or not os.path.exists(COUNTS):
        _write_json(COUNTS, {
            "note": "tools/gen_ecu_data.py --write-counts で更新。差分はレビュー対象。",
            "modules": now,
            "totals": {k: sum(v[k] for v in now.values()) for k in ("jobs", "results")},
            # 結果ロールの分布。分類器を触れば必ずここが動くので、意図しない変更が差分で出る。
            "roles": dict(sorted(roles.items())),
            # SGBD が何も述べていないジョブの数。0 が目標だが、0 にするために
            # 「分からない」を「読取」と書くのが、この数字が防いでいる操作そのもの。
            "unclassified": sum(r["unclassified"] for r in idx),
        })
        print(f"wrote {os.path.relpath(COUNTS)} ({len(now)} modules)")
        return 0
    want = json.load(open(COUNTS, encoding="utf-8"))["modules"]
    diffs = [(k, want.get(k), now.get(k)) for k in sorted(set(want) | set(now))
             if want.get(k) != now.get(k)]
    for k, w, n in diffs:
        print(f"  != {k:12} ledger={w} now={n}")
    return len(diffs)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    os.makedirs(OUT, exist_ok=True)
    only = ([a for a in sys.argv[sys.argv.index("--only") + 1:] if not a.startswith("--")]
            if "--only" in sys.argv else None)
    addrs = load_addresses()
    idx, failed = [], []
    for mid, m in MODULES.items():
        if only and mid not in only:
            continue
        try:
            r = build(mid, m, addrs)
            idx.append(r)
            print(f"  {mid:10} 0x{r['address']:02X} jobs={r['jobs']:<4} results={r['results']:<5} "
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

    if only:
        print(f"regenerated {len(idx)} profile(s); index.json and the counts ledger untouched")
        sys.exit(0)

    # グループ順 → MODULES 宣言順（ECU セレクタの並びそのもの）。
    gorder = {g[0]: i for i, g in enumerate(GROUPS)}
    morder = {k: i for i, k in enumerate(MODULES)}
    idx.sort(key=lambda e: (gorder.get(e.get("group"), 99), morder.get(e["id"], 999)))

    # 配列ではなくオブジェクトの外殻。配列だとスキーマ番号も生成時刻もグループ表も
    # 置く場所が無く、読む側は「配列であること」だけを頼りに形を推測することになる。
    _write_json(os.path.join(OUT, "index.json"), {
        "schema": SCHEMA,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc)
        .replace(microsecond=0).isoformat(),
        "groups": [{"key": k, "ja": ja, "en": en} for k, ja, en in GROUPS],
        "fit": {k: {"ja": ja, "en": en} for k, (ja, en) in FIT.items()},
        "modules": idx,
    })
    total = sum(r["jobs"] for r in idx)
    print(f"wrote {len(idx)} profiles, {total} jobs total")

    drift = check_counts(idx, "--write-counts" in sys.argv)
    if drift:
        sys.stderr.write(
            f"[FATAL] {drift} module(s) differ from tools/ecu_data_counts.json.\n"
            "If the change is intended, re-run with --write-counts and let the diff be reviewed.\n")
        sys.exit(1)
