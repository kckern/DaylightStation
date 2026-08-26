import { describe, it, expect, vi } from 'vitest';
import { ResolvePersonalCard, agendaArtifactId } from './ResolvePersonalCard.mjs';

const document = { id: 'agenda-test-learner', title: 'Test Learner' };

function subject({ captureAgenda = null, printed = true } = {}) {
  const buildAgenda = {
    execute: vi.fn(async () => ({
      document, offers: [{ subject: 'scripture', unitId: 'u1' }], createdSessions: [], sections: [],
    })),
  };
  const receipts = { print: vi.fn(async () => ({ printed })) };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const card = new ResolvePersonalCard({
    buildAgenda,
    receipts,
    captureAgenda,
    // Cooldown off — this suite is about capture, and the cooldown would
    // suppress the second print in the idempotency case below.
    cooldownMinutes: 0,
    clock: () => new Date('2026-08-25T23:48:31.080Z'),
    logger,
  });
  return { card, buildAgenda, receipts, logger };
}

describe('ResolvePersonalCard agenda capture', () => {
  it('archives the printed agenda under the agreed id, with the document as input', async () => {
    const captureAgenda = { execute: vi.fn(async () => ({ created: true })) };
    const { card } = subject({ captureAgenda });

    const result = await card.execute({ learnerId: 'test-learner' });

    expect(result.status).toBe('agenda_printed');
    expect(captureAgenda.execute).toHaveBeenCalledTimes(1);
    const call = captureAgenda.execute.mock.calls[0][0];
    // ISO BASIC in the leaf: a full instant carries colons, and a colon is
    // illegal in a Windows filename and awkward in Finder — hidden until now
    // only by whole-id percent-encoding, which is the thing being unwound.
    expect(call.artifactId).toBe('agenda/test-learner/20260825T234831080Z');
    expect(call.kind).toBe('agenda');
    expect(call.learnerId).toBe('test-learner');
    // The renderer's INPUT is the point — bytes alone cannot be re-rendered
    // through a layout you have since fixed.
    expect(call.document).toBe(document);
  });

  it('names the artifact the same way the CLI does', () => {
    // A convention duplicated as a template string in two files is a convention
    // that drifts, so both sides call this.
    expect(agendaArtifactId({ learnerId: 'test-learner', issuedAt: '2026-08-25T23:48:31.080Z' }))
      .toBe('agenda/test-learner/20260825T234831080Z');
  });

  it('NEVER fails a print because the archive failed', async () => {
    // This runs after the paper is already in a child's hand. An archive that
    // can turn a successful print into a failed scan has its priorities
    // backwards.
    const captureAgenda = { execute: vi.fn(async () => { throw new Error('disk full'); }) };
    const { card, logger } = subject({ captureAgenda });

    const result = await card.execute({ learnerId: 'test-learner' });

    expect(result.status).toBe('agenda_printed');
    expect(result.printed).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      'school.card.agenda-capture-failed',
      expect.objectContaining({ learnerId: 'test-learner', error: 'disk full' }),
    );
  });

  it('does not archive a page that never printed', async () => {
    // The archive answers "what was the child holding?" — a page the printer
    // refused was never held, and recording it would make the archive lie.
    const captureAgenda = { execute: vi.fn(async () => ({ created: true })) };
    const { card } = subject({ captureAgenda, printed: false });

    const result = await card.execute({ learnerId: 'test-learner' });

    expect(result.status).toBe('print_failed');
    expect(captureAgenda.execute).not.toHaveBeenCalled();
  });

  it('prints exactly as before when no capture port is wired', async () => {
    const { card, receipts } = subject({ captureAgenda: null });
    const result = await card.execute({ learnerId: 'test-learner' });
    expect(result.status).toBe('agenda_printed');
    expect(receipts.print).toHaveBeenCalledTimes(1);
  });
});
