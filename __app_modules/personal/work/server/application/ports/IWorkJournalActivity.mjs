/** Idempotent attributed activity projection; never a journal entry writer. */
export class IWorkJournalActivity {
  async upsert(_input) {
    throw new Error('IWorkJournalActivity.upsert not implemented');
  }
  async read(_input) {
    throw new Error('IWorkJournalActivity.read not implemented');
  }
}
