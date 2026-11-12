#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""first_send: what a job sends first, read from its start on a path with no branch.

The instruction bytes below are the encodings the real EdiabasLib trace shows for MSS54DS0
(opcode, addressing byte, operands), assembled by hand: no SGBD is needed to run this.
With the private data beside the repository, the last test reads SMG2.prg itself.

    python -m unittest tools/test_extract_telegrams.py
"""
import os
import struct
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_telegrams import dexor, extract, first_send, jobtable  # noqa: E402

S1, S2, S6, L0, L1, B0 = 0x1D, 0x1E, 0x22, 0x18, 0x19, 0x00


def lit(b):
    return struct.pack("<H", len(b)) + bytes(b)


def clear_s(r):            return bytes([0x01, 0x10, r])
def move_s_lit(r, b):      return bytes([0x00, 0x18, r]) + lit(b)
def move_s_s(d, s):        return bytes([0x00, 0x11, d, s])
def move_l_imm(r, v):      return bytes([0x00, 0x47, r]) + struct.pack("<I", v)
def push_imm(v):           return bytes([0x1E, 0x70]) + struct.pack("<I", v)
def push_l(r):             return bytes([0x1E, 0x40, r])
def pop_l(r):              return bytes([0x1F, 0x40, r])
def poke(s, idx, b):       return bytes([0x00, 0xA2, s, idx, b])      # S[Ln] <- Bn
def xsend_lit(resp, b):    return bytes([0x2A, 0x18, resp]) + lit(b)
def xsend_s(resp, s):      return bytes([0x2A, 0x11, resp, s])
def jz(rel):               return bytes([0x10, 0x70]) + struct.pack("<i", rel)


def patched(template, index, value):
    """The shape of SMG II's STATUS_IO_STATI_LESEN: template, copy, patch one byte, send."""
    return b"".join([
        clear_s(S1), move_s_lit(S1, template), push_imm(1), clear_s(S6), move_s_s(S6, S1), pop_l(L0),
        move_l_imm(L0, index), push_l(L0), move_l_imm(L0, value), push_l(L0),
        pop_l(L0), pop_l(L1), push_l(L0), poke(S6, L1, B0), pop_l(L0),
        clear_s(S1), move_s_s(S1, S2), push_imm(1), clear_s(S1), move_s_s(S1, S6), push_imm(1),
        clear_s(S2), xsend_s(S2, S6),
    ])


class FirstSend(unittest.TestCase):
    def run_code(self, code, addr=0x32):
        return first_send(code, 0, len(code), addr)

    def test_literal_send(self):
        code = clear_s(S2) + xsend_lit(S2, [0x32, 0x05, 0x0B, 0x03])
        sent, _ = self.run_code(code)
        self.assertEqual(sent.hex(" "), "32 05 0b 03")

    def test_patched_template(self):
        sent, src = self.run_code(patched([0x32, 0x05, 0x0B, 0x03], 3, 4))
        self.assertEqual(sent.hex(" "), "32 05 0b 04")
        # The origin is the template literal the scrape saw.
        code = patched([0x32, 0x05, 0x0B, 0x03], 3, 4)
        self.assertEqual(code[src:src + 4].hex(" "), "32 05 0b 03")

    def test_branch_before_the_send_is_not_resolved(self):
        code = clear_s(S2) + jz(0) + xsend_lit(S2, [0x32, 0x05, 0x0B, 0x03])
        self.assertIsNone(self.run_code(code))

    def test_unknown_instruction_is_not_resolved(self):
        # 0x57 (reads a job argument in ADAPTIONSWERTE_LESEN) before the send.
        code = bytes([0x57, 0x47, L0, 1, 0, 0, 0]) + xsend_lit(S2, [0x32, 0x05, 0x40, 0x00])
        self.assertIsNone(self.run_code(code))

    def test_patch_outside_the_template_is_not_resolved(self):
        self.assertIsNone(self.run_code(patched([0x32, 0x05, 0x0B, 0x03], 4, 1)))

    def test_wrong_address_or_length_is_not_resolved(self):
        self.assertIsNone(self.run_code(clear_s(S2) + xsend_lit(S2, [0x12, 0x05, 0x0B, 0x03])))
        self.assertIsNone(self.run_code(clear_s(S2) + xsend_lit(S2, [0x32, 0x06, 0x0B, 0x03])))

    def test_send_of_a_string_nothing_set_is_not_resolved(self):
        self.assertIsNone(self.run_code(clear_s(S2) + xsend_s(S2, S6)))


PRG = os.path.join(os.environ.get("EDIABAS_ECU_DIR", ""), "SMG2.prg")


@unittest.skipUnless(os.path.exists(PRG), "SMG2.prg is not here (EDIABAS_ECU_DIR)")
class Smg2(unittest.TestCase):
    def test_the_four_status_reads_each_send_their_own_block(self):
        got = extract(PRG, 0x32, resolve_first_send=True)
        want = {
            "STATUS_IO_LESEN": "32 05 0b 03 3f",
            "STATUS_IO_STATI_LESEN": "32 05 0b 04 38",
            "STATUS_HARDWARE_STATI_LESEN": "32 05 0b 02 3e",
            "STATUS_FAHRZEUGTESTER_LESEN": "32 05 0b 05 39",
        }
        for job, hex_ in want.items():
            self.assertEqual([(e["hex"], e["confidence"], e.get("firstSend")) for e in got[job]],
                             [(hex_, "single", True)], job)

    def test_nothing_else_changes(self):
        before = extract(PRG, 0x32)
        after = extract(PRG, 0x32, resolve_first_send=True)
        strip = lambda es: [(e["hex"], e["confidence"]) for e in es]
        changed = sorted(j for j in set(before) | set(after) if strip(before.get(j, [])) != strip(after.get(j, [])))
        self.assertEqual(changed, ["STATUS_FAHRZEUGTESTER_LESEN", "STATUS_HARDWARE_STATI_LESEN",
                                   "STATUS_IO_LESEN", "STATUS_IO_STATI_LESEN"])

    def test_a_job_that_reads_an_argument_first_stays_a_template(self):
        raw = open(PRG, "rb").read()
        jobs = jobtable(raw)
        k = next(i for i, (_, n) in enumerate(jobs) if n == "ADAPTIONSWERTE_LESEN")
        self.assertIsNone(first_send(dexor(raw), jobs[k][0], jobs[k + 1][0], 0x32))


if __name__ == "__main__":
    unittest.main()
