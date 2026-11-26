/**
 * What goes to the car, decided by the owner item by item (operator, 2026-11-15).
 *
 * "Reads only" was retired on 2026-11-14. In its place the owner decided, for every job of every
 * module, three things:
 *
 *   - **when**: `moving` (also while the car moves) or `parked` (only when the DME's speed is
 *     measured 0 just before the send);
 *   - **how far**: `run` (a button that sends it), `show` (on the screen with its text and cautions,
 *     never sent) or `off` (not on the screen);
 *   - **who**: `screen` (only the person pressing the screen) or `ai` (the assistant may start it
 *     when asked, after reading the request back).
 *
 * The owner decided by NATURE — what a job does to the car — and the decision page let any module
 * or job be set apart from its nature. The 2026-11-15 decision set none apart, so the table below is
 * per nature. A job's nature is judged here from its SGBD name and class; the judgement is this
 * app's (`provenance: authored`), not BMW's, and it errs towards the nature with the narrower
 * decision: anything that writes is `w`, whatever else its name says.
 *
 * `runGate.mayRun` is the one place that reads this. Nothing else may decide what is sent.
 */
import type { CatalogJob } from './ecuCatalog.ts';

export type Nature =
    // 読む
    | 'r_ident'
    | 'r_status'
    | 'r_misc'
    // 部品を動かす
    | 'a_disp'
    | 'a_av'
    | 'a_comfort'
    | 'a_body'
    | 'a_chassis'
    | 'a_engine'
    | 'a_smg'
    | 'a_brake'
    | 'a_safety'
    // ECU に任せる・合わせる
    | 'p_smg'
    | 'c_check'
    | 'c_sim'
    | 'c_adapt'
    // 状態を変える・消す・書く
    | 'c_mode'
    | 'c_setup'
    | 'c_clear'
    | 'w';

export type PolicyWhen = 'moving' | 'parked';
export type PolicyHow = 'run' | 'show' | 'off';
export type PolicyWho = 'screen' | 'ai';

export interface Decision {
    when: PolicyWhen;
    how: PolicyHow;
    who: PolicyWho;
}

/** The natures, in the order the decision page showed them, with their names. */
export const NATURES: ReadonlyArray<{ nature: Nature; ja: string; en: string }> = [
    { nature: 'r_ident', ja: '識別と故障メモリを読む', en: 'Read identity and fault memory' },
    { nature: 'r_status', ja: '状態の値を読む', en: 'Read status values' },
    { nature: 'r_misc', ja: '読取（書き込み側に分けられていたもの）', en: 'Reads filed with the writes' },
    { nature: 'a_disp', ja: 'メーター・警告灯・チャイム・表示を点ける', en: 'Cluster, warning lamps, chimes, displays' },
    { nature: 'a_av', ja: 'オーディオ・ナビを操作する', en: 'Audio and navigation' },
    { nature: 'a_comfort', ja: '快適装備を動かす', en: 'Comfort equipment' },
    { nature: 'a_body', ja: '灯火・施錠・盗難防止の入出力を動かす', en: 'Lights, locks and immobiliser I/O' },
    { nature: 'a_chassis', ja: '舵角・タイヤ空気圧の入出力を動かす', en: 'Steering angle and tyre pressure I/O' },
    { nature: 'a_engine', ja: 'エンジンの部品を動かす', en: 'Engine actuators' },
    { nature: 'a_smg', ja: '変速機（SMG II）の部品を動かす', en: 'Gearbox (SMG II) actuators' },
    { nature: 'a_brake', ja: 'ブレーキ油圧を動かす（DSC・ASC）', en: 'Brake hydraulics (DSC, ASC)' },
    { nature: 'a_safety', ja: '安全装置を展開する', en: 'Deploy safety equipment' },
    { nature: 'p_smg', ja: '変速機の手順（SMG II が自分で進める）', en: 'Gearbox procedures (SMG II runs them)' },
    { nature: 'c_check', ja: '機能検査（ECU 自身のシステムチェック）', en: 'Function checks (the ECU’s own)' },
    { nature: 'c_sim', ja: 'センサー信号の模擬', en: 'Sensor signal simulation' },
    { nature: 'c_adapt', ja: '学習値のリセット・基準合わせ', en: 'Adaptation resets and zeroing' },
    { nature: 'c_mode', ja: '動作モードを変える', en: 'Operating modes' },
    { nature: 'c_setup', ja: '初期化・設定の変更', en: 'Initialisation and settings' },
    { nature: 'c_clear', ja: '消去する', en: 'Clear' },
    { nature: 'w', ja: '書き込む（コーディング・プログラミング・識別・フラッシュ）', en: 'Write (coding, programming, identity, flash)' },
];

/**
 * The decision by nature. The owner approved the decision page (2026-11-15, 「これで実装をお願いします」)
 * without pasting its selections, so this was first written from the page's recommended settings —
 * the assistant's, not the owner's. Corrected by the owner the same day: the brake hydraulics are not
 * shown-only (「DSCの油圧系は表示だけにしていません」); they run like the other actuators, parked, on the
 * screen. Any other nature the owner sets differently is corrected here the same way.
 *
 * 2026-11-16 the owner chose, of three ways put to them (A: the assistant too, one table for MONITORING
 * and the shop's SUITE; B: the assistant only in the shop; C: as it was), A: clearing faults,
 * actuator tests, procedures, function checks, simulations and adaptation resets are `who: 'ai'`, and
 * operating modes and initialisation/settings go from shown-only to `run`. `when` stays parked;
 * safety deployment and writes stay off. Every rule in OWNER_RULES still holds for the assistant —
 * it reads back and waits for "yes", reads only while moving, measures before sending, one at a time,
 * stoppable. `who: 'ai'` opens nothing by itself: the assistant reaches a run only through a facade
 * tool — `monitoring_actuate` and `monitoring_procedure` (src/lib/bridge/capabilities.ts NATURE_TOOLS).
 */
export const OWNER_DECISION: Readonly<Record<Nature, Decision>> = {
    r_ident: { when: 'moving', how: 'run', who: 'ai' },
    r_status: { when: 'moving', how: 'run', who: 'ai' },
    r_misc: { when: 'parked', how: 'run', who: 'ai' },
    a_disp: { when: 'parked', how: 'run', who: 'ai' },
    a_av: { when: 'parked', how: 'run', who: 'ai' },
    a_comfort: { when: 'parked', how: 'run', who: 'ai' },
    a_body: { when: 'parked', how: 'run', who: 'ai' },
    a_chassis: { when: 'parked', how: 'run', who: 'ai' },
    a_engine: { when: 'parked', how: 'run', who: 'ai' },
    a_smg: { when: 'parked', how: 'run', who: 'ai' },
    a_brake: { when: 'parked', how: 'run', who: 'ai' },
    a_safety: { when: 'parked', how: 'off', who: 'screen' },
    p_smg: { when: 'parked', how: 'run', who: 'ai' },
    c_check: { when: 'parked', how: 'run', who: 'ai' },
    c_sim: { when: 'parked', how: 'run', who: 'ai' },
    c_adapt: { when: 'parked', how: 'run', who: 'ai' },
    c_mode: { when: 'parked', how: 'run', who: 'ai' },
    c_setup: { when: 'parked', how: 'run', who: 'ai' },
    c_clear: { when: 'parked', how: 'run', who: 'ai' },
    w: { when: 'parked', how: 'off', who: 'screen' },
};

/** What an item the owner has not decided gets (2026-11-15: 「画面に表示だけ」). */
export const UNDECIDED: Decision = { when: 'parked', how: 'show', who: 'screen' };

/**
 * The rules the owner laid over every decision (2026-11-15, all kept). Each is enforced where the
 * thing it governs happens; this list is what they are, so the screen and the guide can say them.
 */
export const OWNER_RULES = {
    /** A job whose own SGBD requires the car stationary goes only parked, whatever `when` says. */
    sgbdStationaryWins: true,
    /** Just before a send: stationary (DME speed 0), battery ≥ 12 V, the engine as the SGBD asks. Unmeasured is not sent. */
    measureBeforeSend: true,
    /** A confirmation before running: what moves, conditions, cautions, how to stop. */
    confirmFirst: true,
    /** A stop: the button, a time-out (the SGBD's, else 10 s), and the link dropping. */
    alwaysStoppable: true,
    /** One thing driven at a time. */
    oneAtATime: true,
    /**
     * Practice first: nothing goes to the car whose send path has not run in PRACTICE. Done by the build
     * for every item (src/lib/practiceEveryItem.test.ts), not asked of each device (owner, 2026-11-26).
     */
    practiceFirst: 'build',
    /** Every run and its result go to the ledger and CO-WORK. */
    recordRuns: true,
    /** The assistant reads the request back and waits for "yes". */
    aiReadsBack: true,
    /** While moving the assistant may start reads only. */
    aiMovingReadsOnly: true,
} as const;

/** The minimum battery voltage measured before a run (OWNER_RULES.measureBeforeSend). */
export const MIN_RUN_VOLTAGE = 12;

/** The time-out when the SGBD names none (OWNER_RULES.alwaysStoppable). */
export const DEFAULT_RUN_TIMEOUT_S = 10;

const DSC_MODULES = new Set(['ascmk20', 'dsc_e46', 'dsc_mk60']);
/** Classes a read can be filed under by the generator (a `test` named STATUS_ may start one: STATUS_TANK_DICHTHEIT). */
const READS_FILED_AWAY = new Set<string>(['coding', 'identity', 'programming', 'unclassified']);

const WRITE = /SCHREIBEN|^WRITE_|_WRITE_|CODIER|FLASH|BAUDRATE|PRUEFSTEMPEL|ZIF_BACKUP|SET_EDIC|NAVDVDPIN/;
const READ_NAME = /^(READ_|IDENT|ANALYSE_|CHECKSUMME_ABFRAGEN|FASTA_|SPEICHER_LESEN$)/;
const CLEAR = /^(FS_|IS_|C_FS_)\w*LOESCHEN|^FS_SELEKTIV_LOESCHEN$/;
const MODE = /SLEEP|ENERGIESPAR|POWER_DOWN|KOMPRESSOR_SPERRE|^BET_(AKTIV|PASSIV)$|EOL_PASSIV|TRANSPORTSICHERUNG|FLOTTENMODUS|SELBSTHALTUNG/;
const SETUP = /INIT|LOGIN|SEED|SECURITY|VERRIEGELUNG_SETZEN|SW_DEMAND|C_SN_AUFTRAG|CS_BILDEN|C_CHECKSUM|FORCE_EJECT|ZEITINSPEKTION_VORZIEHEN|SETZE_|TELEGRAMM_CLEAR|_VORHANDEN$|PRUEFFLAG/;
const BRAKE = /DRUCK(AUF|AB)BAU|DRUCKHALTEN|PUMPE|ENTLUEFTUNG|BLEEDMASTER|VAKUUM|_SIM_|REGELSIMULATION|^STEUERN_(DIGITAL|ANALOG)/;
const SIM = /_SIM|SIMULATION|^STEUERN_(AUSSENTEMPERATUR|BELADUNGSSENSOR|DIMMER|DREHZAHL|FOTOZELLE|GESCHWINDIGKEIT|LWR_POTI|SCHALTERSPANNUNG|WEG_V)/;
const CHECK = /TEST|CHECK|PRUEF|DICHTHEIT|VERSTELLZEIT|SG_PRUEFLAUF|^STEUERN_(DISPLAY|IO)$/;
const ADAPT = /ABGLEICH|ADAPT|RESET|SYNC|EICHLAUF|KALIBRIER|LERN|_INK$|_DEK$|SIA_|BETRIEBSSTUNDEN|BETR_H|SCHRITTVERLUSTE|VERTEILUNG|DEFAULT_SOUND|LOESCHEN/;
const DISPLAY = /ANZEIGE|GONG|PIEZO|LEUCHTE|BELEUCHTUNG|HELLIGKEIT|BFD_LED|WARNLAMPEN|TACHO|POWER_DISPLAY/;
/**
 * SMG II outputs that only light something: fault lamp, selector gear display, cluster comfort index.
 * By name, as STEUERN_STELLGLIED takes them (its STELLGLIEDER row; the PIN 0x3E/0x42/0x43 makes the job
 * refuse with ERROR__PARAMETER_STELLGL_MISSING, as EdiabasLib showed in job-frames.oracle.json).
 */
const SMG_DISPLAY_OUTPUTS = new Set(['STOERANZEIGE', 'GANG_WAHLHEBEL_ANZEIGE', 'KOMBIANZEIGE_KOMFORTINDEX']);

/**
 * A job's nature.
 *
 * `group` is the module's group in the index (engine, drivetrain, chassis, safety, body, comfort,
 * comm). `args` are the values chosen for the job, where a nature depends on one (SMG II's
 * STEUERN_STELLGLIED drives a valve or lights a lamp by its first argument).
 */
export function natureOf(moduleId: string, job: Pick<CatalogJob, 'id' | 'class'>, group?: string, args?: readonly string[]): Nature {
    const id = job.id;
    // A read, as the generator classified it from the SGBD's own comment (STATUS_CODIER_CHECKSUMME
    // reads), unless its name says it writes.
    if (job.class === 'read' && !/SCHREIBEN|^WRITE_|_WRITE_/.test(id)) return /^(IDENT|FS_|IS_|AIF_)/.test(id) ? 'r_ident' : 'r_status';
    // A read filed under coding, identity or programming (PRUEFSTEMPEL_LESEN, CODIERUNG_LESEN,
    // STATUS_CODIER_CHECKSUMME): a read. Its frame must still carry a read control byte to go.
    if (READS_FILED_AWAY.has(job.class) && /_LESEN|LESEN_|^STATUS_/.test(id) && !WRITE.test(id)) return 'r_misc';
    // The immobiliser's pairing with the DME: setup, shown, never run from here.
    if (/EWS3_INITIALISIEREN|EWS3_SYNC|WECHSELCODE_SYNC/.test(id)) return 'c_setup';
    if (job.class === 'programming' || job.class === 'coding' || job.class === 'identity' || WRITE.test(id)) return 'w';
    if (READ_NAME.test(id)) return 'r_misc';
    if (CLEAR.test(id)) return 'c_clear';
    if (moduleId === 'smg2' && /^TESTPRG_/.test(id)) return 'p_smg';
    // SMG II's STEUERN_STELLGLIED needs this first (its SGBD: prerequisite); it belongs with it.
    if (moduleId === 'smg2' && id === 'ANSTEUERUNG_VORBEREITEN') return 'a_smg';
    if (MODE.test(id)) return 'c_mode';
    if (job.class === 'unclassified' && SETUP.test(id)) return 'c_setup';
    if (DSC_MODULES.has(moduleId) && !DISPLAY.test(id) && !/ABGLEICH/.test(id) && BRAKE.test(id)) return 'a_brake';
    if (SIM.test(id)) return 'c_sim';
    if (job.class !== 'calibration' && CHECK.test(id) && !/^STEUERN_IO$/.test(id)) return 'c_check';
    if (ADAPT.test(id) || job.class === 'calibration') return 'c_adapt';
    if (/^STEUERN_|^IO_STATUS_VORGEBEN$|^SPRACHAUSGABE$/.test(id)) {
        if (DISPLAY.test(id)) return 'a_disp';
        if (moduleId === 'smg2') return args?.[0] && SMG_DISPLAY_OUTPUTS.has(args[0].toUpperCase()) ? 'a_disp' : 'a_smg';
        if (/^ews/.test(moduleId)) return 'a_body';
        switch (group) {
            case 'engine':
                return 'a_engine';
            case 'drivetrain':
                return 'a_smg';
            case 'comm':
                return 'a_av';
            case 'comfort':
                return 'a_comfort';
            case 'safety':
                return 'a_safety';
            case 'chassis':
                return 'a_chassis';
            default:
                return 'a_body';
        }
    }
    if (CHECK.test(id)) return 'c_check';
    return 'c_setup';
}

/** The owner's decision for a job. */
export function decisionFor(moduleId: string, job: Pick<CatalogJob, 'id' | 'class' | 'catalogOnly'>, group?: string, args?: readonly string[]): Decision & { nature: Nature } {
    const nature = natureOf(moduleId, job, group, args);
    const decision = OWNER_DECISION[nature] ?? UNDECIDED;
    if (job.catalogOnly && decision.how === 'run') return { nature, ...decision, how: 'show' };
    return { nature, ...decision };
}

/** Whether a nature is a read (its frames must carry a read control byte to go). */
export const isReadNature = (n: Nature): boolean => n === 'r_ident' || n === 'r_status' || n === 'r_misc';

export const natureName = (n: Nature, lang: 'ja' | 'en' = 'ja'): string => NATURES.find((x) => x.nature === n)?.[lang] ?? n;
