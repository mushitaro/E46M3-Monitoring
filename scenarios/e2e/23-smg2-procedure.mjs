import { tool } from './_lib.mjs';

const NAME = '前後加速度センサのオフセット学習';

/** An SMG II procedure in PRACTICE: the owner's decision of 2026-11-15 (`p_smg`: run, parked, practised first). */
const scenario = {
    id: 'S23',
    title: 'SMG II の手順：練習モードでエンジンを止め、前提を確かめて実行し、最後まで進む',
    story:
        'オーナーの決定（2026-11-15）：SMG II の 14 の手順は停車中に画面の人が実行する。練習モードで一度動かしたものが実車で動く。' +
        '練習の車のエンジンを止め（ENGINE の印を外す）、SERVICE で「前後加速度センサのオフセット学習」を選ぶと手順の画面が開く。電圧・停車・エンジンはアプリが測るので値の行、測れない前提（ニュートラル、平坦な場所）に印を付けて進め、' +
        '実行すると送る直前に車速・電圧・エンジンを測り、手順は最後まで進んで結果が出る。',
    steps: [
        { ui: 'module', value: 'smg2', means: 'SMG II を選ぶ' },
        { ui: 'practice' },
        { ui: 'click', text: 'CONNECT', settle: 2500, means: '練習の車につなぐ' },
        {
            check: {
                desc: '練習の車のエンジンを止める（ENGINE の印を外す）',
                run: async (page) => {
                    // ENGINE is the practice car's, behind PRACTICE (UX-03): open it first.
                    const door = page.locator('button[aria-controls="practice-car"]:visible').first();
                    if ((await door.count()) === 0) return '練習の車の設定が無い';
                    await door.click();
                    const box = page.locator('label:has-text("ENGINE") input[type=checkbox]').first();
                    if ((await box.count()) === 0) return 'ENGINE の切り替えが無い';
                    await box.uncheck();
                    return true;
                },
            },
        },
        { ui: 'tab', name: 'SERVICE' },
        {
            check: {
                desc: `「${NAME}」（0x08）を一覧で選ぶ`,
                run: async (page) => {
                    const row = page.locator(`button:has-text("0x08"):has-text("${NAME}")`).first();
                    if ((await row.count()) === 0) return '一覧に無い';
                    await row.click();
                    await page.waitForTimeout(800);
                    return true;
                },
            },
        },
        {
            check: {
                desc: '手順の画面の最初の段：電圧・停車・エンジンは測った値の行で印が無く、電池の SGBD の文は印なしで残り、測れない文だけが印（運営者 2026-11-21）',
                run: async (page) => {
                    // The hub opens the procedure's screen.
                    await page.locator('button.rounded-full:has-text("Start"):not([disabled])').first().click();
                    const dialog = page.locator('[role=dialog]').first();
                    await dialog.waitFor({ timeout: 3000 });
                    // The first step: what the app measures before the start (battery, standstill, engine) as lines,
                    // not boxes; the SGBD's battery sentence without a box; the sentences with what it cannot measure, boxes.
                    const lines = await dialog.locator('[data-test="gate-measured"]').allInnerTexts();
                    const boxes = await dialog.locator('input[type=checkbox]').count();
                    if (!(lines.length === 3 && /電圧/.test(lines[0]) && /停車/.test(lines[1]) && /エンジン停止/.test(lines[2]))) return `測る前提の行が違う: ${lines.join(' / ')}`;
                    if (!/バッテリ電圧が十分/.test(await dialog.innerText())) return '電池の SGBD の文（充電器の助言）が消えた';
                    if (boxes !== 2) return `前提の印が ${boxes} 個（測れない文の 2 個のはず）`;
                    return true;
                },
            },
        },
        { shot: 'prereq' },
        {
            check: {
                desc: '測れない前提に印を付けて進み、Start で実行すると最後まで進む',
                run: async (page) => {
                    const dialog = page.locator('[role=dialog]').first();
                    for (let i = 0; i < 6; i++) {
                        for (const box of await dialog.locator('input[type=checkbox]').all()) if (await box.isEnabled()) await box.check();
                        const start = dialog.locator('button:has-text("Start"):not([disabled])');
                        if ((await start.count()) > 0) {
                            await start.first().click();
                            break;
                        }
                        const next = dialog.locator('button:has-text("Next"):not([disabled])');
                        if ((await next.count()) === 0) return `進めない: ${(await dialog.innerText()).slice(0, 300)}`;
                        await next.first().click();
                    }
                    for (let i = 0; i < 40; i++) {
                        const text = await dialog.innerText();
                        if (/正常に終了しました|正常には終了しませんでした|中止しました/.test(text)) {
                            const s = await tool(page, 'monitoring_status');
                            return /正常に終了しました/.test(text) && !s.error ? true : `${text.slice(0, 300)} / error: ${s.error}`;
                        }
                        await page.waitForTimeout(500);
                    }
                    return `終わらない: ${(await dialog.innerText()).slice(0, 400)}`;
                },
            },
        },
        { shot: 'smg2-procedure' },
    ],
};

export default scenario;
