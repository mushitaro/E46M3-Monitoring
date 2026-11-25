import { createElement as element } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DiagnosisView, DiagnosisViz, JapaneseInstruments, ModuleRow } from '@tsunagi/monitoring-ui/instruments';

const disconnected = {
    index: null, ecuId: '', connected: false, mode: 'practice', state: 'disconnected',
    practiceArmed: true, allowAll: true, all: true,
    onPractice: () => {}, onDisconnect: () => {}, onChangeEcu: () => {},
} as const;

describe('the shop diagnosis instruments', () => {
    it('keeps standalone practice selectable and lets a shop lock a practice session', () => {
        const works = renderToStaticMarkup(element(ModuleRow, disconnected));
        expect(works).toContain('ALL MODULES');
        expect(works.match(/<input[^>]*>/)?.[0]).not.toContain('disabled');
        const shop = renderToStaticMarkup(element(JapaneseInstruments, {
            children: element(ModuleRow, { ...disconnected, readoutLanguage: 'ja', practiceLocked: true }),
        }));
        expect(shop).toContain('全モジュール');
        expect(shop.match(/<input[^>]*>/)?.[0]).toContain('disabled');
        expect(shop.match(/<input[^>]*>/)?.[0]).toContain('checked');
    });

    it('renders the selected module before a read and distinguishes no reading from zero faults', () => {
        const unread = renderToStaticMarkup(element(JapaneseInstruments, {
            children: [element(DiagnosisView, { key: 'list', ident: null, faults: null, rawFaults: null, catalog: null }),
                element(DiagnosisViz, { key: 'viz', faults: null })],
        }));
        expect(unread).toContain('読取待機中');
        expect(unread).not.toContain('故障なし');
        const clean = renderToStaticMarkup(element(JapaneseInstruments, { children: element(DiagnosisViz, { faults: [] }) }));
        expect(clean).toContain('故障なし');
    });
});
