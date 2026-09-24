/**
 * The account half of SYNC: this app's own /api/sessions and /api/diagnostics, through the owner
 * gate, with the cookie the gate set when the owner arrived from m3.
 *
 * Every call here first asks `canSync()`, and a build that answers no makes NO request — not a
 * failed one, none. That is the property production depends on (THIRD-PARTY-NOTICES §1): it has
 * no `app-variant` tag, so `isPreviewBuild()` is false, and neither is the dev server, which never
 * carries the tag and has no /api to talk to.
 *
 * The preview answers no as well until the owner has acknowledged what it sends — the notice in its
 * first-run dialog (lib/previewNotice.ts). Until then it is production as far as the network is
 * concerned: nothing is sent, listed or asked, not even whether the owner is signed in.
 *
 * No token, no settings: the requests are same-origin and the gate knows who is asking. Nothing
 * here sends an owner id — the server takes the owner from the gate, never from the body.
 */
import { previewNoticeAcknowledged } from '@/lib/previewNotice';
import { api, gunzipB64, gzipB64, isPreviewBuild, type ApiResult } from './owner-sync';
import { isSavedSession, summarise, type SavedSession } from './session';

/**
 * Whether the account half may make a request: the preview build, once its notice has been
 * acknowledged. Asked at the moment of each call rather than once, so an acknowledgement opens it
 * and nothing before one can.
 */
export const canSync = (): boolean => isPreviewBuild() && previewNoticeAcknowledged();

const notSent = <T>(): ApiResult<T> => ({ ok: false, status: 0, data: null, expired: false, tooLarge: false });

/** A cloud session as the list shows it — every column but the blob. */
export interface CloudSessionRow {
    id: string;
    label: string;
    created_at: number;
    synced_at: number;
    ecu: string | null;
    mock: number;
    fault_count: number | null;
    sample_count: number;
    failure_count: number;
    app_build: string | null;
    session_bytes: number;
}

export interface CloudDiagnosticRow {
    id: string;
    created_at: number;
    synced_at: number;
    ecu: string | null;
    job: string;
    error: string | null;
    error_kind: string | null;
    transport: string | null;
    mock: number;
    app_build: string | null;
    payload_bytes: number | null;
}

export async function sendSession(s: SavedSession): Promise<ApiResult<{ id: string; storedBytes: number }>> {
    if (!canSync()) return notSent();
    const sum = summarise(s);
    return api('/api/sessions', {
        method: 'POST',
        body: {
            id: s.id,
            label: s.label,
            createdAt: s.createdAt,
            ecu: s.ecu,
            mock: s.mock,
            faultCount: sum.faultCount,
            sampleCount: sum.sampleCount,
            failureCount: sum.failureCount,
            appBuild: s.appBuild,
            sessionGz: await gzipB64(JSON.stringify(s)),
        },
    });
}

export async function listCloudSessions(): Promise<ApiResult<{ sessions: CloudSessionRow[] }>> {
    if (!canSync()) return notSent();
    return api('/api/sessions');
}

/**
 * One cloud session, decoded and shape-checked, ready for the local store. Null with the result
 * when it could not be fetched or is not a session this build can read.
 */
export async function fetchCloudSession(id: string): Promise<{ session: SavedSession | null; result: ApiResult<unknown> }> {
    if (!canSync()) return { session: null, result: notSent() };
    const r = await api<{ sessionGz: string | null }>(`/api/sessions/${encodeURIComponent(id)}`);
    if (!r.ok || !r.data?.sessionGz) return { session: null, result: r };
    try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(await gunzipB64(r.data.sessionGz)));
        return { session: isSavedSession(parsed) ? parsed : null, result: r };
    } catch {
        return { session: null, result: r };
    }
}

export async function deleteCloudSession(id: string): Promise<ApiResult<unknown>> {
    if (!canSync()) return notSent();
    return api(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listDiagnostics(): Promise<ApiResult<{ diagnostics: CloudDiagnosticRow[] }>> {
    if (!canSync()) return notSent();
    return api('/api/diagnostics');
}

export async function deleteDiagnostic(id: string): Promise<ApiResult<unknown>> {
    if (!canSync()) return notSent();
    return api(`/api/diagnostics/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
