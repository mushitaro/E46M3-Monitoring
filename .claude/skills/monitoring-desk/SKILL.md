---
name: monitoring-desk
description: 'The desk side of E46M3 /// MONITORING (DS2 diagnosis of a BMW E46 M3): read an investigation the owner handed over (its CO-WORK record and mandate, the PROBE runs and read records), move it one turn round the diagnostic cycle — hypotheses with the observation that would refute each, evidence in the cheapest order, a plan of reads inside the mandate, judgements with their provenance, the next step — and turn what the tool could not answer into a development task. Use it when analysing a MONITORING run or investigation, writing or revising a PROBE plan, answering a question CO-WORK left for the desk, deciding whether a symptom is DSC, SMG II or DME, or making a module, job or value readable — 「調査を解析して」「次の計画を書いて」「DSC の応答を読めるようにして」「この故障の原因は？」「SMG 側も見て」 "analyse the investigation", "write the next plan", "why was this read refused".'
---

# MONITORING — 机の側

車の側の会話の手順は `public/guide/*.md`（タブが名乗り、中継が `monitoring_guide` で返す）。この Skill はその**机の側**：任された調査を一周進め、道具が答えられなかったところを開発に回す。仕組みの正本は `docs/AUTONOMY.md`。

## 場所

| 何 | どこ |
|---|---|
| CO-WORK の規則（委任・計画・所見） | `src/lib/notebook/rules.ts` |
| 計画の手順の形、RAM の窓 | `packages/monitoring-engine/src/probe/plan.ts` |
| 全モジュールの故障の読み取り | `packages/monitoring-engine/src/probe/scan.ts` |
| ランどうしの比較、一つの値の推移 | `src/lib/probe/compare.ts` |
| タブの実行器、判定 | `packages/monitoring-engine/src/probe/executor.ts`、`criteria.ts` |
| 送ってよいかの判断 | `packages/monitoring-engine/src/runGate.ts`（`mayRun`、`mayRunProtocolRead`） |
| モジュールごとの送れるフレーム | `packages/monitoring-engine/src/moduleProtocol.ts` |
| 台帳（停車中に答えた・走行中に読んでよい） | `packages/monitoring-engine/src/ledger.ts` |
| ジョブのカタログ（BMW SGBD 由来） | `public/ecu-data/`（private の `E46M3-Monitoring-data` から置く） |
| 任された調査（アカウントの写し） | `npm run desk -- list`・`pull <record>`・`run <record> <n>`（`workers/desk` を通す。オーナーの ID と VIN は出ない。取ったものは `desk-work/` に置き、コミットしない） |
| 車 | Matrix MONITORING WORKS（`monitoring_*`）。TUNER の RAM の名前は `tuner_ram` |

## 先に読む

0. **取る。** `npm run desk -- list` で委任が立っている調査を見て、`pull <record>` で記録・実行の一覧・読み取りの記録を、要る実行だけ `run <record> <n>` で取る。委任が立っていない調査は机には見えない — それが正しい。
1. **委任を読む。** 誰の言葉で、どのモジュールまで、いつまでか。範囲の外には手を出さない。期限が切れていたら、問い（`ask`、`to: driver`）を残して止まる。
2. **ドライバーの言葉と問いを読む。** 待っている問いに答えが来ていれば、それを前提にする。ドライバーがしたことをデータから決めない — 問いにする（tsunagi-m-research の「走行を読む前に」と同じ）。
3. **前の読みを読む。** 違う結論なら `re` で並べる。上書きしない。

## モードで一周の形が変わる

委任の `mode` が調査の種類を言う（`rules.ts` の `InvestigationMode`）。車の側の手順は guide の同名のトピックで、机は同じ形で続ける。`mode` の無い古い委任は、言葉から決めて `read` に書く。

| mode | 机がすること |
|---|---|
| `reactive`（事後保全） | `focus` のコードについて、フリーズフレームと関係する値から仮説を立て、計画の版を重ねて値を絞る。対策が画面の手順なら手順を書いて問いにし、対策のあとは同じ計画で再観測を待つ。定点観測では前のランと比べ、再発・回復を書く |
| `predictive`（予兆保全） | 全ブロック（`3:*`）と学習値（`adapt`）、合格基準（`judge`、出所つき、24 まで）の計画。毎回の観測を前回と比べ（`compareRuns`）、3 回目からは推移（`trend`）で評価する。外れた値ごとに「様子見・点検・調整」と根拠を書く。基準を実測から決め直すなら出所は `observed` |
| `symptom`（症状） | 言葉から値を見繕い（guide `symptom` の表が出発点）、症状の起きる条件で取る計画。前の `predictive` の記録があれば、そのランを基準に比べる |

**観測の系譜**：PROBE のセッションは記録一つで、次の回はオーナーの NEXT（またはアシスタントの `monitoring_session` next）が新しい記録に引き継ぐ。新しい記録の委任の `follows` が前の記録を指し、その鎖が系列になる（`lib/probe/sessions.ts` の `lineage`）。古い記録が委任を足して続いているのも、そのまま系列として読む。`compareRuns` は二つのランの**形**（`formOf`）を渡すと、両方の形が測った項目だけを比べ、足した・外した項目を `items` に分ける（`lib/probe/items.ts`）。項目を足す・外すときは計画の新しい版（`re` で今の形を指す）を書く。データを取った形は書き換えず、足した項目はその版の最初のランから数える。条件（`where`）を変えた判定は別の項目として書く。別の系列のランと比べるとき（症状を健康診断の基準と）は、条件（計画の版、暖機、アイドル）が揃っているかを先に書く。

## 一周

1. **症状を一文に**：ドライバーの言葉のまま。
2. **仮説を複数**：各々に、それを**否定する観察**を書く（`plan.ts` の `refutedBy` が必須なのはこのため）。
3. **証拠は安い順**：故障とフリーズフレーム → 停車中の状態 → 停車中のライブ値 → 走行中の捕捉（条件で取る。運転は指示しない） → DME の RAM（master の窓、`tuner_ram`） → 画面での手順（作動テスト・システムチェック。人が実行）。
4. **計画を書く**：委任の範囲の読み取りだけ。手順は 12 まで（`faults`・`read`・`sample`（`3:*` でブロックごと）・`adapt`・`ram`・`capture`）、判定（`judge`、24 まで）には基準値の**出所**（sgbd・inpa・authored・observed）。出所の無い値は `authored` と書き、そう言う。書く前に catalog と runGate で**送れるか**を確かめる。送れないものを計画に入れても、タブが断るだけ。
5. **読む**：タブの判定をそのまま使う。計算し直さない。`fact` は区間と値と読み方つき、`read` は確かさつき。
   書くのは `npm run desk -- write <record> <file>`（`[{ "body": … }]`）。`desk` として、サーバーの時刻で書き足される。全部通るか一つも書かないかで、拒否はどの項目がどの規則に当たったかを言う — その文のまま直す。
6. **次の一手**：
   - 支持 → 対策の提案（修理、画面での手順、マップの変更は TUNER・SMG2 MAPPING）と、直ったかを確かめる計画。
   - 否定 → 次の仮説。モジュールを替えるなら理由を書く。
   - 不足 → 同じ計画を、足りない条件で。
   - 道具の失敗 → 下の「道具の穴」。**拒否された読み取りを送り直す計画を書かない。**

## 道具の穴を開発に回す

道具が答えられなかったら、それが開発の仕事になる。種類ごとに直す場所が違う。

| 穴 | 例 | 直すところ | 承認 |
|---|---|---|---|
| テレグラムが一意でない | DSC の STATUS が `56 04 00 52` に潰れている | SGBD の実行トレース（`tools/SgbdDump`）→ `telegrams.json` | 人 |
| 応答の読み方が無い | DSC の故障の応答がバイトのまま | デコーダ（ds2-mss54 の形で、出所つき） | 読取専用のデコード表は自動、リンク層は人 |
| ジョブの分類が違う | 作動を述べる STATUS_* | `tools/sgbd/classify.py` | 人 |
| 手順書の不足 | 頼み方に合うトピックが無い | `public/guide/*.md` | 前提・言わないことは人、ほかは自動 |
| 例題で答えられない | 能力の表に穴 | `scenarios/` と能力 | 自動 |

- PR は分類を一つにまとめる（承認の要るものと要らないものを混ぜない）。分類はパスで決まり、CI が見る。
- 試験はシミュレータで、車で記録した応答を再生して書く。**自分のモックで証明しない**（tsunagi-m-link §24）。

## しないこと

- 委任の外を読む計画、読み取り以外の手順。
- ドライバーがしたことをデータから決めること。
- 前の記録を消す・書き換える。
- 台帳を `moving-ok` にすること（オーナーが決める）。
- VIN・位置・人を特定できるものを所見に書くこと。
- 推定値を実測値の顔で書くこと。
