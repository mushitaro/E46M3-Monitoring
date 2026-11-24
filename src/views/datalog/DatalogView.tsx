"use client";

import { memo, useMemo, useState } from "react";
import {
  MSS54_BLOCKS_BY_SYMBOL,
  MSS54_CHANNELS,
  MSS54_LIVE_BLOCKS,
  channelId,
  type ChannelId,
} from "@tsunagi/ds2-mss54";
import type { ProbeStep } from "@tsunagi/monitoring-engine";
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
} from "../../components/ui";
import { useLang } from "../../lib/i18n";
import { TEST_ID, tid } from "../../lib/testIds";
import {
  GEAR_CHANNEL,
  captureWindows,
  sameQuantity,
  segmentStats,
} from "../../lib/datalogRun";
import { Awaiting } from "../../views/shared/Awaiting";
import type { LiveSample, ModuleChannelInfo } from '@tsunagi/monitoring-engine';
import type { DatalogSegment } from '../../lib/datalogRun';

export interface DatalogInstrument {
  selected: ChannelId[];
  recorded: ChannelId[];
  samples: LiveSample[];
  segments: DatalogSegment[];
  latest: LiveSample['values'];
  rateHz: number | null;
  running: boolean;
  selectionDrifted: boolean;
  costNotice: string;
  toggle(id: ChannelId, on: boolean): void;
  moduleInfo(id: string): ModuleChannelInfo | null;
  moduleInfos: ModuleChannelInfo[];
}
type Datalog = DatalogInstrument;

/** The plan the open CO-WORK record holds, as DATALOG shows it beside a recording. */
export interface DatalogPlan {
  /** When it was written (`appNow()`): a capture counts from then. */
  at: number;
  steps: readonly ProbeStep[];
}

import { useLook, clockOf, formatValue, groupChannels, type ChannelLook } from './DatalogViz';
export { DatalogViz, clockOf, formatValue } from './DatalogViz';

/**
 * DATALOG — what is being recorded, at what rate, and what the file will hold.
 *
 * The pane is deliberately sections in the same idiom as every other list
 * in the app. It used to be a readout strip that looked like neither a section
 * nor a list, above a `<details>` tree that looked like nothing else at all.
 */
export function DatalogView({
  datalog,
  plan = null,
  mss54 = true,
}: {
  datalog: Datalog;
  plan?: DatalogPlan | null;
  mss54?: boolean;
}) {
  const { t } = useLang();
  const look = useLook(datalog);
  const last = datalog.samples[datalog.samples.length - 1];
  const showGear = !datalog.selected.includes(GEAR_CHANNEL);
  return (
    <Pane>
      {/* Readouts, not a bare strip of mono text. This row was the one
                place in the app that looked like neither a section nor a list. */}
      <Section title={t.datalog_run} note={datalog.costNotice}>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <Field label={t.samples} value={datalog.samples.length} />
          <Field
            label={t.rate}
            value={datalog.rateHz ? datalog.rateHz.toFixed(1) : "—"}
            unit={datalog.rateHz ? "Hz" : undefined}
          />
          <Field
            label={t.datalog_elapsed}
            value={last ? clockOf(last.time) : "—"}
          />
        </div>
        {/* Reserved: the gear line and the export note keep their height
                    whether or not they have anything to say. */}
        <p className="mt-2 min-h-[16px] truncate text-[11px] leading-relaxed text-slate-500">
          {showGear ? t.datalog_gearNote : ""}
        </p>
        {/* The export describes the RUN. Once the selection has moved on
                    from it, say so — otherwise the file and the list above
                    disagree and only the file is right. */}
        <p className="min-h-[16px] truncate text-[11px] leading-relaxed text-slate-500">
          {datalog.selectionDrifted && !datalog.running
            ? t.datalog_exportsRun(datalog.recorded.length)
            : ""}
        </p>
      </Section>

      {datalog.segments.length > 1 && <Segments datalog={datalog} />}
      {plan && <PlanSteps plan={plan} datalog={datalog} />}

      <Section title={t.channels} count={datalog.selected.length}>
        <DataList>
          {datalog.selected.map((id) => {
            const ch = MSS54_CHANNELS.get(id);
            const other = ch ? null : datalog.moduleInfo(id);
            const l = look(id);
            const v = datalog.latest[id];
            // Another module's value that the gate holds while the car moves comes empty:
            // the row says so, rather than looking like a reading that stopped.
            const empty = datalog.running && other && v == null;
            return (
              <DataRow
                key={id}
                name={humanName(l.name)}
                ident={
                  ch?.field.symbol ??
                  (other ? `${other.module} · ${other.result}` : id)
                }
                // The block is part of the channel's identity, so
                // it is shown where the identity is shown.
                code={ch ? String(ch.block.selection) : undefined}
                trailing={
                  <span className="shrink-0 font-mono text-xs tabular-nums text-slate-200">
                    {formatValue(v, l.unit)}
                    {l.unit && (
                      <span className="ml-1 text-slate-500">{l.unit}</span>
                    )}
                  </span>
                }
                detail={
                  empty ? (
                    <p className="text-[11px] text-slate-500">
                      {t.datalog_otherEmpty}
                    </p>
                  ) : undefined
                }
              />
            );
          })}
        </DataList>
      </Section>

      {mss54 && <ChannelPicker
        selected={datalog.selected}
        onToggle={datalog.toggle}
      />}
      {datalog.moduleInfos.length > 0 && <OtherModules datalog={datalog} />}
    </Pane>
  );
}

/** Where the run's channels changed, and the ten-minute cuts: each stretch with its rate. */
function Segments({ datalog }: { datalog: Datalog }) {
  const { t } = useLang();
  const rows = useMemo(
    () => segmentStats(datalog.segments, datalog.samples),
    [datalog.segments, datalog.samples],
  );
  return (
    <Section title={t.datalog_segments} count={rows.length}>
      <DataList>
        {rows.map((s, i) => (
          <li
            key={`${s.from}-${i}`}
            {...tid(TEST_ID.datalogSegmentRow)}
            className="flex items-baseline gap-x-3 px-2 py-2 text-xs"
          >
            <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-500">
              {clockOf(s.from)}
            </span>
            <span className="min-w-0 flex-1 truncate text-slate-200">
              {t.datalog_segmentWhy[s.why]}
              {s.part > 1 ? ` · ${t.datalog_part(s.part)}` : ""}
            </span>
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-400">
              {t.datalog_segmentLine(s.channels.length, s.blocks, s.rateHz)}
            </span>
          </li>
        ))}
      </DataList>
    </Section>
  );
}

/**
 * The plan of the open CO-WORK record, beside the recording: what it reads, and for each capture
 * whether the recording has passed through its condition since the plan was written (待っている →
 * 取った). The steps PROBE alone runs (fault reads, learned values) say so.
 */
function PlanSteps({ plan, datalog }: { plan: DatalogPlan; datalog: Datalog }) {
  const { t } = useLang();
  const startedAt = datalog.segments[0]?.at ?? null;
  // Captures count from when the plan was written: seconds into this run.
  const sinceS = startedAt === null ? Infinity : (plan.at - startedAt) / 1000;
  const look = useLook(datalog);
  return (
    <Section title={t.datalog_plan} count={plan.steps.length}>
      <DataList>
        {plan.steps.map((s) => {
          let state: string;
          let windows: Array<{ from: number; to: number; hit: number }> = [];
          if (s.kind === "capture") {
            windows = captureWindows(datalog.samples, s.condition, s.preS, s.postS);
            const caught = windows.filter((w) => w.hit >= sinceS).length;
            state = caught > 0 ? t.datalog_planCaught(caught) : t.datalog_planWaiting;
          } else if (s.kind === "sample") {
            state = datalog.running ? t.datalog_planRecording : "—";
          } else {
            state = t.datalog_planProbe;
          }
          return (
            <li key={s.n} className="px-2 py-2">
              <div className="flex items-baseline gap-x-3 text-xs">
                <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-slate-500">
                  {s.n}
                </span>
                <span className="min-w-0 flex-1 truncate text-slate-200">{s.do}</span>
                <span className={`shrink-0 ${LABEL} text-slate-400`}>{state}</span>
              </div>
              {s.kind === "capture" && windows.length > 0 && (
                <Compare datalog={datalog} windows={windows.slice(-2)} look={look} />
              )}
            </li>
          );
        })}
      </DataList>
    </Section>
  );
}

/** The engine speed in a sample, from whichever block read it. */
function rpmOf(values: Partial<Record<string, number | null>>): number | null {
  for (const c of sameQuantity("3:n")) {
    const v = values[c];
    if (typeof v === "number") return v;
  }
  return null;
}

/**
 * Two stretches the plan's capture marked, overlaid against engine speed: the first and the last,
 * so a repeat of the same pull can be laid on the one before (SC13: 「1 回目と比べて」).
 */
function Compare({
  datalog,
  windows,
  look,
}: {
  datalog: Datalog;
  windows: Array<{ from: number; to: number }>;
  look: (id: string) => ChannelLook;
}) {
  const { t } = useLang();
  const panels = useMemo(() => {
    // The quantities both stretches carry, engine speed and the gear aside, grouped as the graphs are.
    const inWindow = windows.map((w) =>
      datalog.samples.filter((s) => s.time >= w.from && s.time <= w.to),
    );
    const common = datalog.recorded.filter(
      (c) =>
        c !== GEAR_CHANNEL &&
        MSS54_CHANNELS.get(c)?.field.symbol !== "n" &&
        inWindow.every((xs) => xs.some((s) => typeof s.values[c] === "number")),
    );
    const groups = groupChannels(common).slice(0, 3);
    let lo = Infinity;
    let hi = -Infinity;
    for (const xs of inWindow)
      for (const s of xs) {
        const r = rpmOf(s.values);
        if (r !== null) [lo, hi] = [Math.min(lo, r), Math.max(hi, r)];
      }
    return { inWindow, groups, lo, hi };
  }, [datalog.samples, datalog.recorded, windows]);
  if (panels.groups.length === 0 || !Number.isFinite(panels.lo)) return null;
  const span = panels.hi - panels.lo || 1;
  const COLORS = ["var(--color-series-neutral)", "var(--color-series-primary)"];
  return (
    <div className="mt-2 space-y-2 pl-[52px]">
      <div className="flex items-baseline gap-4 text-[11px] text-slate-400">
        <span className={`${LABEL} text-slate-500`}>{t.datalog_compare}</span>
        {windows.map((_, k) => (
          <span key={k} className="flex items-baseline gap-1.5">
            <span className="inline-block h-0.5 w-3" style={{ background: COLORS[k % COLORS.length] }} />
            {t.datalog_compareRun(k + 1)}
          </span>
        ))}
        <span className="ml-auto font-mono tabular-nums text-slate-500">
          {Math.round(panels.lo)}–{Math.round(panels.hi)} rpm
        </span>
      </div>
      {panels.groups.map((g) => {
        let min = Infinity;
        let max = -Infinity;
        for (const xs of panels.inWindow)
          for (const s of xs)
            for (const c of g) {
              const v = s.values[c as ChannelId];
              if (typeof v === "number") [min, max] = [Math.min(min, v), Math.max(max, v)];
            }
        const vspan = max - min || 1;
        return (
          <div key={g.join()} className="text-[11px]">
            <div className="flex items-baseline gap-2 text-slate-400">
              <span className="truncate">{g.map((c) => look(c).name).join(" / ")}</span>
              <span className="shrink-0 font-mono text-slate-500">{look(g[0]).unit}</span>
            </div>
            <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="h-12 w-full">
              {panels.inWindow.map((xs, k) =>
                g.map((c, j) => {
                  const pts = xs
                    .map((s) => [rpmOf(s.values), s.values[c as ChannelId]] as const)
                    .filter((p): p is readonly [number, number] => typeof p[0] === "number" && typeof p[1] === "number")
                    .sort((a, b) => a[0] - b[0])
                    .map(([r, v]) => `${((r - panels.lo) / span) * 100},${40 - ((v - min) / vspan) * 40}`)
                    .join(" ");
                  return (
                    <polyline
                      key={`${k}-${c}`}
                      points={pts}
                      fill="none"
                      style={{ stroke: COLORS[k % COLORS.length] }}
                      strokeWidth="1"
                      strokeDasharray={j > 0 ? undefined : g.length > 1 ? "3 2" : undefined}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                }),
              )}
            </svg>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Every other module's values (operator 2026-11-13: 「全モジュールのデータログ」): one module at a time,
 * chosen by a chip, so the list stays a list. A module with a channel already selected shows its count.
 */
function OtherModules({ datalog }: { datalog: Datalog }) {
  const { t, lang } = useLang();
  const modules = useMemo(
    () => [...new Set(datalog.moduleInfos.map((i) => i.module))],
    [datalog.moduleInfos],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const shown =
    picked && modules.includes(picked) ? picked : (modules[0] ?? null);
  const infos = datalog.moduleInfos.filter((i) => i.module === shown);
  const chosen = (m: string) =>
    datalog.moduleInfos.filter(
      (i) =>
        i.module === m && datalog.selected.includes(i.channel as ChannelId),
    ).length;
  return (
    <Section
      title={t.channels_other}
      count={datalog.moduleInfos.length}
      note={t.channels_otherNote}
    >
      <FacetRow label={t.channels_module}>
        {modules.map((m) => (
          <Chip
            key={m}
            active={m === shown}
            onClick={() => setPicked(m)}
            count={chosen(m) || undefined}
          >
            {m.toUpperCase()}
          </Chip>
        ))}
      </FacetRow>
      <DataList>
        {infos.map((i) => {
          const id = i.channel as ChannelId;
          const on = datalog.selected.includes(id);
          return (
            <DataRow
              key={i.channel}
              selected={on}
              onSelect={() => datalog.toggle(id, !on)}
              leading={
                <input
                  type="checkbox"
                  checked={on}
                  readOnly
                  tabIndex={-1}
                  className="size-3 shrink-0 accent-blue-500"
                />
              }
              name={humanName(lang === "en" ? i.name : i.ja)}
              ident={`${i.job} · ${i.result}`}
              trailing={
                i.unit ? (
                  <span className="shrink-0 font-mono text-[11px] text-slate-500">
                    {i.unit}
                  </span>
                ) : undefined
              }
            />
          );
        })}
      </DataList>
    </Section>
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
 * It stays open while recording: a change then is a segment of the same run
 * (useDatalog `retune`), not a reason to stop.
 *
 * Still memoized. Without it every sample flush re-rendered all 213 rows, and
 * against a synchronous simulator that starved the poll loop badly enough to
 * report 1.0 Hz — the app measuring itself instead of the link, in the one view
 * whose job is to report the link's real rate.
 */
const ChannelPicker = memo(function ChannelPicker({
  selected,
  onToggle,
}: {
  selected: readonly ChannelId[];
  onToggle: (id: ChannelId, on: boolean) => void;
}) {
  const { t, lang } = useLang();
  const [query, setQuery] = useState("");
  const [block, setBlock] = useState<number | "all">("all");

  const all = useMemo(
    () =>
      MSS54_LIVE_BLOCKS.flatMap((b) =>
        b.fields.map((f) => ({ ...f, block: b })),
      ),
    [],
  );
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((f) => {
      if (block !== "all" && f.block.selection !== block) return false;
      if (!q) return true;
      // Every name a channel has is searchable: the symbol, the Japanese,
      // the reference English and the SGBD German. Someone reading a wiring
      // diagram has the German; someone reading a forum post has the symbol.
      return (
        f.symbol.toLowerCase().includes(q) ||
        f.ja.includes(query.trim()) ||
        f.name.toLowerCase().includes(q) ||
        (f.de ?? "").toLowerCase().includes(q)
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
        hiddenNote={
          rows.length < all.length
            ? t.facet_hidden(all.length - rows.length)
            : undefined
        }
      >
        <FacetRow label={t.channels_block}>
          <Chip active={block === "all"} onClick={() => setBlock("all")}>
            {t.facet_all}
          </Chip>
          {MSS54_LIVE_BLOCKS.map((b) => (
            <Chip
              key={b.selection}
              active={block === b.selection}
              count={b.fields.length}
              title={t.channels_blockNote(b.selection)}
              onClick={() =>
                setBlock(block === b.selection ? "all" : b.selection)
              }
            >
              {lang === "en" ? b.name : b.ja}
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
              onSelect={() => onToggle(id, !on)}
              leading={
                <input
                  type="checkbox"
                  checked={on}
                  readOnly
                  tabIndex={-1}
                  className="size-3 shrink-0 accent-blue-500"
                />
              }
              name={humanName(lang === "en" ? f.name : f.ja)}
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
                    <span className="shrink-0 font-mono text-[11px] text-slate-500">
                      {f.unit}
                    </span>
                  )}
                  {also.length > 0 && (
                    <span
                      title={t.channels_alsoInNote}
                      className={`shrink-0 ${LABEL} text-slate-600`}
                    >
                      {t.channels_alsoIn(also.join(" / "))}
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
