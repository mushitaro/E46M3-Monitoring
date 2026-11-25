"""Executable reads proven in interpreter replay. Retain the remaining source jobs in the catalogue."""

DDE3_READS = frozenset({"IDENT", "STATUS_MOTORDREHZAHL", "STATUS_GESCHWINDIGKEIT"})

REPLAYED_READS = {
    "dde30ds0": DDE3_READS,
    "dws": frozenset({"IDENT", "STATUS_IO"}),
    "ekp_ds2": frozenset({"IDENT", "STATUS_MESSWERTE", "STATUS_REGELUNGSWERTE"}),
    "gr2": frozenset({"IDENT"}),
}
