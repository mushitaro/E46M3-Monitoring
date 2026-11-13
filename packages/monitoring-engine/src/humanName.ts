/**
 * Text a person can read, resolved for the current language.
 *
 * This is a brand, not a description. `DataRow`'s primary slot takes only a
 * `HumanName`, so an SGBD identifier cannot drift into it — putting one there
 * requires calling `humanName()` explicitly, which is a single greppable
 * assertion rather than a mistake anyone can make in passing.
 *
 * The mistake was not hypothetical: eight of the app's ten row types had the
 * identifier in the bright monospace slot that never truncates, and the
 * translated name in the dim one that truncates first.
 *
 * Minted here, by the screen's own primitives (`src/components/ui.tsx` re-exports it) and by the
 * catalogue resolvers (`label()`, `text()` in `ecuCatalog.ts`) — nowhere else. It lives in the
 * engine because the catalogue mints it; the engine has no screen of its own.
 */
export type HumanName = string & { readonly __human: unique symbol };

export function humanName(s: string): HumanName {
    return s as HumanName;
}
