'use client';

import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import { MSS54_CHANNELS, type ChannelId } from '@tsunagi/ds2-mss54';
import { useLang } from '../../lib/i18n';
import { TEST_ID, tid } from '../../lib/testIds';
import { GEAR_CHANNEL, gearAt, nearestSample, sameQuantity } from '../../lib/datalogRun';
import { Awaiting } from '../shared/Awaiting';

/** A channel's name, unit and series colour, wherever it comes from (the DME's blocks or another module). */
export interface ChannelLook {
  id: string;
  name: string;
  unit: string;
}

interface ChannelLabels {
  moduleInfo(id: string): { name: string; ja: string; unit: string | null } | null;
}

export interface DatalogPlot extends ChannelLabels {
  selected: string[];
  samples: { time: number; values: Partial<Record<string, number | null>> }[];
  latest: Partial<Record<string, number | null>>;
  segments: { from: number; why: 'start' | 'channels' | 'part' }[];
  cursor: number | null;
}

export function useLook(datalog: ChannelLabels) {
  const { lang } = useLang();
  return (id: string): ChannelLook => {
    const ch = MSS54_CHANNELS.get(id as ChannelId);
    if (ch)
      return {
        id,
        name: lang === "en" ? ch.field.name : ch.field.ja,
        unit: ch.field.unit,
      };
    const other = datalog.moduleInfo(id);
    return {
      id,
      name: other ? (lang === "en" ? other.name : other.ja) : id,
      unit: other?.unit ?? "",
    };
  };
}

/** Digits by what the value is: whole rpm and km/h, tenths of a degree, two places otherwise. */
export function formatValue(v: number | null | undefined, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (unit === "rpm" || unit === "km/h" || unit === "°C" || unit === "1/min")
    return Math.round(v).toString();
  if (unit.startsWith("°") || unit === "%" || unit === "bar") return v.toFixed(1);
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

/** m:ss */
export const clockOf = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/**
 * The channels as graphs: a target and its actual (`…_soll`, `…_ist` of one block) share one, so
 * the gap between them is what the eye sees; every other channel has its own.
 */
export function groupChannels<C extends string>(channels: readonly C[]): C[][] {
  const out: C[][] = [];
  const used = new Set<string>();
  for (const c of channels) {
    if (used.has(c)) continue;
    const m = /^(.*)_soll$/.exec(c);
    const ist = m ? (`${m[1]}_ist` as C) : null;
    if (ist && channels.includes(ist)) {
      out.push([c, ist]);
      used.add(c).add(ist);
      continue;
    }
    const n = /^(.*)_ist$/.exec(c);
    const soll = n ? (`${n[1]}_soll` as C) : null;
    if (soll && channels.includes(soll)) continue;
    out.push([c]);
    used.add(c);
  }
  return out;
}

/** The colour a quantity is drawn in, by its role (globals.css: the datalog series). */
function seriesOf(unit: string, second: boolean): string {
  if (unit === "rpm") return "var(--color-series-primary)";
  if (unit === "°C") return "var(--color-series-heat)";
  if (unit.startsWith("°") || unit === "%")
    return second ? "var(--color-series-feedback-2)" : "var(--color-series-feedback)";
  return second ? "var(--color-series-neutral-2)" : "var(--color-series-neutral)";
}

/** The seconds a graph spans: the last half minute. */
const WINDOW_S = 30;
const POINTS = 240;

/**
 * Every selected channel as a graph — name, unit and the value now — over the last half minute.
 * Where the run's channels changed, a mark; where the assistant analysed a moment, a cursor with
 * each channel's value at it.
 *
 * `active` is not decoration. The shell overlays every visualization and hides
 * the ones that are not up, so without it this recomputes the traces on every
 * sample flush to draw an `invisible` picture — work stolen from the poll loop,
 * in the view whose whole job is to report that loop's real rate.
 */
export function DatalogViz({
  datalog,
  active,
}: {
  datalog: DatalogPlot;
  active: boolean;
}) {
  const { t } = useLang();
  const look = useLook(datalog);
  const channels = useMemo(
    () => datalog.selected.filter((c) => c !== GEAR_CHANNEL),
    [datalog.selected],
  );
  const view = useMemo(() => {
    if (!active || datalog.samples.length < 2) return null;
    const all = datalog.samples;
    const end = all[all.length - 1].time;
    // The cursor stands while its moment is on the graph: once the run has moved half a minute on, the
    // graph is the run now again, and its values are now's.
    const from = Math.max(0, end - WINDOW_S);
    const first = nearestSample(all, from) ?? 0;
    const window = all.slice(first);
    const step = Math.max(1, Math.ceil(window.length / POINTS));
    const thin = window.filter((_, i) => i % step === 0 || i === window.length - 1);
    const span = end - from || 1;
    const x = (time: number) => ((time - from) / span) * 100;
    const marks = datalog.segments
      .filter((s) => s.why !== "start" && s.from >= from)
      .map((s) => ({ x: x(s.from), why: s.why, from: s.from }));
    const cursorAt = datalog.cursor !== null && datalog.cursor >= from && datalog.cursor <= end ? datalog.cursor : null;
    const ci = cursorAt !== null ? nearestSample(all, cursorAt) : null;
    return { thin, x, marks, end, cursor: cursorAt === null || ci === null ? null : { x: x(cursorAt), t: cursorAt, i: ci } };
  }, [active, datalog.samples, datalog.segments, datalog.cursor]);

  if (!view) return <Awaiting icon={Activity} label={t.awaiting_samples} />;

  const groups = groupChannels(channels);
  const cursorSample = view.cursor ? datalog.samples[view.cursor.i] : null;
  const cursorGear = view.cursor ? gearAt(datalog.samples, view.cursor.i) : null;
  return (
    <div className="flex h-full flex-col gap-1">
      <div className="flex min-h-[16px] items-baseline justify-between gap-2 font-mono text-[10px] text-slate-500">
        <span>
          {t.datalog_window(Math.round(Math.min(WINDOW_S, view.end)))}
        </span>
        {/* Reserved: the cursor's line is there whether or not one is set. */}
        <span
          data-moment={view.cursor ? view.cursor.t.toFixed(2) : undefined}
          className="truncate text-slate-300"
        >
          {view.cursor
            ? t.datalog_cursorLine(clockOf(view.cursor.t), cursorGear?.value ?? null)
            : ""}
        </span>
      </div>
      <div
        className={`grid min-h-0 flex-1 gap-x-3 gap-y-1 ${groups.length > 3 ? "grid-cols-2" : "grid-cols-1"}`}
        style={{ gridTemplateRows: `repeat(${Math.ceil(groups.length / (groups.length > 3 ? 2 : 1))}, minmax(0, 1fr))` }}
      >
        {groups.map((g) => (
          <Trace
            key={g.join()}
            group={g}
            look={look}
            thin={view.thin}
            x={view.x}
            marks={view.marks}
            cursor={view.cursor ? { x: view.cursor.x, values: cursorSample?.values ?? {} } : null}
            latest={datalog.latest}
          />
        ))}
      </div>
    </div>
  );
}

const ALTS = new Map<string, string[]>();
/** A channel's value in a sample, or the same quantity's from another block (a run's channels can change). */
function q(values: Partial<Record<string, number | null>>, c: string): number | null {
    let alts = ALTS.get(c);
    if (!alts) ALTS.set(c, (alts = sameQuantity(c)));
    for (const x of alts) {
        const v = values[x];
        if (typeof v === "number" && Number.isFinite(v)) return v;
    }
    return null;
}

function Trace({
  group,
  look,
  thin,
  x,
  marks,
  cursor,
  latest,
}: {
  group: string[];
  look: (id: string) => ChannelLook;
  thin: DatalogPlot["samples"];
  x: (t: number) => number;
  marks: Array<{ x: number; why: string; from: number }>;
  cursor: { x: number; values: Partial<Record<string, number | null>> } | null;
  latest: Partial<Record<string, number | null>>;
}) {
  const { t } = useLang();
  const looks = group.map(look);
  let min = Infinity;
  let max = -Infinity;
  for (const s of thin)
    for (const c of group) {
      const v = q(s.values, c);
      if (v !== null) [min, max] = [Math.min(min, v), Math.max(max, v)];
    }
  const has = Number.isFinite(min);
  const span = max - min || 1;
  const y = (v: number) => 92 - ((v - min) / span) * 84;
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex min-w-0 items-baseline gap-2 text-[10px]">
        {looks.map((l, k) => (
          <span key={l.id} className="flex min-w-0 items-baseline gap-1">
            <span
              className="inline-block h-0.5 w-2 shrink-0"
              style={{ background: seriesOf(l.unit, k > 0) }}
            />
            <span className="truncate font-sans text-slate-300">{l.name}</span>
            <span className="shrink-0 font-mono tabular-nums text-slate-100">
              {formatValue(q(cursor ? cursor.values : latest, l.id), l.unit)}
            </span>
          </span>
        ))}
        <span className="ml-auto shrink-0 font-mono text-slate-500">{looks[0].unit}</span>
      </div>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="min-h-[18px] w-full flex-1"
      >
        {marks.map((m) => (
          <line
            key={`${m.why}-${m.from}`}
            {...tid(TEST_ID.datalogSegmentMark)}
            aria-label={t.datalog_markLabel(m.why === "part" ? t.datalog_segmentWhy.part : t.datalog_segmentWhy.channels)}
            x1={m.x}
            x2={m.x}
            y1={0}
            y2={100}
            style={{ stroke: "var(--color-series-neutral-2)" }}
            strokeDasharray="2 2"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {has &&
          group.map((c, k) => {
            const pts = thin
              .map((s) => [s.time, q(s.values, c)] as const)
              .filter((p): p is readonly [number, number] => typeof p[1] === "number" && Number.isFinite(p[1]))
              .map(([time, v]) => `${x(time)},${y(v)}`)
              .join(" ");
            return (
              <polyline
                key={c}
                points={pts}
                fill="none"
                style={{ stroke: seriesOf(looks[k].unit, k > 0) }}
                strokeDasharray={group.length > 1 && k === 0 ? "3 2" : undefined}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        {cursor && (
          <line
            {...tid(TEST_ID.datalogCursor)}
            aria-label={t.datalog_cursorLabel}
            x1={cursor.x}
            x2={cursor.x}
            y1={0}
            y2={100}
            style={{ stroke: "var(--color-series-heat)" }}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}

