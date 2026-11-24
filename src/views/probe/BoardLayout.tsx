'use client';

import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { Pane, Section, TextButton } from '../../components/ui';
import { useLang } from '../../lib/i18n';

export interface BoardSection {
    id: string;
    title: ReactNode;
    note?: ReactNode;
    open: boolean;
    body: () => ReactNode;
}

/** Shared board chrome. Each host keeps its own session data and ordering. */
export function BoardLayout({ parts, onMove, onToggle }: {
    parts: readonly BoardSection[];
    onMove: (id: string, by: -1 | 1) => void;
    onToggle: (id: string) => void;
}) {
    const { t } = useLang();
    return (
        <Pane>
            {parts.map((p, i) => (
                <Section
                    key={p.id}
                    title={p.title}
                    note={p.note}
                    actions={
                        <span className="flex items-baseline gap-2">
                            <TextButton tone="neutral" Icon={ChevronUp} disabled={i === 0} onClick={() => onMove(p.id, -1)} aria-label={t.board_up} title={t.board_up} className="-my-2 px-1 py-2">
                                {null}
                            </TextButton>
                            <TextButton
                                tone="neutral"
                                Icon={ChevronDown}
                                disabled={i === parts.length - 1}
                                onClick={() => onMove(p.id, 1)}
                                aria-label={t.board_down}
                                title={t.board_down}
                                className="-my-2 px-1 py-2"
                            >
                                {null}
                            </TextButton>
                            <TextButton
                                tone="neutral"
                                Icon={p.open ? ChevronsDownUp : ChevronsUpDown}
                                onClick={() => onToggle(p.id)}
                                aria-expanded={p.open}
                                aria-label={p.open ? t.board_close : t.board_open}
                                title={p.open ? t.board_close : t.board_open}
                                className="-my-2 px-1 py-2"
                            >
                                {null}
                            </TextButton>
                        </span>
                    }
                >
                    {p.open ? p.body() : null}
                </Section>
            ))}
        </Pane>
    );
}
