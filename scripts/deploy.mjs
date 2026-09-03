// ============================================================================
//  deploy.mjs — out/ を Cloudflare Pages に配信する
// ----------------------------------------------------------------------------
//  順序: build → 静的であることの主張 → データがあることの主張 → wrangler →
//        配信物の検証。前身から移植したが、**このアプリ固有の拒否がひとつ増えて
//        いる**（下記 3.）。
//
//  1. **wrangler は必ずこのリポジトリ直下で実行する。**
//     `wrangler pages deploy <dir>` の `<dir>` はアップロードする資産の場所だが、
//     Pages Functions は **CWD の `functions/`** から拾われる。別プロジェクトの
//     ディレクトリで実行すると、こちらの静的サイトの上にあちらのバックエンドが
//     載る。静的サイトなら 404 が返るはずのパスが 503 を返したら、それが起きて
//     いる（503 は「コードが動いた」という意味）。
//
//  2. **プロジェクト名は `wrangler.jsonc` の `name` から読む。**
//     `--project-name` と config の `name` が食い違うと、D1/KV/R2 のバインディング
//     が**警告なしに適用されない**。このアプリはバインディングを持たないので実害は
//     無いが、食い違いを許すと持った日に静かに壊れる。
//
//  3. **データの無いビルドは配信を拒否する。** これがこのリポジトリ固有の門。
//     `public/ecu-data/` は git に入っていないので、clone しただけの木でも
//     `npm run build` は通り、**51 モジュールが 0 個の `out/` ができる**。それを
//     配信すると、本物を「誰でも作れるもの」で置き換えることになる。だから
//     `out/ecu-data/index.json` を読み、モジュール数が足りなければ止める。
//
//  4. **`--branch` は本番ブランチに固定する。** `--branch X` は
//     `X.<project>.pages.dev` という alias を作り、**それは期限切れしない**。
//     三つのブランチから配信すれば三つの URL が生き続け、どれも同じラベルを
//     name乗りながら別のビルドで凍る。固定すれば alias は一つも生まれない。
// ============================================================================
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'out');

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
            if (i === tries) throw e;
            console.log(`  ↓ 配信物がまだ古いらしい。${waitMs / 1000}s 待って再検証する。`);
            execSync(`node -e "setTimeout(()=>{}, ${waitMs})"`, { cwd: ROOT, stdio: 'ignore' });
        }
    }
};

if (existsSync(path.join(ROOT, 'functions'))) {
    refuse('functions/ が存在する。この配信は静的でなければならない。消すか、設計を変えるなら意図してやること。');
}

run('npm run build');

// --- データがあることの主張 -------------------------------------------------
const indexPath = path.join(OUT, 'ecu-data', 'index.json');
if (!existsSync(indexPath)) {
    refuse(
        'out/ecu-data/index.json が無い。データの無いビルドを配信しようとしている。\n' +
        '         `npm run data:link` で public/ecu-data/ を用意してから build すること。',
    );
}
const index = JSON.parse(readFileSync(indexPath, 'utf-8'));
const n = index.modules?.length ?? 0;
if (n < MIN_MODULES) {
    refuse(`out/ecu-data/index.json のモジュールが ${n} 個しかない（${MIN_MODULES} 必要）。データが欠けたビルド。`);
}
console.log(`ok    ${n} modules in out/ecu-data/index.json`);

run(`npx --yes wrangler pages deploy out --project-name ${PROJECT} --branch main --commit-dirty=true`);
verify(`node scripts/verify-deploy.mjs https://${PROJECT}.pages.dev`);
