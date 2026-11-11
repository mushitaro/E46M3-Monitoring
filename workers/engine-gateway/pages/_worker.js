// The engine gateway, as a Pages project's _worker.js (advanced mode): every request goes to the
// Worker in ../src/index.ts, which wrangler bundles from here. A Pages project rather than a Worker,
// because a Worker's own address is on the account's workers.dev name, which is a person's — the same
// reason as the desk (workers/desk/pages/_worker.js).
export { default } from '../src/index.ts';
