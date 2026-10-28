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
- **机**は Claude Code の自律ループ。頼まれた瞬間に起きる：WORKS が委任・机への問い・問いへの答え・PROBE の
  実行を D1 に入れると、`functions/_lib/wake.ts` がループの定期実行を API で起こす（合図は記録の id だけ。
  一つの記録は 10 分に 1 回、全体で 1 時間に 20 回まで）。定期の巡回は取りこぼしと CI・レビュー・例題の穴を
  拾う予備。記録を読み、仮説を確定・否定し、次の計画（再試験・別モジュール）か、道具の穴（拒否・未知の
  テレグラム・デコード不明）を開発タスクにして PR まで進める。承認の要らない直しは、マージされるとすぐ
  配信される（`autonomy-merge.yml` が `deploy-works.yml` を呼ぶ）。
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
| タブは新しい計画の版と新しいビルドを停車中・リンク休止中にだけ採る | 計画は `useProbe` が開始時に一度だけ読む（開始は人が画面で）。ビルドは、リンクが 1 分続けて切れていて未保存が無いときだけ（`lib/adoptBuild.ts`） | 済（ビルドは 2026-10-28） |
| 送るのは、委任が立っている調査だけ。取り下げたら、まだ送っていないものも送らない | `lib/investigation/share.ts`（タブ・`functions/api/notebook`・`/runs`・机が同じ関数を使う） | 済（2026-10-28） |
| 机が読むのは委任中の調査だけ。オーナーの ID と VIN は出さない。書くのは `desk` としての追記だけ | `workers/desk/`、`lib/investigation/redact.ts`、`deskProblem`、監査の行 | 済（2026-10-28）。配備は §6 |

## 5. 段取り

| 段 | 中身 | 承認 |
|---|---|---|
| 0 | 宛先の修正、実測の車両状態、台帳の段階、キルリスト、試験とクラウドの足場 | 人 |
| 1 | タブの実行器（`src/lib/probe/`）と CO-WORK（TUNER の `notebook/rules.ts` の形）。実行器・判定・委任の規則、端末の保存（`notebook/store.ts`）、PROBE（副操作で開始、ハブで STOP と一行）は済 | 人 |
| 2 | ポリシーの改訂（成功した読取の送信・中継の catalog）→ D1 → 机の CLI。ポリシーは済（tsunagi-m3 #29）。お知らせ v2、D1（`0002`）、端末の送信（読み取りの記録・調査の記録）、机の Worker と `npm run desk` は作成済み（§8） | 人 |
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

済んだもの（2026-10-28）：ポリシーの公開（tsunagi-m3 #29）、段 0–4 のマージ（#1）、`.prg` と SIM（データ
repo #1）、中継 0.11.0 の配備と MONITORING 用の秘密、定期実行（専用セッション「MONITORING 自律ループ」）。
段 2 と机（#4・#5）：D1 の `0002`、WORKS の配信（build 143.c0d3826）、机（`https://monitoring-desk.pages.dev`、
Pages の別プロジェクト。Worker の `workers.dev` はアカウント名が URL に出るので使わない）、机のトークン
（`loop`、2026-11-27 まで）とクラウド環境の `MONITORING_DESK_URL`・`MONITORING_DESK_TOKEN`・ネットワークの許可。
GitHub のラベル・自動マージ・ブランチ保護は `autonomy.yml` と `autonomy-merge.yml` が要らなくした。

机のトークンは期限（既定 30 日）の前に `npm run desk:token -- issue loop` で新しいものを出し、クラウド環境を
差し替えてから、古いものを `revoke` する。Cloudflare の鍵はクラウドのセッションに置かない（運営者、2026-10-28）。

残るもの：

1. この変更（起こす口・すぐの配信・机の分け方）のレビュー（人の承認クラス）。
2. ヘッドユニットで MONITORING WORKS を開き直し（新しいビルド）、お知らせ v2 に同意、SESSIONS → ASSISTANT を
   オン、端末に名前を付ける。走る前に CONNECT、計画があれば PROBE。
3. 頼まれた瞬間に起こす口（`functions/_lib/wake.ts`）。この順に。トークンは会話には貼らない：
   1. PC で `npx wrangler d1 migrations apply tsunagi-m-preview-runs --remote`（`0003`、起こした記録の表）。
   2. claude.ai/code/routines → 「MONITORING 自律ループ」→ Edit → Trigger の「+」→ API → Generate token。
      トークンは一度しか出ない。その定期実行を起こすことにしか使えない。
   3. PC で `npx wrangler pages secret put LOOP_FIRE_TOKEN --project-name e46m3-monitoring-preview` を実行し、
      聞かれたところに貼る。`LOOP_TRIGGER_ID` は `wrangler.jsonc` にある。トークンが無いうちは、起こす口は
      何もしない（ループは定期の巡回だけ）。
4. 承認の要らない直しを、マージしたらすぐ配信する鍵（`deploy-works.yml`）：
   1. Cloudflare の API トークンを一つ：権限は Account → Cloudflare Pages: Edit だけ、期限つき。
   2. GitHub → Settings → Environments → `works` を作り、Deployment branches を `main` だけにする。そこに
      `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID`。
   3. リポジトリの secret に `MONITORING_DATA_TOKEN`：fine-grained の読み取り専用（Contents: Read）で、
      `E46M3-Monitoring-data` と `tsunagi-m3` の二つだけ、期限つき。配信は、データと、ゲートの正本との
      一致の確認にこの二つを読む。
5. 定期の巡回を予備（1 日 1〜2 回）に減らす。定期実行の設定を変えるので、運営者の一言で机が行う。

## 7. 机への道

```
 タブ ──/api/notebook・/api/runs・/api/reads（オーナーのゲートの内側）──► D1 tsunagi-m-preview-runs
   ▲                                                                          │
   └──── 机の書いた計画（2 分ごとの同期で取り込み、端末の規則でもう一度確かめる）     ▼
                                     机（npm run desk）──Bearer トークン──► monitoring-desk（Pages）
```

- タブは、委任のある記録ごとに、アカウントの写しを読み、机の書いたものを取り込み、足りないものを送る
  （`lib/sync/investigations.ts`）。送った印は端末に持たない。アカウントの写しが一覧なので、途中で切れた
  回は次の回が仕上げる。読み取りの記録は別の口で、1 分に 1 件の種類ごと、30 秒ごとにまとめて送る。
- 机は `npm run desk -- list | pull <record> | run <record> <n> | write <record> <file>`。取ったものは
  `desk-work/<record>/` に置く（git に入らない。公開 repo なので）。
- 机の答えには、オーナーの ID も VIN も無い。識別の読取（IDENT・AIF など）は中身ごと伏せ、ほかの応答と
  文字列の中の VIN は伏せ字にする。
- 机が書けるのは、計画（委任の範囲の読取だけ）・事実・読み・問い・机への問いへの答え・自分の書いたものの
  状態。全部通るか、一つも書かないか。

## 8. 分かっている穴

- DSC のテレグラムは静的な抜き出しでは決まらない（52 ジョブのうち一意は 1 件）。SGBD の実行トレースが要る（段 5）。
  データ repo の表は `.prg` から作り直した（2026-10-28、データ repo #2）。それで試験は 611 件すべて通る。
- `tools/check_references.py` は開発機の参照物を検査するのでクラウドでは落ちる。データ repo のダンプは
  台帳とハッシュが合わない（大きさが数 % 違い、改行コードの違いに見える）。
- `node tools/check_ui_tokens.mjs` が `CreditsDialog.tsx:124` の `text-[9px]` で落ちる（main から）。
- 切り替え時に `0x9F` を送るかは未決（PLAN §2-4）。実車で測って決める。
- 読み取りの記録とまとめて送る前の待ちは、ページを閉じると失われる（最大 30 秒ぶん）。
