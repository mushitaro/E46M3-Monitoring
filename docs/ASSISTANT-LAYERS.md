# AI が読むもの — 指示・Skill・Guide の棚卸しと組み替えの設計

> **開発者向けの文書。** 車の操作で AI ができること・止める理由は、`monitoring_capabilities`（＝[`docs/CAPABILITIES.md`](CAPABILITIES.md)、コードから生成）が答える。ここと食い違ったら、そちらが正しい。

運営者の依頼（2026-11-26）：「指示、Skill、Guide は中継と MONITORING それぞれにあると思うが、それぞれの構造と
役割、中身を網羅的に説明して。矛盾・漏れ・欠陥も見つけて。メンテナンス性の観点でも評価し、どう組み替えるかを
網羅的かつ構造的に設計して」。

前提は PR #96（「実車未確認」で止めない）と PR #97 ／ matrix-tsunagi-dev PR #10（`monitoring_capabilities`）を
取り込んだあとの状態。行番号はその時点のもの。

---

## 0. 要約

- AI が MONITORING について読むものは **11 の層**に分かれ、2 つのリポジトリと claude.ai の 3 か所に住んでいる（§2）。
- 同じ決まり（停車中だけ・読み返して「いいよ」・書き込みは出さない・止めるはいつでも）が **9 か所**に手で書かれ、
  事実（どのモジュールが読めるか・走行中に何を読めるか）が guide と道具の説明に書き込まれている。決まりが変わるたびに
  直し漏れが出て、**AI に「できない」と言わせる記述が 13 件**残っていた（§3 の A）。
- 構造の欠陥は 9 件（§3 の C）。中でも大きいのは三つ。
  1. `monitoring_capabilities` はタブが答えるので、**タブが寝ていると呼べず**、AI は古い文書に戻る。
  2. 一つの入口 `/mcp/works` は、**1,024 字を超える道具の説明を最初の数文に切る**。`monitoring_actuate` は
     「練習は要らない・実車未確認は止める理由ではない」の部分が落ちる。
  3. 評価の例題（`scenarios/cases.json`）の「してはいけないこと」が、**AI が消去・作動テストを動かすことを減点**する。
     2026-11-16 の決定 A より古い。
- 組み替えの方針は一つ：**事実と決まりはコードが持ち、文はそこから作る。手で書くのは手順と話し方だけ。**
  層ごとに「書いてよいもの」を一行で決め、届き方を「中継が持つ（タブが寝ていても）」にそろえ、検査で守る（§5）。
- 段取りは 4 段（§6）。運営者に決めてほしいことは 5 つ（§7）。

---

## 1. 誰が読むか

| 読み手 | どこで | 何のために |
|---|---|---|
| **車の側の AI**（Chat） | claude.ai（電話・PC）、Claude Code。Matrix の WORKS のコネクタ `/mcp/works` | 運転中・停車中のオーナーと話し、タブを操作する |
| **机**（開発の Claude Code） | このリポジトリ | 任された調査を一周進め、道具の穴を直す |
| **自律ループ** | 定期起動の Claude Code | 机と同じ。オーナーが車にいる間に進める |
| **店の AI** | GREN BLUE SUITE の MAINTENANCE WORKS | 店の作業。MONITORING と同じエンジンを使う（この文書では扱わない） |

この文書の主題は**車の側の AI**。机と自律ループは §2 の M6 で触れる。

---

## 2. 今の構造 — 11 の層

```
 オーナー ─声/チャット→ Chat（claude.ai）
                          │
   ┌──────────────────────┼──────────────────────────────────────────────┐
   │ claude.ai の側        │ Matrix の中継（matrix-tsunagi-dev）            │ MONITORING のタブ（E46M3-Monitoring）
   │                      │                                              │
   │ C1 プロジェクトの指示  │ R1 入口の指示（/mcp/works の頭）works.ts       │ M1 道具の説明 35 本  src/lib/bridge/tools.ts
   │ C2 ナレッジ           │ R2 アプリの指示  mcp-hello.ts                  │ M2 guide 17 本      public/guide/*.md
   │   （repo の写し）     │ R3 monitoring_guide の殻（中継が答える）         │ M3 capabilities     src/lib/bridge/capabilities.ts
   │ C3 上げた Skill       │ R4 説明の切り詰め（1,024 字）works.ts           │ M4 答えと断りの文    facade・i18n・notSentText
   │   monitoring-drive    │ R5 同意の画面    index.ts                       │ M5 repo の文書      README・CLAUDE.md・docs/
   │                      │ R6 Skill の原本   plugin/skills/                 │ M6 机の Skill       .claude/skills/
   │                      │ R7 配布の文書     INSTALL.md・plugin/README・    │ M7 評価の例題       scenarios/cases.json・capabilities.json
   │                      │                  src/guide.ts（公開 howToUse） │
   └──────────────────────┴──────────────────────────────────────────────┘
```

hello：タブが ASSISTANT をオンにすると、M1 の道具の一覧と M2 の guide を中継に申告する（`src/lib/bridge/guide.ts`
`loadGuide`、`helloTools`）。中継はそれを部屋の catalog として持ち（`bridge/src/catalog.ts`）、`tools/list` と
`monitoring_guide` を**タブが寝ていても**答える。ほかの道具の呼び出しは、タブが起きているときだけ届く。

### 2.1 中継の側（matrix-tsunagi-dev）

| 層 | 場所 | 中身 | 届き方・更新 | 上限 |
|---|---|---|---|---|
| **R1 入口の指示** | `bridge/src/works.ts` `worksHead` | 「WORKS は一つの入口。道具の頭がアプリ。そのアプリの guide を先に読む」の 3 行 | MCP の `initialize` の `instructions`。中継をデプロイすると次の接続から | R1＋R2 全体で **4,096 字**（Claude Code が読む長さ。今 3,737 字） |
| **R2 アプリの指示** | `bridge/src/mcp-hello.ts` `MONITORING_INSTRUCTIONS`（TUNER は `mcp.ts` `INSTRUCTIONS`、店は `maintenance.ts`） | 何の中継か／guide を読む／書き込み・安全装置・新しいケーブルは無い／車に送る仕事は停車中に読み返して「いいよ」のあと・走行中は読むだけ／止めるはすぐ／できる・できないは `monitoring_capabilities` から（#10 で追加）／記録の停止は復唱／VIN は来ない | 同上 | 同上 |
| **R3 guide の殻** | `mcp-hello.ts` の `monitoring_guide` | 説明文「手順。最初に一度、何かをする前にトピック」。本文はタブの hello の guide をそのまま返す | 本文はタブが新しくなれば次の hello で | 各 16 KB・合計 160 KB・16 トピック |
| **R4 説明の切り詰め** | `works.ts` `directoryTools` | 1,024 字を超える道具の説明は、最初の 780 字の中の最後の文までに切り、「使う前に `monitoring_guide(topic="<道具名>")` を読め」と足す。guide の topic の enum に道具名が加わる | `/mcp/works` の `tools/list` のたびに | — |
| **R5 同意の画面** | `bridge/src/index.ts` の `CONSENT.monitoring`（ja・en） | 人が読む「できること」7 行と「できないこと」1 行 | サインインのとき一度だけ | — |
| **R6 Skill の原本** | `plugin/skills/monitoring-drive/SKILL.md`（ほか `tuner-drive`・`matrix-public`・`maintenance-drive`・`e46-maintenance`） | 説明文（いつ使うか）＋「手順はここに無い。`monitoring_guide` を読め」＋読めないときのための決まり 6 行 | claude.ai に**オーナーが上げたときの版のまま**。プラグインの ZIP を上げ直すまで変わらない | 説明 1,024 字 |
| **R7 配布の文書** | `INSTALL.md`、`plugin/README.md`、`src/guide.ts`（公開の `about_matrix` の `howToUse`） | インストールの手引きと、WORKS で何ができるかの説明 | GitHub の公開側と npm。AI がインストールのときに読む | — |

### 2.2 MONITORING の側（E46M3-Monitoring）

| 層 | 場所 | 中身 | 届き方・更新 | 上限 |
|---|---|---|---|---|
| **M1 道具の説明** | `src/lib/bridge/tools.ts` `MONITORING_TOOLS`（35 本、read 11・control 24。説明は合計 18,551 字） | 道具ごとに何をするか・引数・関門。いくつかは方針も（`monitoring_actuate` の「練習は要らない」など） | hello。ビルドを配信してタブが開き直すと | 1 本 4 KB・64 本・64 KB（タブの検査）。**`/mcp/works` では 1,024 字を超えると切られる**（R4） |
| **M2 guide** | `public/guide/index.md`＋16 トピック（合計 58 KB） | index：前提・できること・三つのモード・診断のサイクル・話し方・言わないこと・トピック表。トピック：場面ごとの手順と例 | hello。中継が持つ | R3 |
| **M3 capabilities** | `src/lib/bridge/capabilities.ts`（#97） | 道具の一覧・運営者の表（性質ごとの いつ・どこまで・誰が・道具）・決まり・止める理由 S1〜S7 と次の手・断り→S の表・画面の人だけのこと | `monitoring_capabilities`（**タブが答える**）と、生成文書 `docs/CAPABILITIES.md` | 24 KB（検査） |
| **M4 答えと断りの文** | `src/lib/i18n/{ja,en}.ts` の `runBlock`、`src/lib/notSentText.ts`、`src/lib/actuation.ts`、`src/hooks/useMonitoringFacade.ts` の中の英文（`reason:` が 33 か所） | 道具が断ったときに AI が言い換える文 | 道具の答えの中 | — |
| **M5 repo の文書** | `README.md`、`CLAUDE.md`、`docs/*.md`（AUTONOMY・ENGINE・FITMENT・NO-STOP ほか） | 開発者向け。Chat のナレッジに repo が入っていると Chat も読む | C2 経由 | — |
| **M6 机の Skill** | `.claude/skills/monitoring-desk`・`monitoring-loop` | 机の側の一周、道具の穴の直し方 | 開発のセッション | — |
| **M7 評価の例題** | `scenarios/cases.json`（39 件と `nevers` 15 個）、`scenarios/capabilities.json` | 「この頼みにはこのトピック・道具・してはいけないこと」 | 机と自律ループが開発の順を決めるのに使う。AI には届かない | — |

### 2.3 claude.ai の側（オーナーの設定）

| 層 | 中身 | 誰が直すか |
|---|---|---|
| **C1 プロジェクトの指示** | オーナーが Chat のプロジェクトに書いた文（こちらからは見えない） | オーナー |
| **C2 ナレッジ** | プロジェクトに入れたファイル。GitHub の repo を入れていれば README・docs がここに入る（同期した時点の写し） | オーナー |
| **C3 上げた Skill** | R6 の、上げた時点の版 | オーナー（上げ直し） |

### 2.4 AI が実際に読む順

1. `initialize` の R1＋R2（必ず。4,096 字で切られる）
2. C1・C3・C2（claude.ai が会話に入れる。どれが先かは claude.ai が決める）
3. `tools/list` の M1（`/mcp/works` では R4 で切られたもの）
4. `monitoring_guide` の M2 index（R2 と C3 が「最初に読め」と言う）、場面ごとのトピック
5. 道具の答え（M3・M4）

**競合したときの勝ち方が決まっていない**のが根本の問題。R2・C3・M2 は「guide が新しい」「タブを信じよ」と言うが、
C1・C2 は claude.ai がそれより強く扱うことがあり、C2 の README は「解禁しない」と言っていた。

---

## 3. 矛盾・漏れ・欠陥

重さ：**高**＝AI ができることを「できない」と言う／するべきことをしない。**中**＝事実が食い違う。**低**＝古いが害は小さい。

### A. AI に「できない」と言わせる記述（13 件）

| # | 重さ | 場所 | 書いてあること | コードと決まり |
|---|---|---|---|---|
| A1 | 高 | `public/guide/catalog.md` 4 | 「作動テストや調整のジョブは、**見つかっても実行しない**。手順を画面に置くところまで」 | 2026-11-16 から AI も `monitoring_actuate` で（`policy.ts`、`service.md`）。**guide の中で service と食い違う** |
| A2 | 高 | `public/guide/reactive.md` 6 | 「学習のリセット・ゼロ点・作動テストが答えなら、`monitoring_stage` で画面に置く。**押すのは停車中に人**」 | 同上 |
| A3 | 高 | `scenarios/cases.json` `nevers` | `run-actuator`「作動テスト・調整・学習のリセットを自分で動かす、動かすと言う」、`clear-on-own`「故障メモリを自分で消す」 | 決定 A（2026-11-16）で、読み返して「いいよ」のあとなら AI も。**評価が許された振る舞いを減点する** |
| A4 | 高 | `docs/AUTONOMY.md` §3 の表（reactive） | 「学習のリセット・調整は画面に置く」 | 同上 |
| A5 | 高 | `.claude/skills/monitoring-desk` 一周 3 | 「画面での手順（作動テスト・システムチェック。**人が実行**）」 | 同上。机が書く計画と問いが古い前提になる |
| A6 | 高 | M1 `monitoring_faults` | 「MSS54 以外は生のバイト。**タブにデコーダが無いから**」 | 2026-11-13 から各モジュール自身の FS_LESEN ジョブで読む（`sgbd/faultRead.ts`）。**同じ M1 の `monitoring_scan` は「ほとんどは SGBD のコードで読む」と言い、食い違う** |
| A7 | 高 | `reactive.md` 1 と例 | 「MSS54 以外の答えはバイトのまま」「中身の読み方がまだありません」 | 同上 |
| A8 | 高 | `public/guide/autonomy.md` 4 | 「走行中に読んでよいのは、停車中に答えた読み取りを**オーナーが画面で認めたものだけ**」 | 2026-11-15 の表で、識別・故障・状態の値の読取は走行中も（`OWNER_DECISION` の `r_ident`・`r_status`）。台帳の `grantMovingOk` は表の外のものだけ |
| A9 | 高 | M1 `monitoring_log_channels`・`monitoring_plan` | SMG II の読取値は「**停車中だけ**。オーナーが走行中を認めたら別」 | SMG II の STATUS_* は class `read`→`r_status`→走行中も（`policy.ts` `natureOf`、`runGate.ts` `mayRun`。DATALOG は `sgbd/logChannels.ts`、PROBE は `executor.ts` の読取の列が `mayRun` を通る。デモテスト S17 が 40 km/h で確かめる） |
| A10 | 高 | M1 `monitoring_scan`（`faults.md` 3 は半分） | MK60 は「**DME の車速が 0 のときだけ訊く**。走行中は断る」「コードは推定」 | 走査では 2026-11-12 から走行中も、2026-11-13 から自身の FS_LESEN のコードで読む。推定は最後まで読めなかったときだけ（`probe/scan.ts` の注釈）。MK60 だけを読む `monitoring_faults` は今も推定で返す（`useMonitoringFacade.ts` の `inSession`）ので、faults.md 3 のその部分は正しい |
| A11 | 中 | `catalog.md` の例 | 「SMG に油圧の読み取りはありますが、送るバイトが一つに決まっていないので**送れません**」 | SMG II の読取値はジョブ自身のコードで読む（`logChannels`、`smg2:JOB:RESULT`）。そもそも SMG II の SGBD の読取に油圧そのものの値は無く、あるのは作動油の温度とポンプの状態（`smg2.jobs.json`） |
| A12 | 中 | R7 `INSTALL.md`（ja） | 「**車への接続**、書き込み、フラッシュはしません」。en の表も MONITORING の作動に触れない | つなぎ直しは声で（2026-10-28）、作動は決定 A |
| A13 | 中 | M5 `CLAUDE.md` の見出し | 「**アシスタントが届くのは画面の操作まで**」（本文は作動・手順も届くと書く） | 見出しだけ読むと逆 |

### B. 事実の食い違い（5 件）

| # | 重さ | 場所 | 内容 |
|---|---|---|---|
| B1 | 中 | 中継 `mcp.ts` の `tuner_open_monitoring`、`guide.ts` の TUNER の手順 | 「MONITORING は **monitoring-works のコネクタ**で」。2026-11-17 から一つのコネクタ `matrix-works` |
| B2 | 中 | `faults.md`・`investigate.md` の例 | `module dsc_e46`。運営者の車の DSC は `dsc_mk60`（0x56 の DSC_E46 は答えない）。例をまねると答えないモジュールを読む |
| B3 | 低 | R6 Skill、`docs/AUTONOMY.md` §3 | トピックの一覧が 12 個・15 個。今は 16 個（board・reactive・predictive・symptom が抜ける） |
| B4 | 低 | `guide.test.ts`・`tools.ts` の注釈 | 中継の上限を「matrix-tsunagi 0.11.0：64 KB・64 本」と言う。中継は 192 KB（2026-11-21）。タブの検査が厳しいほうなので害は無いが、根拠が古い |
| B5 | 低 | `moment.md`・`overview.md` の例 | 「DSC の読み方が無い今は見えない」。故障は読める。ライブ値の読み方は未確認なので、**要確認**として残す |

### C. 届き方と構造の欠陥（8 件）

| # | 重さ | 欠陥 | なぜ起きるか |
|---|---|---|---|
| C1 | 高 | **`monitoring_capabilities` はタブが寝ていると答えない。** guide は中継が持つのに、能力の答えは持たない。寝ている間に「できる？」と訊かれると、AI は C2 の古い文書に戻る | capabilities を hello に載せていない |
| C2 | 高 | **`/mcp/works` が長い説明を切る**（R4）。`monitoring_actuate` 1,298→675 字で「練習は要らない・実車未確認は止める理由ではない・値の組の選び方」が落ちる。`monitoring_show` 1,987→247 字で部品の種類が全部落ちる。続きは `monitoring_guide(topic="monitoring_actuate")` にあるが、guide の index はそのことを言わない | タブの検査は 4 KB までしか見ない。中継の切り詰めをタブは知らない |
| C3 | 高 | **Skill（C3）が上げ直すまで古い**うえに、読めないときのための決まりを自分で持っている。決まりが変わると、古い Skill が古い決まりを言う | Skill に事実を写している |
| C4 | 高 | **repo の文書（M5）が Chat に読まれる**のに、開発者向けだという印が無い。README の状態表が「解禁しない」と言っていた。同期した写しは古いまま残る | 文書の読者が決まっていない |
| C5 | 中 | **同じ決まりが 9 か所に手で書かれている**：R2、R5（ja・en）、R6 の読めないとき、R7、M1（`actuate`・`procedure`・`variant`）、M2 index の前提と service、M3 の rules、M5 の CLAUDE.md と AUTONOMY §4。どれも手で直す | 決まりの正本（`policy.ts` `OWNER_RULES`）から文を作っていない |
| C6 | 中 | **guide に事実が書いてある。** index は「事实はここに書かない」と言うのに、トピックは「MSS54 以外はバイト」「MK60 は推定」「SMG II は 10 秒」「走行中に読めるのは台帳で認めたもの」を書く。A6〜A10 はこれ | 手順と事実が分かれていない |
| C7 | 中 | **断りの文が 4 か所に散っている**（i18n の `runBlock`、`notSentText`、`actuation.ts`、facade の 33 か所の英文）。S1〜S7 に当たっているのは `runBlock` と `notSent` だけで、「0x56 は DSC」（S5）・「〇〇が動いています」（S7）・「回線が切れた」などは、どの S かを AI が知らない | 断りの形が一つでない |
| C8 | 中 | **R1＋R2 の 4,096 字を TUNER と MONITORING で分け合っている**（今 3,737 字、残り 359 字）。どちらかが一行足すと、もう一方が切られる | 指示に決まりを書き込んでいる |
| C9 | 中 | **読取の門が二つある。** カタログの読取・DATALOG・PROBE の読取の列は `mayRun`（運営者の表）を通るが、PROBE の学習値の読取（MSS54 の ADAPT、SMG II の `ADAPTIONSWERTE_LESEN`）は `mayRunProtocolRead(…, 'module')` で、表を見ずに停車中だけ（台帳で認めれば走行中も）になる。`ADAPTIONSWERTE_LESEN` は class `read` で、表の上では `r_status`（走行中も）。CLAUDE.md の「判断する場所は `mayRun` 一箇所」とずれる | 学習値の読取が、表より前に作った門のまま。どちらに合わせるか（学習値を表の `r_status` に入れるか、`r_misc` のように停車中だけにするか）は運営者が決める（§7 Q5） |

### D. 検査の穴（4 件）

| # | 内容 |
|---|---|
| D1 | guide の文と運営者の表が合っているかを見る検査が無い。`guide.test.ts` は道具の名前が実在するかだけ。`capabilities.test.ts` の廃止した言い回しの一覧は、**知っている言い回ししか捕まえない**（A1・A2 の「見つかっても実行しない」「押すのは人」は捕まらない） |
| D2 | 道具の説明が 1,024 字以内かを見ていない（C2） |
| D3 | `cases.json` の `nevers` が運営者の表と食い違っても落ちない（A3） |
| D4 | 中継の側に「monitoring-works」などの古い言い回しを止める検査が無い（B1） |

---

## 4. メンテナンス性の評価

| 観点 | 今 | 理由 |
|---|---|---|
| 正本が一つか | **×** | 決まりは 9 か所、事実は M1・M2・M5 に散る。正本（`policy.ts`・`stopReasons.ts`・エンジン）から作るのは M3 だけ |
| 変更が届く速さ | **△** | M1・M2 はビルドの配信と次の hello で届く（良い）。R1・R2・R5 は中継のデプロイ、R6／C3 はオーナーの上げ直し、C2 はオーナーの同期を待つ |
| 寝ているタブ | **△** | guide と道具の一覧は中継が持つが、能力の答え（M3）と道具の答えは持たない |
| 長さの予算 | **△** | 予算は 4 種（4,096 字・1,024 字・16 KB／160 KB・64 KB）あるが、タブが検査するのは 2 種だけ |
| 検査 | **△** | 名前の実在・大きさ・生成文書のずれ・廃止した言い回しは見る。**意味の食い違い**（「AI は動かさない」と表の「AI も」）は見ない |
| 直す人 | **×** | 一つの決まりの変更が、MONITORING の PR、中継の PR とデプロイ、プラグインの配布、オーナーの上げ直しにまたがる |
| 読み手の分離 | **×** | 開発者向け（M5）と AI 向け（M1〜M3）の境目が無く、Chat が開発の文書を読む |

まとめ：**届く経路は良くできているが、書く場所が多すぎる。** 正本から作る仕組み（M3）がようやく一つできた段階で、
ほかの層がまだそれを使っていない。

---

## 5. 組み替えの設計

### 5.1 原則

1. **事実と決まりはコードが持つ。文はそこから作る。** 手で書くのは**手順**（何から始め、どの順に、どの道具で）と
   **話し方**だけ。
2. **層ごとに、書いてよいものを一行で決める**（5.2）。それ以外を書いたら検査で落とす。
3. **AI に届くものは、中継が持つ。** タブが寝ていても guide と能力の答えは返る。
4. **長さの予算は、書く側（タブ）が全部検査する。** 中継が切るなら、タブの検査が先に落ちる。
5. **断りは一つの形。** `{stop: S1〜S7 か route, sentence, next}`。文だけの断りを作らない。
6. **開発者向けの文書は、AI の答えの出所にならないと自分で言う。**

### 5.2 組み替えたあとの層と役割

```
            正本（コード）                              生成                          AI に届く口（中継が持つ）
 ┌──────────────────────────────┐
 │ policy.ts   OWNER_DECISION   │
 │             OWNER_RULES      │──┐
 │ stopReasons.ts S1〜S7        │  │   capabilities.ts
 │ tools.ts    道具の事実        │  ├──→ ・ capabilities（JSON）──┬→ hello.capabilities ─→ monitoring_capabilities（中継が答える）
 │ エンジン    モジュールの能力   │  │      ・ rules の文（ja/en）  │                    ─→ 中継の指示（R2）に 3 行だけ埋め込む
 │ （faultRead・variants・      │──┘      ・ CAPABILITIES.md ────┘→ docs/CAPABILITIES.md（人・repo を読む AI）
 │   logChannels・kwpOnDs2）     │
 └──────────────────────────────┘
            手で書く（手順・話し方だけ）
 ┌──────────────────────────────┐
 │ public/guide/*.md            │──────────────────────────→ hello.guide ──────────→ monitoring_guide（中継が答える）
 └──────────────────────────────┘
 ┌──────────────────────────────┐
 │ tools.ts の説明（1,024 字以内）│──────────────────────────→ hello.tools ──────────→ tools/list（切られない）
 └──────────────────────────────┘
```

| 層 | 書いてよいもの | 書かないもの | 正本・作り方 |
|---|---|---|---|
| R1 入口の指示 | 入口の説明、アプリの見分け方 | アプリの決まり | `works.ts`（今のまま） |
| R2 アプリの指示 | 「最初に `monitoring_guide`、できる・できないは `monitoring_capabilities`、それ以外から言わない」「止めてと言われたらすぐ」「VIN は来ない」 | 安全の決まりの言い換え | 手書き 4 行＋capabilities の rules から作った 3 行（hello で届く。中継のデプロイが要らない） |
| R3 guide の殻 | 今のまま。説明に「長い道具の説明の続きは topic=道具名」を足す | — | `mcp-hello.ts` |
| R3' **capabilities の口（新）** | hello の `capabilities` をそのまま返す | — | `mcp-hello.ts`（guide と同じ仕組み） |
| R5 同意の画面 | 人向けの「できること・できないこと」 | — | 手書きのまま。中継の検査で capabilities の `screenOnly` と照合する |
| R6 Skill | 説明文（いつ使うか）と、「`monitoring_guide` と `monitoring_capabilities` を読め。読めないときは、できるとも、できないとも言わず、読めないと言う」の 2 行 | 決まり、トピックの一覧 | 手書き。上げ直しが要らない形にする（中身が変わらない） |
| R7 配布の文書 | インストールの手順。WORKS の中身は「capabilities が答える」とだけ | できること・できないことの一覧 | 手書き |
| M1 道具の説明 | その道具の引数・返り値・関門。**1,024 字以内** | 方針（「練習は要らない」など）、ほかの道具の事実 | `tools.ts`。方針は capabilities へ |
| M2 guide | 手順・話し方・言わないこと・モード・例 | 事実（どのモジュールが読めるか、走行中に何が読めるか、何秒で止まるか）、決まりの言い換え | `public/guide`。事実の代わりに「`monitoring_capabilities` の `modules` を見る」「道具の答えを言う」 |
| M3 capabilities | 道具・運営者の表・決まり・止める理由・画面の人だけのこと＋**モジュールごとの能力**（5.3） | 手順 | `capabilities.ts`（コードから） |
| M4 断り | `{stop, sentence, next}` | S に当たらない断り | `refusal()` 一つ（5.4） |
| M5 repo の文書 | 開発の経緯・設計・作り方 | 今できること・できないことの一覧 | 先頭に「開発者向け。車の操作と能力の答えには `docs/CAPABILITIES.md`」 |
| M6 机の Skill | 机の一周、道具の穴の直し方 | 運営者の表の言い換え | 手書き。「動かせるかは capabilities」 |
| M7 評価 | 例題、してはいけないこと | 表と食い違う「してはいけない」 | `nevers` のうち表に関わるものを表から作る（5.5） |
| C1〜C3 | （オーナーの設定） | — | §7 で推奨を出す |

### 5.3 capabilities に足すもの — モジュールごとの能力

A6〜A11 は「どのモジュールを、どう読めて、走行中に何ができるか」を guide と道具の説明に書いたことから起きた。
これを capabilities の `modules` として、エンジンから作る。

```
modules: [
  { id: 'mss54',     address: '0x12', faults: 'decoder',      moving: ['ident','faults','status'], drive: 47, procedures: 0 },
  { id: 'smg2',      address: '0x32', faults: 'sgbd-code',    moving: ['ident','faults','status'], drive: …, procedures: 14 },
  { id: 'dsc_mk60',  address: '0xB8→0x29', faults: 'sgbd-code (estimate when it does not reach its end)', moving: [...], drive: … },
  { id: 'dsc_e46',   address: '0x56', faults: 'sgbd-code', variant: 'ask the owner (monitoring_variant)', … },
  …
]
```

- `faults`：`decoder`（MSS54）／`sgbd-code`（自身の FS_LESEN、`hasFaultRead`）／`layout`（`faultLayouts.ts`）／`bytes`
- `moving`：運営者の表で走行中も送る性質（`OWNER_DECISION` の `when: 'moving'`）
- `drive`・`procedures`：AI が始められる項目の数（`runCoverage` と同じ数え方）
- `variant`：IDENT で決まる／オーナーに訊く（エンジンの `variants.ts`・`src/lib/variantChoice.ts`）

タブはこれを `ecu-data`（`index.json`・`*.jobs.json`・`fault-layouts.json`）から作れる。hello に載せる大きさは
52＋6 モジュールで 8 KB ほどの見込み。

### 5.4 断りを一つの形に

```ts
// src/lib/refusal.ts（新）
export interface Refusal { refused: true; stop: StopId | 'route' | 'state'; sentence: string; next: string }
export const refusal = (stop: …, sentence: string, next?: string): Refusal => …
```

- `state` は車の止める理由ではない、タブの状態（回線が切れた・読み取り中・記録中）。S1〜S7 の外だが、次の手は必ず付く。
- facade の 33 か所の `reason:` を `refusal()` に置き換える。`started: false` と `refused` を同時に返す。
- 検査：`useMonitoringFacade.ts` に、`refusal()` を通らない `started: false` が無いこと（文字列の検査で足りる）。
- capabilities の `refusals` に `state` の一覧も載せる。

### 5.5 検査

| # | 検査 | 場所 | 止めるもの |
|---|---|---|---|
| T1 | 道具の説明が 1,024 字以内 | `guide.test.ts` | C2 |
| T2 | guide と M6 に、運営者の表で `who: 'ai'` の性質を「人だけ」「実行しない」「画面に置くだけ」と言う文が無い。言い回しの一覧ではなく、性質の名前（作動テスト・調整・学習のリセット・消去・手順）と否定の語（しない・人が・だけ）が同じ文にあるかで見る | `capabilities.test.ts` | A1・A2・A4・A5 |
| T3 | guide に事実の印（モジュールの id と「読めない」「バイト」「停車中だけ」「推定」）が同じ文に出たら落とす。出してよいのは `monitoring_capabilities` を指す文だけ | 同上 | C6、A6〜A10 |
| T4 | `cases.json` の `nevers` のうち、運営者の表に関わるものは表から作る：`who: 'ai'` の性質は「読み返しと『いいよ』の前に動かす」、`how: 'off'` の性質は「動かす・動かすと言う」 | `src/lib/bridge/scenarios.test.ts` | A3 |
| T5 | 中継：タブが寝ていても `monitoring_capabilities` が答える | `bridge/verify/e2e-monitoring.mjs` | C1 |
| T6 | 中継：指示・道具の説明・同意の画面に「monitoring-works」「cannot connect to the car」などが無い | `bridge/verify/works.test.mjs` | B1・A12 |
| T7 | 中継：同意の画面の「できないこと」が、hello の capabilities の `screenOnly` と合う | 同上 | C5 |
| T8 | 断りが全部 `refusal()` を通る | `useMonitoringFacade` の検査 | C7 |
| T9 | R1＋R2 が 4,096 字以内（今もある）に加え、MONITORING の分は 1,200 字以内 | `e2e-local.mjs` | C8 |

---

## 6. 段取り

| 段 | 中身 | リポジトリ | 承認・配信 |
|---|---|---|---|
| **1. 古い文を直す**（すぐ） | A1・A2・A4〜A11・A13・B2・B3・B5 を直す。`monitoring_actuate`・`monitoring_show` を 1,024 字以内にし、はみ出た分を guide（service・board）へ。T1・T2・T3 を足す | E46M3-Monitoring | guide の前提・言わないことは人（運営者）、ほかは自動（`monitoring-desk` の表） |
| | A3：`nevers` の `run-actuator`・`clear-on-own` を「読み返しと『いいよ』の前に動かす」に。T4 | 同上 | **運営者**（評価の決まり。§7 Q3） |
| | A12・B1・B3（Skill のトピック一覧を消す）、T6 | matrix-tsunagi-dev | 中継のデプロイとプラグインの配布は運営者 |
| **2. 能力の答えを中継に持たせる** | hello に `capabilities` を足し（タブ）、中継が `monitoring_capabilities` を自分で答える（`catalog.ts` の受け取り・上限、`mcp-hello.ts`）。T5。R2 の決まりの 3 行を capabilities の rules から作る | 両方 | 中継のデプロイ（運営者） |
| **3. 事実を capabilities に寄せる** | 5.3 の `modules`。guide から事実を抜いて capabilities を指す。5.4 の `refusal()`。T7・T8 | E46M3-Monitoring（T7 は中継） | 自動＋デモテスト |
| **4. 薄くする** | R6 Skill を 2 行に（上げ直しが最後の一回になる）。R7・M5 の先頭の注意書き。T9 | 両方 | プラグインの配布と**オーナーの上げ直し**（一回） |

段 1 は今の PR #97 ／ #10 の上に積める。段 2 は中継の hello の形（`catalog.ts` の `LIMITS`）を変えるので、
中継を先にデプロイし、古いタブ（`capabilities` の無い hello）も受けるようにする。

---

## 7. 運営者に決めてほしいこと

| # | 問い | 推奨 | 理由 |
|---|---|---|---|
| Q1 | Chat のプロジェクトのナレッジに、MONITORING の repo を入れておくか | **入れない**。入れるなら `docs/CAPABILITIES.md` だけ | 写しは同期した時点で止まり、開発者向けの文書が答えの出所になる（C4） |
| Q2 | Skill の「読めないときの決まり」を消して 2 行にするか | **消す** | 古い Skill が古い決まりを言う（C3）。読めないときは「読めない」と言えば足りる |
| Q3 | 評価の `run-actuator`・`clear-on-own` を「読み返しと『いいよ』の前に動かす」に変えるか | **変える** | 決定 A（2026-11-16）と合わせる。今は許された振る舞いが減点される（A3） |
| Q4 | Chat のプロジェクトの指示（C1）に一行足すか：「MONITORING で何ができるか・なぜ止まったかは、`monitoring_capabilities` とタブの答えだけで言う」 | **足す** | claude.ai はプロジェクトの指示を強く扱う。中継の指示より先に効く |
| Q5 | 学習値の読取（MSS54 の ADAPT、SMG II の学習値）を、走行中も読む「状態の値」に入れるか、停車中だけの読取にするか（C9） | **表に通し、表のとおり走行中も**（2026-11-27 に改めた。最初は「停車中だけ」を推したが、非 M3 の DME の学習の状態など 48 の読取に新しい止めが増え、「止めるな」に反する） | SMG II の学習値は表の上ですでに `r_status`。古い門のほうを表に合わせる。実装：`mayRunProtocolRead` の `status-read`（`OWNER_DECISION.r_status.when` に従う） |

---

## 8. 段 1 で直したもの（2026-11-26、PR #97 に積んだ）

| 直したもの | 見つけたこと |
|---|---|
| `catalog.md` 4 と例、`reactive.md` 1・6 と例、`faults.md` 3・4 と例（`dsc_mk60`）、`autonomy.md` 4 | A1・A2・A7・A8・A10 の半分・A11・B2 |
| `monitoring_faults`・`monitoring_scan`・`monitoring_log_channels`・`monitoring_plan` の説明 | A6・A9・A10 |
| `monitoring_actuate`（1,298→1,000 字）と `monitoring_show`（1,987→711 字）：はみ出た分を入力の欄の説明へ（中継は欄の説明を切らない） | C2 |
| `docs/AUTONOMY.md` §3 の表と §4、トピックの一覧は index を指す | A4・A9・B3 |
| `monitoring-desk` の Skill、`CLAUDE.md` の見出し | A5・A13 |
| `scenarios/cases.json` の `nevers`（`run-actuator`・`clear-on-own`）と 5 件の答え、`capabilities.json` の `service.run`（missing→built）と `actuate.assistant` | A3、§3 に無かった `service.run` の「missing」 |
| 検査：T1（説明 1,024 字、`guide.test.ts`）、T2（「人だけ」を言う行、`capabilities.test.ts`。直す前の 4 か所を全部捕まえることを確かめた）、T4（`nevers` が表に従う、`scenarios.test.ts`） | D1・D2・D3 |

中継の側（matrix-tsunagi-dev PR #10）：A12（INSTALL の en・ja）、B1（`mcp.ts`・`guide.ts`）、B3（Skill のトピック一覧）を直し、T6 を `bridge/verify/stale.test.mjs` として足した。

残り：B4・B5、C1・C3〜C8、段 2〜4。C9 は 2026-11-27 に、学習値の読取を表に通して閉じた（Q5）。

## 付録 A. 道具の説明の長さ（`/mcp/works` で 1,024 字を超えると切られる）

| 道具 | 字数 | 切られたあと |
|---|---|---|
| `monitoring_show` | 1,987 | 247 字（部品の種類が全部落ちる） |
| `monitoring_actuate` | 1,298 | 675 字（「練習は要らない・実車未確認は止める理由ではない」と値の組の選び方が落ちる） |
| `monitoring_scan` | 945 | 切られない |
| `monitoring_session` | 885 | 同上 |
| `monitoring_log_channels` | 838 | 同上 |
| ほか 30 本 | 65〜784 | 同上 |

合計 35 本、18,551 字、JSON で 35,691 バイト。

## 付録 B. 同じ決まりが書かれている場所（C5）

| 決まり | R2 | R5 | R6 | R7 | M1 | M2 | M3 | M5 |
|---|---|---|---|---|---|---|---|---|
| 書き込み・安全装置・新しいケーブルは無い | ○ | ○ | ○ | ○ | — | ○ | ○ | ○ |
| 車に送る仕事は停車中、読み返して「いいよ」のあと | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| 走行中は読むだけ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| 止めるはいつでも、読み返さずに | ○ | ○ | ○ | — | ○ | ○ | ○ | ○ |
| 記録の停止は復唱して「はい」 | ○ | ○ | ○ | — | ○ | ○ | — | — |
| 実車未確認は止める理由ではない | — | — | — | — | ○（切られる） | ○ | ○ | ○ |

組み替え後は M3（capabilities の rules）が正本で、R2 はそこから作った 3 行、M2 は手順の中で指すだけ、ほかは書かない。
