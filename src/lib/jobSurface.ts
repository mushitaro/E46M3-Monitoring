/**
 * Which tab a job belongs to — decided once, for both of them.
 *
 * ACTUATOR and SERVICE list the module's jobs between them, and the split has to
 * be a partition rather than two filters that happen to agree. The two surfaces
 * run a job through DIFFERENT gates: SERVICE goes to `mayRun`, ACTUATOR to
 * `mayActuate`, which is deliberately wider in PRACTICE. A job reachable from
 * both is two answers to "may this be sent", and the operator has no way to know
 * which one they got.
 *
 * So there is one function. Each view asks it, and the test asserts that every
 * job in all 51 modules lands on exactly one surface — which is free here and
 * impossible to state when the rule is a `.filter()` in each component.
 *
 * The boundary is by CONSEQUENCE, not by name: `test` is exactly the class that
 * can leave an output energised, which is the thing ACTUATOR's arming, its STOP
 * button and its ENGAGED badge exist for. Everything else is browse-and-send,
 * which is what SERVICE's faceted list is.
 */
import type { CatalogJob } from './ecuCatalog';

export type JobSurface = 'actuator' | 'service';

export function surfaceOf(job: Pick<CatalogJob, 'class'>): JobSurface {
    return job.class === 'test' ? 'actuator' : 'service';
}

export function isOn(surface: JobSurface) {
    return (job: Pick<CatalogJob, 'class'>) => surfaceOf(job) === surface;
}
