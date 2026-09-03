# 参照物の所在

このリポジトリが依存している「正」がどこにあるか。**5 つは repo の外にある。**

散らばっていたので 1 枚にした。以前は `tools/*.py` の定数と `.csproj` の
`<EdiabasLibPath>` と `gearWindows.ts` のコメントに分かれていて、全体像を
持っている場所が無かった。

機械検査は `tools/check_references.py`。この文書が古くなったら **落ちる**。

---

## 1. repo の外にあるもの

| # | もの | 実パス | 読むもの | 環境変数 | 失うと |
|---|---|---|---|---|---|
| 1 | SGBD バイナリ | `C:\EDIABAS\ECU\` | `SgbdDump/Program.cs`, `extract_telegrams.py`, `gen_live_blocks.py`, `gen_from_dump.py` | `EDIABAS_ECU_DIR` / `EDIABAS_ECU_PATH` | 再ダンプ・テレグラム再抽出・故障本文抽出が **不可** |
| 2 | EDIABAS シミュレーション | `C:\EDIABAS\SIM` | `SgbdDump/Program.cs` | `EDIABAS_SIM_PATH` | 再ダンプ **不可**（`Simulation=1` が無いと仮想ジョブでも `IFH-0018`） |
| 3 | EdiabasLib（GPLv3） | `C:\EC-APPS\ediabaslib` | `tools/SgbdDump/SgbdDump.csproj` の **ビルド時のみ** | `-p:EdiabasLibPath=<path>` | `SgbdDump.exe` の再ビルド不可。github.com/uholeschak/ediabaslib から再取得できる |
| 4 | 逆コンパイル済みカタログ | `C:\Users\kazuh\MSS54-DS2-Tool-Public-1.2.1\decompiled-source\Core\Mss54Ds2Tool.Core\` | `gen_live_blocks.py`, `gen_adaptation_blocks.py` | `MSS54_CATALOG` / `MSS54_ADAPTATIONS` | **最も危険。下記参照** |
| 5 | INPA 画面ソース | `C:\EC-APPS\INPA\SGDAT\SMG2.IPO` | **無し**（`src/lib/gearWindows.ts:57` が出典として引用するだけ） | — | 影響なし。内容は手写し済み |

### #1 の内訳

`MSS54DS0.prg` 824,810 B ／ `SMG2.prg` 535,906 B ／ `DSC_E46.prg` 231,805 B（いずれも 2021-09-18）。
`C:\EDIABAS\ECU` 全体では 2,357 ファイル。BMW の所有物であり、**このリポジトリには入れない**
（`THIRD-PARTY-NOTICES.md` §3.1）。`.gitattributes` は `*.prg binary` を宣言しているが、
一致するファイルは 1 つも無い。これは意図どおり。

### #4 が一番危ない

`DmeLiveValueCatalog.cs`（17,342 B）と `DmeAdaptationProfiles.cs`（14,277 B）。
**ライブ値 213ch と適応ブロックの、バイト位置・データ形式・スケール係数の唯一の出所**で、
SGBD からは復元できない（SGBD はジョブと結果の名前しか公表していない）。

他の外部入力と違い、**この 2 つには repo 内の中間生成物が無い。**
`gen_live_blocks.py` と `gen_adaptation_blocks.py` は毎回この `.cs` を直接読む。
失えば `packages/ds2-mss54/src/liveValueBlocks.generated.ts` と
`adaptationBlocks.generated.ts` は二度と再生成できず、手編集しか道が無くなる。

対して #1 の SGBD は `tools/SgbdDump/out/*.json` としてコミット済みなので、
`C:\EDIABAS` を失っても **今あるものは作り直せる**。再ダンプができなくなるだけ。

repo に取り込むかどうかは、逆コンパイル物であるためライセンス面の判断が要る
（`THIRD-PARTY-NOTICES.md` §3.2）。**未決。**

### EC-APPS の残り

`INPA` / `NFS` / `BMWCodingTool` / `FindECU` はこのリポジトリのどのスクリプトも読まない。

前身の PWA は 2026-08-30 に `C:\EC-APPS\OldBMW-Diag-PWA` から
**`C:\Users\kazuh\OldBMW-Diag-PWA`** へ移した（参照用であり、ビルド入力ではない）。
BMW ツールチェーンの導入物として `C:\EC-APPS` に置いてある。`C:\EDIABAS` も同じ理由で動かさない
（`EDIABAS.INI` とレジストリが実パスを持っている）。

---

## 2. repo の中にある「正」

> **この節の見出しは「repo の中」だが、上の 2 行はもう repo の中に無い。**
> repo が public になった時点で、SGBD ダンプとその派生物はコミットできなくなった
> （BMW SGBD 由来。`THIRD-PARTY-NOTICES.md` §3）。置き場は `$SGBD_DUMP_DIR`
> （既定 `C:\EDIABAS-derived\sgbd-dumps`）で、理由は `tools/paths.py` に書いてある。
> 用語表 `tools/terms/` も同じ理由で ignore されている。

| もの | パス | 性質 |
|---|---|---|
| SGBD ダンプ | `$SGBD_DUMP_DIR/<SGBD>.json`（51 モジュール分＋除外候補） | **repo の外。** BMW SGBD 由来なのでコミットしない |
| テレグラム抽出 | `$SGBD_DUMP_DIR/{mss54,smg2,dsc_e46}.telegrams.json` | 同上 |
| 用語表 | `tools/terms/*.py` | 手書き。SGBD の独語原文を含むので ignore。失っても再生成は通るが、訳が機械翻訳まで劣化する |
| ライブ値の和名 | `tools/terms/live_channels.py` | 手書き 213ch ＋ ブロック名 8。**機械生成できない**（英→日の経路をこの repo は持たない） |
| 注意文 | `tools/jobtext/cautions.py` ＋ `jobtext/overrides/*` | `gen_jobtext.py` は高リスク/不可逆ジョブに注意文が無いと非ゼロ終了する |
| 分類規則 | `tools/sgbd/{classify,model,specs}.py` | ジョブの risk / class の単一の正 |
| 実車記録 | `recordings/m3-{mss54,smg2}-real.json` | テスト用。生成器の入力ではない |

### ダンプの台帳 — `tools/SgbdDump/out.manifest.json`

ダンプ本体は repo の外にあるが、**台帳はコミットされている**。名前・SHA-256・
バイト数・ジョブ数・テーブル数だけで、SGBD の文字列は 1 つも入らない。だから
public repo を clone した人が、**何がどれだけ欠けているか**を形と大きさで確認できる。

87 ファイル（51 モジュール＋装備違いの候補＋テレグラム抽出 3 件）。更新は
`python tools/gen_dump_manifest.py` で、差分はレビュー対象。

ここには以前 SHA-256 が 6 個、この文書とチェッカーの両方にリテラルで並んでいた。
3 モジュールのうちは 2 箇所 × 6 行で足りたが、51 では手で維持する表になり、
維持されなくなる。**同じ値を 2 箇所に書くのをやめた**のがこの台帳である。

`check_references.py` はこれを**二方向**に使う。台帳→ディスクでダンプが差し替わった
ことを、ディスク→台帳で**台帳を書き直さずにダンプを増やした**ことを検出する。後者が
無いと、上の「何がどれだけ欠けているか」という主張が黙って偽になる。

あわせて、`generatedFrom.dumpSha256` を名乗る生成物 **52 件**（`*.jobs.json` 51 ＋
`dsc_e46.hydraulics.json`）を全部その場で照合する。以前は 2 件を手で並べていたので、
名乗り始めた 50 個目の生成物は誰にも見られていなかった。

**台帳に入っていない 2 つの欄。** `dumpedAt` と `sgbdSha256`（元の `.prg` のハッシュ）
はダンプ側が名乗っていないので、台帳には作れない——作ればそれは我々がでっち上げた値
になる。SgbdDump を直して全数を取り直したときに入る。それまでは「どのダンプから出たか」
は言えるが、「そのダンプがいつ、どの `.prg` から出たか」は言えない。

---

## 3. 何がどれを書くか

| 生成器 | 入力 | 出力 |
|---|---|---|
| `tools/SgbdDump/Program.cs` | #1 ＋ #2（EdiabasLib 経由） | `$SGBD_DUMP_DIR/<SGBD>.json` |
| `gen_dump_manifest.py` | `$SGBD_DUMP_DIR/*.json` | `tools/SgbdDump/out.manifest.json`（**コミットされる**） |
| `extract_telegrams.py` | #1 | `$SGBD_DUMP_DIR/<id>.telegrams.json` |
| `gen_ecu_data.py` | ダンプ ＋ `sgbd/*` ＋ `translate.py` | `public/ecu-data/<id>.jobs.json`, `index.json` |
| `gen_smg2_workflows.py` | `SMG2.json` | `public/ecu-data/smg2-workflows.json` |
| `gen_dsc_hydraulics.py` | `DSC_E46.json` ＋ `dsc_e46.telegrams.json` | `public/ecu-data/dsc_e46.hydraulics.json` |
| `jobtext/gen_jobtext.py` | `<id>.jobs.json` ＋ `cautions.py` | `public/ecu-data/<id>.jobtext.json` |
| `gen_live_blocks.py` | **#4** ＋ `MSS54DS0.json` ＋ #1 ＋ `terms/live_channels.py` | `packages/ds2-mss54/src/liveValueBlocks.generated.ts` |
| `gen_adaptation_blocks.py` | **#4** ＋ `MSS54DS0.json` | `packages/ds2-mss54/src/adaptationBlocks.generated.ts` |
| `gen_from_dump.py` | ダンプ ＋ #1（故障本文のみ） | `public/ecu-data/<id>.json`（**旧 schema**） |
| `gen_icons.py` | 無し（幾何はコードに直書き） | `public/icon-{192,512}.png` |

`gen_from_dump.py` の 3 出力（`mss54.json` / `smg2.json` / `dsc_e46.json`）は
**アプリが読んでいない**。唯一の読者だった `verify_translation_quality.py` が
schema 2 に向き直したので、**読者はもういない**。退役させる。

検査側:

| 検査 | 何を見るか |
|---|---|
| `verify_ecu_data.py` | モジュール毎の出力数 == ダンプの `jobCount`、＋ `tools/ecu_data_counts.json` との員数照合 |
| `verify_translation_quality.py` | **`<id>.jobs.json` の `ja` に残った独語**（51 モジュール × 7 区分、`tools/translation_baseline.json` から増えたら失敗） |
| `check_ui_tokens.mjs` | ///M のトークン規則（型サイズ・枠線・行の作法） |
| `check_references.py` | **この文書**（外部 5 件の存在、ダンプ台帳 87 件、出所を名乗る生成物 52 件） |
| `check_term_scope.py` | 族の用語ファイルが、族外の SGBD の識別子を主張していないこと |
| `jobtext/gen_jobtext.py --check` | 高リスク/不可逆ジョブに注意文があること、＋生成物がディスクと一致すること |

---

## 4. 既知の穴

直っていない。踏む前に読むこと。

**(a) `out/` → `public/ecu-data/` のコピーを行うスクリプトが無い。**
`tools/SgbdDump/out/*.telegrams.json` と `public/ecu-data/*.telegrams.json` は
現在バイト一致している（`cmp` で確認済み）が、これは**手でコピーした結果**であって、
そうし続ける仕組みは無い。`extract_telegrams.py` を再実行してもアプリには届かない。

**(b) 生成パイプラインは CI で一度も走っていない。**
`.github/workflows/ci.yml` の `data-pipeline` ジョブは `if: false` で無効
（コメント: "enable once `C:\EDIABAS` and the reference catalog are on a runner"）。
`C:\EDIABAS` と #4 はローカルにしか無いので、これは正しい判断だが、**結果として
生成物のドリフトを検知する仕組みが存在しない**。`verify_ecu_data.py` もワークフローに
繋がっていない。
