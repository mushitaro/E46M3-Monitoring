'use client';
import { MonitoringModeCorner } from '@tsunagi/monitoring-ui';
import { useLang } from '@/lib/i18n';

export function ModeCorner(props: Omit<Parameters<typeof MonitoringModeCorner>[0], 't'>) {
    const { t } = useLang();
    return <MonitoringModeCorner {...props} t={t} />;
}
