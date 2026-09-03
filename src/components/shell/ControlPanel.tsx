'use client';

import { Hub, HubCluster, HubNotice, SubActions, type HubConfig, type NoticeTone } from '@/components/Hub';

/**
 * The right column below the picture: what you are talking to, what went wrong,
 * the one primary control, and the actions on the current run.
 *
 * Every slot in it is RESERVED — the notice line and the sub-action row keep
 * their height when empty — so the panel's height is constant by construction.
 * That is what lets the φ split above be declared rather than emerge, and it is
 * why a state change here recolours and relabels without moving anything.
 *
 * It takes its rows as slots rather than as props because two of them are about
 * the session (`module`) and the current run (`children`) and the shell is the
 * only thing that knows those. What this file owns is the ORDER and the reserved
 * heights, which is the part that must not be re-decided per view.
 */
export function ControlPanel({
    module,
    notice,
    hub,
    children,
}: {
    /** The status row: what is being addressed, and the controls that end it. */
    module: React.ReactNode;
    notice: { text?: string; tone: NoticeTone };
    hub: HubConfig;
    /** The sub-actions — things that act on the current run or the workspace. */
    children?: React.ReactNode;
}) {
    return (
        // px-5 pt-4 pb-5 is the control-panel padding from the spacing scale.
        <div className="flex h-[38.2%] min-h-fit flex-none flex-col overflow-y-auto px-5 pb-5 pt-4">
            {module}

            {/* A failure is reported HERE, in the slot that is already reserved
                for it, next to the control that caused it — not as a strip
                between the header and the columns. That strip cost 26px of
                permanent dead space when empty and shoved the whole workspace
                down when full; this costs nothing and puts the message where the
                eye already is. */}
            <HubNotice text={notice.text} tone={notice.tone} />

            {/* The cluster band takes the panel's slack, and the ring sits
                centred in it. The reference does the same — its band is 120px
                because its wings reserve that much, and the hub is 72px centred
                inside. Giving the slack to this band rather than letting it pile
                up at the bottom is what keeps the ring optically centred at every
                viewport height. */}
            <div className="flex min-h-0 flex-1 items-center justify-center">
                <HubCluster>
                    <Hub config={hub} />
                </HubCluster>
            </div>

            <SubActions>{children}</SubActions>
        </div>
    );
}
