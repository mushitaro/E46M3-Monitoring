# 車と例題で自分を育てる仕組み

ヘッドユニットの MONITORING WORKS に K+DCAN を挿したまま運営者が用事で走る間に、ドライバーの問い
（「低速カーブで DSC が早く効く気がする。原因と対策を」）を燃料に、**診断**と**道具の開発**が勝手に
進む仕組み。Matrix↔TUNER（CO-WORK・OBSERVE・`tuner_*`）の延長に置く。運営者の依頼は 2026-10-23、
計画の承認は 2026-10-27。

この文書が仕組みの正本。安全の決まりの実体はコードにあり、ここはその地図と理由を持つ。

## 1. 形 — 二つのループ

```
 例題（scenarios/）──► 机（Claude Code の定期セッション）──► 計画 v+1 ──┐
        ▲                 │ 道具の穴 → PR → CI → 自動マージ/人の承認 → WORKS 配信
        │                 ▼                                              │
   完成度の表 ◄── 所見・台帳 ◄── 走行・停車の記録（D1）◄── タブ（PROBE 実行）◄┘
                                   ▲  ヘッドユニットの MONITORING WORKS（オフライン先行）
                    Matrix MONITORING（monitoring_*）: 運転中の会話と机の両方が使う口
```

- **タブ**は、机が置いた計画の「起きたら取る」項目を自分で捕まえる。読取だけ。運転を指示しない。
  ネットが切れても走り、記録は後で上がる。
- **机**は定期起動の Claude Code。記録を読み、仮説を確定・否定し、次の計画（再試験・別モジュール）か、
  道具の穴（拒否・未知のテレグラム・デコード不明）を開発タスクにして PR まで進める。
- **例題**は受入テスト。各例題が要る能力を宣言し、例題 × 能力の表が「完成」の物差しになる。

## 2. TUNER の作法から引き継ぐもの、足すもの

会話と記録は TUNER の作法をそのまま採る（中継 0.10.0 の `tuner_guide` 全トピック）。

- 手順は Skill に写さず、道具と一緒に配る手順書（`monitoring_guide`）が持つ。Skill は入口だけ。
- トピックはオーナーの言い回しではなく「これから何をするか」で分け、各トピックに「読むとき」を付ける。
- 事実は手順書に書かない。ツールの説明とタブの応答が持つ。数はタブが計算し、ツールは読むだけ。
- CO-WORK（計画・手順の印・ドライバーの言葉・fact / read / ask / answer / status）。上書きしない。
- ドライバーの言葉がログに勝つ。推測は書かずに問いにする。結論を一文目に、確かさを言い分ける。
- 確認は二種類（頼まれた言葉が「はい」／失うものは復唱）。車への接続・書込・フラッシュは画面で人。

TUNER に無いのは自律だけなので、そこだけ足す。

- **委任（mandate）**。TUNER の「計画はオーナーが同意した中身だけ」を守ったまま、オーナーの頼み
  （「原因と対策を考えて」「勝手に進めて」）を、その調査の範囲で読取の計画を書いてよい同意として
  CO-WORK に残す。範囲の外（読取以外・別の調査・期限切れ）は `ask` にしてオーナーを待つ。
- 判定基準 `criteria` に、文の他に機械で判定できる形（出所つき）を足す。判定はタブが計算する。
- 例題は Skill の網羅表にせず、Skill が正しく応じるかを試す評価用の例題にする。

## 3. Skill の組み方 — 一つの診断サイクル

オーナーの頼みは、言い回しは無数でも、次のサイクルのどこかに入る。エージェントは入口を決め、
そこのトピックを読む。網羅表なしに柔軟に応じられるのはこのため。

```
 症状 → 仮説（否定する観察つき）→ 証拠の取り方 → 計画（CO-WORK）→ 実行 → 判定 → 次の一手
  ▲                                                                     │
  └──── 再試験／別モジュールへ／対策（修理・画面での手順・TUNER へ）／道具の穴（開発）◄─┘
```

| 層 | 使う者 | 正本 | 入口 |
|---|---|---|---|
| 車側の会話 | 声の会話（claude.ai ほか） | `public/guide/*.md` → タブが hello で申告 → 中継が保持して `monitoring_guide` で返す | Matrix プラグインの薄い Skill `monitoring-drive` |
| 机 | Claude Code | `.claude/skills/monitoring-desk/SKILL.md` | 「解析して」「次の計画」「この項目を読めるように」 |
| 自律 | 定期起動の Claude Code | `.claude/skills/monitoring-loop/SKILL.md` | scheduled task のプロンプトは「これに従う」だけ |

`monitoring_guide` のトピック：drive・faults・investigate・catalog・cowork・moment・overview・
service・tuning・session・trouble・autonomy。

証拠は安い順に取る：故障とフリーズフレーム → 停車中の状態 → 停車中のライブ値 → 走行中の捕捉 →
DME の RAM（master の窓だけ）→ 画面での手順。

guide が名乗るツールは `src/lib/bridge/tools.ts` の一覧だけ（`guide.test.ts` が照合し、中継の
大きさの上限も検査する）。

### 例題 — 評価用で、Skill には書かない

`scenarios/cases.json` に、オーナーの言葉・状況・サイクルの入口・読むトピック・呼ぶツール・
してはいけないこと（`nevers`）・「答えた」の定義・要る能力を一件ずつ置く。`scenarios/capabilities.json`
は能力ごとの状態（`car` 実車で確認／`built` 作った／`missing` まだ）と、その根拠。

- `src/lib/bridge/scenarios.test.ts` — 例題が存在するトピック・ツール・決まり・能力だけを指すこと、
  guide の全トピックと全ての決まりにどれかの例題が当たること。
- `node tools/scenario_coverage.mjs` — 今答えられる例題の数と、どの能力が何件を塞いでいるか。
  完成度の物差しで、自律ループが開発の順を決めるのもこの表。
- 能力の状態を上げるのは、`where` に書いた根拠（実車の記録・コード）があるときだけ。

## 4. 安全の境界

| 決まり | どこが強制するか | 状態 |
|---|---|---|
| 送るかを決めるのは `runGate.ts`（カタログの読取は `mayRun`、アプリが組む読取は `mayRunProtocolRead`）。ツールは K ラインに直接何も足さない | `src/lib/runGate.ts`、`src/lib/probe/executor.ts` | 済。実行器は全フレームでゲートに訊く（2026-10-27） |
| モジュールには、そのモジュール自身の SGBD が送るものだけ | `src/lib/moduleProtocol.ts`、`link.to(address)` | 済（2026-10-27） |
| 読取は、送る直前に DME の車速が 0 と読めたときだけ。読めなければ出さない | `useDs2Link` の事前読取、`lib/vehicleState.ts` | 済（2026-10-27） |
| 走行中に送ってよい読取はオーナーが決める。アプリもアシスタントも格上げしない | `lib/ledger.ts` の `grantMovingOk`。`monitoring_ledger` は読むだけ | 台帳は済。認める画面はまだ |
| 意味的失敗（0xB0 など）は再送しない。再送は transport の失敗だけ | `packages/ds2-core/src/link.ts` | 済（以前から） |
| 読取以外は画面に置くだけ。実行は停車中に画面で人。DSC 油圧系は出さない | `mayRun`（非読取は拒否）、`monitoring_stage` | 拒否は済。stage は段 3 |
| キルリストで任意のジョブを即時に止める | `public/kill-list.json`、`lib/ledger.ts`、SW は precache しない | 取得と適用は済。D1 からの配信は段 2 |
| タブは新しい計画の版と新しいビルドを停車中・リンク休止中にだけ採る | 計画は `useProbe` が開始時に一度だけ読む（開始は人が画面で）。ビルドは Service Worker | 計画は済。ビルドは段 4 |

## 5. 段取り

| 段 | 中身 | 承認 |
|---|---|---|
| 0 | 宛先の修正、実測の車両状態、台帳の段階、キルリスト、試験とクラウドの足場 | 人 |
| 1 | タブの実行器（`src/lib/probe/`）と CO-WORK（TUNER の `notebook/rules.ts` の形）。実行器・判定・委任の規則、端末の保存（`notebook/store.ts`）、PROBE（副操作で開始、ハブで STOP と一行）は済 | 人 |
| 2 | ポリシーの改訂（成功した読取の送信・中継の catalog）→ D1 → 机の CLI | 人 |
| 3 | Matrix MONITORING：ticket・同一オリジンのソケット・hello・19 のツール・SESSIONS の ASSISTANT。タブ側は済（代わりの中継で確認）。中継 0.11.0 は作成済み、未配備 | 人 |
| 4 | guide の全トピック、机と自律の Skill、例題と能力の表、自動マージの分類（`.github/autonomy.json`・`scripts/autonomy-class.mjs`・CODEOWNERS・`autonomy.yml`）、配信（`deploy-works.yml`）は済。定期実行は PR #1 が main に入ってから | 分類による |
| 5 | テレグラムを SGBD の実行トレースで得る（`.prg` をデータ repo へ） | 人 |
| 6 | 例題 1（DSC 低速カーブ）を一周 | — |
| 7 | Manifold の DIAG の枠（OTA の署名は PC） | 人 |

自動マージは PLAN §8-3 のとおり（運営者 2026-10-23）：文言・訳・単位表・読取専用のデコード表・
例題・文書は CI が通れば自動。台帳・テレグラム・引数・リスク・前提条件・`runGate`・`packages/ds2-core`・
`classify.py`・guide の「前提」と「言わないこと」は人の承認。分類はパスの許可表と CI で決め、
エージェントの判断にしない。`autonomy.yml` が PR に `autonomy:auto` か `autonomy:human` を付ける（ラベルは
無ければ作る）。`autonomy-merge.yml` は、自律ループのブランチ（`claude/loop-*`）で `auto` のものだけを、CI が
その同じコミットで通ったあとにマージする。分類は main の表で計算し直すので、ブランチが自分を裁く表を
緩めることはできない。リポジトリの設定（自動マージ・ブランチ保護）は要らない。`human` は CODEOWNERS が
オーナーにレビューを頼む。表と CODEOWNERS が食い違わないことは `src/lib/autonomyClass.test.ts` が見る。

配信は `deploy-works.yml`（main への push と 6 時間ごと、配信済みのコミットは飛ばす）。`npm run deploy` が
きれいな main とデータを確かめてから上げ、配信物を読み戻す。ゲートの内側の確認はオーナーのセッションが
要るので、ランナーでは「配信済み・内側は未確認」の警告で終わる。

## 6. 運営者に一度だけ頼むこと

1. 段 0 の PR のレビュー。
2. `.prg`（DSC_E46・SMG2・MSS54DS0・LWS5 ほか）と `C:\EDIABAS\SIM` を `E46M3-Monitoring-data` へ。
3. Cloudflare の API トークン（Pages・D1 の編集）を一つ。クラウド環境の設定に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` として置けば、机とループが配信と D1 を扱える。GitHub Actions から配る場合は同じものを GitHub の secret に、加えてデータ repo の読取トークン `MONITORING_DATA_TOKEN`。
4. クラウド環境の secret（D1 `tsunagi-m-preview-runs` だけに効くトークン）。
5. PC での中継 0.11.0 の配備（ポリシーの公開のあと）と、claude.ai への MONITORING WORKS のコネクタの追加。
6. ヘッドユニットで MONITORING WORKS にサインインし、走る前に CONNECT と PROBE ON。

## 7. 分かっている穴

- データ repo の `telegrams.json` が抽出器の修正 a5635d4（2026-09-03）より古い。データを置いて試験を回すと
  16 件が落ちる（main でも同じ）。再生成には `.prg` が要る（§6 の 2）。CI にデータを入れるのはその後。
- `tools/check_references.py` は開発機の参照物を検査するのでクラウドでは落ちる。データ repo のダンプは
  台帳とハッシュが合わない（大きさが数 % 違い、改行コードの違いに見える）。
- `node tools/check_ui_tokens.mjs` が `CreditsDialog.tsx:124` の `text-[9px]` で落ちる（main から）。
- 切り替え時に `0x9F` を送るかは未決（PLAN §2-4）。実車で測って決める。
