/**
 * What in the working tree differs from HEAD — the one definition of "dirty" that build-id.mjs
 * stamps with `+` and deploy.mjs refuses on, so the two can never disagree about a tree.
 *
 * Untracked files count: a build can depend on a file that was never added, and it would then ship
 * code the published repository does not have. Two paths do not: CLAUDE.md and .claude/ are the
 * operator's and the agent's working notes, which no build reads.
 *
 * Gitignored paths (public/ecu-data/, tools/terms/) never appear here — git does not report them —
 * which is correct: they are deliberately not in the published source, and deploy.mjs checks the
 * tables by content instead (the module count).
 */
import { execFileSync } from 'node:child_process';

export const NOTES = /^(CLAUDE\.md$|\.claude\/)/;

/** Paths that differ from HEAD, excluding the notes. Throws if git itself fails. */
export function dirtyPaths(cwd = process.cwd()) {
    // Not trimmed: the first line's leading space is part of its two-column status.
    const out = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
        .split('\n')
        .filter((line) => line.length > 3)
        .map((line) => line.slice(3).replace(/^"|"$/g, ''))
        .filter((path) => !NOTES.test(path));
}
