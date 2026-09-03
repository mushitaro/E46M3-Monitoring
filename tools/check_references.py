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
import hashlib, json, os, sys

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

# --- リポジトリ外のダンプ、コミットされた台帳と照合 --------------------------
#
# ここには以前 SHA-256 が 6 個リテラルで並んでいた。3 モジュールのときは 6 行で
# 足りたが、51 モジュール = 87 ファイルになると手で維持する表になり、維持されない。
# `tools/gen_dump_manifest.py` が書く台帳（中身を持たない——名前・ハッシュ・員数
# だけなので public repo にコミットできる）と照合する。
#
# 台帳は二方向に効く。**台帳→ディスク**はダンプが差し替わったことを教え、
# **ディスク→台帳**はダンプが増えたのに台帳を書き直していないことを教える。
# 後者が要るのは、この台帳が public repo に対して「何がどれだけ欠けているか」を
# 主張しているから——増えた分を黙って落とすと、その主張が静かに偽になる。
MANIFEST = os.path.join(HERE, "SgbdDump", "out.manifest.json")

VERBOSE = "-v" in sys.argv
fails, warns, ran = [], [], 0
provenance_ok: list[str] = []


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

# --- 台帳 → ディスク ---------------------------------------------------------
LEDGER: dict[str, str] = {}
if not os.path.isfile(MANIFEST):
    fails.append(f"ダンプ台帳が無い: {MANIFEST}\n"
                 f"        python tools/gen_dump_manifest.py で書ける")
else:
    ran += 1
    manifest = json.load(open(MANIFEST, encoding="utf-8"))
    LEDGER = {e["path"]: e["sha256"] for e in manifest["dumps"]}
    sizes = {e["path"]: e["bytes"] for e in manifest["dumps"]}
    ok(f"台帳 {os.path.relpath(MANIFEST, ROOT)}  {len(LEDGER)} 件")
    for fname, want in LEDGER.items():
        ran += 1
        p = os.path.join(DUMP_DIR, fname)
        if not os.path.isfile(p):
            fails.append(f"ダンプ {fname} が無い（{DUMP_DIR}）")
            continue
        got = sha256(p)
        if got != want:
            fails.append(f"ダンプ {fname} のハッシュ不一致\n"
                         f"        台帳 {want} ({sizes[fname]:,} B)\n"
                         f"        現物 {got} ({os.path.getsize(p):,} B)\n"
                         f"        再ダンプしたなら python tools/gen_dump_manifest.py も回すこと")
        else:
            ok(f"{fname}  {got[:16]}…")

    # --- ディスク → 台帳 -----------------------------------------------------
    # 台帳に無いダンプは、台帳を書き直さずに増やしたということ。台帳の
    # 「何がどれだけ欠けているか」という主張が黙って偽になる経路はここしかない。
    ran += 1
    extra = sorted(f for f in os.listdir(DUMP_DIR)
                   if f.endswith(".json") and f not in LEDGER)
    if extra:
        fails.append("ダンプが台帳に無い（python tools/gen_dump_manifest.py を回すこと）:\n"
                     + "\n".join(f"        {f}" for f in extra))

# --- 生成物 → 台帳 -----------------------------------------------------------
# 「どのダンプから出たか」を名乗っている生成物を**全部**当たる。以前は 2 件を
# 手で並べていたので、名乗り始めた 50 個目の生成物は誰にも見られていなかった。
# 名簿を持たないことがここでは正しい——名乗っているものが対象、という規則で足りる。
for fname in sorted(os.listdir(ECU_DATA)):
    if not fname.endswith(".json"):
        continue
    with open(os.path.join(ECU_DATA, fname), encoding="utf-8") as f:
        doc = json.load(f)
    gen = (doc.get("generatedFrom") or {}) if isinstance(doc, dict) else {}
    claimed, dump = gen.get("dumpSha256"), gen.get("dump")
    if not claimed:
        continue
    ran += 1
    if dump not in LEDGER:
        fails.append(f"{fname} が台帳に無いダンプを名乗っている: {dump}")
    elif claimed != LEDGER[dump]:
        fails.append(f"{fname} は古いダンプから作られている\n"
                     f"        主張 {claimed}\n"
                     f"        現物 {LEDGER[dump]} ({dump})\n"
                     f"        再生成が要る")
    else:
        provenance_ok.append(fname)
        ok(f"{fname} ← {dump}")

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

print(f"ok - 参照物 {ran} 件（外部 {len(EXTERNAL)} 種・ダンプ {len(LEDGER)} 件・"
      f"出所を名乗る生成物 {len(provenance_ok)} 件）"
      + (f" / WARN {len(warns)} 件" if warns else ""))
