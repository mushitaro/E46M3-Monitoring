# OldBmwDiagHost — ローカル EdiabasLib ブリッジ（Phase 2）

ブラウザPWAは EdiabasLib（.NET）を直接実行できないため、**PCに常駐する小さな.NETホスト**を挟む。
PWAはこのホストに localhost HTTP で問い合わせ、ホストが EdiabasLib で実 ECU と通信する。

```
[ブラウザPWA :8099]  ──HTTP──▶  [OldBmwDiagHost :5199]  ──▶ EdiabasLib ──▶ K+DCAN ──▶ ECU
   UI・項目名・グループ            ident/faults/live/job          SGBD解釈・正しいスケーリング・故障本文
```

## 起動

```bat
host\run-host.bat                                       :: mock（ハード不要・検証用）
host\run-host.bat ediabas                               :: 実機（EdiabasLib, 自動で -p:UseEdiabas）
host\run-host.bat ediabas --record recordings\m3.json   :: ★実車セッションを記録
host\run-host.bat replay  --recording recordings\m3.json :: ★記録を再生（ハード不要・実データ）
```
→ `http://127.0.0.1:5199/api/info` が応答すれば OK。PWA 側で接続モードを **「EdiabasLibホスト」** にして「接続」。

### 記録 / 再生（実車応答のオフライン再現）

Tool32 のシミュレーションと同じ狙い＝**実車で1回記録 → 以後どこでもオフラインで実データを使って開発/テスト**。

- **記録**: `--record <file>` を付けると、識別・故障・ライブ値(＋ECUが返す実単位)・ジョブ応答を
  逐次 JSON に保存（[`Backends/RecordingBackend.cs`](Backends/RecordingBackend.cs)）。実車=`ediabas` と併用。
  記録されるライブ値は「その時 PWA が読んだ項目」なので、記録したい項目を一通り表示させておく。
- **再生**: `--backend replay --recording <file>` で、ハードも EdiabasLib も無しに記録データを配信
  （[`Backends/ReplayBackend.cs`](Backends/ReplayBackend.cs)、net9 の mock ホストで動く）。数値は微小ジッタで“生きた”表示。
- PWA からは通常どおり「EdiabasLibホスト」モードで接続（バックエンドは透過。`/api/info` の `backend` で判別可）。
- 検証: mock で記録→replay で再生 を E2E 確認済み（故障本文・ライブ値・単位が再現）。

## API（PWAが呼ぶ）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/info` | backend / 接続中ECU / version |
| GET | `/api/ecus` | 利用可能ECU一覧（ecu-data/index.json） |
| POST | `/api/connect` | `{ecuId, iface}` 対象ECU・I/F選択 |
| GET | `/api/ident` | 識別（ZB/HW/SW/日付） |
| GET | `/api/faults` | 故障（コード＋本文） |
| GET | `/api/live?ids=a,b,c` | ライブ値（スケーリング済み） |
| POST | `/api/job` | `{job,args}` 任意ジョブ |

## バックエンド

- **MockBackend**（既定）: `ecu-data/*.json`（実SGBD由来の名称・故障本文）を読み、ライブ値は名称ヒューリスティックで合成。**PWA↔ホストの全経路をハード無しで検証**できる。
- **EdiabasLibBackend**（実機）: `Backends/EdiabasLibBackend.cs`。`#if EDIABASLIB` 内に EdiabasLib(`EdiabasNet`) の実結線コードあり。

## 実機（EdiabasLib）を有効化する手順  ※コンパイル検証済み

`OldBmwDiagHost.csproj` は条件付き構成済み。`-p:UseEdiabas=true` で **net8.0-windows** で
EdiabasLib を参照し `EDIABASLIB` を定義する（`Backends/EdiabasLibBackend.cs` の実結線が有効）。

1. EdiabasLib を取得（→ `C:\EC-APPS\ediabaslib`）
   ```
   cd C:\EC-APPS
   git clone https://github.com/uholeschak/ediabaslib
   ```
2. **TFM 対応**（EdiabasLib 最新は net10 も対象）: 次のどちらか
   - .NET 10 SDK を入れる、または
   - `ediabaslib\EdiabasLib\EdiabasLib\EdiabasLib.csproj` の `<TargetFrameworks>` を
     `net8.0-windows10.0.26100.0` のみに絞る（本リポジトリの検証ではこれで **0エラー** 確認）。
3. ビルド確認:
   ```
   cd host
   dotnet build -c Release -p:UseEdiabas=true      # → ビルド成功(0エラー)確認済み
   ```
4. `Backends/EdiabasLibBackend.cs` の `ReadLive` の対象ジョブ（`STATUS_MESSWERTE_BLOCK` 等）と
   `_ecuPath`（既定 `C:\EDIABAS\ECU`）を、各SGBDの実ジョブ構成に合わせて調整（`result→job` 対応）。
5. K+DCAN のCOMポート/インターフェース種別（`STD:OBD` / `ADS` / `ENET`）を `POST /api/connect` の
   `iface` で指定（PWA側は既定 `STD:OBD`）。
6. 実機起動:
   ```
   dotnet run -c Release -p:UseEdiabas=true -- --backend ediabas --port 5199
   ```
   → **実車で K+DCAN 接続し、読取値・故障本文・スケーリングを検証**（最終確認は要実車）。

> ✅ 検証済み: `EdiabasLibBackend.cs` は実 EdiabasLib（`EdiabasNet` 管理API）に対して
> **コンパイル成功**。残るは on-vehicle 動作確認のみ。

## セキュリティ

- ホストは `127.0.0.1` のみ待受（LAN非公開）。CORSはlocalhost用。
- 書込系ジョブ（アクチュエータ/コーディング）はPWA側で**未検証コマンドを実機ブロック**。ホスト側でも
  実行前提条件の確認を推奨。
- 実車のフラッシュ等の危険操作は本ホストの範囲外（WinKFP等別系統）。
