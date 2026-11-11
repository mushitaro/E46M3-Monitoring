# 装備 — どの SGBD を載せ、どれを載せないか

`$SGBD_DUMP_DIR` には ECU のダンプが **63** ある。アプリが持つモジュールは **51**。
差の 12 について、この文書と `tools/sgbd/fitment.py` が理由を持つ。

機械可読な表は `tools/sgbd/fitment.py`。`check_references.py` が
**「ダンプ 1 個につき、モジュールか除外理由のどちらかが必ずある」**ことを検査するので、
新しいダンプを置いた人は、使うか、使わない理由を書くかを迫られる。**黙って落とす経路は無い。**

---

## なぜこの文書があるか

前身アプリでは、除外は `gen_from_dump.py` のヘッダ 23-26 行に散文で書かれていた。
6 件分の理由があり、実際に除外されていたのは 11 件だった。差の 5 件は理由ごと存在しなかった。

そのうちの 1 件が `ASCMK20` で、理由の欄にはこう書かれていた:

> ASCMK20（従来決定どおり）

これは理由ではない。そして**この一言が、前期 E46 M3 の 0x56 を丸ごと落としていた**。
実測すると `ASCMK20` は 0x56 でトレース検証済み、9 テーブル
（`FORTTEXTE`・`FUMWELTMATRIX`・`FUMWELTTEXTE`・`STEUERN`・`RAEDER` ほか）、ECU 文字列は
`ABS/ASC, ITT_Industries, MK20E_I, E36,E46`。載っていないどころか、**E46 だと自分で名乗っていた**。

散文のヘッダは、書き忘れても誰も気付かない。表と検査にしたのはそのためである。

---

## 1. 0x56 — 年式で入れ替わる 2 つ

同じアドレスに 2 つの SGBD がぶら下がり、**同時装着は無い**。既存の `fit` 機構で両載せする。

| id | SGBD | fit | ECU 文字列 | 裏付け |
|---|---|---|---|---|
| `ascmk20` | `ASCMK20.prg` | `early`（前期 MK20） | `ABS/ASC, ITT_Industries, MK20E_I, E36,E46` | 実送信 `56 04 00` |
| `dsc_e46` | `DSC_E46.prg` | `late`（後期） | `Antiblockiersystem u. Dynamisches Stabilitaets Controll E46` | 実送信 `56 04 00` |

両方の ECU が COMMENT で同じことを述べている——`Keine Diagnose bei V > 6 km/h`。
その一文は 2 つとも `index.json` の `note` に載っている。

> **ここは長く穴だった。** `dsc_e46` は 51 モジュールの中で唯一、実送信テレグラムの
> 裏付けが無く、0x56 という値は `gen_ecu_data.py` の宣言でしかなかった。
> `python tools/dump_modules.py DSC_E46` で埋めた: `56 04 00`、宣言と一致。
>
> 同じ実行を全 63 件に広げたところ、**`_addresses.json` に載っていなかったのは
> `DSC_E46` だけではなかった**——`MSS54DS0`（0x12）と `SMG2`（0x32）、つまり主力の
> 2 モジュールも入っていなかった。dump_modules.py より前に手でダンプしたからで、
> 誰も気付いていなかった。3 件とも宣言どおりの値が出て、**51 モジュールの宣言
> アドレスと実測テレグラムの食い違いは 0 件**。台帳は 59 → 63 件になった。

---

## 2. プロトコルが違う — 2 件

### `DSC_MK60` — 2026-11-10 に一覧へ入れた（下は当時の記録）

> **訂正（2026-11-10）。** 運営者の車の DSC がこれだった（`0x56` の DSC_E46 は答えない）。
> PC で `DSC_MK60.prg` を EDIABAS のシミュレーションで動かすと、INITIALISIERUNG が選ぶ通信方式は
> **DS2（concept 0x0006、9600 8E1、初期化なし、末尾 XOR）**で、その上に KWP2000 の形の電文を載せていた。
> 下の「DS2 しか話さないので届かない」は**半分違った**——回線は同じで、違うのは電文の形（長さが
> 4 バイト目、答えは `byte[3] + 5`）だけである。0xB8 は線上の先頭バイト（DS2 の宛先の位置）、
> KWP の宛先は 0x29。証拠はデータリポジトリの `sgbd-dumps/DSC_MK60.telegrams.json`。
> アプリは識別と故障の読み取りだけを、停車中だけ送る（`packages/monitoring-engine/src/kwpOnDs2.ts`）。答えは実車でまだ見ていない。

63 件のうち 61 の IDENT が 3 バイトの DS2（`<アドレス> 04 00`）なのに対し、
KWP2000 を送るのは 2 件だけで、そのうちの 1 つがこれである:

```
DSC_MK60   addr 0xB8   ident_tele  B8 29 F1 02 1A 80
```

6 バイト、宛先 0xB8、KWP2000。**このアプリは DS2 しか話さないので届かない。**

前身アプリはこれを「この車両の DS2 DSC ではない」と記録していた。**半分違う。**
SGBD 自身は E46 だと名乗っている:

```
ECU:     Dynamische Stabilitaets Control DSC E46,R50,E85
COMMENT: Version Conti_Teves MK60 DSC3 E46(ASC/DSC), R50(ABS/ASC/DSC), E85 DSC
```

車が違うのではなく、**話す言葉が違う**。除外の理由としてはそちらのほうが強い——
装備の推測を一切挟まずに済むからである。（この repo が DS2 専用である理由は
`README.md`、K-Line の配線は `docs/CONNECT-VEHICLE.md`。）

### `10flash`

ECU ではない。**ECU 文字列が自分でそう名乗っている**:

```
ECU: Spezial SGBD nur zum flashen eines SG's
```

ジョブも `FLASH_PARAMETER_LESEN` / `MOST_CAN_GATEWAY_ENABLE` /
`ACCESS_TIMING_PARAMETER` の類。加えて IDENT は `82 00 F1 1A 80`——DSC_MK60 と同じ
KWP2000 で、宛先は 0x82。DS2 のこのアプリからは届かない。WinKFP の領分。

> ここには当初「診断アドレスを持たない。63 個のダンプの中で唯一 `_addresses.json` に
> 載らない」と書いていた。**根拠が逆立ちしていた**——載っていなかったのは
> アドレスが無いからではなく、誰も測っていなかったからである。台帳に無いことを
> 事実の不在として読むと、こうなる。

---

## 3. E46 M3 に載っていない装備 — 6 件

理由は前身アプリのヘッダから移した。どれも SGBD が述べていることではなく、
人が装備から判断したこと（`provenance: authored`）。

| SGBD | アドレス | 代わりに載っているもの | 理由 |
|---|---|---|---|
| `EWS` | 0x44 | `ews3` / `ews3d` | EWS2。E46 M3 非搭載 |
| `IHKR46` | 0x5B | `ihka46` / `_2` / `_3` | マニュアルエアコン。M3 は IHKA が標準 |
| `MRS4RD` | 0xA4 | `mrs3` / `mrs4` | E83（X3）用 |
| `DWS` | 0x70 | `rdc` | 空気圧警告。M3 の 0x70 は RDC |
| `GR2` | 0xA6 | *（0xA6 は空）* | 独立クルーズ ECU。M3 のクルーズは DME 内蔵 |
| `EKP_DS2` | 0x65 | *（0x65 は空）* | 電子燃料ポンプ制御。M3 の燃料ポンプはリレー駆動 |

---

## 4. 理由が記録されていない — 4 件

`provenance: unrecorded`。**引き継いだ決定で、根拠が残っていない。**

| SGBD | アドレス | ECU 文字列 | 採ったもの |
|---|---|---|---|
| `SM46` | 0x72 | `SM46`（rev 1.00。チャンネル数も車種も名乗らない） | `sm46_4` |
| `SM46_3` | 0x72 | `3-Kanal Sitzmemory E46/E85` | `sm46_4`（`4-Kanal Sitzmemory E46`） |
| `SM46C_4` | 0x72 | `Sitzmemory E46 Cabrio` | `sm46c_5`（**同じ文字列**） |
| `B_SM46_3` | 0xDA | `3-Kanal Beifahrer-Sitzmemory E46/E85` | `b_sm46_4`（`4-Kanal …`） |

どれも 0x56（`ascmk20` / `dsc_e46`）や 0x5B（`ihka46` / `_2` / `_3`）と同じ形——
同一アドレスに複数がぶら下がる——なので、**本来は `fit` の候補**である。

**何が違うのかは実測で分かった。** ECU 文字列が言っているのは世代ではなく
**チャンネル数**で、3ch と 4ch は別のハードウェアである（`SM46C_4` と `SM46C_5` だけは
文字列が一字一句同じで、こちらは本当に SGBD の版違い）。3ch も 4ch も自分で E46 だと
名乗っているので、**どちらも載りうる**。

それでも `unrecorded` のままにする。分かったのは「何が違うか」であって「この車が
どちらか」ではない。

**推測で埋めない。** それらしい理由を書けば `unrecorded` は 0 になるが、それは
数字が良くなっただけで、根拠は増えていない。`unrecorded` を 0 にする正しい手は、
実車の 0x72 / 0xDA に IDENT を送って、返ってきた ECU 文字列を読むことである。

---

## 5. どのモジュールがいるかは IDENT で選ぶ（2026-11-10）

上の表は「E46 M3 に何が付いているか」で、一覧そのものが M3 のものである。非 M3 の E46
（DS2 の世代: M52/M54 の MS42/MS43、M43、GS20 の AT）では、同じアドレスに別のモジュールがいる。
それまでのアプリは、どの車でも 0x12 に MSS54 の、0x32 に SMG II の電文を送り、0x12 の答えを
MSS54 として解いていた。

EDIABAS はアドレスごとのグループファイル（`D_0012.grp` など）の IDENTIFIKATION で変種を選ぶ:
共通の IDENT（`<addr> 04 00`）を送り、答えのバイトで表を引く。アプリも同じことをする。

- **規則**は `tools/sgbd/gen_variants.py` の `RULES`。どのバイトをどの順にどの表で引くかは、
  グループファイルの逆アセンブル（EdiabasLib の `Tools/BESTDIS`）を読んで書いた。表の中身は
  グループファイルから取る（`SgbdDump --tables`）。
  - `D_0012`（エンジン）: 答えの 3..9（部品番号）で `HW7_Tabelle`、なければ 10..11＋14..15
    （HW＋診断インデックス）で `HW2_DIAG_Tabelle`、なければ 10..11 で `HW2_Tabelle`。
    状態が 0xA0 でなければ KWP2000 の道（ME9・MS45）で、この段では送らない。
  - `D_0032`（変速機）: 10..11 で `SGBD` 表。"22" だけ 14 で GS836/GS832 に分かれる。
    見つからなければ表の最後の行 `XYZ`（SGBD ではなく「見つからない」の印）。
- **決めるのは EDIABAS。** 生成器は答えの束（表の全行・小文字・NUL・短い答え・否定応答・乱数、
  1,309 件）を作り、`SgbdDump --ident` で EdiabasLib にグループファイルそのものを走らせ、規則の評価と
  一件でも食い違えば書かない。2026-11-10 の生成で食い違い 0 件（乱数を 5,000 に増やした 10,509 件でも 0 件）。
  突き合わせた答えは `variants.oracle.json` に残り、TS の規則も同じ答えで試験している。
- **送るもの**（`packages/monitoring-engine/src/variants.ts`、`packages/monitoring-engine/src/probe/scan.ts`、`packages/monitoring-engine/src/link/session.ts`）:
  - 規則のあるアドレス（今は 0x12・0x32・0x80）には、IDENT が選んだ SGBD をアプリが載せているときだけ、
    そのモジュールの電文を送る。MS43（MS430DS0）や GS20 は名前を出し、IDENT のほかは送らない。
  - 0x12 が MSS54DS0 と答えた車（M3）では、規則の無いアドレスは M3 の装備として、これまでどおり読む。
  - それ以外の車では、規則の無いアドレスは「?」で、IDENT のほかは送らない。共通の IDENT が自分の表に
    無いアドレス（LSZ、AIC/RLS など）には IDENT も送らない。
  - `Ds2Link.setSendGuard` が、どの経路から来たフレームも書き込みの直前に止める。
- **0x80（メーター、2026-11-11）**: `D_0080` は表を引かず、IDENT の答えの 9 番（診断インデックス）を BCD の数として
  読み、範囲で選ぶ（48–53 が KOMBI46、54–64 が KOMBI46R。3 番の上位が D なら R40 系の別の道）。規則の形
  （バイトの範囲・マスク）を足し、EdiabasLib に D_0080.grp そのものを走らせた 2,459 件の答えと突き合わせた。
  KOMBI46・KOMBI46R と選ばれたときだけ、そのメーターの電文（故障読取と、入庫点検の VIN の読取）を送る。
  M3 でも、今は IDENT を先に送ってから読む（M3 の装備のままでは読まない）。
- **まだ無いもの**: 0x12・0x32・0x80 のほかのアドレスの規則（`D_0056` の ASC/DSC、
  `D_0044` の EWS、`D_005B` の IHKA ほか）。一つ足すごとに、その車種でそのアドレスが読めるようになる。
  MS42/MS43・M43・GS20 の SGBD そのもの（Phase 4-3）。非 M3 の速度源（速度が読めないので、
  停車が要る読み取りは閉じたまま）。

---

## 5b. M3 でない E46 の DME と AT（2026-11-11）

運営者の決定（2026-10-30・11-11）：MONITORING のエンジンは DS2 の E46 全部を読む。入口（E46M3 /// MONITORING と
GREN BLUE SUITE）は分け、どちらにも車種を選ぶ操作は置かない。0x12・0x32 に何がいるかは IDENT が決める（§5）。

| アドレス | 載せた（module id） | ECU の名乗り | 載せない | 理由 |
|---|---|---|---|---|
| 0x12 | `ms420ds0`（MS42、M52TU） | "MS 42.0 fuer M52 mit EWS 3" | `MS420DS1` | D_0012 の選び方に名前が無く、IDENT から選ばれない |
| 0x12 | `ms430ds0`（MS43、M54） | "MS 43.0 fuer M54 mit EWS 3" | `MS43_SP2` | 同上（ジョブ 20 個の特別版） |
| 0x12 | `bms43ds0`・`bms46ds0`・`bms46ds1`（M43） | "BMS 43 fuer M43 mit ASC" ほか | | |
| 0x32 | `gs20`（5 速 AT） | "Getriebesteuerung GS20" | | |

- アドレスは `dump_modules.py` の実送信 IDENT（`12 04 00`・`32 04 00`）。`fit` は `nonm3`（「M3 以外の E46」）。
- 送るのは今までどおり、選ばれたモジュール自身の SGBD の電文だけ。M3 にこれらの電文は行かない。
- 読取は `runGate` の判断のまま。これらの車の速度源（MS42・MS43 は DME か KOMBI、M43 は KOMBI）は実車で
  確かめるまで使わないので、停車を要る読取・故障の消去は閉じたまま（IDENT と故障の読み取りは速度を待たない）。
- 故障の文：`tools/sgbd/gen_fault_layouts.py` が、各モジュール自身の FS_LESEN を EdiabasLib の模擬で走らせて
  故障コードの場所を確かめ（`fault-layouts.json`）、その SGBD の FORTTEXTE で名前を付ける。KOMBI46・46R・
  DSC_E46・ASCMK20・MS42・MS43・BMS43・BMS46（DS0・DS1）・GS20。**実車ではまだ確かめていない**（画面と点検報告が
  そう言う）。BMS43 の「現在あり」のビットは模擬で確かめられず、言わない。
- 訳：新しい 6 モジュールの独語 1,407 文（台帳で 2,006 欄）を訳した（非公開データ `terms/dme_e46.py`・`gs20.py`）。意味の確かめられない語 84 件は推測で埋めず原文のまま残し、`terms/_needs_check.json` に理由つきで載せた（台帳に残る未訳は 23 欄）。

## 6. 除外していないもの

`$SGBD_DUMP_DIR` の残り 21 ファイルは ECU のダンプではない:

- `_addresses.json` — `dump_modules.py` が実送信テレグラムから取った **63 件**のアドレス表（ECU のダンプ全部）
- `_families.json` / `_phrases_*.json`（19 件）/ `_untranslated_tokens.json` — 用語抽出の中間物
（テレグラム抽出の出力はここには無い。`extract_telegrams.py` は
`public/ecu-data/<id>.telegrams.json` に直接書く。）

`fitment.is_ecu_dump()` がこの区別を持ち、`check_references.py` はこれらを
ECU として数えない。
