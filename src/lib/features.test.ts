import { describe, expect, it } from 'vitest';
import { FEATURES, enabledTabs, featureEnabled, type FeatureName } from './features';
import { TAB_ORDER } from './tabs';

/**
 * The production set, pinned as a literal.
 *
 * A stage is one word and it can move in a commit about something else. Stating what production
 * renders here means a promotion cannot land without this line changing too — as a deliberate act,
 * in a diff someone reads.
 */
describe('feature registry', () => {
    it('production renders exactly the instrument tabs', () => {
        expect([...enabledTabs(false)].sort()).toEqual(
            ['actuator', 'adaptation', 'datalog', 'diagnosis', 'service'].sort(),
        );
    });

    it('the preview adds SESSIONS and nothing else', () => {
        expect([...enabledTabs(true)].sort()).toEqual([...TAB_ORDER].sort());
    });

    // Asserted directly, not through the tab set: the reason sessionSync is closed in production is
    // a published sentence (THIRD-PARTY-NOTICES §1, public/_headers), and it would still hold if the
    // feature stopped owning a tab.
    it('sessionSync is preview-only — production is network-free', () => {
        expect(FEATURES.sessionSync.stage).toBe('preview-only');
        expect(featureEnabled('sessionSync', false)).toBe(false);
        expect(featureEnabled('sessionSync', true)).toBe(true);
    });

    it('every tab has exactly one owner', () => {
        for (const tab of TAB_ORDER) {
            const owners = (Object.keys(FEATURES) as FeatureName[]).filter((f) => FEATURES[f].tabs.includes(tab));
            expect(owners, tab).toHaveLength(1);
        }
    });
});
