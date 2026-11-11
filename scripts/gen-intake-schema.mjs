#!/usr/bin/env node
/**
 * Writes docs/schemas/e46.intake-check.v1.schema.json from the zod schema in
 * packages/monitoring-engine/src/intake/intakeCheck.ts — the JSON Schema of the intake report, for a reader that is not
 * TypeScript (a Mainstay's own system, a person checking a saved file). Generated: change the zod
 * file and run this; packages/monitoring-engine/src/intake/intake.test.ts fails while the two disagree.
 *
 *   node scripts/gen-intake-schema.mjs
 *
 * Node reads the .ts directly (type stripping, Node 22.18+): the schema file imports zod alone.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { INTAKE_CHECK_SCHEMA, intakeCheckReport } from '../packages/monitoring-engine/src/intake/intakeCheck.ts';

const out = join(import.meta.dirname, '..', 'docs', 'schemas', `${INTAKE_CHECK_SCHEMA}.schema.json`);
writeFileSync(out, `${JSON.stringify(z.toJSONSchema(intakeCheckReport), null, 2)}\n`);
console.log(`wrote ${out}`);
