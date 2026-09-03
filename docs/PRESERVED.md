# 再生成できない資産の台帳

三つのコードベース（`E46M3-Diagnosis` / `C:\EC-APPS\OldBMW-Diag-PWA` / `E46M3CSL_TuningTool`）を
このリポジトリに統合するにあたって、**失うと取り返しがつかないもの**を一箇所に列挙する。

この表の目的は二つある。第一に、`git filter-repo` による履歴書換とディレクトリ削除の前に、
何がどこへ行くのかを人が一度確認できるようにすること。第二に、公開リポジトリに**何を載せないか**の
判断根拠を、判断の後ではなく判断と同時に記録すること。

> **前提**: `C:\EC-APPS\OldBMW-Diag-PWA` は **git 管理外**だった。あの木はディスク上の一箇所にしか
> 存在しなかった。ここに挙げるもののうち出所が PWA のものは、バックアップを取るまで
> 世界に一つしかない状態だった。

## バックアップ（2026-09-03、統合着手前）

| ファイル | 中身 | 検証 |
|---|---|---|
| `C:\tmp\consolidation-backup\E46M3-Diagnosis-preconsolidation.bundle` | 49 コミットの完全な履歴（ECU データを含む）。1,131,633 B | `git bundle verify` → "records a complete history" |
| `C:\tmp\consolidation-backup\E46M3-Diagnosis-worktree.tgz` | 作業ツリー 227 エントリ。**bundle に入らない未追跡の `packages/ds2-core/src/byteTransport.ts` を含む** | 主要 8 パスの存在を個別確認 |
| `C:\tmp\consolidation-backup\OldBMW-Diag-PWA-full.tgz` | PWA 全体 278 エントリ | ダンプ 84・terms 23・ecu-data 52 と下表の全項目を個別確認 |

bundle は**コミット済み履歴しか含まない**。未コミットの作業（`byteTransport.ts` ほか）が
worktree の tgz にしか無いのはそのため。片方だけでは復元できない。

## 台帳

| 資産 | 出所 | 実測 | 移動先 | 公開 | なぜ再生成できないか |
|---|---|---|---|---|---|
| **DS2 アドレス表** `_addresses.json` | PWA `tools/SgbdDump/out/` → 現在は `$SGBD_DUMP_DIR` | 42,542 B、**63 エントリ**（ECU のダンプ全部。59 だった頃、MSS54DS0・SMG2・DSC_E46・10flash が抜けていた） | `$SGBD_DUMP_DIR` | ✗ | EdiabasLib が**実際に送信した** IDENT テレグラムの先頭バイト（`(Send sim): 80 04 00` → `0x80`）。静的解析による代替（`detect_address.py`）は既知 3 モジュールで全滅した。再取得には EDIABAS 一式・EdiabasLib・再ビルドした exe が要る |
| **SGBD ダンプ** | PWA `tools/SgbdDump/out/` | **63 ダンプ / 3,325,871 B**、うち **61 が `tables` 保有** | `$SGBD_DUMP_DIR` | ✗ | `C:\EDIABAS\ECU` の BMW 製 `.prg` からしか作れない。我々のものではない |
| **翻訳作業セット** `_phrases_*.json` ほか | PWA `tools/SgbdDump/out/` | **18 ファイル** + `_untranslated_tokens.json` / `_families.json` / `_joblist.txt` | `$SGBD_DUMP_DIR` | ✗ | 7,316 フレーズの背後にある監査証跡 |
| **用語表 A** | `E46M3-Diagnosis/tools/terms/` | 6 ファイル / 265,734 B / **PHRASES 1,718** | 統合（下記） | ✗ | 手書き |
| **用語表 B** | PWA `tools/terms/` | 23 ファイル / **1,040,408 B** / **PHRASES 7,316 · TOKENS 1,252** | 統合（下記） | ✗ | 手書き。単一で最大の資産。キーが SGBD のドイツ語原文そのものなので公開不可 |
| **ライブ値チャンネル名** `live_channels.py` | `E46M3-Diagnosis/tools/terms/` | **LIVE_CHANNELS 213 · BLOCK_NAMES 8** | 現状維持 | ✗ | 213 中 127 に対応するドイツ語が存在せず、この repo に en→ja 経路も無い。機械生成できない |
| **ジョブ安全上書き** `sgbd_overrides.py` | PWA `tools/` | 61,994 B / **33 モジュール / 178 ジョブ**（risk 142・注意文 111 対・exclude 36・cat 36・前提条件 29・style 16・不可逆 14） | `tools/sgbd/overrides.py` ＋ `tools/jobtext/overrides/` に分割 | **✓** | SGBD の `_JOBCOMMENTS`/`_ARGUMENTS`/テーブルを読んで下した判断の集積。**我々自身の著作物**であり、公開リポジトリを読む価値のある部分 |
| **実車トレース** `ifh.trc` | PWA `host/trace/` | **696,320 B**、2026-07-18 | `$SGBD_DUMP_DIR` 隣接（git 外） | ✗ | 実車セッションの完全な IFH/API トレース。ZB 番号を含む。`IFH-00xx` の調査と、DS2 を直接実装し直す際の唯一の実挙動証拠 |
| **実車記録** `m3-mss54-real.json` | 両木でバイト同一 | 30,578 B、実故障 5 件 | 保持・gitignore | ✗ **プライバシー** | 車・ケーブル・セッションが要る。**ECU の実 `_EINH` 単位が捕まっている唯一の場所** |
| **実車記録** `m3-smg2-real.json` | 両木でバイト同一 | 11,577 B | 保持・gitignore | ✗ **プライバシー** | 同上 |
| 合成記録 `test-mss54.json` | `tools/deprecated/host-recording-test-mss54.json` | 1,873 B、ZB 7831387（合成） | 引退したホストの出力形式の記録として保持 | **✓** | 合成なので公開可。**読む物はもう無い**——`host/` は削除済みで、この形式のパーサはどこにも存在しない。残す理由は「唯一残った実例」であって「fixture」ではない |
| **逆コンパイル由来のブロック表** | `packages/ds2-mss54/src/*.generated.ts` | 213 ライブ値のオフセット/スケール、適応値ブロック | 現状維持 | **✓**（帰属表示付き） | 生成元は `C:\Users\kazuh\MSS54-DS2-Tool-Public-1.2.1\decompiled-source\`。**この repo にコミット済みの中間物が無い**ので、あの木を失うと二度と生成できない |

## 負の結果 — 消すと同じ道を再発見される

| 事実 | 記録先 |
|---|---|
| `detect_address.py`（`.prg` を XOR 0xF7 して静的にアドレスを推定）は**既知 3 モジュールすべてで誤答**した（BEST バイトコードのノイズから 0x40/0x70 を返す）。実行トレースが唯一の根拠 | `tools/deprecated/detect_address.py` にヘッダ付きで保存 |
| `DSC_MK60.prg` の IDENT は **KWP2000 `B8 29 F1 02 1A 80`** を送る＝この車両の DS2 DSC ではない。アドレスも 0xB8 で 0x56 ではない | `docs/FITMENT.md` |
| 0x56 には **前期 MK20 が `ASCMK20.prg`、後期が `DSC_E46.prg`**。同一アドレスなので同時装着は無い。`ASCMK20` は長らく「従来決定どおり」という理由になっていない理由で除外されていたが、**0x56 でトレース検証済み・9 テーブル保有**で、`DSC_E46`（アドレス未実測・PWA 側ダンプはテーブル 0）より裏付けが強い | `docs/FITMENT.md` |
| 非装着による除外とその理由: `EWS.prg`（EWS2 非搭載）/ `IHKR46`（マニュアルエアコン）/ `MRS4RD`（E83 用）/ `DWS`・`GR2`・`EKP_DS2`（RPA は DSC 内蔵・クルーズは DME 内蔵・燃料ポンプはリレー駆動） | `docs/FITMENT.md` ＋ `tools/sgbd/fitment.py` |
| FTDI Latency Timer を 1 ms にする必要があるという通説は**実測に反する**。実車スイープで 16 ms が 5.7% 速く、覚醒回数は 135→14。FTDI 自身の AN_107 も 1 ms を勧めない（USB フレーム長と同じ） | `docs/CONNECT-VEHICLE.md`（旧 `host/CONNECT-VEHICLE.md` の記述を訂正） |
| コメントに埋まった設計根拠 — `index.html`（ログの backdrop が body 直下である理由、ADAPTATION が `calibration` の識別子を保つ理由）、`css/style.css`（ワードマークの実測値、φ の導出、320×568 でハブが 119px 失われた計測）、`app.js`（`getHubConfig` の契約と、calibration/workflow が意図的に実装しない理由）、`testjobs.js`（ARMED バッジが名前セルにある理由、STOP にモーダルが無い理由、`TASTVERHAELTNIS=0` の根拠）、`datalog.js`（params グリッドが `minmax(0,1fr)` を要する理由 — auto トラックが MSS54 で 2209px になった） | **コードごと移植する際にコメントも運ぶ**。これを落とすと学習の大半が消える |

## 公開可否の三つの根拠 — 混同しないこと

1. **BMW の SGBD 由来**（`THIRD-PARTY-NOTICES.md` §3.1）— `public/ecu-data/`、SGBD ダンプ、`tools/terms/`（キーがドイツ語原文）。
2. **逆コンパイル経路**（同 §3.2）— `packages/ds2-mss54/src/*.generated.ts`、`errorMemory.ts`。**公開すると決定済み**、karter16 への帰属表示を README・ファイルヘッダ・アプリ内ダイアログの 3 箇所で行う（`E46M3CSL_TuningTool` が同一上流に対して既に public で採っている体裁に揃える）。
3. **プライバシー** — `recordings/m3-*-real.json`、`ifh.trc`。実 ZB 番号と故障履歴。ライセンスの問題ではない。

`tools/sgbd_overrides.py` は**どれにも当たらない**。ジョブ名を含むが SGBD の文章は含まず、判断は我々のもの。公開する。
