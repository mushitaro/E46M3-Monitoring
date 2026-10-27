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
| 計画の手順の形、RAM の窓 | `src/lib/probe/plan.ts` |
| タブの実行器、判定 | `src/lib/probe/executor.ts`、`criteria.ts` |
| 送ってよいかの判断 | `src/lib/runGate.ts`（`mayRun`、`mayRunProtocolRead`） |
| モジュールごとの送れるフレーム | `src/lib/moduleProtocol.ts` |
| 台帳（停車中に答えた・走行中に読んでよい） | `src/lib/ledger.ts` |
| ジョブのカタログ（BMW SGBD 由来） | `public/ecu-data/`（private の `E46M3-Monitoring-data` から置く） |
| 車 | Matrix MONITORING WORKS（`monitoring_*`）。TUNER の RAM の名前は `tuner_ram` |

## 先に読む

1. **委任を読む。** 誰の言葉で、どのモジュールまで、いつまでか。範囲の外には手を出さない。期限が切れていたら、問い（`ask`、`to: driver`）を残して止まる。
2. **ドライバーの言葉と問いを読む。** 待っている問いに答えが来ていれば、それを前提にする。ドライバーがしたことをデータから決めない — 問いにする（tsunagi-m-research の「走行を読む前に」と同じ）。
3. **前の読みを読む。** 違う結論なら `re` で並べる。上書きしない。

## 一周

1. **症状を一文に**：ドライバーの言葉のまま。
2. **仮説を複数**：各々に、それを**否定する観察**を書く（`plan.ts` の `refutedBy` が必須なのはこのため）。
3. **証拠は安い順**：故障とフリーズフレーム → 停車中の状態 → 停車中のライブ値 → 走行中の捕捉（条件で取る。運転は指示しない） → DME の RAM（master の窓、`tuner_ram`） → 画面での手順（作動テスト・システムチェック。人が実行）。
4. **計画を書く**：委任の範囲の読み取りだけ。手順は 12 まで、判定（`judge`）には基準値の**出所**（sgbd・inpa・authored・observed）。出所の無い値は `authored` と書き、そう言う。書く前に catalog と runGate で**送れるか**を確かめる。送れないものを計画に入れても、タブが断るだけ。
5. **読む**：タブの判定をそのまま使う。計算し直さない。`fact` は区間と値と読み方つき、`read` は確かさつき。
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
