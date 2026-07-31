# 実車接続手順書 — E46 M3（K+DCAN / DS2）

OldBmwDiag（PWA＋EdiabasLibホスト）を **実車のE46 M3** に接続し、読取・記録するための手順。
対象: MSS54(エンジン) / SMG II(変速機) / DSC(MK20/MK60)。プロトコルは **DS2（K-Line）**。

> ⚠ **安全**: まず**読取と記録だけ**を行う。書込系（キャリブレーション/コーディング）は本ツールで
> 既定ブロック。実行するなら各ジョブを実車で検証し、バッテリー充電器接続・エンジン停止等の
> 前提を満たしてから。フラッシュ（WinKFP領域）は本ツールの対象外。

---

## 0. 必要なもの

| 品目 | 補足 |
|---|---|
| **K+DCANケーブル**（FTDI FT232RL系） | E46は**K-Lineモード**で使用。安価な互換品可だが FTDI 純正チップ推奨 |
| Windows PC（.NET 8/9 SDK） | 本ホストのビルド/実行用 |
| バッテリー充電器（任意だが推奨） | 電圧降下で通信が切れるのを防ぐ |
| EDIABAS 一式（`C:\EDIABAS`） | SGBD `C:\EDIABAS\ECU`。導入済み |
| EdiabasLib（`C:\EC-APPS\ediabaslib`） | `git clone` 済み。実機バックエンドに必要 |

---

## 1. ケーブル接続（E46）

- E46 の **OBD-II 16ピン**（運転席足元）に K+DCANケーブルを挿す。
  - K-Line は **ピン7**（DS2/KWPはここ）。E46は D-CAN 非搭載なので **ピン8ジャンパは不要**。
- USB 側を PC に挿す → Windows が **COMポート**として認識（FTDI VCPドライバ）。
- **イグニッションを ON（KL15）**。エンジンは停止でよい（読取のみなら）。

---

## 2. FTDI ドライバ設定（重要：これを怠ると必ず失敗する）

K-Line はタイミングが厳しく、**FTDIの Latency Timer 既定16ms では遅延/タイムアウトが多発**する。

1. デバイスマネージャー → ポート(COM & LPT) → 該当の USB Serial Port を右クリック → プロパティ
2. **ポートの設定** タブ → **詳細設定**
3. **待ち時間(Latency Timer)** を **1 ms** に変更 → OK
4. ここで表示される **COMポート番号（例: COM3）をメモ**（次で使う）

---

## 3. COMポートを指定

ホストは環境変数 **`EDIABAS_COMPORT`** で COM を受け取る（未指定時の既定は `COM3`）。

```bat
set EDIABAS_COMPORT=COM3      :: ← 手順2でメモした番号に
```
- 通常は `COMx`。FTDI 直アクセス（COMドライバを介さない・より安定）を使うなら `FTDI0` 等も可。
- 迷ったら `mode` コマンドで存在する COM を確認: `mode`

---

## 4. ホストを実機モードで起動

```bat
cd C:\EC-APPS\OldBMW-Diag-PWA\host
set EDIABAS_COMPORT=COM3
run-host.bat ediabas
```
- 初回は EdiabasLib 参照ビルドが走る（`-p:UseEdiabas=true` は bat が自動付与）。
- ビルドに失敗する場合: EdiabasLib が net10 も対象 → .NET 10 SDK を入れるか、
  `ediabaslib\EdiabasLib\EdiabasLib\EdiabasLib.csproj` の `<TargetFrameworks>` を
  `net8.0-windows10.0.26100.0` のみに絞る（`host\README.md` 参照）。
- `http://127.0.0.1:5199/api/info` が `backend: ediabas` を返せば起動OK。

---

## 5. PWA から接続して読取

```bat
:: 別ウィンドウで PWA を起動
cd C:\EC-APPS\OldBMW-Diag-PWA
start.bat
```
1. ブラウザ（Chrome/Edge）で `http://localhost:8099/`
2. 上部の **モジュール** を選択（まず **MSS54**）
3. 接続モードを **「EdiabasLibホスト」** にして **接続**
4. **診断**タブ →「識別情報を読取」→ 実車の ZB/HW/SW/日付が出れば **通信成功**
5. 続けて「故障コード読取」→ 実際の故障（本文つき）

### 最初に確認すべき順序（切り分け）
1. **識別(IDENT)** … 通信の基本確認。ここが通れば配線・COM・ドライバはOK
2. **故障(FS_LESEN)** … 本文が出るか（SGBDの文字列が効いているか）
3. **ライブ値**（データログ）… 値と**単位**が返るか

> 識別で `IFH-0009`（SG無応答）→ 配線/ピン7/イグニッションON/COM番号を疑う。
> `IFH-0018`（初期化失敗）→ COMポート番号違い/ドライバ/ケーブル。

---

## 6. セッションを記録（以後オフラインで再現）

実車で一度記録すれば、車が無くても実データで開発・テストできる。

```bat
:: ホストを記録モードで起動（COMは手順3で設定済み）
run-host.bat ediabas --record recordings\m3-mss54.json
```
- この状態で PWA から **記録したい項目を一通り表示**する:
  - 識別・故障を読む
  - データログで**見たい項目を選択**して数十秒記録（表示した項目だけが記録される）
- 保存された `recordings\m3-mss54.json` を、以後どこでも再生:
  ```bat
  run-host.bat replay --recording recordings\m3-mss54.json
  ```

### 最初に記録しておくと良い項目（MSS54）
| 目的 | 項目(id) |
|---|---|
| 基本 | `STATUS_MOTORDREHZAHL`(回転数), `STATUS_KUEHLW_AUSL_TEMPERATUR`(水温), `STATUS_OELTEMPERATUR`(油温) |
| VANOS | `STATUS_EVANOS1_IST/SOLL`(吸気), `STATUS_AVANOS1_IST/SOLL`(排気) |
| ラムダ | `STATUS_LAMBDA_ADD_1/2`, O2センサ各バンク |
| 故障 | `FS_LESEN`（全故障＋本文） |
- モジュールごと（SMG II / DSC）にも同様に1回ずつ記録しておくと、UI/ラベル/単位の検証が完結する。

---

## 7. トラブルシューティング

| 症状 | 原因/対処 |
|---|---|
| `IFH-0018` 初期化失敗 | COM番号違い / FTDIドライバ未導入 / ケーブル不良。`EDIABAS_COMPORT` を確認 |
| `IFH-0009` SG無応答 | イグニッションOFF / ピン7未接続 / 対象ECU未搭載 / アドレス違い |
| 通信が途中で切れる | 電圧降下 → **充電器接続**。FTDI Latency=1ms を再確認 |
| 文字化け/型初期化例外 | （ホスト側で対処済み: `CodePagesEncodingProvider` 登録で Windows-1252 対応） |
| 値は出るが単位が空 | その項目に `_EINH` 単位結果が無い（正常）。実単位はECUが返せば自動反映 |
| ビルドが net10 で失敗 | .NET 10 SDK 導入 or EdiabasLib の TFM を net8 に絞る |

---

## 参考: アドレスとプロトコル

| モジュール | SGBD | DS2アドレス |
|---|---|---|
| MSS54（エンジン） | MSS54DS0.prg | 0x12 |
| SMG II（変速機） | SMG2.prg | 0x32 |
| DSC MK20 / MK60 | ASCMK20.prg / dsc_mk60.prg | 0x56 |

E46 M3 は全て **DS2 / K-Line**。D-CAN・ENET は非対象（後継車用）。
