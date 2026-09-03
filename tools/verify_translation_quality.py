#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  verify_translation_quality.py — ecu-data/*.json の「未訳の独語残り」を定量測定する。
#  gen_from_dump.py / gen_smg2_workflows.py 再生成後に実行し、対策前後の
#  label/desc/faultText 各カテゴリの残存率(%)を比較する。
#  ※ translate.py の内部(leftover_ratio)には依存しない — 出力JSONのja文字列を
#     外形的に検査することで、生成ロジック自体のバグも検出できるようにする
#    （生成側と同じロジックで自己採点しない）。
#  使い方: python tools/verify_translation_quality.py [--json] [--list mss54 faultText]
# ============================================================================
import json, os, re, sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")  # Windowsコンソール(cp932)でüäö等が落ちるのを防ぐ

HERE = os.path.dirname(__file__)
# データは public/ecu-data に移した。ここが古いままだったため、この検査は
# 「ファイルが無ければ continue」で3件とも黙って飛ばし、ヘッダだけ出して
# exit 0 していた——何も検査しない検査。下の「1件も読めなければ失敗」が
# その再発を止める。
ECU_DIR = os.path.join(HERE, "..", "public", "ecu-data")
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

# 現状は9区分すべて 0.0%。上限は 1.0% ——1件混ざれば気付くが、1件で赤にはしない。
# 下げるのは歓迎。**上げるときは、なぜ上げたのかをここに書くこと。**
CEILING = 1.0


# 16進リテラル。`0x00-0xFF` の `xFF` を独語と数えていた。
_HEX_LITERAL = re.compile(r"0[xX][0-9a-fA-F]+")


def _is_leftover(word, whole):
    if word.upper() in ALLOW or word.upper() in _UNITS:
        return False
    if any(word in m for m in _HEX_LITERAL.findall(whole)):
        return False
    # 語そのものが全大文字なら識別子。周囲の `_` も識別子の一部として見る。
    if _IDENTIFIER.match(word):
        return False
    return True


def has_leftover_german(ja_text):
    t = ja_text or ""
    return any(_is_leftover(w, t) for w in _LATIN_RUN.findall(t))


def pct(items):
    return round(100 * sum(1 for s in items if has_leftover_german(s)) / len(items), 1) if items else 0.0


def collect(d):
    labels, descs = [], []
    for g in d.get("groups", []):
        for p in g.get("params", []):
            labels.append(p.get("ja", ""))
            if p.get("desc"): descs.append(p["desc"].get("ja", ""))
    for a in d.get("actuators", []) + d.get("testJobs", []):
        labels.append(a.get("ja", ""))
        if a.get("desc"): descs.append(a["desc"].get("ja", ""))
    faults = [f.get("ja", "") for f in d.get("faultText", [])]
    return labels, descs, faults


def main():
    results = {}
    for fname in ("mss54.json", "smg2.json", "dsc_e46.json"):
        path = os.path.join(ECU_DIR, fname)
        if not os.path.exists(path):
            sys.stderr.write(f"[FATAL] {path} not found — this check would measure nothing.\n")
            return 1
        d = json.load(open(path, encoding="utf-8"))
        labels, descs, faults = collect(d)
        results[fname[:-5]] = {
            "label": pct(labels), "label_n": len(labels),
            "desc": pct(descs), "desc_n": len(descs),
            "faultText": pct(faults), "faultText_n": len(faults),
        }
    if "--list" in sys.argv:
        i = sys.argv.index("--list"); mod, cat = sys.argv[i + 1], sys.argv[i + 2]
        d = json.load(open(os.path.join(ECU_DIR, mod + ".json"), encoding="utf-8"))
        items = dict(zip(("label", "desc", "faultText"), collect(d)))[cat]
        for s in items:
            if has_leftover_german(s): print(s)
        return
    if "--json" in sys.argv:
        print(json.dumps(results, ensure_ascii=False, indent=1)); return
    print(f"{'module':10} {'label%':>8} {'desc%':>8} {'fault%':>8}   (n=label/desc/fault)")
    for mod, r in results.items():
        print(f"{mod:10} {r['label']:>7}% {r['desc']:>7}% {r['faultText']:>7}%   "
              f"(n={r['label_n']}/{r['desc_n']}/{r['faultText_n']})")

    # --- 上限。ここを超えたら失敗する ------------------------------------
    #
    # 「測っているが誰も見ていない」が、この検査がパスを間違えたまま何ヶ月も
    # 緑だった理由である。数字を出すだけでは同じことが起きる。現状値のすぐ上に
    # 上限を置いて、悪化したらビルドを止める。
    #
    # 下げるのは歓迎。**上げるときは、なぜ上げたのかをここに書くこと。**
    over = [f"{mod}.{cat} {r[cat]}% > {CEILING}%"
            for mod, r in results.items()
            for cat in ("label", "desc", "faultText")
            if r[cat] > CEILING]
    if over:
        sys.stderr.write("[FATAL] untranslated German is above the ceiling:\n"
                         + "".join(f"    {o}\n" for o in over)
                         + "    python tools/verify_translation_quality.py --list <module> <category>\n")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
