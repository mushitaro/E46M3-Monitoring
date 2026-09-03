#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  check_references.py — docs/REFERENCES.md が現実と一致しているかを検査する。
#
#  この repo の「正」は 5 つが外部にあり、うち 1 つ（逆コンパイル済みカタログ）は
#  中間生成物を持たない。所在が散らばっていたので docs/REFERENCES.md に集めたが、
#  **文書は必ず古くなる**。ここが古くなったことを教える側。
#
#  設計上の一点: verify_translation_quality.py は以前、対象 3 ファイルが
#  「見つからなければ continue」で全部飛ばし、ヘッダだけ出して exit 0 していた
#  ——何も検査しない検査。だから下の RAN カウンタがあり、1 件も走らなければ失敗する。
#
#  使い方: python tools/check_references.py [-v]
# ============================================================================
import hashlib, os, sys

# stdout **と stderr の両方**。失敗の本文は stderr に出るので、片方だけ直すと
# 「緑のときは読めるが、赤いときだけ文字化けする」——一番読みたい瞬間に読めなくなる。
for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, "reconfigure"):
        _s.reconfigure(encoding="utf-8")  # cp932 で日本語が落ちるのを防ぐ

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import paths                                                # noqa: E402

DUMP_DIR = paths.SGBD_DUMP_DIR   # リポジトリ外。理由は tools/paths.py
ECU_DATA = os.path.join(ROOT, "public", "ecu-data")

# --- 外部の正 ---------------------------------------------------------------
# (見出し, 環境変数, 既定パス, 種別, 補足)
# 種別 'dir' / 'file'。環境変数が設定されていればそちらを見る——生成器と同じ規則で
# 見ないと、生成器が読める場所を検査が「無い」と言う羽目になる。
EXTERNAL = [
    ("SGBD バイナリ", "EDIABAS_ECU_DIR", r"C:\EDIABAS\ECU", "dir",
     ["MSS54DS0.prg", "SMG2.prg", "DSC_E46.prg"]),
    ("EDIABAS シミュレーション", "EDIABAS_SIM_PATH", r"C:\EDIABAS\SIM", "dir", []),
    ("EdiabasLib (GPLv3)", "EDIABASLIB_PATH", r"C:\EC-APPS\ediabaslib", "dir",
     [os.path.join("EdiabasLib", "EdiabasLib", "EdiabasLib.csproj")]),
    ("逆コンパイル済みカタログ", "MSS54_CATALOG_DIR",
     r"C:\Users\kazuh\MSS54-DS2-Tool-Public-1.2.1\decompiled-source\Core\Mss54Ds2Tool.Core",
     "dir", ["DmeLiveValueCatalog.cs", "DmeAdaptationProfiles.cs"]),
    ("INPA 画面ソース (文書用のみ)", "INPA_SGDAT_DIR", r"C:\EC-APPS\INPA\SGDAT", "dir",
     ["SMG2.IPO"]),
]

# 文書用のみの参照は、欠けても再生成は止まらない。WARN であって FAIL ではない。
ADVISORY = {"INPA 画面ソース (文書用のみ)"}

# --- repo 内のダンプ ---------------------------------------------------------
DUMPS = {
    "MSS54DS0.json":           "10cfdd8ed5ba084463bfd4cb3987a9c5615d2c7c067c14665df399c7b2e2dbe9",
    "SMG2.json":               "be85f6362bffe427513f104c64c51dcb56ef3b318a2f11ce8e53ca90307644f1",
    "DSC_E46.json":            "7ea3e00f6a9513a2844b9ad5aad7f44e0b780c7801f8d0626e94689d1a1d0197",
    "mss54.telegrams.json":    "bf26e507634898272e53a4607be68bd76f31a0a394d762d2f1f00eac1f811d3d",
    "smg2.telegrams.json":     "a5142fcdf816f302ce74901576c9e0f6a5de6e6615f77ab0289c3da115a9939d",
    "dsc_e46.telegrams.json": "b689200fd988278b9b4d5490f97f16164f272c1482c3670a455d85b1f8bf3e0a",
}

# 生成物が「どのダンプから出たか」を主張している箇所。ダンプを差し替えて
# 再生成し忘れると、ここだけが古い値のまま残る。
PROVENANCE = [
    ("mss54.jobs.json", "MSS54DS0.json"),
    ("dsc_e46.hydraulics.json", "DSC_E46.json"),
]

VERBOSE = "-v" in sys.argv
fails, warns, ran = [], [], 0


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def ok(msg):
    if VERBOSE:
        print(f"  ok    {msg}")


for name, env, default, kind, members in EXTERNAL:
    ran += 1
    path = os.environ.get(env) or default
    src = f"${env}" if os.environ.get(env) else "既定"
    exists = os.path.isdir(path) if kind == "dir" else os.path.isfile(path)
    if not exists:
        (warns if name in ADVISORY else fails).append(
            f"{name}: {path} が無い（{src}。{env} で場所を指定できる）")
        continue
    ok(f"{name}  {path}  ({src})")
    for m in members:
        ran += 1
        p = os.path.join(path, m)
        if not os.path.isfile(p):
            (warns if name in ADVISORY else fails).append(f"{name}: {p} が無い")
        else:
            ok(f"  {m}  {os.path.getsize(p):,} B")

for fname, want in DUMPS.items():
    ran += 1
    p = os.path.join(DUMP_DIR, fname)
    if not os.path.isfile(p):
        fails.append(f"ダンプ {fname} が無い（{DUMP_DIR}）")
        continue
    got = sha256(p)
    if got != want:
        fails.append(f"ダンプ {fname} のハッシュ不一致\n"
                     f"        期待 {want}\n"
                     f"        実際 {got}\n"
                     f"        再ダンプしたなら docs/REFERENCES.md §2 の表も直すこと")
    else:
        ok(f"{fname}  {got[:16]}…")

for generated, dump in PROVENANCE:
    ran += 1
    p = os.path.join(ECU_DATA, generated)
    if not os.path.isfile(p):
        fails.append(f"生成物 {generated} が無い（{ECU_DATA}）")
        continue
    import json
    with open(p, encoding="utf-8") as f:
        claimed = (json.load(f).get("generatedFrom") or {}).get("dumpSha256")
    if claimed is None:
        fails.append(f"{generated} に generatedFrom.dumpSha256 が無い")
    elif claimed != DUMPS[dump]:
        fails.append(f"{generated} は古いダンプから作られている\n"
                     f"        主張 {claimed}\n"
                     f"        現物 {DUMPS[dump]} ({dump})\n"
                     f"        再生成が要る")
    else:
        ok(f"{generated} ← {dump}")

# 「検査しない検査」への防波堤。
if ran == 0:
    sys.stderr.write("[FATAL] 検査が 1 件も走らなかった。この検査自体が壊れている。\n")
    sys.exit(1)

for w in warns:
    print(f"[WARN]  {w}")
if fails:
    sys.stderr.write("\n[FATAL] 参照物の検査に失敗:\n")
    for f_ in fails:
        sys.stderr.write(f"    {f_}\n")
    sys.stderr.write("\n    所在の一覧は docs/REFERENCES.md\n")
    sys.exit(1)

print(f"ok - 参照物 {ran} 件（外部 {len(EXTERNAL)} 種・ダンプ {len(DUMPS)} 件・出所 {len(PROVENANCE)} 件）"
      + (f" / WARN {len(warns)} 件" if warns else ""))
