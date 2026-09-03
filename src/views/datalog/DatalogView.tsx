'use client';

import { memo, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import {
    MSS54_BLOCKS_BY_SYMBOL,
    MSS54_CHANNELS,
    MSS54_LIVE_BLOCKS,
    channelId,
    type ChannelId,
} from '@tsunagi/ds2-mss54';
import {
    Chip,
    DataList,
    DataRow,
    FacetRow,
    Field,
    LABEL,
    ListControls,
    Pane,
    Section,
    humanName,
} from '@/components/ui';
import { useLang } from '@/lib/i18n';
import { Awaiting } from '@/views/shared/Awaiting';
import type { Datalog } from './useDatalog';

/**
 * DATALOG — what is being recorded, at what rate, and what the file will hold.
 *
 * The pane is deliberately three sections in the same idiom as every other list
 * in the app. It used to be a readout strip that looked like neither a section
 * nor a list, above a `<details>` tree that looked like nothing else at all.
 */
export function DatalogView({ datalog }: { datalog: Datalog }) {
    const { t, lang } = useLang();
    return (
        <Pane>
            {/* Readouts, not a bare strip of mono text. This row was the one
                place in the app that looked like neither a section nor a list. */}
            <Section title={t.datalog_run} note={datalog.costNotice}>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
                    <Field label={t.samples} value={datalog.samples.length} />
                    <Field
                        label={t.rate}
                        value={datalog.rateHz ? datalog.rateHz.toFixed(1) : '—'}
                        unit={datalog.rateHz ? 'Hz' : undefined}
                    />
                </div>
                {/* The export describes the RUN. Once the selection has moved on
                    from it, say so — otherwise the file and the list above
                    disagree and only the file is right. */}
                {datalog.selectionDrifted && (
                    <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                        {t.datalog_exportsRun(datalog.recorded.length)}
                    </p>
                )}
            </Section>

            <Section title={t.channels} count={datalog.selected.length}>
                <DataList>
                    {datalog.selected.map((id) => {
                        const ch = MSS54_CHANNELS.get(id);
                        const v = datalog.latest[id];
                        return (
                            <DataRow
                                key={id}
                                name={humanName(
                                    ch ? (lang === 'en' ? ch.field.name : ch.field.ja) : '',
                                )}
                                ident={ch?.field.symbol ?? id}
                                // The block is part of the channel's identity, so
                                // it is shown where the identity is shown.
                                code={ch ? String(ch.block.selection) : undefined}
                                trailing={
                                    <span className="shrink-0 font-mono text-xs tabular-nums text-slate-200">
                                        {v == null ? '—' : v.toFixed(2)}
                                    </span>
                                }
                            />
                        );
                    })}
                </DataList>
            </Section>

            <ChannelPicker selected={datalog.selected} disabled={datalog.running} onToggle={datalog.toggle} />
        </Pane>
    );
}

/**
 * A single-channel trace. Enough to see the shape; the pane shows the numbers.
 *
 * `active` is not decoration. The shell overlays every visualization and hides
 * the ones that are not up, so without it this recomputes min, max and 240
 * points on every sample flush to draw an `invisible` polyline — work stolen
 * from the poll loop, in the view whose whole job is to report that loop's real
 * rate.
 */
export function DatalogViz({ datalog, active }: { datalog: Datalog; active: boolean }) {
    const { t, lang } = useLang();
    const id = datalog.selected[0];
    // The trace's own label followed the rest of the app's inversion: it printed
    // the raw channel id, `3:n`, in the one slot the eye reads as the name.
    const ch = id ? MSS54_CHANNELS.get(id) : undefined;
    const points = useMemo(() => {
        if (!id || !active) return null;
        const window = datalog.samples.slice(-240);
        const values = window
            .map((s) => s.values[id])
            .filter((v): v is number => v !== null && v !== undefined);
        if (values.length < 2) return null;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = max - min || 1;
        return {
            min,
            max,
            d: values
                .map((v, i) => `${(i / (values.length - 1)) * 100},${100 - ((v - min) / span) * 100}`)
                .join(' '),
        };
    }, [datalog.samples, id, active]);

    if (!points) return <Awaiting icon={Activity} label={t.awaiting_samples} />;

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-baseline justify-between font-mono text-[10px] text-slate-600">
                <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate font-sans text-slate-300">
                        {ch ? (lang === 'en' ? ch.field.name : ch.field.ja) : id}
                    </span>
                    <span className="shrink-0 text-slate-600">{id}</span>
                </span>
                <span>
                    {points.min.toFixed(1)} – {points.max.toFixed(1)}
                </span>
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="min-h-0 w-full flex-1">
                <polyline
                    points={points.d}
                    fill="none"
                    stroke="#26AEE4"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                />
            </svg>
        </div>
    );
}

/**
 * The channel picker — the same recipe as the jobs pane, not its own idiom.
 *
 * It used to be `<details>` / `<summary>` / `<label>` with its own uppercase
 * group headers, its own `(32)` count format, its own row height and a nested
 * scroller, sitting next to a jobs list that had a search box, facet chips with
 * counts, and none of those things. Two lists of a few hundred rows, doing the
 * same job, looking nothing alike.
 *
 * Now: search, block chips carrying their counts, one DataList. The block is a
 * FACET rather than a container because a block is a cost — one round trip per
 * block per sample — so what you want is to see the count, not to fold it away.
 *
 * Still memoized. Without it every sample flush re-rendered all 213 rows, and
 * against a synchronous simulator that starved the poll loop badly enough to
 * report 1.0 Hz — the app measuring itself instead of the link, in the one view
 * whose job is to report the link's real rate.
 */
const ChannelPicker = memo(function ChannelPicker({
    selected,
    disabled,
    onToggle,
}: {
    selected: readonly ChannelId[];
    disabled: boolean;
    onToggle: (id: ChannelId, on: boolean) => void;
}) {
    const { t, lang } = useLang();
    const [query, setQuery] = useState('');
    const [block, setBlock] = useState<number | 'all'>('all');

    const all = useMemo(
        () => MSS54_LIVE_BLOCKS.flatMap((b) => b.fields.map((f) => ({ ...f, block: b }))),
        [],
    );
    const rows = useMemo(() => {
        const q = query.trim().toLowerCase();
        return all.filter((f) => {
            if (block !== 'all' && f.block.selection !== block) return false;
            if (!q) return true;
            // Every name a channel has is searchable: the symbol, the Japanese,
            // the reference English and the SGBD German. Someone reading a wiring
            // diagram has the German; someone reading a forum post has the symbol.
            return (
                f.symbol.toLowerCase().includes(q) ||
                f.ja.includes(query.trim()) ||
                f.name.toLowerCase().includes(q) ||
                (f.de ?? '').toLowerCase().includes(q)
            );
        });
    }, [all, query, block]);

    return (
        <Section title={t.channels_pick} count={all.length}>
            <ListControls
                query={query}
                onQuery={setQuery}
                placeholder={t.channels_search}
                shown={rows.length}
                total={all.length}
                hiddenNote={rows.length < all.length ? t.facet_hidden(all.length - rows.length) : undefined}
            >
                <FacetRow label={t.channels_block}>
                    <Chip active={block === 'all'} onClick={() => setBlock('all')}>
                        {t.facet_all}
                    </Chip>
                    {MSS54_LIVE_BLOCKS.map((b) => (
                        <Chip
                            key={b.selection}
                            active={block === b.selection}
                            count={b.fields.length}
                            title={t.channels_blockNote(b.selection)}
                            onClick={() => setBlock(block === b.selection ? 'all' : b.selection)}
                        >
                            {lang === 'en' ? b.name : b.ja}
                        </Chip>
                    ))}
                </FacetRow>
            </ListControls>

            <DataList className="mt-3">
                {rows.map((f) => {
                    const id = channelId(f.block.selection, f.symbol);
                    const on = selected.includes(id);
                    // 10 quantities are readable from two blocks. Naming the
                    // other one is what replaces the solver that used to pick
                    // silently: a channel already covered by a block you are
                    // reading costs no extra round trip, and now you can see it.
                    const also = (MSS54_BLOCKS_BY_SYMBOL.get(f.symbol) ?? [])
                        .filter((b) => b.selection !== f.block.selection)
                        .map((b) => b.selection);
                    return (
                        <DataRow
                            key={id}
                            selected={on}
                            onSelect={disabled ? undefined : () => onToggle(id, !on)}
                            leading={
                                <input
                                    type="checkbox"
                                    checked={on}
                                    disabled={disabled}
                                    readOnly
                                    tabIndex={-1}
                                    className="size-3 shrink-0 accent-blue-500"
                                />
                            }
                            name={humanName(lang === 'en' ? f.name : f.ja)}
                            // The SGBD's own German where the join found it, and the
                            // symbol otherwise. It goes in the identifier slot rather
                            // than a `detail` line: as a detail it made 86 of 213 rows
                            // taller than the other 127, and a list whose row height
                            // alternates down the page is the reflow this system
                            // reserves slots to avoid.
                            ident={f.de ? `${f.symbol} · ${f.de}` : f.symbol}
                            // Same datum, same slot as the selected-channel
                            // list above: the block IS part of the identity.
                            code={String(f.block.selection)}
                            trailing={
                                <>
                                    {f.unit && (
                                        <span className="shrink-0 font-mono text-[11px] text-slate-500">{f.unit}</span>
                                    )}
                                    {also.length > 0 && (
                                        <span
                                            title={t.channels_alsoInNote}
                                            className={`shrink-0 ${LABEL} text-slate-600`}
                                        >
                                            {t.channels_alsoIn(also.join(' / '))}
                                        </span>
                                    )}
                                </>
                            }
                        />
                    );
                })}
            </DataList>
        </Section>
    );
});
