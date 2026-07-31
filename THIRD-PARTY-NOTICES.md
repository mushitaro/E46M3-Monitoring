# Third-party notices and data provenance

This file records what this project depends on, what it is derived from, and which
of those things are shipped to users versus used only on the developer's machine.

**This is a record of facts, not legal advice.** The provenance questions in §3 are
judgement calls that need to be made deliberately, not inherited by accident.

---

## 1. Runtime dependencies (shipped in the deployed app)

Ordinary npm packages, all permissively licensed. See `package.json` and
`package-lock.json` for exact versions.

| Package | License |
|---|---|
| next, react, react-dom | MIT |
| tailwindcss, @tailwindcss/postcss | MIT |
| plotly.js, react-plotly.js | MIT |
| lucide-react | ISC |
| clsx, tailwind-merge | MIT |
| framer-motion | MIT |

The app makes **no network calls to any third party at runtime**. It talks to the
vehicle over the Web Serial API and to nothing else.

---

## 2. EdiabasLib — GPLv3, build-time only

<https://github.com/uholeschak/ediabaslib> — Ulrich Holeschak's .NET reimplementation
of the BMW EDIABAS interpreter. **Licensed GPLv3.**

**This project does not link, bundle, or distribute EdiabasLib.** It is used only as a
local developer tool, on the maintainer's machine, to read BMW SGBD `.prg` files and
emit the job/telegram/label tables under `ecu-data/`. Those tables are then committed
as ordinary data and the deployed app reads them directly over Web Serial. No part of
EdiabasLib reaches a user.

This is a deliberate change from the previous architecture (`OldBMW-Diag-PWA`), which
ran a local .NET host that **did** link EdiabasLib and would have been distributed to
users. That arrangement is hard to reconcile with keeping this repository private:
GPLv3 attaches obligations to *distribution* of a linked work, and "private repo,
public binary" is exactly the case those obligations bite on. Moving EdiabasLib to a
build-time tool removes the question rather than answering it.

If the `host/` tooling is ever revived as something users install, this decision must
be revisited first.

---

## 3. Vehicle data provenance — read this before making the app public

`ecu-data/*.json` is **generated**, not authored. It is derived from two sources, and
neither is this project's to relicense.

### 3.1 BMW SGBD files (`C:\EDIABAS\ECU\*.prg`)

Job names, job comments, argument names, result names and fault text are extracted
from BMW's own SGBD files, which are proprietary and are **not** redistributed here —
the generator requires the operator to have their own EDIABAS installation.

What *is* committed is the extracted metadata. That is a derived work of BMW's data.

### 3.2 `MSS54-DS2-Tool-Public` decompiled source

Live-value block layouts (offsets, scaling) and the DTC catalogue schema originate in
a third-party tool's decompiled source. Byte offsets and scaling factors for a
hardware protocol are arguably facts about the ECU rather than creative expression,
but the route by which they were obtained is a decompilation.

### 3.3 What follows from this

- The repository is **private**. That keeps the derived tables out of public
  circulation, but it does **not** cover the deployed site: anything under the Next.js
  public output is fetchable by anyone with the URL.
- Therefore the deployment should sit behind **Cloudflare Access**, with `noindex`,
  unless and until the provenance question is settled a different way.
- The cleanest long-term answer is to stop shipping the tables at all and have each
  user generate them locally from their own EDIABAS installation. That is recorded in
  the plan as a large but genuinely-resolving option, not as a fix that has been made.

---

## 4. Dependency audit status

`npm audit` reports **12 high-severity findings**. As of this writing none of them
are reachable in this application, and the reasoning needs to be re-checked rather
than inherited whenever dependencies move.

**`next`** — every advisory in the list concerns a *server* feature: the Image
Optimizer, Server Components, Server Actions, Middleware/Proxy, rewrites, PPR
resume, RSC cache poisoning, the dev HMR websocket. This app is `output: 'export'`
with `images.unoptimized`, so it ships no Next.js server at all — Cloudflare serves
static files. There is currently **no patched stable release**: the advisory range
extends to `16.3.0-preview.7` and the newest stable is `16.2.12`, so upgrading
within 16.x would not clear the audit. The pin stays at 16.1.1, matching the CSL
tuner, so the two apps share one framework version alongside the shared DS2
package.

**`brace-expansion` / `minimatch` / eslint chain** — a DoS in the linter's
transitive dependencies. Development-only; nothing in the chain is bundled.
`npm audit fix --force` wants to install `eslint@10`, a breaking change, to fix a
tool that never runs in production. Not taken.

Re-evaluate if any of these becomes true: the app gains a server or middleware,
`images.unoptimized` is removed, or a stable Next.js release lands above the
advisory range.

---

## 5. Shared code

`packages/ds2-core` is extracted from the MSS54HP CSL Convert Tuner
(`E46M3CSL_TuningTool`, MIT, same author). The DS2 conventions it encodes —
echo verification, the electrical-vs-desync classifier, the retry/resync ordering,
the CommandGate, the timing constants — were established by measurement on a real
vehicle.

**The comments in that package are the specification.** They record measurements,
corrections, hypotheses that were tested and rejected, and the specific incident
behind each guard. Several of those guards were removed once already on reasoning the
files now record as wrong. Do not strip them.
