/** A JSON answer the gateway gives: never cached, so a store's ticket or report is never kept anywhere. */
export function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
}
