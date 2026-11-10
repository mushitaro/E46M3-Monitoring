/**
 * The app itself, at the address the store's E46 /// MAINTENANCE opens it at (`MONITORING ↗` on a
 * car's page; lib/intake/handoff `INTAKE_PATH`).
 *
 * It is a second address and not a second app because one header differs: public/_headers keeps
 * `Cross-Origin-Opener-Policy: same-origin` on every other path, which cuts a cross-origin opener,
 * and leaves it off here, so the MAINTENANCE tab that opened this one stays its `window.opener` and
 * SEND can hand the intake report to it in the background (operator, 2026-11-10, D6). Opened any
 * other way — the head unit, the M menu, a bookmark — MONITORING keeps the stricter policy.
 */
export { default } from '../page';
