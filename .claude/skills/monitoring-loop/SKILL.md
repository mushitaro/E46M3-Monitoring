---
name: monitoring-loop
description: 'One firing of MONITORING''s autonomous loop: the scheduled Claude Code session that, while the owner drives with MONITORING WORKS connected, reads what the car recorded, advances the investigations the owner handed over, turns what the tool could not answer into pull requests, and asks the owner only what only the owner can decide. Use it when a scheduled task or a person says to run the MONITORING loop, "進めて", "自律ループを回して", "monitoring loop", or when a firing''s prompt points here.'
---

# MONITORING — 自律ループの一回

一回の起動で**一件だけ**進める。新しいことが無ければ、何も書かずに終わる。仕組みは `docs/AUTONOMY.md`、調査の進め方は Skill `monitoring-desk`。

## 1. 状態を読む

- main の CI が赤なら、それが一件目（下の 2 の最初）。
- 委任のある調査と、その CO-WORK の新しい項目（ドライバーの答え、タブの記録、待っている問い）。
- 開いている PR（自分のもの）の CI とレビュー。
- 例題と能力の表（`scenarios/`、`tools/scenario_coverage.mjs`）。

## 2. 一件だけ選ぶ（上から）

1. main の CI が赤い → 直す。
2. 自分の PR の CI が赤い、レビューが付いた → 対応する。
3. 新しい車の記録がある調査 → `monitoring-desk` の一周（所見、次の計画）。
4. ドライバーの答えが来た問い → それを前提に計画を直す。
5. 開いている調査を止めている道具の穴 → 開発（`monitoring-desk` の「道具の穴」）。
6. 例題の穴 → 開発。
7. 手順書の評価（例題を手順書だけで解かせ、入ったトピックと「言わないこと」の違反を見る）。

## 3. 進める

- 開発は main から切ったブランチ `claude/loop-<YYYYMMDD>-<短い名前>` で。試験を書き、`npm run lint && npm run typecheck && npm test` と CLAUDE.md の検査を通してから PR（draft にしない）。
- PR の分類はパスで決まる（`.github/autonomy.json`、`node scripts/autonomy-class.mjs` で事前に見られる）。自分で決めない。`auto` は CI が通れば自分でマージされ、`human` はオーナーのレビューを待つ。`human` の変更は、`auto` の変更と同じ PR に混ぜない。
- 計画を書くのは委任の範囲だけ。範囲の外は `ask` にして止まる。
- 車に送るのはタブ。ループは車に何も送らない。

## 4. 報告

- 人の判断が要るとき（承認の要る PR、委任の更新、`moving-ok` の提案、範囲の外）だけ通知する。一行で、何を決めてほしいか。
- それ以外は CO-WORK と PR が記録。

## 止めどき

- 新しいことが無い → 何も書かずに終わる。
- 同じ穴で 3 回失敗した → オーナーに聞いて、その穴はそこで止める。
- 委任が切れた・取り下げられた → その調査は進めない。

## しないこと

- 車への接続、作動テスト、調整、故障の消去、書き込み、フラッシュ（どのツールにも無い）。
- 拒否された読み取りを、形を変えて送り直す計画。
- 台帳を `moving-ok` にすること。人の承認の要る PR を自分でマージすること。
- 一回の起動で二件以上に手を出すこと。
