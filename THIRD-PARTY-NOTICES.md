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
emit the job/telegram/label tables under `public/ecu-data/`. Those tables are not
committed (§3.3); the deployed app reads them directly, and talks to the car over Web
Serial / WebUSB. No part of EdiabasLib reaches a user.

This is a deliberate change from the previous architecture (`OldBMW-Diag-PWA`), which
ran a local .NET host that **did** link EdiabasLib and would have been distributed to
users. GPLv3 attaches obligations to *distribution* of a linked work, and "closed
source, public binary" is exactly the case those obligations bite on. Moving
EdiabasLib to a build-time tool removes the question rather than answering it.

**Scope note, now that this repository is public.** `tools/SgbdDump/` is a program
whose only purpose is to link EdiabasLib, and its source is now publicly readable.
Publishing that source is not distribution of EdiabasLib and does not trigger GPLv3's
distribution obligations — but the repository's MIT `LICENSE` must not be read as
covering what comes *out* of building it:

- The source in `tools/SgbdDump/` is MIT, like the rest of this repository.
- **A built `SgbdDump.exe` is a GPLv3 combined work. Do not redistribute it.**
  `.gitignore` excludes `bin/` and `obj/` for this reason, not merely for tidiness.
- EdiabasLib is referenced by path (`<EdiabasLibPath>`, checked by the
  `CheckEdiabasLib` target) and is never vendored. Clone it yourself from the URL
  above.

The `host/` bridge that linked EdiabasLib at RUNTIME is now deleted, not merely
unused: the app talks to the cable itself over Web Serial and WebUSB, so there is
no longer a component that could be distributed with EdiabasLib inside it. If
anything of that shape is ever built again, this decision must be revisited
first — the question it answers is about distribution, and a build-time tool and
an installed one are not the same artifact.

---

## 3. Vehicle data provenance

`ecu-data/*.json` is **generated**, not authored. It is derived from two sources, and
neither is this project's to relicense.

### 3.1 BMW SGBD files (`C:\EDIABAS\ECU\*.prg`)

Job names, job comments, argument names, result names and fault text are extracted
from BMW's own SGBD files, which are proprietary and are **not** redistributed here —
the generator requires the operator to have their own EDIABAS installation.

What *is* committed is the extracted metadata. That is a derived work of BMW's data.

### 3.2 MSS54 DS2 Tool — karter16

**MSS54 DS2 Tool**, by **karter16**.
Official project: <https://github.com/karter16/MSS54-DS2-Tool-Public>
Copyright © 2026 karter16. Licensed under the *MSS54 DS2 Tool Freeware Licence*.

Two files of this project could not exist without it:

| Generated here | What came from there |
|---|---|
| `packages/ds2-mss54/src/liveValueBlocks.generated.ts` | 8 live-measurement blocks, 213 fields — byte offset, data format and scaling for each |
| `packages/ds2-mss54/src/adaptationBlocks.generated.ts` | the adaptation block layouts, and the DTC catalogue schema |

**The SGBD cannot supply any of it.** BMW's `.prg` files publish job names and result
names; they do not publish where in a response payload a value sits or what to
multiply it by. Every live value this app shows, and every adaptation value it
decodes, rests on that work.

Stated plainly, because the alternative is to leave it vague:

- The **route was a decompilation** of the published application. The licence grants
  use and unmodified redistribution; it does not grant decompilation, and this
  project did it anyway.
- What is used are byte offsets and scaling factors for a hardware protocol —
  arguably facts about a BMW ECU rather than that author's creative expression. That
  is an argument, not a ruling, and it is recorded here as an argument.
- **Neither the tool's source nor its binary is redistributed by this project.** No
  file from it is committed here, and the generators read a local copy the operator
  supplies (`docs/REFERENCES.md` §4).
- The licence asks that attribution and project links stay intact. They are here, in
  `README.md`, in the header of each generated file, and in the app's own credits
  dialog — which is reachable at any time and is deliberately NOT inside the
  disclaimer, because a disclaimer is dismissed once and then never seen again.

If karter16 would prefer this project not derive from that work, that is a request
this project will honour: the two generated files and their generators are separable,
and removing them costs the live values and the adaptation decode, not the app.

### 3.3 What follows from this

This section used to say the repository was private and that the cleanest long-term
answer would be to stop shipping the tables. Half of that has now happened, so the
arrangement is stated here as it actually is rather than as a plan.

- The **repository is public and carries code only**. `public/ecu-data/`,
  `tools/terms/` and the SGBD dumps are not committed and are **not in the published
  history** — they were removed from every commit, not merely gitignored. What a
  clone gets, and what it cannot do without them, is in `README.md`.
- The **deployment is not code-only**. Cloudflare Pages is deployed from the
  maintainer's machine, so the uploaded `out/` contains the generated tables and
  anyone with the URL can fetch them. This is a deliberate, accepted trade-off: it is
  what lets the app be usable by someone who does not own an EDIABAS installation.
  **The exposure is therefore the deployment, not the repository.**
- **Cloudflare Access sits in front of the production deployment, and this is what
  it does and does not do.** Measured, because the difference matters:

  | | `e46m3-monitoring.pages.dev` (production) | `e46m3-diagnosis.pages.dev` (staging) |
  |---|---|---|
  | unauthenticated GET | `302` to a Cloudflare Access login | `200` |
  | crawler, scraper, `curl`, any script | cannot reach the tables | can |
  | a person who can receive email | **can** — the policy is Allow / Everyone, and the identity provider is a one-time PIN | — |

  So the honest statement is **not** "only the maintainer can read the tables". It is
  that automated collection is stopped and a person is not. That is a real reduction
  from "anyone with the URL downloads the JSON", and it is not a wall. The policy is
  one field away from being restricted to a single address; it is deliberately not,
  and this table is here so nobody reads a stronger claim into the word "Access".
- `X-Robots-Tag: noindex` and `robots.txt` are also set, but those only **ask** search
  engines. They are not access control and are not counted as mitigation here.
- The end state the second bullet still falls short of is for each user to generate
  the tables from their own EDIABAS installation. The generators and their
  documentation (`docs/REFERENCES.md`) are published precisely so that is possible.

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
