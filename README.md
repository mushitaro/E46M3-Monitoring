# E46M3 /// MONITORING

(Formerly E46M3///Diagnosis. The repository is named E46M3-Monitoring.)

A tool for diagnosing, data-logging and calibrating the E46 M3 **directly from the browser**, over
DS2 / K-line. It covers **51 modules of the E46 M3**: from **MSS54** (engine, 0x12) / **SMG II**
(transmission, 0x32) to body, comfort and AV. `0x56` changes with the model year (early ASCMK20 /
late DSC_E46; never both fitted) — what was included, what was not, and why, is in
[`docs/FITMENT.md`](docs/FITMENT.md).

TSUNAGI ///M's instrument-family sub-brand. Its DS2 communication shares **the same link layer** as
[MSS54HP CSL Convert Tuner](../E46M3CSL_TuningTool).

---

## Current status

**The read path is implemented. Verification on a real car is still to come.**

| | Status |
|---|---|
| Repository skeleton, theme, static export | ✅ |
| `packages/ds2-core` (the shared DS2 link layer, four layers) | ✅ |
| `packages/ds2-mss54` (213 live values, fault memory, telegrams) | ✅ |
| UI (diagnosis / data log / comms log) + PRACTICE mode | ✅ |
| The Cloudflare delivery set (PWA / CSP / CI) | ✅ |
| **Verifying reads on a real car** | ⏳ **Needs a car** |
| SMG II / DSC live-value block layout | ⏳ Needs a car or a bench ECU |
| Writes and actuators | ⛔ Not unlocked until the safety mechanisms are in place |

**All of the data is unverified.** The live values' offsets/scales come from decompiling a
third-party tool, and the telegrams from a static scrape of the SGBD bytecode;
neither has been confirmed on a real car. The app says so at all times.

The implementation plan is `docs/PLAN.md` (a copy of `~/.claude/plans/pure-hopping-sutton.md`).

---

## The WORKS build

What is distributed now is **only the WORKS build**, at `e46m3-monitoring-preview.pages.dev`.

WORKS is the name of the build for purchasers, given to welcome MILE purchasers as members of the
works team (a manufacturer's own development team) that takes part in research and development
(the operator's decision, 2026-09-25; until then it was the preview build). Only **what is shown**
changed: the manifest's name (`E46M3 /// MONITORING — WORKS`, and `W E46M3 MON` on the home
screen), the WORKS badge in the header, and the wording on screen. The build's variant
(`app-variant=preview`), `owner_preview`, the client id, the host and the script names stay `preview`.

- **Who it is for**: MILE purchasers, and the owners whose cars have been worked on so far. People
  whose m3.tsunagi.app account holds the `owner_preview` right open it from the WORKS row of the M menu.
- **It is inside the gate**: every path goes through `functions/_middleware.ts` (a copy of
  tsunagi-m3's `tools/owner-gate`; `npm run gate:verify` checks that it matches the canonical copy).
  To anyone without the right, or not signed in, nothing is served, ECU tables included.
- **How it differs from production**: it has a SESSIONS tab. It saves read results, data logs and
  the comms log from before and after a failure on the device, sends them with SYNC to the owner's
  own account, and can restore them to another device. When an operation fails, it sends an
  error record automatically. The production build has none of this: it does not save sessions on
  the device, and sends nothing to the network
  (`src/lib/features.ts`, `THIRD-PARTY-NOTICES.md` §1).
- **What it sends and how that is handled**: the first time it is opened, before anything is sent,
  the app's own first dialog ("About this tool") shows it. Nothing is sent until that is confirmed
  (`src/lib/previewNotice.ts`). It is also written in the
  [privacy policy (#preview)](https://m3.tsunagi.app/en/privacy-policy#preview)
  ([Japanese](https://m3.tsunagi.app/privacy-policy#preview)), which can be opened from that dialog
  and from Privacy in the app's header.

Deploying is `npm run deploy`. It does not deploy until it has checked that the gate is there,
that the source of the version being deployed is published (`HEAD == origin/main`) and the working
tree is clean, and that nothing that must not be published is tracked (the top of
`scripts/deploy.mjs`). The old production project `e46m3-monitoring`, which sat behind Access, was
deleted on 2026-10-02.

---
## What you get when you clone

This repository is **public, but contains only code**. The ECU tables are not in it.
They are not gitignored but **removed from the history of every commit**. The reason is
`THIRD-PARTY-NOTICES.md` §3 — they are derivatives generated from BMW's SGBDs, and not something
this project can relicense.

What you can and cannot do with a clone:

| | |
|---|---|
| `npm ci` | ✅ |
| `npm run typecheck` / `npm run lint` | ✅ |
| `npm test` | ⚠️ **55 of 237 fail** (measured). These are the tests that read the catalog: `adaptationReset` / `jobOps` / `runGate` / `dscHydraulics` / `procedureSteps` check that "the shipped data does not contradict the spec" |
| `npm run build` | ✅ Succeeds, and the app's shell works |
| ECU selector | ❌ Empty, since `public/ecu-data/index.json` is missing. It says so |
| Talking to the vehicle | ❌ For the same reason (it does not know which job to send to which address) |

**To build your own data**, you need your own EDIABAS installation. The procedure, and where the
five truths outside the repository are, is in `docs/REFERENCES.md`; the list of assets that cannot
be regenerated is in `docs/PRESERVED.md`. Roughly:

```bash
dotnet build tools/SgbdDump/SgbdDump.csproj -c Release   # needs a clone of EdiabasLib
python tools/dump_modules.py                             # dumps the SGBDs into $SGBD_DUMP_DIR
python tools/gen_ecu_data.py                             # generates public/ecu-data/
```

`tools/SgbdDump` links with EdiabasLib (**GPLv3**). The source here is MIT, but
**the built `SgbdDump.exe` is a GPLv3 combined work and must not be redistributed**
(`THIRD-PARTY-NOTICES.md` §2).

The deployed build is a different matter. Deploys are made from the development machine, so
`out/` carries the tables — that is, **what is exposed is the deployment, not the repository**.
It is a trade-off accepted on purpose, and the mitigation is the WORKS build's owner gate (§3.3).

---



## Architecture

```
[Browser (a static site on Cloudflare Pages)]
        │  Web Serial  9600 8E1
        ▼
[K+DCAN cable] ──K-line (OBD-II pin 7)──▶ [ECU]
```

**There is no server and no localhost that talks to the car.** (The WORKS build has Pages
Functions for the gate and SYNC. Neither touches the car.) Its predecessor, `OldBMW-Diag-PWA`,
went through a local .NET host (`127.0.0.1:5199`) that embedded EdiabasLib, and that design cannot
coexist with a production deployment:

- From Chrome 142, requests from an HTTPS public origin to loopback are
  **blocked without the Local Network Access permission**
- The old host had `Access-Control-Allow-Origin: *` and ran any job without authentication
  (while the cable was connected, any web page could hit the ECU)
- It required every user to install `C:\EDIABAS` and start the .NET host
- EdiabasLib is **GPLv3**. Distributing a host linked with it while keeping the repository
  private does not hold up

Now EdiabasLib is used **only as a build-time data-generation tool** (`tools/SgbdDump`).
Details in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) (the dependency audit's assessment is
in §4 of the same file).

---

## Development

```bash
npm install
npm run dev      # http://localhost:5046
npm run build    # → out/ (static export)
npm run lint
npm run typecheck
```

**Web Serial is desktop Chromium only** (Chrome / Edge). iOS, Android, Safari and Firefox are not
supported. A secure context is required, so open it on `localhost` or over HTTPS.

`npm run dev` (`next dev`) shows the WORKS build's screens (the SESSIONS tab) and saves sessions
on the device (IndexedDB `e46m3-monitoring`), but sends nothing — whether it sends is decided by
the deployed build's `app-variant` tag, which `next dev` does not have. The production build
neither saves nor sends sessions.
To run it locally with the gate and SYNC as well, build the WORKS build and open it with
`wrangler pages dev`:

```bash
npm run hooks:install                      # once; runs check-public-tree before a commit
npm run build:preview                      # next build → build-id → brand-preview → gen-sw
npx wrangler d1 migrations apply tsunagi-m-preview-runs --local
npx wrangler pages dev out --port 8799
```

`.dev.vars` (**do not commit it**; `.gitignore` and `check-public-tree` stop it):

```
M3_CLIENT_SECRET=<any value of 32 characters or more>
GATE_DEV_ACCOUNT=<any UUID>            # treated as this account, without going through m3
```

`GATE_DEV_*` works only when the host is `localhost` / `127.0.0.1`, and is ignored where deployed.
Without `GATE_DEV_ACCOUNT`, the gate sends you to m3 to sign in, as the real one does.
The `--local` D1 lives in `.wrangler/`, which is not committed either.

---

## Directories

```
src/app/          Next.js App Router. globals.css is the TSUNAGI ///M theme (revised 2026-07)
src/components/   UI primitives and shared parts (ui.tsx is the only source)
src/components/shell/  frame, tabs, module rows, overlays
src/views/        one directory per tab; panes and visualisations
src/hooks/        React-side state (link state, keep-alive, arming)
src/lib/          pure logic: gates, classification, protocol, i18n
packages/ds2-core/    DS2 frames and transports (Web Serial / WebUSB-FTDI)
packages/ds2-mss54/   MSS54 block definitions (generated)
public/ecu-data/  data generated from the SGBDs. **Not committed** (below)
tools/            the SGBD → ecu-data generation pipeline (Python / C#)
tools/deprecated/ retired tools, and the record of negative results
functions/        the WORKS build's Pages Functions: the owner gate and SYNC (/api/sessions, /api/diagnostics)
migrations/       SYNC's D1 schema (a shared DB, so the tables are monitoring_*)
docs/             decisions and history. The procedure for connecting to a real car is docs/CONNECT-VEHICLE.md
```

`public/ecu-data/` and `recordings/` are **not in** this repository. They derive from BMW's SGBDs,
so they follow `THIRD-PARTY-NOTICES.md` §3 and are kept in a separate private repository.
Only the **shape and size** of what is missing can be read, from `tools/ecu_data_counts.json` and
`tools/SgbdDump/out.manifest.json`.

---

## Credits

This tool rests on work that others did first.

### MSS54 DS2 Tool — karter16

<https://github.com/karter16/MSS54-DS2-Tool-Public> · © 2026 karter16 ·
*MSS54 DS2 Tool Freeware Licence*

**The byte positions, data formats and scale factors of the 213 live-value channels and the
adaptation blocks** come from this tool. BMW's SGBDs publish only job names and result names;
**neither "where in the reply the value is" nor "what to multiply it by" can be recovered from the
SGBD**. Every number this app shows rests on this work.

It was obtained by decompilation, which its licence does not permit. There is an argument that
the byte positions and scale factors are "facts about BMW's ECU" rather than the author's creative
expression, but that is an argument, not a ruling. The full position is in
`THIRD-PARTY-NOTICES.md` §3.2. **This repository redistributes neither that tool's source nor its
binaries.**

### EdiabasLib — Ulrich Holeschak

<https://github.com/uholeschak/ediabaslib> · GPLv3

Used to extract jobs, arguments, results and fault texts from the SGBDs.
**For build-time data generation only**; none of it goes into the app or the deployed build.
`tools/SgbdDump` links with it, so **the built `SgbdDump.exe` is a GPLv3 combined work and must
not be redistributed** (`THIRD-PARTY-NOTICES.md` §2).

### BMW EDIABAS / SGBD

The source of the jobs, arguments, results and fault texts for the 51 modules. They are BMW's
property, and are not in this repository. Generating them needs your own EDIABAS installation
(`docs/REFERENCES.md`).

---

These can also be read in the app's **CREDITS** dialog (top right of the header). Someone who
installed it as a PWA does not open the README, and they are not put in the disclaimer dialog —
that one never appears again once accepted, which makes it the worst place for something that has
to stay visible.

## Safety

This tool sends commands to a real car's ECU. Writes and actuator drives are
**unlocked one job at a time through a verification ledger**, and all of them are disabled by default.
For DSC's brake hydraulics, the SGBD itself warns that "the pump does not stop by itself (up to 60 s)",
and whether to ship each one is decided individually.

The comments in `packages/ds2-core` **are the specification**. They record measurements,
corrections, rejected hypotheses, and the accidents each guard was born from. Do not strip them.

## 日本語

E46M3 /// MONITORING（旧称 E46M3///Diagnosis）は、E46 M3 の診断・データログ・キャリブレーションを、ブラウザから直接 DS2 / K-line で行うツールです。対象は E46 M3 の 51 モジュールで、MSS54（エンジン）・SMG II（変速機）から、ボディ・快適装備・AV までです。TSUNAGI///M の MONITORING カテゴリのツールです。

- **ワークス版だけ：** <https://e46m3-monitoring-preview.pages.dev/> 。[MESH](https://m3.tsunagi.app/mesh) で MILE をご購入いただいた方と、お申し出いただいた施工オーナーさんがお使いいただけます。m3.tsunagi.app のアカウントで、[M メニュー](https://m3.tsunagi.app/)の WORKS の行から開きます。
- **動く環境：** PC の Chrome / Edge（Web Serial）と K+DCAN ケーブル。iOS・Android・Safari・Firefox は非対応です。
- **車への接続は、画面で人が行います。** 書込・アクチュエータの駆動は、既定ですべて無効です。
- **プライバシー：** 本番のビルドは、セッションを端末に保存せず、ネットワークにも何も送りません。ワークス版は、読み取り結果・データログ・失敗前後の通信ログを端末に保存し、SYNC でご自身のアカウントへ送り、別の端末へ復元できます。操作が失敗したときは、エラー記録を自動で送ります。初めて開いたとき、何かを送る前に、最初のダイアログ（「このツールについて」）で示し、確認されるまでは何も送りません。詳しくは[プライバシーポリシー（#preview）](https://m3.tsunagi.app/privacy-policy#preview)にあります。

### 現在の状態と、データの確かさ

**読取経路は実装完了。実車での検証はこれから。** 書込・アクチュエータは、安全機構が揃うまで解禁しません。

**データはすべて未検証です。** ライブ値のオフセット/スケールは第三者ツールの逆コンパイル由来、テレグラムは SGBD バイトコードの静的スクレイプ由来で、どちらも実車で確認していません。アプリは常時その旨を表示します。

### 安全について

このツールは実車の ECU に命令を送ります。書込・アクチュエータ駆動は**検証台帳で1ジョブずつ解禁する方式**で、既定はすべて無効です。DSC のブレーキ油圧系は SGBD 自身が「ポンプは自動停止しない（最大60秒）」と警告しており、出荷可否を個別に判断します。

`packages/ds2-core` のコメントは**仕様書です**。測定値・訂正・棄却した仮説・各ガードを生んだ事故が記録されています。剥がさないでください。
