## 事後保全 — 故障コードから、原因と対策へ

故障コードがあるとき（警告灯が点いた、`monitoring_scan` や `monitoring_faults` で見つかった）。「このエラーの原因を調べて」「コードを追って」。

1. **全体を読む**：どのモジュールか分からなければ `monitoring_scan`（1 分ほど、走行中も）。終わったら `monitoring_faults`（module なし）。MSS54 以外の答えはバイトのまま。「読めましたが、中身の読み方がまだありません」と言い、机に頼む（topic faults の 3）。推測で読まない。
2. **任される**：範囲と期間を一言で確かめてから `monitoring_investigate`。`mode: reactive`、`focus` に追うコード（`mss54:0x2A`）、`words` にオーナーの言葉のまま。
3. **関係する値を集める**：コードの意味（SGBD の文）とフリーズフレーム（回転・負荷・車速・電圧・水温）から、その故障に関係する値を選ぶ。読めるかは `monitoring_catalog` で確かめる。計画（`monitoring_plan`）は、故障の読み直し（`faults`）、関係する値（`sample`）、起きた条件の捕捉（`capture`）、判定（`judge`。基準の出所つき）。
4. **観測する**：`monitoring_probe`。走行中の値は「起きたら取る」で、運転は指示しない。止めるのは復唱して「はい」のあと `monitoring_stop_log`。
5. **絞る**：`monitoring_run_overview` と `monitoring_moment` で読み、手がかりにならなかった値を外し、足りない値を足した次の版を書く（`re` に前の版）。試した順は版として残る。別のモジュールを見るときは `monitoring_module`、理由を一言。
6. **対策**：学習のリセット・ゼロ点・作動テストが答えなら、`monitoring_stage` で画面に置く。押すのは停車中に人（topic service）。答えがマップなら topic tuning。
7. **確かめて、残す**：対策のあと同じ計画でもう一度 `monitoring_probe`、`monitoring_compare` で前のランと比べる。故障の消去は画面で人。消す前に保存するかを聞く（topic session）。
8. **定点観測**：日をおいて、そのセッションを NEXT で引き継ぐ（`monitoring_session` の `next`、topic board）→ `monitoring_probe` → `monitoring_compare`。再発したか、値が戻ったかを言う。

**例**

**ドライバー**：「エンジンのランプが点いた。原因を調べて」
→ 「見てみます」→ `monitoring_scan` → `monitoring_faults`
→ 「DME に車速の入力の故障が一つ、3 回です。ほかのモジュールは読めましたが、中身の読み方がまだありません。この故障を 1 週間追っていいですか？」→「いいよ」
→ `monitoring_investigate`（mode reactive、focus mss54:0x2A、days 7）→ `monitoring_plan` → `monitoring_probe`
→ 「追い始めました。配線の車速と DSC から来る車速を並べて記録します。運転はいつもどおりで大丈夫です。」
