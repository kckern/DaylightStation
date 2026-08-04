import { describe, expect, it } from 'vitest';

/**
 * Contract every surface-family certification port must satisfy (spec §7.1).
 * Ports are pure: certify(bundle, profile) with no I/O, no throw for
 * unsupported content, deterministic output.
 */
export function runCertificationPortContract({
  name, makePort, profile, renderableBundle, incompatibleBundle, unknownTypeBundle,
}) {
  describe(`certification port contract: ${name}`, () => {
    it('returns one verdict per module, in module order, with the required shape', () => {
      const result = makePort().certify(renderableBundle, profile);
      expect(result.modules.map((m) => m.moduleId))
        .toEqual(renderableBundle.lesson.modules.map((m) => m.moduleId));
      for (const entry of result.modules) {
        expect(['render', 'incompatible']).toContain(entry.verdict);
        expect(Array.isArray(entry.reasons)).toBe(true);
        expect(Array.isArray(entry.warnings)).toBe(true);
      }
      expect(['full', 'partial', 'none']).toContain(result.lesson.verdict);
    });

    it('is deterministic', () => {
      const port = makePort();
      expect(port.certify(renderableBundle, profile)).toEqual(port.certify(renderableBundle, profile));
    });

    it('certifies the renderable bundle full with no reasons', () => {
      const result = makePort().certify(renderableBundle, profile);
      expect(result.lesson.verdict).toBe('full');
      expect(result.modules.flatMap((m) => m.reasons)).toEqual([]);
    });

    it('never throws for unsupported content; returns reasons instead', () => {
      const result = makePort().certify(incompatibleBundle, profile);
      expect(result.lesson.verdict).not.toBe('full');
      const incompatible = result.modules.filter((m) => m.verdict === 'incompatible');
      expect(incompatible.length).toBeGreaterThan(0);
      for (const entry of incompatible) expect(entry.reasons.length).toBeGreaterThan(0);
    });

    // F2 (2026-08-04 acceptance audit): a module of a genuinely unregistered
    // type must never silently certify as renderable just because it has no
    // demanded capabilities to miss (fail-closed, spec §7.1). Every port
    // must reject it with a stated reason, not throw.
    it('rejects a module of an unknown/uncertifiable type instead of silently certifying it (F2)', () => {
      const result = makePort().certify(unknownTypeBundle, profile);
      expect(result.lesson.verdict).not.toBe('full');
      const flagged = result.modules.find(
        (m) => m.moduleId === unknownTypeBundle.lesson.modules[0].moduleId,
      );
      expect(flagged.verdict).toBe('incompatible');
      expect(flagged.reasons.length).toBeGreaterThan(0);
    });
  });
}
