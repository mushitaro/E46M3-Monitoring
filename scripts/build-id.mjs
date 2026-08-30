// ============================================================================
//  build-id.mjs — 配信されているビルドがどれかを、配信物自身に言わせる。
//
//  デプロイが "Success" と出すのは「バイトを上げた」という意味でしかない。
//  どのコミットが今そこに載っているかは、URL を叩いて読めなければ分からない。
//  そのための 1 行を `out/index.html` に入れる。
//
//    <meta name="build-id" content="47.a2cde23+">
//             コミット数 ─┘  ─┘ハッシュ  └─ 未コミット変更あり
//
//  末尾の `+` は作業ツリーが汚れた状態でビルドしたことを示す。開発中は普通だが、
//  公開するビルドに付いていたら、載っているものが git のどこにも無いという意味。
//
//  **`next build` の後に走らせること。** これはビルド済みの HTML を書き換える。
//  後段でバイトを書き換える工程を足すときは、この後ろに置く。
// ============================================================================
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const HTML = 'out/index.html';

if (!existsSync(HTML)) {
    console.error(`[FATAL] ${HTML} が無い。next build の後に実行すること。`);
    process.exit(1);
}

const git = (cmd, fallback) => {
    try {
        return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return fallback;
    }
};

const count = git('git rev-list --count HEAD', '0');
const hash = git('git rev-parse --short HEAD', 'nogit');
const dirty = git('git status --porcelain', '') !== '' ? '+' : '';
const id = `${count}.${hash}${dirty}`;

const html = readFileSync(HTML, 'utf-8');
if (html.includes('name="build-id"')) {
    console.error('[FATAL] build-id が既にある。二重に走っている。');
    process.exit(1);
}

// <head> の直後。無ければ失敗する——黙って何もしないのが一番困る。
const marker = '<head>';
if (!html.includes(marker)) {
    console.error(`[FATAL] ${HTML} に <head> が無い。書き込み場所が分からない。`);
    process.exit(1);
}

writeFileSync(HTML, html.replace(marker, `${marker}<meta name="build-id" content="${id}"/>`), 'utf-8');
console.log(`ok - build-id ${id}`);
