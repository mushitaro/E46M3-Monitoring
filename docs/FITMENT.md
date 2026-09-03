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
| `dsc_e46` | `DSC_E46.prg` | `late`（後期） | *（無し）* | **無し** |

`ASCMK20` の SGBD は「6 km/h 超では診断不可」とも述べており、その一文は
`index.json` の `note` に載っている。

> **開いている穴。** `dsc_e46` は 51 モジュールの中で唯一、実送信テレグラムの裏付けが無い。
> `_addresses.json`（59 件、EdiabasLib の実送信 `(Send sim): …` から取ったもの）に
> `DSC_E46` は**入っていない**し、ダンプにも ECU 文字列が無い。0x56 という値は
> `gen_ecu_data.py` の `MODULES` の宣言であって、測ったものではない。
> `dump_modules.py --exec IDENT` を `DSC_E46` に回して埋めること。実測が 0x56 で
> なければ、宣言ではなくトレースが勝つ。

---

## 2. プロトコルが違う — 2 件

### `DSC_MK60` — 負の結果として保存する

他の 58 モジュールの IDENT が 3 バイトの DS2（`<アドレス> 04 00`）なのに対し、
これだけが違うものを送る:

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

ECU ではない。フラッシュ書込のプロトコル SGBD で、ジョブは `FLASH_PARAMETER_LESEN` /
`MOST_CAN_GATEWAY_ENABLE` / `ACCESS_TIMING_PARAMETER` の類。診断アドレスを持たず、
**63 個のダンプの中で唯一 `_addresses.json` に載らない**。WinKFP の領分。

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

| SGBD | アドレス | 採ったもの |
|---|---|---|
| `SM46` | 0x72 | `sm46_4` |
| `SM46_3` | 0x72 | `sm46_4` |
| `SM46C_4` | 0x72 | `sm46c_5` |
| `B_SM46_3` | 0xDA | `b_sm46_4` |

どれも「同じアドレスの別世代」で、0x56（`ascmk20` / `dsc_e46`）や 0x5B
（`ihka46` / `_2` / `_3`）とまったく同じ形をしている。そちらは `fit` で両載せして
利用者に選ばせているので、**この 4 件も本来は fit の候補**である。

なぜ第 4 世代を採って第 3 世代を採らなかったのかは、どこにも書かれていない。
E46 M3 のシートメモリがどの世代かを、この repo は測っていない。

**推測で埋めない。** それらしい理由を書けば `unrecorded` は 0 になるが、それは
数字が良くなっただけで、根拠は増えていない。`unrecorded` を 0 にする正しい手は、
実車の 0x72 / 0xDA に IDENT を送って ECU 文字列を読むことである。

---

## 5. 除外していないもの

`$SGBD_DUMP_DIR` の残り 24 ファイルは ECU のダンプではない:

- `_addresses.json` — `dump_modules.py` が実送信テレグラムから取った 59 件のアドレス表
- `_families.json` / `_phrases_*.json`（19 件）/ `_untranslated_tokens.json` — 用語抽出の中間物
- `{mss54,smg2,dsc_e46}.telegrams.json` — `extract_telegrams.py` の出力

`fitment.is_ecu_dump()` がこの区別を持ち、`check_references.py` はこれらを
ECU として数えない。
