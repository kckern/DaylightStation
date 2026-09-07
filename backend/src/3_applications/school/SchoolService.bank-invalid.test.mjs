import { describe, it, expect } from 'vitest';
import { SchoolService } from './SchoolService.mjs';
import { SchoolServiceBankReader } from '../../1_adapters/school/SchoolServiceBankReader.mjs';

const raw = { schema: 'school.question-bank/v2', id: 'test', title: 'Test', items: [{
  id: 'neighbors', type: 'multi_select', prompt: 'Which are neighbors?',
  answers: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], decoys: ['I', 'J', 'K'],
}] };
const service = () => new SchoolService({ datastore: { readBankRaw: () => raw }, logger: { warn() {} } });

describe('invalid worksheet diagnostics', () => {
  it('preserves the question-bank validation reason at the API boundary', () => {
    expect(() => service().getBank('test')).toThrow(/items\[0\].*5\.\.10/);
  });
  it('makes diagnostics available without changing the nullable bank-reader contract', () => {
    const reader = new SchoolServiceBankReader({ schoolService: service() });
    expect(reader.getBank('test')).toBeNull();
    expect(reader.getBankIssue('test')).toMatch(/items\[0\].*5\.\.10/);
  });
});
