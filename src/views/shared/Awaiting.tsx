import type { LucideIcon } from 'lucide-react';

/**
 * The canonical empty state: a dashed ring, a dimmed glyph, and terse mono
 * uppercase copy. Calm and centred — an instrument awaiting input, never an
 * error shout. This is the one placeholder shape; reuse it rather than
 * inventing a per-view em-dash.
 *
 * It carries the app's only `border-2`, and `check_ui_tokens.mjs` names this
 * file to allow it. A dashed ring around a drop-target-shaped area is the
 * documented exception to "rules between regions, never frames around things";
 * the allow-list is by file so a second ring cannot appear without that list
 * changing.
 */
export function Awaiting({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
    return (
        <div className="flex h-full flex-col items-center justify-center text-slate-700">
            <div className="mb-4 flex size-16 items-center justify-center rounded-full border-2 border-dashed border-slate-800 opacity-50">
                <Icon className="size-6 opacity-50" />
            </div>
            <p className="font-mono text-xs uppercase opacity-50">{label}</p>
        </div>
    );
}
