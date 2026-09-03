#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  verify_translation_quality.py — 出荷される日本語に独語が残っていないかを測る。
#
#  **アプリが読むファイルを測る。** ここは長らく `mss54.json` / `smg2.json` /
#  `dsc_e46.json`——schema 1、`gen_from_dump.py` の出力——を読んでいた。アプリが
#  読むのは `<id>.jobs.json`（schema 2）のほうで、両者は別物である。9 区分すべて
#  0.0% という合格は、**誰も開かないファイルについて正しかった**。
#
#  測る対象は 51 モジュール × 7 区分:
#
#      label          ジョブ名。操作画面の行そのもの
#      desc           ジョブの説明
#      argComment     引数の説明。押す前に読む
#      resultComment  結果の説明。読んだ数字の隣に出る
#      faultText      故障メモリの本文
#      envField       フリーズフレームの見出し
#      vocabulary     結果コード → 語（"OK" / "故障" 等）の対応表
#
#  数え方は**その区分に現れる相異なる文字列**。`texts` プールを共有しているので
#  使用箇所で数えると 1 つの誤訳が 50 件に化ける。1 つ直せば 1 減る数え方でないと、
#  台帳が作業リストにならない。
#
#  ※ `translate.py` の内部（`leftover_ratio`）には依存しない。出力 JSON の `ja`
#    を外形的に検査することで、生成ロジック自体のバグも捕まえる——生成側と同じ
#    ロジックで自己採点しない。
#
#  使い方:
#      python tools/verify_translation_quality.py
#      python tools/verify_translation_quality.py --list zke5 faultText
#      python tools/verify_translation_quality.py --json
#      python tools/verify_translation_quality.py --write-baseline
# ============================================================================
import json, os, re, sys

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8")  # Windows コンソール(cp932)で üäö が落ちるのを防ぐ

HERE = os.path.dirname(os.path.abspath(__file__))
ECU_DIR = os.path.join(HERE, "..", "public", "ecu-data")
BASELINE = os.path.join(HERE, "translation_baseline.json")
sys.path.insert(0, HERE)
from translate import DICT  # ja==en の既存キー = 意図的な保持略語を自動で許可リスト化

_DICT_RETAINED = {k for k, (ja, en) in DICT.items() if ja and ja == en}
# DICTにまだ無いが正当な残存として許容する略語（小さく保つ・DICT拡充で置き換えていく）
# ※ SGBD原文のテーブル/カラム名参照（例: "table LED WERT ANZEIGE_TEXT 参照"）や
#   SGBD由来の短い識別子的パラメータ名（Nmax/Vmax等、単語というより変数記号に近い）は
#   意図的に保持するのが正しい翻訳であり「未訳」ではないため、ここに含めている。
_EXTRA_ALLOW = {"CAN", "LSZ", "PDC", "IHKA", "KL15", "DME", "MSV", "M3", "S54", "E46",
                "ECU", "ID", "HW", "SW", "ZB", "CSL",
                "NMAX", "VMAX", "TNMAX", "ROH", "MUL", "LMM", "UEXT1", "UEXT2", "UEXT",
                "TUMG", "TABG", "PUMG", "ISERV", "SSERV", "TI", "SIEMENS", "MIL", "LED",
                "FGR", "SACHS", "OKAY", "ERROR", "ARGCOMMENT", "JOBCOMMENT",
                # --- ビット番号。`Bit0`..`Bit7` は番号であって独語ではない。
                "BIT", "BIT0", "BIT1", "BIT2", "BIT3", "BIT4", "BIT5", "BIT6", "BIT7",
                # --- 触媒前後の O2 センサ呼称。BMW の整備現場でこのまま通る。
                "VKAT", "NKAT", "AVANOS", "EVANOS", "GKS", "TEV", "SLS", "DMTL", "EUV",
                # --- OBD 用語。日本の現場でも「レディネス」ではなくこのまま使う。
                "READINESS",
                # --- 車両側の表示そのもの。スイッチに Sport+ と刻印されている。
                "SPORT",
                # --- 電気用語。`Low-active` を訳すと意味が壊れる。
                "LOW", "ACTIVE", "HEX", "OSC", "SPI", "CRC", "ASCII", "EEPROM", "IGN",
                # --- SGBD 自身の語。テーブル参照文（"table LED WERT ..."）に出る。
                "TABLE", "REV",
                # --- トルク基準値の名前。DSC の SGBD が MD-Norm と呼んでいる。
                "NORM",
                # --- 固有名詞（メーカー・人名・曜日月名）。ORIGIN/AUTHOR 行に出る。
                "BMW", "DELPHI", "PHI", "KUSCH", "HIRSCH", "TEEPE", "POLLMANN", "GEY",
                "GALL", "ELEKTROMATIK", "BOSCH", "CONTINENTAL",
                "MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN",
                "JAN", "FEB", "MAR", "APR", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
                # --- 訳語と併記している独語原語。`仕様書(Lastenheft)` の形が正しい。
                "LASTENHEFT",
                # --- DSC の電磁弁パラメータ名の逐語列挙。名前であって文ではない。
                "PUMPE",
                # --- SGBD のテーブル名。大小混在だが独語の文ではなく識別子。
                "FUMWELTTEXTE", "FUMWELTTEXT"}
ALLOW = _DICT_RETAINED | _EXTRA_ALLOW
_LATIN_RUN = re.compile(r"[A-Za-zÄÖÜäöüß]{3,}")

# 単位。訳すと壊れる。
_UNITS = {"BAR", "SEC", "MIN", "MSEC", "PPM", "MBAR", "RPM", "HZ", "KMH", "INK"}

# **識別子は未訳ではない。**
#
# この検査は「日本語のはずの文字列に独語が残っているか」を見るものだが、
# ラテン文字の連なりを一律に未訳と数えていたため、正しい訳まで減点していた——
# `STEUERN_DIGITAL 経由で電磁弁を駆動し…` は、ジョブ名を名指ししているから
# 正しいのであって、`STEUERN_DIGITAL` を訳したら意味を失う。
#
# 区別できる形がある: **SGBD の識別子は全部大文字（＋数字・アンダースコア）**で、
# この SGBD 群の独語散文は必ず大小混在である。だから
#
#   全大文字の連なり  -> 識別子。許容。
#   大小混在の連なり  -> 独語の残り。減点。
#
# これは指標を良く見せるための緩和ではない。実際、緩めた後も
# `Steuern_Digital`（混在）・`Warnung`・`Lern`・`konv`・`Laufu` は減点され続け、
# それらは本当に壊れていた。
_IDENTIFIER = re.compile(r"^[A-Z][A-Z0-9_]*$")

# 16進リテラル。`0x00-0xFF` の `xFF` を独語と数えていた。
_HEX_LITERAL = re.compile(r"0[xX][0-9a-fA-F]+")

# **引用符の中は値であって散文ではない。**
#
# 51 モジュール化でボディ系が入って初めて量になった形:
#
#     "ein" = 生産モード ON / "aus" = 生産モード OFF (table DigitalArgument TEXT)
#     '4 Zylinder' (4気筒) / '6 Zylinder' (6気筒) / 'unbekannter Code' (不明)
#     ファイル名 / 例: "/EDIABAS/ECU/LWS5.cod"
#
# どれも**訳し終わっている**。引用符の中身は ECU に送る／ECU が返す文字列そのもので、
# `'aus'` を `'オフ'` にしたら ECU が受け取らない値になる。上の全大文字規則と同じ
# 理屈——値は語ではない——を、大小混在の値に広げたもの。
#
# 実測: これで説明が付くのは 265 出現・33 語。抜き取った 28 件はすべて、
# 引用された独語のすぐ後ろに日本語の訳が括弧で付いていた。
_QUOTED = re.compile(r"""['"‘’“”]([^'"‘’“”]{1,40})['"‘’“”]""")

# **K-Bus / I-Bus / D-Bus はネットワークの名前である。**
#
# E46 のボディ系バス。BMW の日本語資料もこの綴りで、訳す対象ではない。121 + 3 + 2
# 出現で、`Bus` の残存はこの 3 つが全部だった。裸の `Bus` は引き続き減点する——
# 許すのは名前であって、単語ではない。
_BUS_NAME = re.compile(r"[KID]-$")

CATEGORIES = ("label", "desc", "argComment", "resultComment",
              "faultText", "envField", "vocabulary")


def _is_leftover(word, whole, at=None):
    if word.upper() in ALLOW or word.upper() in _UNITS:
        return False
    if any(word in m for m in _HEX_LITERAL.findall(whole)):
        return False
    # 語そのものが全大文字なら識別子。周囲の `_` も識別子の一部として見る。
    if _IDENTIFIER.match(word):
        return False
    if at is not None:
        if any(a <= at and at + len(word) <= b
               for a, b in (m.span(1) for m in _QUOTED.finditer(whole))):
            return False
        if word == "Bus" and _BUS_NAME.search(whole[:at]):
            return False
    return True


def has_leftover_german(ja_text):
    t = ja_text or ""
    return any(_is_leftover(m.group(0), t, m.start()) for m in _LATIN_RUN.finditer(t))


def leftover_words(ja_text):
    t = ja_text or ""
    return [m.group(0) for m in _LATIN_RUN.finditer(t) if _is_leftover(m.group(0), t, m.start())]


# --- 収集 -------------------------------------------------------------------
def collect(doc):
    """区分ごとの**相異なる文字列**を返す。

    `texts` はプールなので、使用箇所で数えると 1 つの誤訳が使われた回数だけ
    膨らむ。台帳を「直すべきものの一覧」として使うには 1 対 1 でなければならない。
    """
    texts = doc.get("texts") or []

    def t(i):
        return texts[i]["ja"] if isinstance(i, int) and 0 <= i < len(texts) else None

    out = {c: set() for c in CATEGORIES}
    for job in doc.get("jobs", []):
        out["label"].add(job.get("ja") or "")
        for key, cat in (("desc", "desc"),):
            s = t(job.get(key))
            if s is not None:
                out[cat].add(s)
        for arg in job.get("args", []):
            s = t(arg.get("comment"))
            if s is not None:
                out["argComment"].add(s)
        for res in job.get("results", []):
            s = t(res.get("comment"))
            if s is not None:
                out["resultComment"].add(s)
    for f in doc.get("faultText", []):
        s = t(f.get("text"))
        if s is not None:
            out["faultText"].add(s)
    for e in doc.get("envFields", []):
        s = t(e.get("text"))
        if s is not None:
            out["envField"].add(s)
    for items in (doc.get("vocabularies") or {}).values():
        for it in items:
            s = t(it.get("text"))
            if s is not None:
                out["vocabulary"].add(s)
    return {c: sorted(v) for c, v in out.items()}


def measure():
    index = json.load(open(os.path.join(ECU_DIR, "index.json"), encoding="utf-8"))
    per_module, strings = {}, {}
    for m in index["modules"]:
        path = os.path.join(ECU_DIR, f"{m['id']}.jobs.json")
        doc = json.load(open(path, encoding="utf-8"))
        items = collect(doc)
        strings[m["id"]] = items
        row = {}
        for cat in CATEGORIES:
            bad = [s for s in items[cat] if has_leftover_german(s)]
            if bad:
                row[cat] = len(bad)
        per_module[m["id"]] = row
    return per_module, strings


# --- 台帳 -------------------------------------------------------------------
#
# 単一の 1.0% の天井を (モジュール × 区分) の台帳に置き換えた。天井は 3 モジュール
# 全部 0.0% のときに置いた線で、51 モジュールでは「全部赤」にしかならない——全部赤は
# 何も言っていないのと同じで、次に誰かがやるのは天井を上げることである。
#
# **増えたら失敗、減っても失敗しない。** 直すのは普通のコミットであってほしいから。
# ただし減ったまま台帳を書き直さないと改善は固定されないので、そのときは
# --write-baseline を促す（黙らない）。
def load_baseline():
    if not os.path.exists(BASELINE):
        return None
    return json.load(open(BASELINE, encoding="utf-8"))


def write_baseline(per_module):
    total = sum(sum(r.values()) for r in per_module.values())
    doc = {
        "note": ("出荷される日本語に残った独語の件数（相異なる文字列）。"
                 "更新は python tools/verify_translation_quality.py --write-baseline。"
                 "増えたら失敗する。差分はレビュー対象——増やすなら理由をコミットに書くこと。"),
        "generator": "tools/verify_translation_quality.py",
        "categories": list(CATEGORIES),
        "total": total,
        # 0 の欄は書かない。「今きれいな欄が汚れた」を失敗として拾いたいので、
        # 欄が無いこと自体が 0 の主張になっている。
        "modules": {k: dict(sorted(v.items())) for k, v in sorted(per_module.items()) if v},
    }
    tmp = BASELINE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, indent=1)
        f.write("\n")
    os.replace(tmp, BASELINE)
    return total


def main():
    argv = sys.argv[1:]
    per_module, strings = measure()

    # 「検査しない検査」への防波堤。ここが 3 だった頃、対象が消えても緑だった。
    if len(per_module) < 51:
        sys.stderr.write(f"[FATAL] モジュールを {len(per_module)} 件しか読めなかった"
                         f"（51 のはず）。この検査自体が壊れている。\n")
        return 1

    if "--list" in argv:
        i = argv.index("--list")
        mod, cat = argv[i + 1], argv[i + 2]
        if cat not in CATEGORIES:
            sys.stderr.write(f"区分は {', '.join(CATEGORIES)} のいずれか\n")
            return 1
        for s in strings[mod][cat]:
            if has_leftover_german(s):
                print(f"[{' '.join(sorted(set(leftover_words(s))))}] {s}")
        return 0

    if "--write-baseline" in argv:
        old = (load_baseline() or {}).get("total")
        total = write_baseline(per_module)
        if old is None or old == total:
            delta = ""
        else:
            delta = (f"（{old} → {total}、{abs(old - total)} 件"
                     + ("減" if total < old else "増") + "）")
        print(f"wrote {os.path.relpath(BASELINE, os.path.dirname(HERE))}: 合計 {total} 件{delta}")
        return 0

    if "--json" in argv:
        print(json.dumps(per_module, ensure_ascii=False, indent=1))
        return 0

    # --- 人向けの表。0 の欄は出さない ---------------------------------------
    total = sum(sum(r.values()) for r in per_module.values())
    # 見出しは短縮形。正式名は CATEGORIES で、--list はそちらを取る。
    SHORT = {"label": "label", "desc": "desc", "argComment": "arg",
             "resultComment": "result", "faultText": "fault",
             "envField": "env", "vocabulary": "vocab"}
    print(f"{'module':12} " + " ".join(f"{SHORT[c]:>7}" for c in CATEGORIES))
    for mid, row in sorted(per_module.items()):
        if not row:
            continue
        print(f"{mid:12} " + " ".join(f"{row.get(c, 0) or '·':>7}" for c in CATEGORIES))
    by_cat = {c: sum(r.get(c, 0) for r in per_module.values()) for c in CATEGORIES}
    print(f"{'-' * 12} " + " ".join("-" * 7 for _ in CATEGORIES))
    print(f"{'total':12} " + " ".join(f"{by_cat[c]:>7}" for c in CATEGORIES) + f"   = {total}")

    base = load_baseline()
    if base is None:
        sys.stderr.write("[FATAL] 台帳が無い。--write-baseline で作ること。\n")
        return 1

    want = base["modules"]
    up, down = [], []
    for mid in sorted(set(want) | set(per_module)):
        w, n = want.get(mid, {}), per_module.get(mid, {})
        for cat in CATEGORIES:
            a, b = w.get(cat, 0), n.get(cat, 0)
            if b > a:
                up.append(f"{mid}.{cat} {a} -> {b}")
            elif b < a:
                down.append(f"{mid}.{cat} {a} -> {b}")

    if down:
        print(f"\n[改善] {len(down)} 欄が減っている（合計 {base['total']} -> {total}）。"
              f"固定するには:\n    python tools/verify_translation_quality.py --write-baseline")
        for d in down[:10]:
            print(f"    {d}")
        if len(down) > 10:
            print(f"    … 他 {len(down) - 10} 欄")

    if up:
        sys.stderr.write("\n[FATAL] 未訳の独語が増えている:\n"
                         + "".join(f"    {u}\n" for u in up)
                         + "    python tools/verify_translation_quality.py --list <module> <category>\n"
                           "    増やすのが正しいなら --write-baseline で台帳を書き直し、"
                           "理由をコミットに書くこと\n")
        return 1

    print(f"\nok - 51 モジュール × {len(CATEGORIES)} 区分、未訳 {total} 件（台帳 {base['total']} 件以下）")
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
