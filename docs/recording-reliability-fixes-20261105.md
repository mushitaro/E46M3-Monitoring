# 記録・保存・時計の修正（2026-11-05）

| 文書情報 | 内容 |
|---|---|
| 作成日 | 2026-11-05 JST |
| 版 | 1.0 |
| 対象 | Monitoring WORKS |
| 状態 | ローカル実装。検査結果は末尾。未配信 |

## GitHub修正との関係

main `45a2021e8876068330640ea650d7d8f21dcfa952`を基準とし、未反映の
`e749d68f3a98240c7b0305f2a936a7dcd81fe9ea`の19ファイルの変更を先に適用した。
journalのloose/found/rebase、日付不確かな記録の保持、S11はその既存修正に由来する。
同じ修正を別実装で重ねず、残存する境界条件をその上で修正した。

## 実装済み

- byte timeoutを単調時刻で計測。appNowのanchorはページで一度だけ。
- 同じページの初回anchor前に作成したNotebookEntryを補正し、元のsourceAtとともに端末へ保存。
  mandate.untilは期間を維持。別ページの古い委任を復活させない。
- 接続が続く長いDATALOGの終了時はidle gapだけでepisodeを分断しない。
- save/keepはcommitしたSavedSessionを返し、facadeはそのid/件数から結果を返す。
  過去のlistLocal行を選んで成功を推測する処理を削除。
- 記録中・停止直後のSAVEは現在の不変CSV snapshotを取り込む。記録のidを保存・回収で共有。
- IDB v4にrecordingHeaders/recordingChunksを追加。chunkとheaderは同一transaction。
  失敗したchunkを飛ばして後続を成功扱いしない。終了時イベントに依存せず約1秒ごとにcommit。
- ページ再開時にcommit済みサンプルを回収し、回収先のcommit後だけcheckpointを削除。
  Web Locksがあるブラウザーでは記録中の別タブを回収しない。
- PROBEの経過時間をUTC補正から分離し、長い配列のmax/min等を逐次集計。
- judgeのツールschemaに実際の必須キーと型・enumを明示。

## 検証の範囲

既存の全実車ジョブを再実証したものではない。PC Chromium PRACTICEとunitによる検証。
実機のIG OFF、Chrome135、Claude音声のモデル別試験は未実施。未commit区間は失われ得る。
途中PROBEの回収対象はサンプル中心で、終了前のexchanges/captures等の完全復元は今後の課題。
Matrixの古い再接続instruction統一、全step kindのJSON Schema統合は今回の後続課題。

## 検査結果

- 追加した元の境界テスト：8/8成功（期待条件を維持）。
- 既存・候補由来・追加検査を含むunit：783/783成功。
- 型検査、lint（警告なし）、UI token/参照/用語/生成データ/翻訳/owner gate/public検査：成功。
- WORKS E2Eビルド：export 46検査成功。
- 画面E2E：12/12成功。その後のタブ排他追加版でもS12成功。
- S11の初期Date応答競合を除いた再実行：1/1成功。clockの逆行禁止を緩めず、実origin応答を待ってから未anchor状態を模擬するようシナリオを修正。
- S12：記録中保存、停止直後保存、同一ID、別タブの非回収、中断後のcommit済み件数回収を確認。

ローカル証拠はreview-unit.json、review-e2e-final/report.md、review-e2e-smoke/report.md、
review-e2e-clock/report.md、review-checks.json等（gitignore対象）。過去の失敗結果も保存し、後から成功へ書き換えていない。
