'use client';

import React from 'react';
import { FTDI_DATA_8E1_TX_BREAK, getUsb, type USBDevice } from '@tsunagi/ds2-core';
import { MicroLabel, Section, TextButton, WORDMARK, Well } from '@/components/ui';

/**
 * A bench probe for the WebUSB/FTDI path — deliberately standalone.
 *
 * The whole Android port rests on one question that no amount of code review can answer: can Chrome
 * for Android actually claim the interface on this phone, with this cable? If the kernel's
 * `ftdi_sio` holds it, or OTG will not supply VBUS, everything else is wasted work. So this page
 * exists to answer that first, and it imports nothing from the link layer — it cannot be broken by,
 * or break, the transport it is used to validate. (The two type-level imports are the WebUSB
 * declarations and one constant; neither can run.)
 *
 * It also covers the things a car cannot be used to test safely: whether the divisor constants
 * produce the baud rates they claim, whether a break is really visible as the BI bit, whether the
 * RX flush value is 2 and not 1, and whether a backgrounded tab survives five minutes.
 *
 * Everything logs on-screen because a phone has no console.
 *
 * English only, unlike the rest of the app. This is an instrument for whoever is holding the
 * soldering iron, and its output is register names and hex — translating the frame around that
 * would suggest the content had been translated too.
 *
 * **Bench wiring:** use a bare FT232R breakout with TX and RX jumpered together. A K+DCAN cable
 * will *not* self-echo on a desk — the K-line pull-up comes from the vehicle (OBD pin 16), so with
 * no car attached there is nothing to echo. Do not plug into a car for any of this.
 */

const FTDI_VENDOR_ID = 0x0403;
const SIO_RESET = 0x00;
const SIO_SET_MODEM_CTRL = 0x01;
const SIO_SET_FLOW_CTRL = 0x02;
const SIO_SET_BAUD_RATE = 0x03;
const SIO_SET_DATA = 0x04;
const SIO_SET_LATENCY_TIMER = 0x09;
const SIO_GET_LATENCY_TIMER = 0x0a;
const PORT = 1;

/**
 * Restated here rather than imported from the transport, on purpose. This page is the independent
 * check on those constants; a probe that reads the table it is testing can only ever agree with it.
 */
const DIVISORS: Record<number, { value: number; index: number }> = {
    9600: { value: 0x4138, index: 0 },
    38400: { value: 0xc04e, index: 0 },
    125000: { value: 0x0018, index: 0 },
};

const CHIP_NAMES: Record<number, string> = {
    2: 'FT232AM',
    4: 'FT232BM',
    5: 'FT2232C',
    6: 'FT232R',
    7: 'FT2232H',
    8: 'FT4232H',
    9: 'FT232H',
    16: 'FT-X',
};

export default function UsbCheckPage() {
    const [lines, setLines] = React.useState<string[]>([]);
    const [busy, setBusy] = React.useState(false);
    const deviceRef = React.useRef<USBDevice | null>(null);
    const epRef = React.useRef({ inEp: 0, outEp: 0, packetSize: 64, iface: 0 });

    const log = React.useCallback((text: string) => {
        setLines((prev) => [...prev, text]);
    }, []);

    /**
     * Runs one step, and is deliberately NOT a factory that returns a handler.
     *
     * Every step body touches a ref and reads a clock. Building those closures during render —
     * which `run(label, fn)` returning a handler would do — is exactly what the React Compiler
     * lint refuses, and it is right to: from outside, `run` could have called `fn` immediately.
     * Each step below is therefore `() => void runStep(...)`, so the closure is created when the
     * button is pressed and render stays pure.
     */
    const runStep = async (label: string, fn: () => Promise<void>) => {
        setBusy(true);
        log(`\n=== ${label} ===`);
        try {
            await fn();
        } catch (e: unknown) {
            const err = e as Error;
            log(`✗ ${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`);
        } finally {
            setBusy(false);
        }
    };

    const device = () => {
        const d = deviceRef.current;
        if (!d) throw new Error('No device — run step 1 first');
        return d;
    };

    const sio = async (request: number, value: number, index = PORT) => {
        const r = await device().controlTransferOut({
            requestType: 'vendor',
            recipient: 'device',
            request,
            value,
            index,
        });
        if (r.status !== 'ok') throw new Error(`control 0x${request.toString(16)} -> ${r.status}`);
    };

    // --- 1. choose + identify -------------------------------------------------
    const step1 = () => void runStep('1. Choose device', async () => {
        // Two ways to arrive here with no navigator.usb, and they are the two most expensive
        // afternoons available, so both are named before anything else is tried.
        log(`secure context: ${typeof window !== 'undefined' && window.isSecureContext}`);
        const usb = getUsb();
        if (!usb) {
            log('✗ navigator.usb is undefined — WebUSB unavailable here.');
            log('  If the address bar shows a LAN IP (192.168.x.x), that is why: WebUSB needs a');
            log('  secure context, and http://localhost qualifies while a LAN address does not.');
            log('  If this is the deployed site and the API is missing anyway, suspect');
            log('  Permissions-Policy in public/_headers — `usb=()` is an EMPTY allowlist.');
            return;
        }
        const granted = (await usb.getDevices()).filter((d) => d.vendorId === FTDI_VENDOR_ID);
        if (granted.length) log(`(${granted.length} device already granted to this origin)`);
        const d = granted[0] ?? (await usb.requestDevice({ filters: [{ vendorId: FTDI_VENDOR_ID }] }));
        deviceRef.current = d;
        const major = d.deviceVersionMajor;
        log(`✓ VID 0x${d.vendorId.toString(16).padStart(4, '0')} PID 0x${d.productId.toString(16).padStart(4, '0')}`);
        log(`  bcdDevice ${major}.${d.deviceVersionMinor} -> ${CHIP_NAMES[major] ?? 'UNKNOWN'}`);
        log(`  manufacturer: ${d.manufacturerName ?? '-'}`);
        log(`  product:      ${d.productName ?? '-'}`);
        log(`  serial:       ${d.serialNumber ?? '-'}`);
        if (![2, 4, 6].includes(major)) {
            log('  ⚠ This chip family uses a different clock/divisor encoding than the transport implements.');
        }
        if (d.manufacturerName && !/ftdi/i.test(d.manufacturerName)) {
            log('  ⚠ Manufacturer string is not FTDI — possible clone. Clone chips are common on K+DCAN cables.');
        }
    });

    // --- 2. THE question: claim ----------------------------------------------
    const step2 = () => void runStep('2. Open + claim interface', async () => {
        const d = device();
        await d.open();
        log('✓ open()');
        if (!d.configuration) {
            await d.selectConfiguration(1);
            log('✓ selectConfiguration(1)');
        }
        for (const iface of d.configuration?.interfaces ?? []) {
            log(`  interface ${iface.interfaceNumber} (claimed=${iface.claimed})`);
            for (const ep of iface.alternate.endpoints) {
                log(`    ep ${ep.endpointNumber} ${ep.direction} ${ep.type} packetSize=${ep.packetSize}`);
            }
            const inEp = iface.alternate.endpoints.find((e) => e.direction === 'in' && e.type === 'bulk');
            const outEp = iface.alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
            if (inEp && outEp) {
                epRef.current = {
                    inEp: inEp.endpointNumber,
                    outEp: outEp.endpointNumber,
                    packetSize: inEp.packetSize || 64,
                    iface: iface.interfaceNumber,
                };
            }
        }
        await d.claimInterface(epRef.current.iface);
        log(`✓ claimInterface(${epRef.current.iface}) — THIS IS THE ONE THAT MATTERS`);
        log('  If you got here, Chrome detached any kernel driver and the port is viable.');
    });

    // --- 3. vendor requests, both directions ---------------------------------
    const step3 = () => void runStep('3. Vendor requests', async () => {
        await sio(SIO_RESET, 0);
        log('✓ SIO_RESET(0)');
        await sio(SIO_SET_LATENCY_TIMER, 16);
        log('✓ SET_LATENCY_TIMER(16)');
        await sio(SIO_SET_FLOW_CTRL, 0, 0x0000 | PORT);
        log('✓ SET_FLOW_CTRL(none)');
        await sio(SIO_SET_BAUD_RATE, DIVISORS[9600].value, DIVISORS[9600].index);
        log('✓ SET_BAUD_RATE(9600)');
        await sio(SIO_SET_DATA, 0x0208);
        log('✓ SET_DATA(8E1 = 0x0208)');
        await sio(SIO_SET_MODEM_CTRL, 0x0300);
        log('✓ SET_MODEM_CTRL(DTR low, RTS low = 0x0300)');
        const back = await device().controlTransferIn(
            { requestType: 'vendor', recipient: 'device', request: SIO_GET_LATENCY_TIMER, value: 0, index: PORT },
            1,
        );
        const got = back.data?.getUint8(0);
        log(
            got === 16
                ? '✓ GET_LATENCY_TIMER read back 16 — control transfers work both ways'
                : `⚠ GET_LATENCY_TIMER returned ${got} (expected 16)`,
        );
    });

    /** Reads until `want` payload bytes have arrived or the deadline passes, stripping the 2-byte
     *  status header from every packet. Returns payload plus any line-status faults seen. */
    const readPayload = async (want: number, timeoutMs: number) => {
        const { inEp, packetSize } = epRef.current;
        const out: number[] = [];
        let lsrSeen = 0;
        const deadline = Date.now() + timeoutMs;
        while (out.length < want && Date.now() < deadline) {
            const r = await device().transferIn(inEp, 8 * packetSize);
            const view = r.data;
            if (!view) continue;
            for (let off = 0; off + 2 <= view.byteLength; off += packetSize) {
                lsrSeen |= view.getUint8(off + 1);
                const n = Math.min(packetSize, view.byteLength - off) - 2;
                for (let i = 0; i < n; i++) out.push(view.getUint8(off + 2 + i));
            }
        }
        return { bytes: out, lsrSeen };
    };

    // --- 4. loopback at each rate --------------------------------------------
    // All three rates, even though a diagnostics session never leaves 9600: the point is to check
    // the divisor TABLE, and two of its three entries are the ones that can be cross-read against
    // FTDI's published AN232B-05 figures.
    const step4 = () => void runStep('4. Loopback (needs TX–RX jumper)', async () => {
        for (const baud of [9600, 38400, 125000]) {
            await sio(SIO_SET_BAUD_RATE, DIVISORS[baud].value, DIVISORS[baud].index);
            await sio(SIO_RESET, 2); // purge RX
            const pattern = new Uint8Array(1024);
            for (let i = 0; i < pattern.length; i++) pattern[i] = i & 0xff;
            const t0 = performance.now();
            await device().transferOut(epRef.current.outEp, pattern);
            const { bytes, lsrSeen } = await readPayload(pattern.length, 10_000);
            const elapsed = performance.now() - t0;
            // 8E1 is 11 bits per byte on the wire. Comparing against that is also the most
            // practical clone detector available: a chip whose clock is not what it claims cannot
            // land near the theoretical time.
            const theory = (pattern.length * 11 * 1000) / baud;
            const exact = bytes.length === pattern.length && bytes.every((b, i) => b === pattern[i]);
            log(
                `${exact ? '✓' : '✗'} ${baud}: ${bytes.length}/${pattern.length} bytes, ` +
                    `${elapsed.toFixed(0)} ms (theory ${theory.toFixed(0)} ms), lsr=0x${lsrSeen.toString(16)}`,
            );
            if (!exact && bytes.length) {
                const bad = bytes.findIndex((b, i) => b !== pattern[i]);
                log(`   first mismatch at ${bad}: got 0x${bytes[bad]?.toString(16)} want 0x${pattern[bad]?.toString(16)}`);
            }
            if (elapsed > theory * 2.5) log('   ⚠ far slower than theory — suspect a wrong divisor');
        }
        await sio(SIO_SET_BAUD_RATE, DIVISORS[9600].value, DIVISORS[9600].index);
    });

    // --- 5. break generation + detection --------------------------------------
    const step5 = () => void runStep('5. TX break -> BI bit (needs jumper)', async () => {
        await sio(SIO_SET_BAUD_RATE, DIVISORS[9600].value, DIVISORS[9600].index);
        await sio(SIO_RESET, 2);
        await sio(SIO_SET_DATA, FTDI_DATA_8E1_TX_BREAK);
        await new Promise((r) => setTimeout(r, 50));
        await sio(SIO_SET_DATA, 0x0208);
        const { lsrSeen } = await readPayload(1, 1500);
        log(
            lsrSeen & 0x10
                ? '✓ BI (0x10) observed — break detection works, so recoverRead has something to react to'
                : `✗ no BI bit; lsr=0x${lsrSeen.toString(16)}. Break recovery would be untested/dark.`,
        );
    });

    // --- 6. RX flush polarity --------------------------------------------------
    const step6 = () => void runStep('6. RX flush polarity (1 vs 2)', async () => {
        // libftdi <= 1.4 called 1 "PURGE_RX"; 1.5 deprecated that and shipped ftdi_tciflush() using
        // 2, because the old naming had RX and TX swapped. The transport uses 2. This measures it
        // rather than trusting either library's spelling.
        for (const value of [2, 1]) {
            await sio(SIO_SET_BAUD_RATE, DIVISORS[9600].value, DIVISORS[9600].index);
            await sio(SIO_RESET, 2);
            await device().transferOut(epRef.current.outEp, new Uint8Array([0xaa, 0x55, 0xaa, 0x55]));
            await new Promise((r) => setTimeout(r, 300)); // let them land in the chip's FIFO
            await sio(SIO_RESET, value);
            const { bytes } = await readPayload(4, 600);
            log(
                `SIO_RESET(${value}): ${bytes.length} byte(s) survived the flush ` +
                    `${bytes.length === 0 ? '-> this value flushes RX' : ''}`,
            );
        }
    });

    // --- 7. endurance / backgrounding -----------------------------------------
    const step7 = () => void runStep('7. 5-minute endurance (background the app during this)', async () => {
        await sio(SIO_SET_BAUD_RATE, DIVISORS[9600].value, DIVISORS[9600].index);
        let wakeLock: WakeLockSentinel | null = null;
        try {
            wakeLock = navigator.wakeLock ? await navigator.wakeLock.request('screen') : null;
            log(wakeLock ? 'wake lock acquired' : 'wake lock unavailable');
        } catch {
            log('wake lock refused');
        }
        let hidden = false;
        const onVis = () => {
            if (document.visibilityState === 'hidden') hidden = true;
        };
        document.addEventListener('visibilitychange', onVis);
        const end = Date.now() + 5 * 60_000;
        let maxGap = 0;
        let rounds = 0;
        let errors = 0;
        let last = performance.now();
        try {
            while (Date.now() < end) {
                try {
                    await device().transferOut(epRef.current.outEp, new Uint8Array([0x00]));
                    await readPayload(1, 2000);
                } catch {
                    errors++;
                }
                const now = performance.now();
                maxGap = Math.max(maxGap, now - last);
                last = now;
                if (++rounds % 200 === 0) log(`  ${rounds} rounds, max gap ${maxGap.toFixed(0)} ms, ${errors} errors`);
            }
        } finally {
            document.removeEventListener('visibilitychange', onVis);
            await wakeLock?.release().catch(() => {});
        }
        log(`done: ${rounds} rounds, max gap ${maxGap.toFixed(0)} ms, ${errors} errors, backgrounded=${hidden}`);
        log(
            maxGap > 10_000
                ? '⚠ A gap over 10 s means the tab was frozen. A datalog that runs for a drive, or an ' +
                      'actuator held engaged, is at risk on this device.'
                : '✓ No long freeze observed.',
        );
    });

    const close = () => void runStep('Close', async () => {
        try {
            await deviceRef.current?.releaseInterface(epRef.current.iface);
        } catch {}
        await deviceRef.current?.close();
        deviceRef.current = null;
        log('✓ closed');
    });


    return (
        <main className="min-h-[100svh] bg-slate-950 p-4 text-slate-300">
            <h1 className={`${WORDMARK} text-slate-200`}>WebUSB / FTDI bench</h1>
            <p className="mt-1 max-w-[70ch] text-[11px] leading-relaxed text-slate-500">
                Bare FT232R breakout with TX–RX jumpered.{' '}
                <strong className="font-bold text-amber-300">Not a car</strong>, and not a K+DCAN cable on a
                desk — its K-line pull-up comes from the vehicle at OBD pin 16, so with nothing attached
                there is nothing to echo.
            </p>

            <div className="mt-4 flex flex-col gap-6">
                <Section title="Steps" note="Run them in order. Step 2 is the one that decides whether any of this is possible on this phone.">
                    {/* Written out rather than mapped over a [label, handler] array. Each handler
                        reaches a ref, and putting them through .map() during render is a call the
                        React Compiler cannot see into — it has to assume the array was invoked
                        then and there. As a JSX prop the same function is unambiguously a
                        handler. 44px minimum because the whole interface is these buttons, on a
                        phone, one-handed, under a car. */}
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                        <TextButton onClick={step1} disabled={busy} className="min-h-[44px]">
                            1. Choose
                        </TextButton>
                        <TextButton onClick={step2} disabled={busy} className="min-h-[44px]">
                            2. Claim
                        </TextButton>
                        <TextButton onClick={step3} disabled={busy} className="min-h-[44px]">
                            3. Vendor
                        </TextButton>
                        <TextButton onClick={step4} disabled={busy} className="min-h-[44px]">
                            4. Loopback
                        </TextButton>
                        <TextButton onClick={step5} disabled={busy} className="min-h-[44px]">
                            5. Break
                        </TextButton>
                        <TextButton onClick={step6} disabled={busy} className="min-h-[44px]">
                            6. Flush
                        </TextButton>
                        <TextButton onClick={step7} disabled={busy} className="min-h-[44px]">
                            7. Endurance
                        </TextButton>
                        <TextButton tone="danger" onClick={close} disabled={busy} className="min-h-[44px]">
                            Close
                        </TextButton>
                        <TextButton tone="neutral" onClick={() => setLines([])} className="min-h-[44px]">
                            Clear
                        </TextButton>
                    </div>
                </Section>

                <Section title="Output" count={lines.length}>
                    <Well>
                        {/* A phone has no console, so this IS the instrument. Monospace and
                            pre-wrapped: the hex columns are the readable part. */}
                        <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-slate-300">
                            {lines.join('\n') || 'Ready.'}
                        </pre>
                    </Well>
                    <MicroLabel className="mt-2">
                        Copy this whole block into a bug report — the chip name and the theory comparison are the
                        two lines that identify a clone.
                    </MicroLabel>
                </Section>
            </div>
        </main>
    );
}
