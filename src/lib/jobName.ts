/**
 * A job's name as a row or a title says it: the first line of its SGBD comment.
 *
 * The catalogue's label is the whole comment, its lines joined with ` / ` — SMG II's TESTPRG_STOP
 * reads 「実行中のテストプログラムの終了 / TESTPRG_STARTENの前に送信すること！ / （ECUタイムアウト: 10秒！）」.
 * The first line names the job; the rest are instructions to whoever writes the sequence, which
 * this app follows itself (UX-27). The whole label stays in the job's detail.
 */
export function headline(label: string): string {
    const first = label.split(' / ')[0]?.trim();
    return first || label;
}
