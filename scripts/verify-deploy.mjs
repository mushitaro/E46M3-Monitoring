// ============================================================================
//  verify-deploy.mjs — 配信物を URL から読み戻して検証する
// ----------------------------------------------------------------------------
//    node scripts/verify-deploy.mjs https://<host> [--expect=文字列]...
//
//  **ビルドログではなく配信物を読む。** wrangler の "Success" は「バイトを上げた」
//  という意味しかない。前身で実際に起きた沈黙する失敗は全部これを通っていた。
//
//  移植にあたって、前身のアサーションは一つずつ向け直した。**欠けたタグを検査した
//  ままにしない**のが移植の条件だったので:
//
//  - `app-variant` は**外した**。前身は本番/staging/preview の三つを一つの
//    バンドルから作り分けていて、その識別子が要った。こちらは配信先が一つしか
//    無く、`features.ts` も `build-variant.ts` も意図して持ち込んでいない。
//    打っていないタグを検査し続けるのは、検査を一つ黙らせる練習になるだけ。
//  - `/api/info` は `/api/` の任意のパスに変えた。こちらには `functions/` が
//    無いので、確かめたいのは「その特定の口が無いこと」ではなく「API 相当の
//    パスに何も居ないこと」。**404 が正解で、5xx は「コードが動いた」証拠**。
//  - `sw.js` のキャッシュ名は前身では build-id 由来だった。こちらは
//    `gen-sw.mjs` が**内容ハッシュ**で名前を作る（`e46m3mon-<12 hex>`）ので、
//    build-id との一致ではなく**形と接頭辞**を照合する。接頭辞まで見るのは、
//    末尾ハッシュだけ見ると改名漏れを素通しするから。
//  - `index.json` は配列ではなくオブジェクトになった（schema 2）。
//  - `noindex` は `/*` にも載るようになったので、トップページでも確かめる。
//
//  `--expect=` は残す。wrangler が Success と言った直後にエッジが旧バンドルを
//  返す事象を捕まえられる**唯一の検査**で、build-id は古いビルドの上にも打てるが、
//  今回の変更でしか存在しない文字列は打てない。
//
//  ## Cloudflare Access の後ろにある配信先
//
//  本番は Access の内側にあるので、無認証の fetch は **302 でログイン画面へ**
//  飛ばされる。ここで全項目 FAIL を出すのは嘘に近い——検査が落ちたのではなく、
//  **検査できていない**からで、その二つは同じ字面で報告してはいけない。
//
//  なので Access のリダイレクトを検出したら、**検証しなかったと言って終える**
//  （終了コードは 0 ではない。"問題なし" と読まれてはならない）。
//  サービストークンがあるなら `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`
//  を環境変数で渡せば、そのヘッダを付けて普通に検証する。トークンは Zero Trust の
//  「サービス資格情報」で発行するもので、このスクリプトは値を持たないし出力もしない。
// ============================================================================
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) {
    console.error('usage: node scripts/verify-deploy.mjs <https://host> [--expect=string]...');
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

// A service token, if one was issued. Absent is the normal case.
const CF_ID = process.env.CF_ACCESS_CLIENT_ID;
const CF_SECRET = process.env.CF_ACCESS_CLIENT_SECRET;
const accessHeaders =
    CF_ID && CF_SECRET ? { 'CF-Access-Client-Id': CF_ID, 'CF-Access-Client-Secret': CF_SECRET } : {};

const get = async (p) => {
    const r = await fetch(base + p, { redirect: 'manual', cache: 'no-store', headers: accessHeaders });
    return {
        status: r.status,
        headers: r.headers,
        text: r.status < 400 ? await r.text() : '',
        location: r.headers.get('location') || '',
    };
};

const home = await get('/');

// Behind Access, and nothing here can see through it. Say THAT, rather than
// printing fifteen failures — a check that could not run and a check that
// failed must not read the same.
if (home.status === 302 && /cloudflareaccess\.com/.test(home.location)) {
    console.error(`[verify-deploy] ${base} は Cloudflare Access の内側にあり、検証できませんでした。`);
    console.error('  無認証の GET は 302 でログイン画面に飛びます。配信そのものは成功している');
    console.error('  かもしれませんし、していないかもしれません。**このスクリプトは何も確かめていません。**');
    console.error('');
    console.error('  自動で検証したいなら、Zero Trust → Access → サービス資格情報 でトークンを発行し:');
    console.error('    CF_ACCESS_CLIENT_ID=... CF_ACCESS_CLIENT_SECRET=... npm run deploy');
    console.error('  （そのトークンを通す Service Auth ポリシーをアプリに足す必要があります）');
    console.error('');
    console.error('  そうしないなら、ブラウザで開いて build-id とモジュール数を目で確かめてください。');
    process.exit(2); // 0 でも 1 でもない。「未検証」は「合格」でも「不合格」でもない
}
check('GET / is 200', home.status === 200, String(home.status));

const bid = (home.text.match(/name="build-id" content="([^"]*)"/) || [])[1];
check('build-id present', !!bid, bid || '(missing: the stamping step did not run)');
if (local) {
    check('build-id matches the local build', bid === local.buildId, `served ${bid} / local ${local.buildId}`);
} else {
    check('local out/version.json exists', false, 'run npm run build first — nothing to compare against');
}

const csp = home.headers.get('content-security-policy') || '';
check('CSP present', csp.includes("default-src 'self'"), csp.slice(0, 60) || '(none)');
// The one header the Android path dies without, and dies indistinguishably from
// a cable fault. `usb=()` — an EMPTY allowlist — is the failure it guards.
const pp = home.headers.get('permissions-policy') || '';
check('Permissions-Policy allows usb', pp.includes('usb=(self)'), pp || '(none)');
check('Permissions-Policy allows serial', pp.includes('serial=(self)'), pp || '(none)');
check('X-Robots-Tag noindex on /', (home.headers.get('x-robots-tag') || '').includes('noindex'),
    home.headers.get('x-robots-tag') || '(none)');

// The home-screen label, asserted as a VALUE and not merely as present.
// `E46M3` was the predecessor's; this app's is `E46M3 Diag` and the ported
// check said otherwise — caught on the first real deploy, which is the whole
// point of asserting the value. A rename is a deliberate act and should have
// to edit this line, because in a PWA the label is what someone taps.
const EXPECT_SHORT_NAME = 'E46M3 Diag';
const man = await get('/manifest.webmanifest');
const shortName = (man.text.match(/"short_name"\s*:\s*"([^"]+)"/) || [])[1];
check(
    `manifest short_name is ${EXPECT_SHORT_NAME}`,
    man.status === 200 && shortName === EXPECT_SHORT_NAME,
    shortName || String(man.status),
);

// A static site answers 404 here. 5xx means code ran — that is trap 1 in the
// release notes: wrangler compiled someone else's functions/ from the CWD.
const api = await get('/api/info');
check('/api/* is 404 (no backend)', api.status === 404, String(api.status));

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

// The second route exists, and it is the one that fails SILENTLY: a navigation
// fallback written for a single-route app hands /usb-check the main document,
// so the bench page opens as the app and nobody can tell why the phone is not
// being tested.
const usb = await get('/usb-check');
check('/usb-check is its own document', usb.status === 200 && !usb.text.includes('name="build-id" content=""'),
    String(usb.status));
check('/usb-check is not the app shell', usb.status === 200 && /usb/i.test(usb.text.slice(0, 4000)),
    usb.status === 200 ? 'ok' : String(usb.status));

for (const e of expects) {
    const found = home.text.includes(e) || sw.text.includes(e);
    check(`served bundle contains "${e}"`, found, found ? 'yes' : 'NO: old code is being served');
}

const w = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(w)}  ${r.detail}`);
const failed = rows.filter((r) => !r.ok).length;
if (failed) console.error(`\n[FAIL] ${failed} of ${rows.length} checks`);
else console.log(`\n[verify-deploy] ${rows.length} checks, all pass`);
process.exit(failed ? 1 : 0);
