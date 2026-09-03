#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""複数モジュールで同じ注意文を使う族。

同じ族の全ジョブに同じ文を書くと、8 箇所のうち 1 箇所だけ直す事故を招く。1 箇所に
置いて import する——前身アプリがそうしていた性質をそのまま引き継ぐ。

文面は前身の `tools/sgbd_overrides.py` から一字も変えずに移した。
"""
from __future__ import annotations

_IHKA_JA = ("先に DIAGNOSE_AUFRECHT を送り、終わったら必ず DIAGNOSE_ENDE を送ってください"
            "（引数 DIAGNOSE_AUFRECHT には 'ja' を渡す）。DIAGNOSE_ENDE を送るまで IHKA は"
            "指定値を保持し、通常制御に戻りません。")
_IHKA_EN = ("Send DIAGNOSE_AUFRECHT first and DIAGNOSE_ENDE when you are done (pass 'ja' as "
            "the DIAGNOSE_AUFRECHT argument). Until DIAGNOSE_ENDE the IHKA holds the value you "
            "set and does not return to normal control.")
_LSZ_IO_JA = ("灯火の出力を直接駆動します。'Kl15'（イグニッションON扱い）・'SLEEP_MODE'"
              "（通信が切れる）・'START_PRUEF'・'NOTAKTIV'・'QUICK_NACHF' は副作用が大きい"
              "ので使わないこと。通常状態への復帰は DIAGNOSE_ENDE です。")
_LSZ_IO_EN = ("Drives the lamp outputs directly. Do not use 'Kl15' (fakes ignition on), "
              "'SLEEP_MODE' (drops the link), 'START_PRUEF', 'NOTAKTIV' or 'QUICK_NACHF' — "
              "their side effects are large. DIAGNOSE_ENDE returns the LSZ to normal.")
_SM_IO_JA = ("シートが動きます（SLV/SHV/SNV/LNV = 前後・高さ・傾き・背もたれ、POS_1..3 = "
             "メモリ呼出）。シートに誰も座らず、後席の足元・シート下に物や手が無いことを"
             "確認してください。止めるには ORT1='STOP' を送ります。")
_SM_IO_EN = ("The seat moves (SLV/SHV/SNV/LNV = fore-aft, height, tilt, backrest; POS_1..3 = "
             "memory recall). Nobody in the seat, nothing and no hands under it or behind it. "
             "Send ORT1='STOP' to halt.")
_SPM_JA = ("ミラーが動き/折り畳まれます。手を近づけないこと。'MEMx_SPEICHERN' は保存済み"
           "メモリ位置を上書きし、'KOMFORTSCHL' はコンフォートクローズ（窓・ルーフを閉じる）"
           "を起動します。停止は 'SPIEGEL_AUS'。")
_SPM_EN = ("The mirror moves or folds — keep hands away. 'MEMx_SPEICHERN' overwrites the stored "
           "memory position and 'KOMFORTSCHL' triggers comfort-close (windows and roof close). "
           "'SPIEGEL_AUS' stops it.")
_SIA_JA = ("サービスインターバル表示をリセットします。引数は Oel_Reset / Weg_Reset / "
           "Zeit_Reset のいずれか。整備を実施していないのにリセットすると次回時期の根拠が"
           "失われます。元には戻せません。")
_SIA_EN = ("Resets the service-interval display. Argument is one of Oel_Reset / Weg_Reset / "
           "Zeit_Reset. Resetting without having done the service loses the basis for the next "
           "due date. It cannot be undone.")
