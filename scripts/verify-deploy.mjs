// ============================================================================
//  verify-deploy.mjs — 配信物を URL から読み戻して検証する
// ----------------------------------------------------------------------------
//    GATE_SESSION_FILE=<file> CF_API_TOKEN=… CF_ACCOUNT_ID=… \
//      node scripts/verify-deploy.mjs https://<host> [--expect=文字列]...
//
//  **ビルドログではなく配信物を読む。** wrangler の "Success" は「バイトを上げた」
//  という意味しかない。前身で実際に起きた沈黙する失敗は全部これを通っていた。
//
//  配信先は e46m3-monitoring-preview の一つだけで、その前にはオーナーのゲート
//  （functions/_middleware.ts）が居る。なので検査は二つの立場から行う:
//
//  - **セッション無し**（誰でも）: ゲートが閉じていること。画面遷移は m3 の
//    authorize へ 302、`/sw.js`・`/ecu-data/`・`/api/*`・`/_next/static/` の実在する
//    チャンクと実在しないパスは 401。例外は manifest とそれが指すアイコンだけで、
//    これは 200（ブラウザはインストール時に Cookie なしで取りに来る）。ここが開いて
//    いたら、他の何が合っていても不合格。ゲート自身の拒否ページ `/_gate/denied` は
//    403 で、題が manifest の name（ワークス版の名前）と同じであること。
//  - **セッション有り**（オーナー）: 中身が正しいこと。build-id がローカルの
//    ビルドと一致し、app-variant=preview、app-label=WORKS、manifest の名前と dev アイコン、
//    専用の maskable、51 モジュール、SYNC の一覧が 200 で配列を返すこと。
//    そしてデプロイのハッシュのホスト（`<hash>.e46m3-monitoring-preview.pages.dev`）は、
//    セッションを持っていても 404 で、Cookie を一つも置かないこと。
//  - **Fail closed**（`CF_API_TOKEN` と `CF_ACCOUNT_ID` があるとき）: Pages プロジェクトの
//    `deployment_configs.{production,preview}.fail_open` が両方 false であること。これが
//    true だと、Functions が走らなかったときに Pages はゲート無しで全部（ecu-data を含む）を
//    配る。読むだけで、何も変えない。トークンは Authorization ヘッダにしか置かない。
//
//  セッションは tsunagi-m3 の `access-session.mjs` で発行する短命のもので、
//  `GATE_SESSION_FILE` が指すファイルに `{"token": "..."}` として置く。コマンド行にも
//  出力にも載せない。セッションか API トークンが無ければ、できる検査だけを行い、
//  **検証しなかったと言って終える**（終了コード 2）。検査が落ちたのと検査できていない
//  のとを同じ字面で報告してはいけない。
//
//  ハッシュのホストは、canonical の URL へ Host ヘッダだけを変えて送る。node:https は
//  SNI も Host ヘッダから取る（計測: Host に書いた名前がそのまま servername として届く）
//  ので、エッジから見ればそのホストへの普通の要求になる。実在するハッシュは API から
//  （最新の production デプロイの url）取る。トークンが無ければ作り物のハッシュで送るが、
//  それに 404 を返すのは Pages 自身でゲートではない（計測: 実在しない別名には Pages の
//  HTML の 404 が返る）ので、その行は未検証の扱いにする。
//
//  前身から向け直したアサーション:
//  - `app-variant` は**戻した**。以前は配信先が一つで、features.ts も build-variant.ts も
//    持ち込んでいなかったので外していた。今は preview だけが SESSIONS と SYNC を
//    開くので、そのタグが機能を決めている。
//  - `/api/*` は「何も居ないこと」から「ゲートの内側に SYNC が居ること」に変わった。
//    存在しないパス（`/api/info`）は、セッションがあっても 404。
//  - `sw.js` のキャッシュ名は `gen-sw.mjs` の**内容ハッシュ**（`e46m3mon-<12 hex>`）なので、
//    build-id との一致ではなく**形と接頭辞**を照合する。
//
//  `--expect=` は残す。wrangler が Success と言った直後にエッジが旧バンドルを
//  返す事象を捕まえられる**唯一の検査**で、build-id は古いビルドの上にも打てるが、
//  今回の変更でしか存在しない文字列は打てない。
// ============================================================================
import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) {
    console.error('usage: GATE_SESSION_FILE=<file> node scripts/verify-deploy.mjs <https://host> [--expect=string]...');
    process.exit(2);
}
const expects = process.argv
    .slice(3)
    .filter((a) => a.startsWith('--expect='))
    .map((a) => a.slice(9));

/** `build-id.mjs` が書く。ローカルのビルドと配信物を突き合わせるための唯一の点。 */
const vpath = path.join(ROOT, 'out', 'version.json');
const local = existsSync(vpath) ? JSON.parse(readFileSync(vpath, 'utf-8')) : null;

const rows = [];
const check = (name, ok, detail) => rows.push({ name, ok, detail });

/**
 * The owner session, from a file and never from the command line. The value is checked for shape
 * and then only ever placed in a Cookie header; nothing here prints it.
 */
const sessionCookie = (() => {
    const file = process.env.GATE_SESSION_FILE;
    if (!file) return null;
    try {
        const token = JSON.parse(readFileSync(file, 'utf8')).token;
        return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? `__Host-owner=${token}` : null;
    } catch {
        return null;
    }
})();

/**
 * One GET, past every cache: the edge keeps its own, so a unique query string is what actually
 * reaches the origin.
 *
 * node:http rather than fetch. The gate redirects only a PAGE LOAD to m3 — it reads
 * `Sec-Fetch-Mode: navigate` — and fetch treats every `Sec-` header as the runtime's to set: Node's
 * sends `cors` whatever the caller asked for. Measured: through fetch, GET / came back 401 where
 * a browser gets the 302.
 */
const get = (p, { cookie = sessionCookie, navigate = false, host = null, keepBody = false } = {}) =>
    new Promise((resolve, reject) => {
        const url = new URL(`${base}${p}${p.includes('?') ? '&' : '?'}cb=${process.hrtime.bigint()}`);
        const headers = { 'cache-control': 'no-cache' };
        // Another host on the same connection target. node:https takes the TLS servername from this
        // header too, so the edge sees an ordinary request for that host.
        if (host) headers.host = host;
        if (cookie) headers.cookie = cookie;
        if (navigate) Object.assign(headers, { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', accept: 'text/html' });
        const req = (url.protocol === 'https:' ? https : http).get(url, { headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const status = res.statusCode ?? 0;
                const h = res.headers;
                resolve({
                    status,
                    // The one method the checks below use, on the shape fetch's Headers has.
                    headers: { get: (name) => [h[name.toLowerCase()]].flat().filter(Boolean).join(', ') || null },
                    // An error's body only when asked for: the gate's own pages answer 4xx with HTML.
                    text: status < 400 || keepBody ? Buffer.concat(chunks).toString('utf8') : '',
                    location: String(h.location ?? ''),
                    setsCookie: (h['set-cookie'] ?? []).length > 0,
                });
            });
            res.on('error', reject);
        });
        req.on('error', reject);
    });

// ---- the Cloudflare API, read-only ---------------------------------------------------------
// The project this repository deploys to (wrangler.jsonc `name`, which deploy.mjs pins).
const PROJECT = 'e46m3-monitoring-preview';
const cfToken = process.env.CF_API_TOKEN || '';
const cfAccount = process.env.CF_ACCOUNT_ID || '';
// For exercising this script against a local stand-in only: a loopback base, never another host,
// so the token cannot be pointed anywhere but Cloudflare or this machine.
const cfBase = (() => {
    const b = process.env.CF_API_BASE;
    if (!b) return 'https://api.cloudflare.com/client/v4';
    const u = new URL(b);
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
        console.error('[verify-deploy] CF_API_BASE may only name 127.0.0.1 or localhost.');
        process.exit(1);
    }
    return b.replace(/\/$/, '');
})();
/** GET one API path; the result object, or an error string. The token goes in the header only. */
const cf = async (p) => {
    try {
        const r = await fetch(`${cfBase}/accounts/${encodeURIComponent(cfAccount)}${p}`, {
            headers: { authorization: `Bearer ${cfToken}` },
        });
        const body = await r.json().catch(() => null);
        if (!r.ok || !body?.success) return { error: `HTTP ${r.status}${body?.errors?.[0]?.message ? `: ${body.errors[0].message}` : ''}` };
        return { result: body.result };
    } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
    }
};
const cfReady = Boolean(cfToken && cfAccount);
const unverified = [];

// Fail closed: without it, a request the Functions do not run for is served straight from the
// assets — every file, ecu-data included, with no gate in front.
if (cfReady) {
    const project = await cf(`/pages/projects/${PROJECT}`);
    for (const env of ['production', 'preview']) {
        const v = project.result?.deployment_configs?.[env]?.fail_open;
        check(`Fail closed: deployment_configs.${env}.fail_open is false`, v === false,
            project.error ? project.error : `fail_open = ${v === undefined ? '(absent)' : JSON.stringify(v)}`);
    }
} else {
    console.log('fail_open: not verified');
    unverified.push('Fail closed（CF_API_TOKEN と CF_ACCOUNT_ID が無い）');
}

// ---- without a session: the gate is shut --------------------------------------------------
const anonHome = await get('/', { cookie: null, navigate: true });
check('no session: GET / is 302 to m3 authorize',
    anonHome.status === 302 && /^https:\/\/m3\.tsunagi\.app\/api\/access\/authorize\?/.test(anonHome.location),
    `${anonHome.status} ${anonHome.location.split('?')[0]}`);
for (const p of ['/sw.js', '/ecu-data/index.json', '/api/sessions', '/index.html']) {
    const r = await get(p, { cookie: null });
    // /index.html included: Pages would 308 it to / — but only once the gate has let it through.
    check(`no session: ${p} is 401`, r.status === 401, String(r.status));
}

// The code itself. A real chunk, named by the served document when a session can read it — and
// otherwise by the local build, which is the one about to be compared — and a path that exists
// nowhere: both 401, because the gate answers before the assets are consulted at all.
const home = sessionCookie ? await get('/', { navigate: true }) : null;
const chunkSource = home?.status === 200
    ? { from: 'served HTML', html: home.text }
    : existsSync(path.join(ROOT, 'out', 'index.html'))
        ? { from: 'local out/index.html', html: readFileSync(path.join(ROOT, 'out', 'index.html'), 'utf8') }
        : null;
const chunk = (chunkSource?.html.match(/\/_next\/static\/[^"'\s<>?]+\.js/) || [])[0];
if (chunk) {
    const r = await get(chunk, { cookie: null });
    check('no session: a real /_next/static chunk is 401', r.status === 401, `${r.status} ${chunk} (from ${chunkSource.from})`);
} else {
    check('no session: a real /_next/static chunk is 401', false,
        chunkSource ? `no /_next/static/*.js in the ${chunkSource.from}` : 'no served HTML and no out/index.html to take a chunk from');
}
const noChunk = `/_next/static/chunks/verify-deploy-${process.pid}-does-not-exist.js`;
const anonMissing = await get(noChunk, { cookie: null });
check('no session: a nonexistent /_next/static path is 401', anonMissing.status === 401, `${anonMissing.status} ${noChunk}`);
const anonManifest = await get('/manifest.webmanifest', { cookie: null });
check('no session: manifest is 200', anonManifest.status === 200, String(anonManifest.status));
let manifest = null;
try {
    manifest = JSON.parse(anonManifest.text);
} catch {
    /* reported below */
}
const icons = manifest?.icons ?? [];
for (const icon of icons) {
    const r = await get(icon.src, { cookie: null });
    check(`no session: ${icon.src} is 200`, r.status === 200 && (r.headers.get('content-type') || '').includes('image/png'),
        `${r.status} ${r.headers.get('content-type') || ''}`);
}

// The home-screen label, asserted as a VALUE and not merely as present. A rename is a deliberate
// act and should have to edit these lines, because in a PWA the label is what someone taps. The
// build is called WORKS for its users (operator, 2026-09-25); its app-variant is still `preview`.
const EXPECT_NAME = 'E46M3 /// MONITORING — WORKS';
const EXPECT_SHORT_NAME = 'W E46M3 MON';
const EXPECT_LABEL = 'WORKS';
check(`manifest name is ${EXPECT_NAME}`, manifest?.name === EXPECT_NAME, manifest?.name ?? '(unreadable)');
check(`manifest short_name is ${EXPECT_SHORT_NAME}`, manifest?.short_name === EXPECT_SHORT_NAME, manifest?.short_name ?? '(unreadable)');
// The gate's refusal is the one page of this app that someone without access ever sees, and it is
// titled with the gate's `name` (functions/_middleware.ts) — the same name the install shows.
const denied = await get('/_gate/denied', { cookie: null, keepBody: true });
const deniedTitle = (denied.text.match(/<title>([^<]*)<\/title>/) || [])[1];
check(`no session: /_gate/denied is 403, titled ${EXPECT_NAME}`, denied.status === 403 && deniedTitle === EXPECT_NAME,
    `${denied.status} ${deniedTitle ?? '(no title)'}`);
check('every manifest icon is from the dev set', icons.length > 0 && icons.every((i) => /-dev-/.test(i.src)),
    icons.map((i) => i.src).join(', ') || '(none)');
const anySrc = new Set(icons.filter((i) => (i.purpose ?? 'any').split(/\s+/).includes('any')).map((i) => i.src));
const maskable = icons.filter((i) => (i.purpose ?? '').split(/\s+/).includes('maskable'));
check('maskable icons are their own files', maskable.length > 0 && maskable.every((i) => /-maskable-/.test(i.src) && !anySrc.has(i.src)),
    maskable.map((i) => i.src).join(', ') || '(none)');

/**
 * The table, then one of three endings: 1 when a check failed, 2 when something could not be
 * checked, 0 only when everything was checked and passed. 2 is neither a pass nor a failure.
 */
function finish() {
    const w = Math.max(...rows.map((r) => r.name.length));
    for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.detail}`);
    const failed = rows.filter((r) => !r.ok).length;
    if (failed) {
        console.error(`\n[FAIL] ${failed} of ${rows.length} checks`);
        process.exit(1);
    }
    if (unverified.length) {
        console.error(`\n[verify-deploy] ${rows.length} 項目は合格。ただし次は**検証していません**:`);
        for (const u of unverified) console.error(`  - ${u}`);
        if (!sessionCookie) {
            console.error('  GATE_SESSION_FILE にオーナーのセッション（tsunagi-m3 の access-session.mjs）を渡すと');
            console.error('  ゲートの内側まで検証します。使い終わったら --revoke で失効させること。');
        }
        if (!cfReady) console.error('  CF_API_TOKEN と CF_ACCOUNT_ID（Pages を読める権限）を渡すと Fail closed を読みます。');
        process.exit(2);
    }
    console.log(`\n[verify-deploy] ${rows.length} checks, all pass`);
    process.exit(0);
}

if (!sessionCookie) {
    unverified.push('中身——build-id、app-variant と app-label、ecu-data、SYNC、デプロイのハッシュのホスト（GATE_SESSION_FILE が無い）');
    finish();
}

// ---- with a session: what is inside is right -----------------------------------------------
check('GET / is 200', home.status === 200, `${home.status}${home.location ? ` → ${home.location.split('?')[0]}` : ''}`);

const bid = (home.text.match(/name="build-id" content="([^"]*)"/) || [])[1];
check('build-id present', !!bid, bid || '(missing: the stamping step did not run)');
if (local) {
    check('build-id matches the local build', bid === local.buildId, `served ${bid} / local ${local.buildId}`);
} else {
    check('local out/version.json exists', false, 'run npm run build:preview first — nothing to compare against');
}
const variant = (home.text.match(/<meta name="app-variant" content="([^"]*)"/) || [])[1];
check('app-variant is preview', variant === 'preview', variant ?? '(absent: the build was not branded)');
// What the header's badge reads. Display only, and looked up by the variant, never derived from it.
const label = (home.text.match(/<meta name="app-label" content="([^"]*)"/) || [])[1];
check(`app-label is ${EXPECT_LABEL}`, label === EXPECT_LABEL, label ?? '(absent: the build was not branded)');
check('no sync-token meta', !/<meta[^>]+name="sync-token"/.test(home.text), '');

const csp = home.headers.get('content-security-policy') || '';
check('CSP present', csp.includes("default-src 'self'"), csp.slice(0, 60) || '(none)');
// The one header the Android path dies without, and dies indistinguishably from
// a cable fault. `usb=()` — an EMPTY allowlist — is the failure it guards.
const pp = home.headers.get('permissions-policy') || '';
check('Permissions-Policy allows usb', pp.includes('usb=(self)'), pp || '(none)');
check('Permissions-Policy allows serial', pp.includes('serial=(self)'), pp || '(none)');
check('X-Robots-Tag noindex on /', (home.headers.get('x-robots-tag') || '').includes('noindex'),
    home.headers.get('x-robots-tag') || '(none)');
// Behind the gate nothing is for a shared cache: a page served to one owner must not be handed to
// the next person through the edge.
check('/ is private', /private/.test(home.headers.get('cache-control') || ''), home.headers.get('cache-control') || '(none)');

// SYNC answers, and answers with this owner's rows only — the server takes the owner from the gate,
// so all this can see from outside is that the list is a list.
const sessions = await get('/api/sessions');
let sessionList = null;
try {
    sessionList = JSON.parse(sessions.text).sessions;
} catch {
    /* reported below */
}
check('/api/sessions is 200 with a list', sessions.status === 200 && Array.isArray(sessionList),
    `${sessions.status}${Array.isArray(sessionList) ? `, ${sessionList.length} row(s)` : ''}`);
const diags = await get('/api/diagnostics');
check('/api/diagnostics is 200', diags.status === 200, String(diags.status));
// A path with no handler falls through to the assets, which have nothing there. 5xx would mean the
// functions ran without their database — trap 5.2, the project name and wrangler.jsonc disagreeing.
const api = await get('/api/info');
check('/api/info is 404', api.status === 404, String(api.status));

// A deployment hash is this project too, serving the same bytes on a host the gate does not
// answer on: 404, session or not, and no cookie set there. A REAL hash is the test — Pages itself
// 404s a made-up one before the gate runs — so it comes from the API when there is a token.
// Against a local `wrangler pages dev` there is no Pages in front, and a made-up one reaches the gate.
const baseIsLocal = ['localhost', '127.0.0.1'].includes(new URL(base).hostname);
let hashHost = null;
let hashFrom = null;
if (cfReady) {
    const deps = await cf(`/pages/projects/${PROJECT}/deployments?env=production`);
    const url = (deps.result ?? []).find((d) => d.environment === 'production' && d.url)?.url;
    if (url) {
        hashHost = new URL(url).host;
        hashFrom = 'the latest production deployment';
    } else {
        check('a deployment hash host to test', false, deps.error ?? 'the API listed no production deployment');
    }
}
if (!hashHost && !(cfReady && !baseIsLocal)) {
    hashHost = `${process.pid.toString(16).padStart(8, '0').slice(-8)}.${PROJECT}.pages.dev`;
    hashFrom = 'made up';
    if (!baseIsLocal) unverified.push('デプロイのハッシュのホスト（作り物のハッシュに 404 を返したのは Pages で、ゲートではない）');
}
if (hashHost) {
    const r = await get('/', { navigate: true, host: hashHost }).catch((e) => ({ error: e.message }));
    check('a deployment hash host is 404 even with a session', r.status === 404 && !r.setsCookie,
        `${r.error ?? `${r.status}${r.setsCookie ? ', SETS A COOKIE' : ''}`} ${hashHost} (${hashFrom})`);
}

const idx = await get('/ecu-data/index.json');
let modules = 0;
try {
    modules = JSON.parse(idx.text).modules?.length ?? 0;
} catch {
    /* reported by the count check below */
}
check('ecu-data/index.json 200', idx.status === 200, String(idx.status));
check('ships 51 modules', modules >= 51, `${modules} modules`);
check('ecu-data noindex', (idx.headers.get('x-robots-tag') || '').includes('noindex'),
    idx.headers.get('x-robots-tag') || '(none)');

const sw = await get('/sw.js');
const cache = (sw.text.match(/const CACHE = ['"]([^'"]+)['"]/) || [])[1];
check('sw.js cache name is e46m3mon-<12 hex>', /^e46m3mon-[0-9a-f]{12}$/.test(cache || ''), cache || '(none)');
check('sw.js lets /_gate/ and /api/ through', sw.text.includes("url.pathname.startsWith('/_gate/')") && sw.text.includes("url.pathname.startsWith('/api/')"), '');

// The second route exists, and it is the one that fails SILENTLY: a navigation
// fallback written for a single-route app hands /usb-check the main document,
// so the bench page opens as the app and nobody can tell why the phone is not
// being tested.
const usb = await get('/usb-check', { navigate: true });
check('/usb-check is its own document', usb.status === 200 && !usb.text.includes('name="build-id" content=""'),
    String(usb.status));
check('/usb-check is not the app shell', usb.status === 200 && /usb/i.test(usb.text.slice(0, 4000)),
    usb.status === 200 ? 'ok' : String(usb.status));

for (const e of expects) {
    const found = home.text.includes(e) || sw.text.includes(e);
    check(`served bundle contains "${e}"`, found, found ? 'yes' : 'NO: old code is being served');
}

finish();
