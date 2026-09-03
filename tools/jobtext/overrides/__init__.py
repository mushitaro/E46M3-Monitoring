#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""個体ごとの注意文。`cautions.py` の族の表より優先される。

族の一般論で足りるものはここに書かない——`STEUERN_EV1..8` の8本は同じ危険を
共有しているので、8回書けば8箇所のうち1箇所だけ直す事故を招くだけである。

ここに書くのは、族の文では言い足りない個体だけ。

前身アプリの `tools/sgbd_overrides.py` から 149 件を移した。分類の事実（risk / cat /
style / preconditions / exclude）は一緒に来ていない——そちらは `tools/sgbd/classify.py`
の領分で、いくつかは前身とこの repo で食い違っている。文のほうは食い違っていない。

`"*"` バケット（モジュール横断）は、そのジョブを実際に持つモジュールにだけ展開した。
素朴に全 51 モジュールへ展開すると 1,611 対のうち 1,461 対が存在しないジョブを指す。
"""
from __future__ import annotations

from .aic import AIC
from .alc_ds2 import ALC_DS2
from .b_sm46_4 import B_SM46_4
from .bm46wide import BM46WIDE
from .bmbt46rn import BMBT46RN
from .bmbt46tn import BMBT46TN
from .bmbt_mir import BMBT_MIR
from .cdc_46 import CDC_46
from .cvm_ii import CVM_II
from .dsc_e46 import DSC_MK60
from .ews3 import EWS3
from .ews3d import EWS3D
from .ihka46 import IHKA46
from .ihka46_2 import IHKA46_2
from .ihka46_3 import IHKA46_3
from .kombi46 import KOMBI46
from .kombi46r import KOMBI46R
from .lsz import LSZ
from .lsz_2 import LSZ_2
from .lws5 import LWS5
from .mrs3 import MRS3
from .mrs4 import MRS4
from .mss54 import MSS54
from .nav_jap import NAV_JAP
from .navmk4_2 import NAVMK4_2
from .pdcact import PDCACT
from .pdce38 import PDCE38
from .radio import RADIO
from .rdc import RDC
from .rls_ds2 import RLS_DS2
from .shd46 import SHD46
from .shd46_2 import SHD46_2
from .sm46_4 import SM46_4
from .sm46c_5 import SM46C_5
from .smg2 import SMG2
from .spm46bt import SPM46BT
from .spm46ft import SPM46FT
from .szm46 import SZM46
from .ueb2 import UEB2
from .videomod import VIDEOMOD
from .xenon_l import XENON_L
from .xenon_r import XENON_R
from .zke5 import ZKE5
from .zke5_s12 import ZKE5_S12

OVERRIDES: dict[str, dict[str, tuple[str, str]]] = {
    "aic": AIC,
    "alc_ds2": ALC_DS2,
    "b_sm46_4": B_SM46_4,
    "bm46wide": BM46WIDE,
    "bmbt46rn": BMBT46RN,
    "bmbt46tn": BMBT46TN,
    "bmbt_mir": BMBT_MIR,
    "cdc_46": CDC_46,
    "cvm_ii": CVM_II,
    "dsc_e46": DSC_MK60,
    "ews3": EWS3,
    "ews3d": EWS3D,
    "ihka46": IHKA46,
    "ihka46_2": IHKA46_2,
    "ihka46_3": IHKA46_3,
    "kombi46": KOMBI46,
    "kombi46r": KOMBI46R,
    "lsz": LSZ,
    "lsz_2": LSZ_2,
    "lws5": LWS5,
    "mrs3": MRS3,
    "mrs4": MRS4,
    "mss54": MSS54,
    "nav_jap": NAV_JAP,
    "navmk4_2": NAVMK4_2,
    "pdcact": PDCACT,
    "pdce38": PDCE38,
    "radio": RADIO,
    "rdc": RDC,
    "rls_ds2": RLS_DS2,
    "shd46": SHD46,
    "shd46_2": SHD46_2,
    "sm46_4": SM46_4,
    "sm46c_5": SM46C_5,
    "smg2": SMG2,
    "spm46bt": SPM46BT,
    "spm46ft": SPM46FT,
    "szm46": SZM46,
    "ueb2": UEB2,
    "videomod": VIDEOMOD,
    "xenon_l": XENON_L,
    "xenon_r": XENON_R,
    "zke5": ZKE5,
    "zke5_s12": ZKE5_S12,
}
