/**
 * What kind of fault, in Japanese: the SGBDs' own fault-kind texts (`FArtTexte`, the `F_ARTn_TEXT` and
 * `F_VORHANDEN_TEXT` a module's FS_LESEN reports) as the owner reads them (U5, F13).
 *
 * The SGBDs hold these in German and the generated catalogues carry no translation of them (they live
 * in each module's results table, not in its text table). So the translation is here, one line per
 * text, for every kind text the shipped SGBDs hold (collected from public/ecu-data/*.results.json,
 * 2026-11-20). Provenance: this file's translation of the SGBD's own words — the German stays beside
 * it wherever it is shown, and a text not listed is shown as the SGBD wrote it, never guessed.
 */
const KINDS: Readonly<Record<string, string>> = {
    // Present now, or stored only.
    'Fehler momentan vorhanden': '今出ている',
    'Fehler momentan nicht vorhanden': '今は出ていない（記録のみ）',
    'Fehler momentan nicht vorhanden, aber bereits gespeichert': '今は出ていない（記録のみ）',
    'Fehler momentan vorhanden und bereits gespeichert': '今出ている（記録あり）',
    'Fehler momentan vorhanden, aber noch nicht gespeichert (Entprellphase)': '今出ている（まだ記録されていない・確認中）',
    'Fehler zur Zeit aktiv': '今出ている',
    'Fehler zur Zeit nicht aktiv': '今は出ていない（記録のみ）',
    'Fehler aktuell vorhanden': '今出ている',
    'Fehler nicht vorhanden': '今は出ていない',
    'Fehler aktiv': '今出ている',
    'Fehler nicht aktiv': '今は出ていない',
    'Fehler bisher nicht aufgetreten': 'これまで出ていない',
    'Fehler nach Entprellung abgespeichert': '確認のうえ記録',
    // Sporadic or static.
    'sporadischer Fehler': '散発',
    'Fehler sporadisch': '散発',
    'Fehler ist sporadisch': '散発',
    'statischer Fehler': '常時（散発でない）',
    'Fehler ist nicht sporadisch': '常時（散発でない）',
    'Fehler nicht sporadisch': '常時（散発でない）',
    // Warning lamp (DSC MK60).
    'Fehler wuerde kein Aufleuchten einer Warnlampe verursachen': '警告灯は点かない',
    'Fehler wuerde das Aufleuchten einer Warnlampe verursachen': '警告灯が点く',
    // Test state (DSC MK60).
    'Testbedingungen erfuellt': '試験条件を満たした',
    'Testbedingungen noch nicht erfuellt': '試験条件をまだ満たしていない',
    // Symptoms (DSC MK60).
    'kein passendes Fehlersymptom': '当てはまる症状なし',
    'Signal oder Wert oberhalb Schwelle': '信号・値が上限を超えた',
    'Signal oder Wert unterhalb Schwelle': '信号・値が下限を下回った',
    'kein Signal oder Wert': '信号・値が無い',
    'unplausibles Signal oder Wert': '信号・値がつじつまが合わない',
    // Electrical.
    'Leitungsunterbrechung': '断線',
    Unterbrechung: '断線',
    Leitungsfehler: '配線の異常',
    'Kurzschluss gegen U-Batt': 'バッテリー電源への短絡',
    'Kurzschluss gegen Masse': 'アースへの短絡',
    'KS gegen UBatt': 'バッテリー電源への短絡',
    'KS gegen Masse': 'アースへの短絡',
    Masseschluss: 'アースへの短絡',
    'Masse-Schluss': 'アースへの短絡',
    'Leitung Masse-Schluss': '配線がアースへ短絡',
    'Leitung gegen Masse': '配線がアースへ短絡',
    Batterieschluss: 'バッテリー電源への短絡',
    'U-Batterie-Schluss': 'バッテリー電源への短絡',
    'Leitung U-Batterie-Schluss': '配線がバッテリー電源へ短絡',
    'Leitung gegen Plus': '配線がプラスへ短絡',
    'Masseschluss / Widerstand zu klein': 'アースへの短絡／抵抗が小さすぎる',
    'Masseschluss / Unterbrechung': 'アースへの短絡／断線',
    'Masse-Schluss / Unterbrechung': 'アースへの短絡／断線',
    'Batterieschluss / Unterbrechung / Widerstand zu gross': 'バッテリー電源への短絡／断線／抵抗が大きすぎる',
    'U-Batterie-Schluss / Unterbrechung / Widerstand zu gross': 'バッテリー電源への短絡／断線／抵抗が大きすぎる',
    'Batterieschluss / Ansteuerung defekt': 'バッテリー電源への短絡／駆動の故障',
    'U-Batterie-Schluss / Ansteuerungdefekt': 'バッテリー電源への短絡／駆動の故障',
    'Kurzschluss Datenleitung gegen U-Batt': 'データ線がバッテリー電源へ短絡',
    'Kurzschluss Versorgungs-/Datenleitung gegen Masse': '電源線・データ線がアースへ短絡',
    'Leckwiderstand oder Kurzschluss gegen U-Batt': 'リーク抵抗かバッテリー電源への短絡',
    'Leckwiderstand oder Kurzschluss gegen Masse': 'リーク抵抗かアースへの短絡',
    'Widerstand zu klein': '抵抗が小さすぎる',
    'Widerstand zu gross': '抵抗が大きすぎる',
    'Widerstand nicht definiert oder Graubereich': '抵抗が決まらない（中間の値）',
    Unterspannung: '電圧不足',
    'Unterbrechung Sitzmatte': '着座センサーの断線',
    'Kurzschluss Sitzmatte': '着座センサーの短絡',
    'Verkopplung mit einem anderen Zuendkreis': '別の点火回路とつながっている',
    'Leitung verkoppelt': '配線がほかとつながっている',
    'Zuendkreis verkoppelt': '点火回路がほかとつながっている',
    'Wandlerleitung: Kurzschluss gegen Masse': '振動子の配線がアースへ短絡',
    'Schirm: Kurzschluss gegen Masse': 'シールドがアースへ短絡',
    'Kurzschluss Schirm Wandlerleitung': '振動子の配線のシールドが短絡',
    Ausschwingfehler: '振動の収まりの異常',
    'Ausschwingfehler (Wandler schwingt zu lange nach)': '振動の収まりの異常（振動子が長く振れ続ける）',
    // Values and plausibility.
    Plausibilitaetsfehler: 'つじつまが合わない',
    'unplausibler Wert': '値のつじつまが合わない',
    'ungueltiger Arbeitsbereich': '動作範囲の外',
    Grenzwertunterschreitung: '下限を下回った',
    Grenzwertueberschreitung: '上限を超えた',
    // The module itself.
    'Fehler im RAM': 'RAM の異常',
    'Fehler Checksumme ROM': 'ROM のチェックサム異常',
    'Fehler Checksumme EEPROM': 'EEPROM のチェックサム異常',
    'Checksummen-Fehler beim Schreiben der Daten': 'データ書き込み時のチェックサム異常',
    'CRC Fehler durch Schreiben Codierdaten': 'コーディングデータ書き込みの CRC 異常',
    'Programmierung fehlegeschlagen': 'プログラミングに失敗',
    'Programmierung nicht mehr moeglich': 'もうプログラミングできない',
    'Falsche Algorithmusparameter': 'アルゴリズムのパラメータが違う',
    'Falsche Algoparameter': 'アルゴリズムのパラメータが違う',
    'Falscher Typ': '型式が違う',
    'Unterschiedliche Typen': '型式が食い違う',
    'Typen untershiedlich': '型式が食い違う',
    'Type Fehlerhaftp': '型式の異常',
    'SG spezifisch': 'ECU 固有',
    // Communication.
    Kommunikationsfehler: '通信の異常',
    Kommunikationsstoerung: '通信の障害',
    'Modul sendet Fehlersignal': 'モジュールが故障信号を送っている',
    'Modul sendet Fehler': 'モジュールが故障を送っている',
    'Sendet Fehler': '故障を送っている',
    'Mind. ein Modul inaktiv': '少なくとも一つのモジュールが動いていない',
    'Sammelfehler SLV': 'シート調整（SLV）のまとめての故障',
    'SLV codiert aber nicht k-Bus': 'シート調整（SLV）がコーディングされているが K バスに無い',
    // Airbag.
    'Crashtelegramm(e) gespeichert': '衝突の記録あり',
    'Mindestens ein Crashtelegramm gespeichert': '衝突の記録が一つ以上ある',
    // Not said.
    'unbekannte Fehlerart': '種類は SGBD に書かれていない',
};

/** A kind text in Japanese, or null where this table does not hold it (the SGBD's own words are shown then). */
export function kindJa(kind: string): string | null {
    return KINDS[kind.trim()] ?? null;
}

/** Each kind text in Japanese where the table holds it, else as the SGBD wrote it. */
export function kindsJa(kinds: readonly string[]): string[] {
    return kinds.map((k) => kindJa(k) ?? k);
}

/** The Japanese that says only whether the fault is there now: the state tag beside the name says it already. */
const STATE_ONLY = new Set(['今出ている', '今は出ていない（記録のみ）', '今は出ていない']);

/**
 * The kinds worth a line under a fault whose row already carries its state tag (現在あり／記録のみ):
 * every kind in Japanese except the ones that only repeat that tag. What the tag cannot say — 散発,
 * 警告灯は点かない, まだ記録されていない — stays (UX-21: one statement of the state, not two).
 */
export function kindsBesideState(kinds: readonly string[]): string[] {
    return kindsJa(kinds).filter((k) => !STATE_ONLY.has(k));
}

/**
 * A fault location's own text that names nothing: the SGBD's placeholder for a number it has no entry
 * for. Said as such ("この場所の名前は SGBD に無い"), not shown as if it were a name.
 */
export function isUnnamedLocation(text: string | null): boolean {
    return !text || /^(reserviert|unbekannter Fehlerort|unbekannter Fehler(ort)?|-+|\?+)$/i.test(text.trim());
}
