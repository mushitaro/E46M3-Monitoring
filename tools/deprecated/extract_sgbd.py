#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  extract_sgbd.py — BMW SGBD(.prg) → バイリンガル ECU プロファイル(ecu-data/*.json)
# ----------------------------------------------------------------------------
#  SGBD 文字列は XOR 0xF7 符号化。復号して実ジョブ/結果(STATUS_)/アクチュエータ
#  (STEUERN_)/故障テキストを抽出し、translate.py で日本語・英語ラベルを付与する。
#  出力は EN/JA 切替を見据えたバイリンガル構造:
#    param  = {id, ja, en}
#    group  = {key, ja, en, params:[param...]}
#    fault  = {de, ja, en}   (de=独語原文, ja/en=翻訳)
#  新モジュール追加: MODULES に1行足すだけ。
# ============================================================================
import re, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from translate import translate

ECU_DIR = r"C:\EDIABAS\ECU"

# ⚠ DEPRECATED — DO NOT RUN AGAINST ecu-data/. Superseded by gen_from_dump.py.
#
# This is regex scraping of decrypted .prg bytes, i.e. guessing. gen_from_dump.py
# uses EdiabasLib's virtual jobs (_JOBS / _JOBCOMMENTS / _ARGUMENTS / _RESULTS)
# and gets the authoritative tables instead.
#
# Kept only as a reference for the XOR-0xF7 decode. It used to write straight to
# ../ecu-data with a live __main__, and running it would have:
#   - mapped dsc_mk60 to "dsc_mk60.prg" — the E46 SGBD is DSC_E46.prg
#   - emitted no testJobs[] and no per-param `job` field, so the runtime
#     result→job map would come back empty and every live value would die
# OUT now points at a scratch directory and the __main__ block is gone, so the
# file cannot damage ecu-data even if someone executes it.
OUT = os.path.join(os.path.dirname(__file__), "_scratch-output")

# id : (SGBD file, {ja,en}表示名, DS2アドレス)
MODULES = {
    "mss54":    ("MSS54DS0.prg", ("MSS54 (S54 / E46 M3 エンジン)", "MSS54 (S54 / E46 M3 Engine)"), 0x12),
    "smg2":     ("SMG2.prg",     ("SMG II (E46 M3 変速機)", "SMG II (E46 M3 Gearbox)"),          0x32),
    "dsc_mk20": ("ASCMK20.prg",  ("DSC MK20 (ASC/DSC)", "DSC MK20 (ASC/DSC)"),                   0x56),
    "dsc_mk60": ("dsc_mk60.prg", ("DSC MK60", "DSC MK60"),                                       0x56),
    # 追加例: "kombi": ("KOMB46.prg", ("メーター (E46)", "Cluster (E46)"), 0x60),
}

# (regex, key, ja, en)
GRP = [
    (r'DREHZAHL|GESCHWIND|LADUNG|LAST|FAHRZEUG', 'basic',   '基本',            'Basic'),
    (r'TEMP|KUEHLW|OEL|OIL|LUFTTEMP',            'temp',    '温度',            'Temperature'),
    (r'VANOS',                                    'vanos',   'VANOS',           'VANOS'),
    (r'LAMBDA|SONDE|O2|ABGAS|KAT',                'lambda',  'ラムダ/排気',      'Lambda/Exhaust'),
    (r'KLOPF',                                    'knock',   'ノック',          'Knock'),
    (r'DROSSEL|DKP|PEDAL|MDK|LEERLAUF|LL_',       'throttle','スロットル/アイドル','Throttle/Idle'),
    (r'EINSPRITZ|ZUEND|EV\d',                     'ignfuel', '点火/噴射',        'Ignition/Fuel'),
    (r'ADAPT|ADD|INT_|KORREK|GEBERRAD',           'adapt',   '適応/補正',        'Adaptation'),
    (r'SPANNUNG|STROM|BATT|KLEMME|RELAIS|VENTIL|PUMPE|LUEFTER|HEIZ', 'elec', '電気/アクチュエータ', 'Electrical/Actuator'),
    (r'DRUCK|RAD|BREMS|GIER|QUER|LENK|ABS|ASC|DSC', 'chassis','シャシ/ブレーキ',  'Chassis/Brake'),
    (r'GANG|KUPPL|GETRIEBE|WAEHL|SMG|MOMENT',     'trans',   '変速機',          'Transmission'),
    (r'CODIER|IDENT|HW|SW|DATUM',                 'ident',   '識別/コーディング',  'Ident/Coding'),
]

def group_of(name):
    for pat, key, ja, en in GRP:
        if re.search(pat, name):
            return key, ja, en
    return 'other', 'その他', 'Other'

def label(name):
    return {'id': name, 'ja': translate(name, 'ja'), 'en': translate(name, 'en')}

def extract(path):
    dec = bytes(b ^ 0xF7 for b in open(path, 'rb').read())
    runs = list(dict.fromkeys(m.group().decode('latin1') for m in re.finditer(rb'[\x20-\x7e]{3,}', dec)))
    ident = re.compile(r'^[A-Z][A-Z0-9_]{2,44}$')
    ids = [s for s in runs if ident.match(s)]
    def base(s):
        for suf in ('_WERT', '_EINH', '_TEXT'):
            if s.endswith(suf): return s[:-len(suf)]
        return s
    status = sorted({base(s) for s in ids if s.startswith(('STATUS_', 'STAT_'))})
    actions = action_jobs(ids)
    bad = set('\\/')
    text = [s for s in runs if len(s) >= 8 and re.search(r'[a-zäöü]', s) and ' ' in s
            and s[0] not in '_.' and not (bad & set(s))
            and not s.startswith(('ARGUMENT', 'BMW ', 'RESULT', 'JOBCOMMENT'))]
    return status, actions, text[:250]

# アクチュエータ/適応/リセット等の「実行ジョブ」を判定（STEUERN_だけでなくSMG等の別名も網羅）
_RESULT_PREFIX = ('STATUS', 'STAT_', 'AIF', 'ID_', 'ZIF', 'SW_', 'WW_', 'T_KL', 'ERROR',
                  'FLASH', 'DATEN', 'INFO', 'POS', 'KORR', 'TELEGRAMM', 'SPEICHER', 'TESTPRG',
                  'ANZ', 'UW', 'SIEMENS', 'HERSTELL', 'GANGANZEIGE', 'BAUDRATEN')

def action_jobs(ids):
    seen, out = set(), []
    for s in ids:
        if s in seen: continue
        if re.search(r'_(WERT|EINH|TEXT|EIN)$', s): continue     # 結果(値)は除外
        if s.startswith(_RESULT_PREFIX): continue
        cat = None
        if re.match(r'^(STEUERN|STELLGLIED|MAGNETVENTIL|AKTIV)', s):
            cat = 'actuator'
        elif re.search(r'^ADAPTION|_LOESCHEN$|^INITIALISIER|_RESET$|^SG_RESET|^GRUNDEINSTELL|^ENTLUEFT|^KALIBR|^ABGLEICH|^LERN|FREISCHALT|^RESET', s):
            cat = 'adapt'
        if cat:
            seen.add(s); out.append((s, cat))
    return sorted(out)

ACT_CAT = {'actuator': ('アクチュエータ', 'Actuators'), 'adapt': ('適応/リセット', 'Adaptation/Reset')}

def build(mid, sgbd, name, addr):
    status, actions, text = extract(os.path.join(ECU_DIR, sgbd))
    groups = {}   # key -> {key,ja,en,params}
    for s in status:
        key, gja, gen = group_of(s)
        groups.setdefault(key, {'key': key, 'ja': gja, 'en': gen, 'params': []})['params'].append(label(s))
    order = [g[1] for g in GRP] + ['other']
    grouped = [groups[k] for k in dict.fromkeys(order) if k in groups]
    acts = [dict(label(a), cat=cat, catJa=ACT_CAT[cat][0], catEn=ACT_CAT[cat][1]) for a, cat in actions][:80]
    prof = {
        'id': mid, 'name': name[0], 'name_en': name[1], 'sgbd': sgbd, 'address': addr, 'verified': False,
        'liveCount': len(status), 'groups': grouped,
        'actuators': acts,
        'faultText': [{'de': t, 'ja': translate(t, 'ja', decompose=False), 'en': translate(t, 'en', decompose=False)} for t in text],
    }
    json.dump(prof, open(os.path.join(OUT, mid + '.json'), 'w', encoding='utf-8'), ensure_ascii=False)
    return {'id': mid, 'name': name[0], 'name_en': name[1], 'sgbd': sgbd, 'live': len(status), 'act': len(prof['actuators'])}

# __main__ deliberately removed. Use tools/gen_from_dump.py.
if __name__ == '__main__':
    sys.exit(
        "extract_sgbd.py is deprecated and does not run.\n"
        "Use: python tools/gen_from_dump.py  (authoritative EdiabasLib virtual-job pipeline)"
    )
