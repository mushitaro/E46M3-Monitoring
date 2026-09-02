#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# ============================================================================
#  gen_from_dump.py — 「権威ある」SGBDジョブ表 → アプリ用 ecu-data/*.json
# ----------------------------------------------------------------------------
#  入力: $SGBD_DUMP_DIR/<SGBD>.json （EdiabasLibの仮想ジョブ _JOBS/_JOBCOMMENTS/
#        _RESULTS で取得した実データ。ジョブ名・説明文・結果名・型・結果説明を含む）
#  出力: ecu-data/<id>.json （バイリンガル {id, ja, en} 構造）
#
#  ※ 従来の extract_sgbd.py（正規表現スクレイピング＝推測）を置き換える。
#     ラベルは「識別子」ではなく SGBD の実説明文から生成するため精度が高い。
#  ※ 故障テキストのみ SGBD 文字列から抽出（ジョブ表には無いため）。
#
#  手順:  1) cd tools/SgbdDump && dotnet run -c Release -- MSS54DS0 SMG2 ASCMK20 dsc_mk60
#         2) python tools/gen_from_dump.py
# ============================================================================
import re, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from translate import translate, leftover_ratio

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import paths                                                # noqa: E402

DUMP = paths.require_dump_dir()   # リポジトリ外。理由は tools/paths.py
# public/ 配下が配信ルート（アプリは ./ecu-data/*.json を fetch する）。
OUT = os.path.join(HERE, "..", "public", "ecu-data")
ECU_DIR = r"C:\EDIABAS\ECU"

# id : (dump/SGBDファイル名, (ja名, en名), DS2アドレス, 実SGBDファイル)
MODULES = {
    "mss54":    ("MSS54DS0", ("MSS54 (S54 / E46 M3 エンジン)", "MSS54 (S54 / E46 M3 Engine)"), 0x12, "MSS54DS0.prg"),
    "smg2":     ("SMG2",     ("SMG II (E46 M3 変速機)", "SMG II (E46 M3 Gearbox)"),           0x32, "SMG2.prg"),
    # E46 の DSC は DSC_E46.prg が正（汎用 dsc_mk60.prg ではない）。MK20 はこの車両非搭載のため除外。
    "dsc_mk60": ("DSC_E46",  ("DSC (E46 M3)", "DSC (E46 M3)"),                                 0x56, "DSC_E46.prg"),
}

GRP = [
    (r'DREHZAHL|GESCHWIND|LADUNG|LAST|FAHRZEUG', 'basic',   '基本',            'Basic'),
    (r'TEMP|KUEHLW|OEL|OIL',                     'temp',    '温度',            'Temperature'),
    (r'VANOS',                                    'vanos',   'VANOS',           'VANOS'),
    (r'LAMBDA|SONDE|LSH|O2|ABGAS|KAT',            'lambda',  'ラムダ/排気',      'Lambda/Exhaust'),
    (r'KLOPF',                                    'knock',   'ノック',          'Knock'),
    (r'DROSSEL|DKP|PEDAL|MDK|LEERLAUF|LL_',       'throttle','スロットル/アイドル','Throttle/Idle'),
    (r'EINSPRITZ|ZUEND|EV\d',                     'ignfuel', '点火/噴射',        'Ignition/Fuel'),
    (r'ADAPT|ADD|INT_|KORREK|GEBERRAD',           'adapt',   '適応/補正',        'Adaptation'),
    (r'SPANNUNG|STROM|BATT|KLEMME|RELAIS|VENTIL|PUMPE|LUEFTER|HEIZ|UBATT', 'elec', '電気/アクチュエータ', 'Electrical/Actuator'),
    (r'DRUCK|RAD|BREMS|GIER|QUER|LENK|ABS|ASC|DSC', 'chassis','シャシ/ブレーキ',  'Chassis/Brake'),
    (r'GANG|KUPPL|GETRIEBE|WAEHL|SMG|MOMENT|SCHALT', 'trans','変速機',          'Transmission'),
    (r'CODIER|IDENT|HW|SW|DATUM|AIF|ZIF',         'ident',   '識別/コーディング',  'Ident/Coding'),
]
def group_of(name):
    for pat, key, ja, en in GRP:
        if re.search(pat, name, re.I): return key, ja, en
    return 'other', 'その他', 'Other'

# --- テスト/キャリブレーション対象ジョブの選別 -------------------------------
#  安全のためフラッシュ/メモリ書込/検査スタンプ等（プログラミング系＝WinKFP領域）は除外。
EXCLUDE = re.compile(r'^(FLASH|SPEICHER_SCHREIBEN|AIF_SCHREIBEN|PRUEFSTEMPEL|BAUDRATEN|SET_EDIC|FS_LOESCHEN|FS_|STATUS|INFO|IDENT|DIAGNOSE|SEED_KEY|ZIF|HERSTELLER|BLOCKLAENGE|DATEN_REFERENZ|HW_REFERENZ)', re.I)

# --- テストJob（Stellglieddiagnose = 一時的な動作確認。原則ジョブ自身/ECUが
#     元の状態へ復帰する）------------------------------------------------------
#  従来の STEUERN_*/STELLGLIED*/MAGNETVENTIL*/ANSTEUERUNG_*/TESTPRG* に加え、
#  SgbdDump実ダンプ（$SGBD_DUMP_DIR/*.json）で1件ずつ確認して追加:
#    MSS54DS0 : IO_STATUS_VORGEBEN / IO_STATUS_LESEN（生I/Oピン強制/読取）
#    DSC_E46  : DRUCKABBAU_*/DRUCKAUFBAU_*/DRUCKHALTEN/PUMPENFOERDERLEISTUNG_*/
#               ABS_REGELSIMULATION/NA_ENTLUEFTUNG_*/ENTLUEFTUNG_SERVICE
#               （ENTLUEFTUNG_SERVICE は "ENTLUEFT" 前方一致で従来 ADAPTJOB に
#                 誤分類されていたが、コメントが他のDRUCK*/PUMPEN*系と同一の
#                 自己復帰型ジョブのため、下のif/elif順序でTESTJOBを優先する）
#    DSC_E46  : DSC_SIM_VA/HA, VA1..3/HA1..3（駆動後に「保持」し自動復帰しない
#               点が他と異なる。gen側では一律テストJob扱いとし、UI側
#               （js/ecu-generic.js の execStyle）で "pulse-unreleasable"
#               として高リスク・解除手順未確認の警告を必須表示する）
TESTJOB = re.compile(
    r'^(STEUERN|STELLGLIED|MAGNETVENTIL|ANSTEUERUNG|TESTPRG'
    r'|IO_STATUS_VORGEBEN|IO_STATUS_LESEN'
    r'|DRUCKABBAU|DRUCKAUFBAU|DRUCKHALTEN|PUMPENFOERDERLEISTUNG'
    r'|ABS_REGELSIMULATION|NA_ENTLUEFTUNG|ENTLUEFTUNG_SERVICE|DSC_SIM_)', re.I)

ADAPTJOB = re.compile(r'^(ADAPTION|INITIALISIER|SG_RESET|EDIC_RESET|GRUNDEINSTELL|ENTLUEFT|KALIBR|ABGLEICH|LERN|CODIERDATEN_SCHREIBEN|GETRIEBEDATEN)|_LOESCHEN$|_RESET$|ABGLEICHEN$|_SCHREIBEN$', re.I)
ACT_CAT = {'testJob': ('アクチュエータテスト', 'Actuator Test'), 'adapt': ('適応/リセット', 'Adaptation/Reset')}

# 汎用すぎて情報価値のない説明文（この場合は識別子から作る方が良い）
GENERIC = {'', 'ergebnis', 'result', 'wert', 'value', 'status', 'job'}

def lbl_for(name, comment):
    """ラベルと説明を分離して生成。
       ラベル: 「comment翻訳」と「識別子分解」の2候補を作り、leftover_ratio()（未訳の
       独語が占める割合）が小さい方を採用する。同点（両方きれい/両方に同程度残り）なら
       短い方を採用（ラベルの簡潔性優先）。従来の len(comment)<=40 閾値は廃止
       （短い説明文でも未訳が残るなら識別子分解の方が良い場合があるため）。
       説明:   SGBDの原文(de)＋翻訳(ja/en)を保持。※独語の文は分解すると誤爆(Nullの LL→アイドル)するため全語一致のみ。
       戻り: (ja, en, desc|None)"""
    c = (comment or '').strip()
    meaningful = bool(c) and c.lower() not in GENERIC and len(c) > 3

    base = re.sub(r'_(WERT)$', '', name)
    ja_id, en_id = translate(base, 'ja'), translate(base, 'en')

    if meaningful:
        ja_c, en_c = translate(c, 'ja', decompose=False), translate(c, 'en', decompose=False)
        score_c, score_id = leftover_ratio(c, decompose=False), leftover_ratio(base, decompose=True)
        if score_c < score_id:
            ja, en = ja_c, en_c
        elif score_id < score_c:
            ja, en = ja_id, en_id
        else:                                   # 同点 → 短い方（簡潔性優先）
            ja, en = (ja_c, en_c) if len(ja_c) <= len(ja_id) else (ja_id, en_id)
    else:
        ja, en = ja_id, en_id

    desc = ({'de': c, 'ja': translate(c, 'ja', decompose=False), 'en': translate(c, 'en', decompose=False)}
            if meaningful else None)
    return ja, en, desc

def fault_text(prg):
    """故障テキストはジョブ表に無いのでSGBD文字列から抽出（XOR 0xF7）。"""
    dec = bytes(b ^ 0xF7 for b in open(os.path.join(ECU_DIR, prg), 'rb').read())
    runs = list(dict.fromkeys(m.group().decode('latin1') for m in re.finditer(rb'[\x20-\x7e]{3,}', dec)))
    bad = set('\\/')
    txt = [s for s in runs if len(s) >= 8 and re.search(r'[a-zäöü]', s) and ' ' in s
           and s[0] not in '_.' and not (bad & set(s))
           and not s.startswith(('ARGUMENT', 'BMW ', 'RESULT', 'JOBCOMMENT'))]
    return [{'de': t, 'ja': translate(t, 'ja', decompose=False), 'en': translate(t, 'en', decompose=False)}
            for t in txt[:250]]

def build(mid, dumpname, name, addr, prg):
    d = json.load(open(os.path.join(DUMP, dumpname + '.json'), encoding='utf-8'))

    # ---- ライブ値: STATUS_* ジョブの結果（実名＋型＋実説明文） ----
    seen, groups = {}, {}
    for j in d['jobs']:
        if not re.match(r'^(STATUS|STAT)_', j['job'], re.I): continue
        names = {r['name'] for r in (j.get('results') or [])}
        for r in j.get('results') or []:
            n = r['name']
            if n == 'JOB_STATUS' or n.endswith(('_EINH', '_TEXT')) or n in seen: continue
            ja, en, desc = lbl_for(n, r.get('comment'))
            seen[n] = True
            key, gja, gen = group_of(n + ' ' + ((desc or {}).get('de') or ''))
            p = {'id': n, 'ja': ja, 'en': en, 'type': r.get('type', ''),
                 'job': j['job']}                        # ★この結果を返すジョブ（実機読取に必須）
            # 単位は実行時に <name>_EINH 結果でECUが返す（メタデータには実単位が無い）
            base = re.sub(r'_WERT$', '', n)
            if base + '_EINH' in names: p['unitRes'] = base + '_EINH'
            if desc: p['desc'] = desc
            groups.setdefault(key, {'key': key, 'ja': gja, 'en': gen, 'params': []})['params'].append(p)
    order = [g[1] for g in GRP] + ['other']
    grouped = [groups[k] for k in dict.fromkeys(order) if k in groups]
    live = sum(len(g['params']) for g in grouped)

    # ---- キャリブレーション(adapt=永続書込み) / テストJob(testJob=一時動作確認):
    #      実ジョブ＋実説明文＋実引数(_ARGUMENTS、宣言順のまま保持) ----
    acts, tests = [], []
    for j in d['jobs']:
        nm = j['job']
        if EXCLUDE.match(nm): continue
        cat = 'testJob' if TESTJOB.match(nm) else ('adapt' if ADAPTJOB.search(nm) else None)
        if not cat: continue
        ja, en, desc = lbl_for(nm, j.get('comment'))
        a = {'id': nm, 'ja': ja, 'en': en}
        if cat == 'adapt':
            a['cat'] = 'adapt'; a['catJa'], a['catEn'] = ACT_CAT['adapt']
        if desc: a['desc'] = desc
        # ★ 引数は宣言順のまま保持する（EdiabasLibBackend.RunJob が ";" 結合で
        #   位置引数として渡すため、順序を変えてはならない）
        args = [{'name': ar['name'], 'type': ar.get('type') or '', 'comment': ar.get('comment') or ''}
                for ar in (j.get('args') or [])]
        if args: a['args'] = args
        (acts if cat == 'adapt' else tests).append(a)

    prof = {'id': mid, 'name': name[0], 'name_en': name[1], 'sgbd': prg, 'address': addr,
            'verified': False, 'liveCount': live, 'groups': grouped,
            'actuators': acts, 'testJobs': tests, 'faultText': fault_text(prg),
            'jobCount': d['jobCount'], 'source': 'EdiabasLib _JOBS/_RESULTS (authoritative)'}
    # indent=1 is not cosmetic. These files are committed, and the auto-fix
    # pipeline reviews them as diffs. Written on one physical line, mss54.json
    # was 166 KB that showed up as a single changed line — unreviewable, so a
    # regeneration that silently dropped jobs would look identical to one that
    # fixed a label. gen_smg2_workflows.py already wrote indent=1; this was the
    # odd one out.
    _write_json(os.path.join(OUT, mid + '.json'), prof)
    return {'id': mid, 'name': name[0], 'name_en': name[1], 'sgbd': prg,
            'live': live, 'act': len(acts), 'test': len(tests), 'jobs': d['jobCount']}


def _write_json(path, obj):
    """Atomic write: build the whole file, then replace. A generator that dies
    part-way must not leave a truncated profile behind for the app to load."""
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write('\n')
    os.replace(tmp, path)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    idx, failed = [], []
    for mid, (dumpname, name, addr, prg) in MODULES.items():
        try:
            r = build(mid, dumpname, name, addr, prg); idx.append(r)
            print(f"  {mid:10} jobs={r['jobs']:<4} live={r['live']:<4} calib={r['act']:<3} test={r['test']:<3} <- {dumpname}.json")
        except Exception as e:
            failed.append((mid, e))
            print(f"  {mid:10} ERR {e}")

    # A failed module used to drop out of index.json while its stale <id>.json
    # stayed on disk, and the script still exited 0 — so CI passed and the app
    # quietly lost a module. Fail loudly instead, and don't rewrite the index
    # from a partial run.
    if failed:
        sys.stderr.write(
            f"\n[FATAL] {len(failed)} module(s) failed: "
            + ', '.join(m for m, _ in failed)
            + "\nindex.json was NOT rewritten; ecu-data is unchanged for the failed modules.\n")
        sys.exit(1)

    _write_json(os.path.join(OUT, 'index.json'), idx)
    print(f"wrote {len(idx)} AUTHORITATIVE profiles to ecu-data/")
