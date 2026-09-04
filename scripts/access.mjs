// ============================================================================
//  access.mjs — Cloudflare Access のアプリとポリシーを読み書きする
// ----------------------------------------------------------------------------
//    node scripts/access.mjs list
//    node scripts/access.mjs show <app-id|hostname の一部>
//    node scripts/access.mjs allow-email <app-id|hostname の一部> <email>
//
//  ## なぜ wrangler ではないのか
//
//  `wrangler login` の OAuth トークンは Pages / Workers / D1 / KV を持つが
//  **Access のスコープを持たない**。しかも wrangler が要求できるスコープ一覧にも
//  無いので、ログインし直しても増えない。実測:
//
//      /accounts/<id>/pages/projects        success  n=10
//      /accounts/<id>/access/organizations  10000 Authentication error
//      /accounts/<id>/access/apps           success  n=0   ← ダッシュボードには 2 つある
//
//  最後の行が一番危ない。**権限が無いことを 403 ではなく「空配列」で返す**ので、
//  「0 件だから作ろう」と進むと静かに間違える。だからこのスクリプトは
//  「0 件」を成功として扱わず、下の `assertVisible` で疑う。
//
//  ## トークン
//
//  `CF_ACCESS_API_TOKEN` から読む。権限は **Account → Access: Apps and Policies →
//  Edit** ひとつで足りる。`CLOUDFLARE_API_TOKEN` という名前で置いてはいけない——
//  wrangler がそれを OAuth より優先し、Access しか権限の無いトークンで
//  `wrangler pages deploy` が落ちる。
//
//  値は読むだけで、**表示も記録もしない**。エラー本文も、トークンを含み得る部分は
//  出さない。
// ============================================================================
const TOKEN = process.env.CF_ACCESS_API_TOKEN;
const ACCOUNT = process.env.CF_ACCOUNT_ID || '2465a92a0a1fce881e195dbe6585e524';
const API = 'https://api.cloudflare.com/client/v4';

if (!TOKEN) {
    console.error('CF_ACCESS_API_TOKEN が未設定です。');
    console.error('  ダッシュボード → プロフィール → API トークン → カスタムトークンを作成');
    console.error('  権限: Account | Access: Apps and Policies | Edit   （これ 1 行だけ）');
    console.error('  CLOUDFLARE_API_TOKEN という名前は使わないこと（wrangler が拾ってしまう）');
    process.exit(2);
}

async function api(path, init = {}) {
    const r = await fetch(API + path, {
        ...init,
        headers: {
            Authorization: `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
            ...(init.headers || {}),
        },
    });
    const body = await r.json().catch(() => ({ success: false, errors: [{ message: 'not json' }] }));
    if (!body.success) {
        const why = (body.errors || []).map((e) => `${e.code}: ${e.message}`).join('; ');
        throw new Error(`${init.method || 'GET'} ${path} -> ${r.status}  ${why}`);
    }
    return body.result;
}

/**
 * 「見えない」を「無い」と読まないための番人。
 *
 * Access の一覧エンドポイントは権限不足を空配列で返す。ダッシュボードに何かある
 * のに 0 件なら、それは事実ではなく権限の話なので、そう言って止まる。
 */
function assertVisible(apps) {
    if (apps.length === 0) {
        console.error('アプリが 0 件です。本当に 0 件かもしれませんが、**権限不足でも 0 件が返ります**。');
        console.error('トークンに Access: Apps and Policies の権限があるか確認してください。');
        process.exit(1);
    }
    return apps;
}

const find = (apps, needle) =>
    apps.find((a) => a.id === needle || (a.domain || '').includes(needle) || (a.name || '').includes(needle));

const line = (a) =>
    `${(a.domain || '(no domain)').padEnd(42)} ${String(a.session_duration || '').padEnd(10)} ${a.id}`;

const [cmd, arg1, arg2] = process.argv.slice(2);

if (cmd === 'list') {
    const apps = assertVisible(await api(`/accounts/${ACCOUNT}/access/apps`));
    console.log('DOMAIN'.padEnd(42) + ' SESSION'.padEnd(11) + ' ID');
    for (const a of apps) console.log(line(a));
    console.log(`\n${apps.length} application(s)`);
} else if (cmd === 'show') {
    const apps = assertVisible(await api(`/accounts/${ACCOUNT}/access/apps`));
    const app = find(apps, arg1 || '');
    if (!app) throw new Error(`no application matching "${arg1}"`);
    console.log(line(app));
    const policies = await api(`/accounts/${ACCOUNT}/access/apps/${app.id}/policies`);
    if (policies.length === 0) {
        console.log('\n  ポリシーが 1 つもありません。Access はデフォルト拒否なので、');
        console.log('  この状態ではログインできても誰も通れません（自分も含めて）。');
    }
    for (const p of policies) {
        console.log(`\n  ${p.decision.toUpperCase()}  "${p.name}"`);
        console.log('  include: ' + JSON.stringify(p.include));
        if (p.require?.length) console.log('  require: ' + JSON.stringify(p.require));
        if (p.exclude?.length) console.log('  exclude: ' + JSON.stringify(p.exclude));
    }
} else if (cmd === 'allow-email') {
    if (!arg2) throw new Error('usage: allow-email <app> <email>');
    const apps = assertVisible(await api(`/accounts/${ACCOUNT}/access/apps`));
    const app = find(apps, arg1 || '');
    if (!app) throw new Error(`no application matching "${arg1}"`);
    const created = await api(`/accounts/${ACCOUNT}/access/apps/${app.id}/policies`, {
        method: 'POST',
        body: JSON.stringify({
            name: `Allow ${arg2}`,
            decision: 'allow',
            include: [{ email: { email: arg2 } }],
        }),
    });
    console.log(`added to ${app.domain}:  ALLOW  ${arg2}   (${created.id})`);
    console.log('既存のポリシーは消していません。広いポリシーが残っていると、');
    console.log('そちらが先に一致して通してしまいます — `show` で並びを確認してください。');
} else {
    console.error('usage: node scripts/access.mjs list | show <app> | allow-email <app> <email>');
    process.exit(2);
}
