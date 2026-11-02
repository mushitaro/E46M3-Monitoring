'use client';

import type { LucideIcon } from 'lucide-react';
import { LABEL } from '@/components/ui';
import type { StatusLook, StatusTone } from '@/lib/sync/status';

/**
 * SAVE or SYNC on the desk: TUNER's session-bar control — a glyph and the state's word, in the
 * state's colour, `title` carrying the sentence. Unpressable while anything else is in flight too.
 */
export function StatusButton({
    look,
    tones,
    Icon,
    busy,
    onClick,
}: {
    look: StatusLook;
    tones: Record<StatusTone, string>;
    Icon: LucideIcon;
    busy: boolean;
    onClick: () => void;
}) {
    const disabled = look.disabled || busy;
    return (
        <button
            type="button"
            onClick={disabled ? undefined : onClick}
            disabled={disabled}
            title={look.title}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap ${LABEL} transition-colors ${tones[look.tone]}`}
        >
            <Icon className="size-3 shrink-0" />
            {look.label}
        </button>
    );
}
