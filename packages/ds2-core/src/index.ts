/**
 * @tsunagi/ds2-core — ECU-agnostic BMW DS2 protocol core.
 *
 * Layering (keep these separate; most link bugs are a layer reaching past its
 * own concern):
 *
 *   codec      this package's pure modules — frame, echo, login, memory,
 *              blockDecoder. No I/O, no DOM, no framework. Testable offline,
 *              and where the highest-value diagnostics live.
 *   transport  owns the port, a read buffer, readExact, purge/recover.
 *              Must not know the protocol.
 *   link       exchanges, retries, the command gate, high-level operations.
 *              Must not know about React.
 *   hook       link *state* for the UI, error surfacing, the heartbeat timer.
 *              Must not contain protocol logic.
 *
 * The comments in this package are the specification. They record measurements
 * taken on a real vehicle, corrections to earlier conclusions, hypotheses that
 * were tested and rejected, and the specific incident behind each guard.
 * Several of these guards were removed once already, on reasoning the files now
 * record as wrong. Do not strip them.
 */

export {
    Ds2Address,
    Ds2Control,
    Ds2Status,
    DS2_MIN_FRAME_LENGTH,
    DS2_MAX_FRAME_LENGTH,
    buildDs2Frame,
    parseDs2Frame,
    ds2Checksum,
    isPositiveResponse,
    frameToBytes,
    describeStatus,
    toHex,
    type Ds2Frame,
    type Ds2AddressValue,
} from './frame.ts';

export {
    classifyEchoMismatch,
    ELECTRICAL_FAULT_CHECKLIST,
    type EchoMismatchAnalysis,
} from './echo.ts';

export {
    calculateLoginKey,
    buildSeedRequestPayload,
    buildKeyPayload,
    isAlreadyUnlockedResponse,
    isSeedResponse,
    DS2_DEFAULT_ACCESS_LEVEL,
    DS2_SEED_FRAME_LENGTH,
    DS2_ALREADY_UNLOCKED_LENGTH,
} from './login.ts';

export {
    buildReadMemoryPayload,
    buildWriteMemoryPayload,
    parseWriteResult,
    describeVerifyByte,
    isVerifyByteOk,
    DS2_MAX_WRITE_COUNT,
    type Ds2WriteResult,
} from './memory.ts';

export {
    decodeField,
    readRaw,
    byteLength,
    minPayloadLength,
    type FieldDef,
    type FieldFormat,
} from './blockDecoder.ts';

export { Ds2Error, isDs2Error, type Ds2ErrorCode, type Ds2ErrorKind } from './errors.ts';

export {
    WebSerialTransport,
    RX_BUFFER_BYTES,
    DS2_SERIAL_DEFAULTS,
    type TransportOptions,
} from './transport.ts';

export type { Ds2ByteTransport } from './byteTransport.ts';

export {
    WebUsbFtdiTransport,
    FtdiLineError,
    FTDI_DATA_8E1_TX_BREAK,
    FTDI_VENDOR_ID,
} from './webUsbFtdiTransport.ts';

export {
    createDs2Transport,
    detectTransportKind,
    readTransportEnv,
    isAndroidPlatform,
    latencyTimerOf,
    type TransportKind,
    type TransportEnv,
} from './transportSelect.ts';

export { isWebUsbSupported, getUsb } from './webUsbTypes.ts';
export type { USBDevice, USBLike, USBConnectionEvent } from './webUsbTypes.ts';

export {
    Ds2Link,
    DS2_DEFAULT_TIMINGS,
    type Ds2Timings,
    type Ds2LinkOptions,
    type Ds2Target,
    type RetryOptions,
    type SendGuard,
} from './link.ts';

export { isWebSerialSupported, getSerial } from './webSerialTypes.ts';
export type {
    SerialPortLike,
    SerialLike,
    SerialOptions,
    SerialOutputSignals,
    SerialPortInfo,
    SerialPortFilter,
} from './webSerialTypes.ts';

export type { LinkTiming } from './timing.ts';

// Test-time only, but exported so the app's own integration tests can drive the
// real stack too. Simulating the DEVICE beats mocking the link.
export {
    SimulatedEcu,
    SimulatedBus,
    SimulatedSerialPort,
    simulatedPort,
    simulatedFtdiEcu,
    type ExchangeBehavior,
    type SimulatedEcuOptions,
    type SimulatedDevice,
    type TraceEntry,
} from './simulator.ts';

// The FTDI bench, for the same reason: the packet framing is the part of the WebUSB backend that
// cannot be checked by reading it.
export {
    SimulatedFtdiDevice,
    SimulatedUsb,
    type SimulatedFtdiOptions,
    type ControlRecord,
} from './ftdiSimulator.ts';
