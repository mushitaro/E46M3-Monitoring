// ============================================================================
//  deploy.mjs — out/ を Cloudflare Pages の preview プロジェクトに配信する
// ----------------------------------------------------------------------------
//  順序: 配信元の主張（名前・ゲート・公開済みのソース・きれいな木）→ build:preview
//        → データがあることの主張 → 共有トークンが無いことの主張 → wrangler →
//        配信物の検証。どれか一つでも満たさなければ、何も上げずに止まる。
//
//  このリポジトリから配信するのは**オーナー向けの preview だけ**（運営者の決定、
//  2026-09-23）。本番 `e46m3-monitoring`（Access の内側）は残っているが、ここからは
//  もう配信しない。
//
//  1. **wrangler は必ずこのリポジトリ直下で実行する。**
//     `wrangler pages deploy <dir>` の `<dir>` はアップロードする資産の場所だが、
//     Pages Functions は **CWD の `functions/`** から拾われる。このリポジトリの
//     `functions/` はオーナーのゲートと SYNC そのもので、別の場所から実行すれば
//     ゲートの無い配信か、別のアプリのバックエンドが載った配信になる。
//
//  2. **プロジェクト名は `wrangler.jsonc` の `name` から読み、preview 以外を拒む。**
//     `--project-name` と config の `name` が食い違うと、D1 のバインディング
//     （RUNS_DB）が**警告なしに適用されない**——SYNC が 5xx を返す配信になる。
//     `name` が preview でなければ、それは誰かが本番へ向け直したということなので止める。
//
//  3. **ゲートの無い配信を拒否する。** 以前はここで `functions/` の存在を拒んでいた
//     （静的配信だった）。今は逆で、`functions/_middleware.ts` が無ければ止める。
//     `ecu-data/` は BMW SGBD 由来＋逆コンパイル由来で（THIRD-PARTY-NOTICES.md §3.3）、
//     ゲートの無い preview はそれを誰にでも配る。`npm run gate:verify` でゲートが
//     tsunagi-m3 の正本と一致することも確かめる。
//
//  4. **配るソースは公開済みでなければならない。** MESH は「研究開発した技術や
//     ツールはオープンソースとして無料で公開」と言っている。preview として配る版も
//     例外ではないので、`HEAD == origin/main` でなければ拒む（先に push する）。
//     作業ツリーもきれいであること——未コミットの変更が載った配信は、公開された
//     どのコミットとも一致しない。例外は CLAUDE.md と .claude/ だけ（どのビルドも
//     読まない作業メモ）。定義は scripts/tree-state.mjs で、build-id.mjs と共有する。
//     公開リポジトリに載ってはならないもの（BMW 由来のデータ、ダンプ、VIN、秘密）が
//     追跡されていないことは `scripts/check-public-tree.mjs` で確かめる。
//
//  5. **データの無いビルドは配信を拒否する。** これがこのリポジトリ固有の門。
//     `public/ecu-data/` は git に入っていないので、clone しただけの木でも
//     build は通り、**51 モジュールが 0 個の `out/` ができる**。それを
//     配信すると、本物を「誰でも作れるもの」で置き換えることになる。だから
//     `out/ecu-data/index.json` を読み、モジュール数が足りなければ止める。
//
//  6. **共有のアップロードトークンは退役した。** SYNC はゲートが解決した持ち主で
//     分けられ、トークンを持たない。`sync-token` の meta を含む HTML が一つでも
//     あれば、それは公開ページに書き込み鍵を載せる配信なので止める。
//
//  7. **`--branch` は main に固定する。** `--branch X` は
//     `X.<project>.pages.dev` という alias を作り、**それは期限切れしない**。
//     固定すれば alias は一つも生まれない。
//
//  検証（verify-deploy.mjs）はゲートの内側を読むので、オーナーのセッションが要る。
//  tsunagi-m3 の `access-session.mjs` で短命のセッションを発行し、そのファイルを
//  `GATE_SESSION_FILE` で渡す。Fail closed は Pages の API から読むので、
//  `CF_API_TOKEN` と `CF_ACCOUNT_ID`（読むだけ）も要る。どちらかが無ければ
//  「未検証」（終了コード 2）で終える。
// ============================================================================
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirtyPaths } from './tree-state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');

/** The only project this repository deploys to. The production project is not deployed from here. */
const PREVIEW_PROJECT = 'e46m3-monitoring-preview';
/** Where the published source lives. A deployed build must be exactly a commit on it. */
const PUBLIC_BRANCH = 'main';

/** 出荷に必要なモジュール数。`tools/ecu_data_counts.json` が真の台帳で、これは下限。 */
const MIN_MODULES = 51;

const cfg = JSON.parse(
    readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf-8').replace(/^\s*\/\/.*$/gm, ''),
);
const PROJECT = cfg.name;

const run = (cmd) => {
    console.log('> ' + cmd);
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
};

const git = (args) =>
    execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const refuse = (why) => {
    console.error(`[REFUSE] ${why}`);
    process.exit(1);
};

/**
 * 配信物の検証だけは再試行する。
 *
 * wrangler が Success を返した直後にエッジがまだ旧バンドルを返すことがある(実測)。
 * それを「デプロイ失敗」と誤報すると本物の失敗を見失うので、回数を切って再試行し、
 * **各試行を黙らずに出す**。黙ってリトライすると伝播遅延の実態が見えなくなる。
 * 三度目でも落ちるならそれは本物。
 */
const verify = (cmd, tries = 3, waitMs = 8000) => {
    for (let i = 1; i <= tries; i++) {
        console.log(`> ${cmd}${i > 1 ? `   (attempt ${i}/${tries})` : ''}`);
        try {
            execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
            return;
        } catch (e) {
            // 2 は「検証できなかった」。ゲートの内側を読むセッションが無い、という意味で、
            // **再試行しても永遠に同じ**。1（検証して落ちた）と混ぜない——再試行するのは
            // 「エッジがまだ古い」場合だけ。
            if (e.status === 2) {
                console.error('\n[deploy] 配信は完了しましたが、検証はできていません（上記参照）。');
                process.exit(2);
            }
            if (i === tries) throw e;
            console.log(`  ↓ 配信物がまだ古いらしい。${waitMs / 1000}s 待って再検証する。`);
            execSync(`node -e "setTimeout(()=>{}, ${waitMs})"`, { cwd: ROOT, stdio: 'ignore' });
        }
    }
};

// --- 1–2. どこへ ---------------------------------------------------------------
if (PROJECT !== PREVIEW_PROJECT) {
    refuse(
        `wrangler.jsonc の name が "${PROJECT}"。このリポジトリが配信するのは ${PREVIEW_PROJECT} だけ。\n` +
            '         本番（e46m3-monitoring）へは、ここからは配信しない。',
    );
}
if (!cfg.d1_databases?.some((d) => d.binding === 'RUNS_DB')) {
    refuse('wrangler.jsonc に RUNS_DB のバインディングが無い。SYNC がすべて 5xx になる配信になる。');
}

// --- 3. ゲート ---------------------------------------------------------------
if (!existsSync(path.join(ROOT, 'functions', '_middleware.ts'))) {
    refuse('functions/_middleware.ts が無い。オーナーのゲートの無い preview は ecu-data を誰にでも配る。');
}
run('npm run gate:verify');

// --- 4. 公開済みのソースと、きれいな木 -----------------------------------------
run('node scripts/check-public-tree.mjs');
const dirty = dirtyPaths(ROOT);
if (dirty.length > 0) {
    refuse(
        '作業ツリーがきれいでない（CLAUDE.md と .claude/ 以外）。コミットして push してから配信する:\n' +
            dirty.map((p) => `           ${p}`).join('\n'),
    );
}
let head = '';
let published = '';
try {
    head = git(['rev-parse', 'HEAD']);
    // Read the remote as it is now, not as the last fetch left it: a stale origin/main that happens
    // to equal HEAD would pass a commit that was never pushed.
    git(['fetch', '--quiet', 'origin', PUBLIC_BRANCH]);
    published = git(['rev-parse', `origin/${PUBLIC_BRANCH}`]);
} catch {
    refuse(
        `origin/${PUBLIC_BRANCH} を読めない。配る版が公開済みであることを確かめられないので配信しない。\n` +
            '         remote が無いなら、先に公開リポジトリへ push すること。',
    );
}
if (head !== published) {
    refuse(
        `HEAD (${head.slice(0, 7)}) が origin/${PUBLIC_BRANCH} (${published.slice(0, 7)}) と一致しない。\n` +
            `         配る版のソースは公開されていなければならない。先に git push origin ${PUBLIC_BRANCH} すること。`,
    );
}
const short = git(['rev-parse', '--short', 'HEAD']);
console.log(`ok    HEAD ${short} is origin/${PUBLIC_BRANCH}`);

run('npm run build:preview');

// --- 5. データがあることの主張 -------------------------------------------------
const indexPath = path.join(OUT, 'ecu-data', 'index.json');
if (!existsSync(indexPath)) {
    refuse(
        'out/ecu-data/index.json が無い。データの無いビルドを配信しようとしている。\n' +
            '         public/ecu-data/ を用意してから build すること（docs/REFERENCES.md §3）。',
    );
}
const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
const n = index.modules?.length ?? 0;
if (n < MIN_MODULES) {
    refuse(`out/ecu-data/index.json のモジュールが ${n} 個しかない（${MIN_MODULES} 必要）。データが欠けたビルド。`);
}
console.log(`ok    ${n} modules in out/ecu-data/index.json`);

// --- 6. 共有トークンが載っていないこと、公開済みのコミットの preview であること -------
const html = (function walk(dir) {
    return readdirSync(dir).flatMap((name) => {
        const p = path.join(dir, name);
        return statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') ? [p] : [];
    });
})(OUT);
const rel = (ps) => ps.map((p) => path.relative(ROOT, p)).join(', ');
const withToken = html.filter((p) => /<meta[^>]+name="sync-token"/.test(readFileSync(p, 'utf8')));
if (withToken.length > 0) refuse(`sync-token の meta を含む HTML がある: ${rel(withToken)}`);
const unbranded = html.filter((p) => !readFileSync(p, 'utf8').includes('<meta name="app-variant" content="preview">'));
if (unbranded.length > 0) refuse(`app-variant=preview の無い HTML がある: ${rel(unbranded)}`);
const { buildId } = JSON.parse(readFileSync(path.join(OUT, 'version.json'), 'utf8'));
if (buildId !== `${git(['rev-list', '--count', 'HEAD'])}.${short}`) {
    refuse(`build-id "${buildId}" が、公開済みの HEAD ${short} のきれいなビルドではない。`);
}
console.log(`ok    no sync-token; ${html.length} documents branded preview; build ${buildId}`);

// `--commit-dirty=true`: CLAUDE.md and .claude/ may differ from HEAD and are deliberately outside the
// tree check above; without the flag wrangler warns about them on every deploy.
run(`npx --yes wrangler pages deploy out --project-name ${PROJECT} --branch main --commit-dirty=true`);
verify(`node scripts/verify-deploy.mjs https://${PROJECT}.pages.dev`);
