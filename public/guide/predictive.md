## 予兆保全 — 故障が無くても全部を見て、前と比べる

「健康診断して」「全部見ておいて」「調子はどう？」、故障は無いが状態を知りたいとき、定期の観測。

1. **全モジュールの故障**：`monitoring_scan`（停車中）。故障があれば先にそれを言い、事後保全にするかを聞く（topic reactive）。
2. **任される**：`monitoring_investigate`（`mode: predictive`、`modules` は空で全部、期間）。前の健康診断の記録があれば `record` でそれを続ける。同じ記録のランどうしが比べられる。
3. **計画**：停車・暖機・アイドルで、DME のライブ値を全部（`sample` に `3:*` のようにブロックごと）、学習値（`adapt`）。合格基準を `judge` に（最大 24）。**基準には出所を付ける**：SGBD の範囲、INPA、前回の実測、自分で決めた値。自分で決めた値はそう言う。条件をそろえる（水温、アイドル、電気負荷）には `judge` の `where`。
4. **観測する**：`monitoring_probe`（停車中に 30 秒〜1 分）。
5. **総合して伝える**：`monitoring_run_overview` の判定。**外れたものを先に**、合格は数でまとめる。学習値は大きく寄っていないかを見る。結論を一文目に。
6. **残す**：総評は `monitoring_finding`（`kind: read`、確かさつき）、`monitoring_save`。
7. **定期観測**：前のセッションを NEXT で引き継ぎ（`monitoring_session` の `next`、topic board）、同じ形で `monitoring_probe` → `monitoring_compare`（引き継ぐ前の最後の回と比べる）。何が変わったか、次の一手（様子見・点検・調整）を言う。結果は `monitoring_show` で画面にも置く。
8. **推移で判断する**：観測が 3 回以上あれば `monitoring_compare`（`trend: true`、気になる値）。一回の値ではなく推移で言う。整備の記録（オーナーが言ったこと）があれば合わせる。

**例**

**ドライバー**：「健康診断して。前回と比べて」
→ 「見てみます」→ `monitoring_scan` → `monitoring_cowork`（前の健康診断の記録）→ `monitoring_investigate`（mode predictive、record その記録）→ `monitoring_probe`
→（1 分後）`monitoring_run_overview` → `monitoring_compare`
→ 「故障はありません。合格 22、外れが 2 つです。吸気 VANOS の目標とのずれが前回より広がっていて、3 回続けて増えています。部品の点検を勧めます。もう一つは自分で決めた基準なので、参考程度です。」
