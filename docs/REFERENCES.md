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

ダンプの SHA256（`check_references.py` が突き合わせる）:

```
10cfdd8ed5ba084463bfd4cb3987a9c5615d2c7c067c14665df399c7b2e2dbe9  MSS54DS0.json
be85f6362bffe427513f104c64c51dcb56ef3b318a2f11ce8e53ca90307644f1  SMG2.json
7ea3e00f6a9513a2844b9ad5aad7f44e0b780c7801f8d0626e94689d1a1d0197  DSC_E46.json
bf26e507634898272e53a4607be68bd76f31a0a394d762d2f1f00eac1f811d3d  mss54.telegrams.json
a5142fcdf816f302ce74901576c9e0f6a5de6e6615f77ab0289c3da115a9939d  smg2.telegrams.json
b689200fd988278b9b4d5490f97f16164f272c1482c3670a455d85b1f8bf3e0a  dsc_e46.telegrams.json
```

`MSS54DS0.json` と `DSC_E46.json` のハッシュは
`public/ecu-data/mss54.jobs.json` と `dsc_e46.hydraulics.json` の `generatedFrom.dumpSha256`
にも書かれていて、一致することを確認済み。生成物が **どのダンプから出たか** を主張できる。

---

## 3. 何がどれを書くか

| 生成器 | 入力 | 出力 |
|---|---|---|
| `tools/SgbdDump/Program.cs` | #1 ＋ #2（EdiabasLib 経由） | `$SGBD_DUMP_DIR/<SGBD>.json` |
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
**アプリが読んでいない**。今も読んでいるのは `verify_translation_quality.py` だけ。

検査側:

| 検査 | 何を見るか |
|---|---|
| `verify_ecu_data.py` | `TOTAL_JOBS = 323`, `TOTAL_RESULTS = 2311` などの不変条件 |
| `verify_translation_quality.py` | 出力 JSON の `ja` に残った独語の割合（上限 1.0%） |
| `check_ui_tokens.mjs` | ///M のトークン規則（型サイズ・枠線・行の作法） |
| `check_references.py` | **この文書**（外部 5 件の存在と、ダンプ 6 件のハッシュ） |

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
