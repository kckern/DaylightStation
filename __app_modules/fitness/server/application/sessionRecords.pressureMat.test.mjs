import { describe, expect, it } from 'vitest';
import { Session } from "../domain/entities/Session.mjs";
import { serializeSession, reconstituteSession } from "./sessionRecords.mjs";
import { dehydrateSessionRecord } from "../adapters/persistence/YamlSessionDatastore.mjs";

describe('durable pressure-mat checkpoint', () => {
  it('survives application, domain, and YAML projections without dropping attribution', () => {
    const metadata = { pressure_mats: { version: 1, mats: [{
      matId: 'mat-1', equipmentId: 'step_mat', sessionSteps: 40, sessionStomps: 8,
      assignedUserId: 'alex', users: { alex: { steps: 30, stomps: 4 } }, seenThisSession: true, engaged: false,
    }] } };
    const session = new Session({ sessionId: '20260904144124', metadata });
    const saved = JSON.parse(JSON.stringify(dehydrateSessionRecord(session)));
    expect(serializeSession(reconstituteSession(saved)).metadata).toEqual(metadata);
  });
});
