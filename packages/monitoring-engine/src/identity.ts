/**
 * What the link needs to tell which module is at an address (lib/variants), loaded once a page:
 * the group rules, which SGBD is which of the app's modules, and the addresses whose common IDENT
 * is their own.
 *
 * Never throws. Anything missing leaves the identity empty, and an empty identity clears no address:
 * the link then sends IDENTs only where every candidate's own table carries the common one, and
 * nothing else to any module (fails closed).
 */
import { loadEcuIndex } from './ecuCatalog';
import { moduleProtocol } from './moduleProtocol';
import { loadTelegrams } from './telegrams';
import { identAddresses, loadVariantRules, NO_RULES, type VariantRules } from './variants';

export interface Identity {
    rules: VariantRules;
    modules: ReadonlyArray<{ id: string; sgbd: string; address: number }>;
    identOk: ReadonlySet<number>;
}

export const EMPTY_IDENTITY: Identity = { rules: NO_RULES, modules: [], identOk: new Set() };

export async function loadIdentity(): Promise<Identity> {
    try {
        const [rules, index] = await Promise.all([loadVariantRules(), loadEcuIndex()]);
        const protocols = await Promise.all(index.modules.map(async (m) => moduleProtocol(m.id, m.address, await loadTelegrams(m.id))));
        return {
            rules,
            modules: index.modules.map((m) => ({ id: m.id, sgbd: m.sgbd, address: m.address })),
            identOk: identAddresses(protocols, rules),
        };
    } catch {
        return EMPTY_IDENTITY;
    }
}
