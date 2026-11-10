# プライバシーポリシーの改訂案：点検報告を店の管理画面へ渡す（2026-11-10）

MONITORING の SEND（入庫点検の報告を、店の E46 /// MAINTENANCE へ渡す）を入れる**前に**、m3 の
プライバシーポリシー（`tsunagi-m3` の `content/privacy-policy.md` と `content/en/privacy-policy.md`）を
この案のとおり改める。データの流れより先にポリシーを直す決まり（`tsunagi-m-access` §3-7、
`tsunagi-m-docs-sync`）による。この案は、改訂を m3 に出すための下書きで、公開の本文ではない。

事実の出所：`src/lib/intake/`（何を書くか・どこへ渡すか）、`public/_headers`（`/intake`）、
`src/hooks/useMonitoringFacade.ts`（アシスタントに見せるもの）。

## 変えるところ

| 場所 | 変え方 |
|---|---|
| 前付け `updated` | `2026-11-10` |
| §4「提供を行う場合」 | 箇条を一つ足す（下の A） |
| §10「送信する情報」のあと | 小節を一つ足す（下の B）。アンカー `{#intake}` |
| §10「アシスタント連携」の「送信する情報（MONITORING）」 | 一文を足す（下の C） |
| §10「端末に保存される情報」の MONITORING の段落 | 記録するものに「全モジュールの読み取り」を足す（下の D） |

「利用目的」と「保存先と、見られる人」は変えない。報告は当サービスのサーバーに届かないので、
当サービスの利用目的にも保存先にも入らない。

---

## 日本語

### A. §4「提供を行う場合」に足す箇条

- MONITORING のワークス版で、ご本人（または整備を任された店の方）が SEND を押して、点検報告をその店の管理画面へ渡すことは、ご本人の操作による提供であり、上記「本人の同意がある場合」に当たります。報告は当サービスのサーバーを通りません（「10. 購入者向けワークス版における情報の取り扱い」の「点検報告を店の管理画面へ渡す」）。

### B. §10 に足す小節

```markdown
### ▶︎ 点検報告を店の管理画面へ渡す（MONITORING のワークス版のみ） {#intake}

MONITORING のワークス版では、全モジュールを読み取ったあと、ご本人（または整備を任された店の方）が画面の SEND を押したときだけ、その読み取りを点検報告にまとめ、この MONITORING を開いた店の管理画面（E46 /// MAINTENANCE）へ渡します。今の渡し先は GREN BLUE の管理画面（`https://gren-blue-auto-admin.pages.dev`）だけです。

- 渡すもの：アプリの名前と版、使った SGBD の組、車両の型（エンジンと変速機）、読み取った日時、各モジュールのアドレス・SGBD・変種・応答・識別の答え（部品番号、ハードウェア番号、コーディングと診断のインデックスを含みます）、故障コードとその説明・回数、読み取ったバイト、模擬実車（PRACTICE）かどうか、および読み取ったバイトに VIN が書かれていたときはその VIN（店が車を照らし合わせるためのものです）。走行距離は読み取らず、渡しません。
- 渡し方：同じパソコンのブラウザの中で、店の管理画面のタブへ直接渡します。当サービスのサーバーと中継サーバーは通らず、当サービスは報告を受け取らず、保存もしません。渡すのは、当サービスが登録した店の管理画面のアドレスだけで、そのタブが MONITORING を開いたときに限ります。
- 開いていないとき：店の管理画面のタブが無いか、答えないときは、同じ報告を JSON のファイルとして端末に保存します。そのファイルを店に渡すかどうかは、ご本人が決めます。
- 渡したあと：報告は店のものになり、店のプライバシーポリシーに従って扱われます。店は受け取るときに VIN を照らし合わせ、合わなければ取り込みません。故障の所見は店の整備の記録の案として入り、店の方が署名するまで決まりません。
- AI アシスタントとの関係：報告そのものは、アシスタント連携で送りません。アシスタントに伝わるのは、送ったかどうかと渡した店の名前だけです。VIN は、アシスタントにも当サービスの開発環境にも渡しません。
- 止める：SEND を押さなければ、何も渡りません。
```

### C. 「アシスタント連携」の「送信する情報（MONITORING）」に足す一文

> 点検報告を店の管理画面へ渡したかどうかと、渡した店の名前（報告そのものは送りません。「点検報告を店の管理画面へ渡す」）。

（置く場所：「…検証台帳の状態、および CO-WORK の記録。」の直後、「**VIN は送信しません。**」の前。）

### D. 「端末に保存される情報」の MONITORING の段落

「（接続と切断、故障コードの読み出し結果、データログ、学習値、手順の結果、通信ログ、ECU の識別情報（VIN を含む））」を
「（接続と切断、故障コードの読み出し結果、全モジュールの読み取り（各モジュールの識別の答えを含む）、データログ、学習値、手順の結果、通信ログ、ECU の識別情報（VIN を含む））」に改める。

---

## English

### A. Add to §4 "When we disclose"

- In MONITORING WORKS, handing an intake report to a shop's management screen when you (or the shop you have entrusted with the work) press SEND is a provision made by your own action, and falls under "where you have consented" above. The report does not pass through this service's servers (see "Handing an intake report to a shop's management screen" in "10. How the WORKS builds handle information").

### B. New subsection in §10

```markdown
### ▶︎ Handing an intake report to a shop's management screen (MONITORING WORKS only) {#intake}

In MONITORING WORKS, after every module has been read, and only when you (or the shop you have entrusted with the work) press SEND on the screen, the reads are put together as an intake report and handed to the shop's management screen (E46 /// MAINTENANCE) that opened this MONITORING. At present the only shop it can be handed to is GREN BLUE's (`https://gren-blue-auto-admin.pages.dev`).

- What is handed over: the app's name and version, the SGBD set used, the vehicle's type (engine and gearbox), when the modules were read, each module's address, SGBD, variant, answer and identification (including its part number, hardware number, and coding and diagnosis indexes), the fault codes with their descriptions and counts, the bytes read, whether it was the practice car (PRACTICE), and the VIN when the bytes read spell one (so that the shop can check it is the same car). The odometer is not read and not handed over.
- How: directly to the shop's management tab, inside the browser on the same computer. It does not pass through this service's servers or the relay server; this service neither receives nor stores the report. It is handed only to a shop management address this service has registered, and only when that tab opened MONITORING.
- When no such tab is open: when there is no shop management tab, or it does not answer, the same report is saved on the device as a JSON file. Whether to give that file to the shop is your decision.
- Afterwards: the report belongs to the shop and is handled under the shop's privacy policy. The shop checks the VIN when it receives the report and does not take it in if they do not match. The fault findings go into the shop's service record as proposals, and nothing is decided until someone at the shop signs.
- The AI assistant: the report itself is never sent through the assistant link. The assistant is told only whether it was handed over and to which shop. The VIN is given neither to the assistant nor to this service's development environment.
- Stopping: if you do not press SEND, nothing is handed over.
```

### C. Add to "Assistant link" → "What is sent (MONITORING)"

> Whether an intake report was handed to a shop's management screen, and the shop's name (not the report itself; see "Handing an intake report to a shop's management screen").

(Placed right after "…the state of the verification ledger, and the CO-WORK record." and before "**The VIN is not sent.**")

### D. "Stored on the device", MONITORING paragraph

Change "connecting and disconnecting, fault codes read, data logs, learned values, …" to
"connecting and disconnecting, fault codes read, reads of every module (including each module's answer to its identification), data logs, learned values, …".

（A〜D の英語は、m3 の英語版の 2026-11-09 の本文（274 行・341 行）に合わせた。）

---

## 決めてほしいこと（運営者）

1. **店の側のポリシー**：報告を受け取った後の扱いは、GREN BLUE のプライバシーポリシーが言う（計画 Phase 3 の「GREN BLUE：点検報告…」）。こちらの改訂と同じ日に公開されるのが望ましい。
2. **ワークス版の初回のお知らせ**（`src/lib/previewNotice.ts`、v2）に SEND の項目を足すか。足すと版が上がり、全員にもう一度確認を求めることになる。SEND は押したときだけ動くので、**足さずに、ポリシーと SEND の `title`（何をどこへ渡すか）で言う**のを推す。
