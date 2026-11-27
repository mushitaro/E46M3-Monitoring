/**
 * One shape for every "not started" the assistant's tools answer (ASSISTANT-LAYERS.md 5.4, C7): the
 * sentence to say, which stop of the closed list it is (docs/NO-STOP.md §2), and the next step that
 * makes it go. It lives in the engine (capabilities.ts) so GREN BLUE SUITE's diagnosis tools refuse
 * in the same shape (GREN BLUE's ask 2-2, 2026-11-27); the facade keeps importing it from here.
 *
 * refusal.test.ts checks that the facade returns no `started: false` that did not come from here.
 */
export { refusal, type Refusal, type RefusalKind } from '@tsunagi/monitoring-engine';
