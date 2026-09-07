/** Translates the legacy SchoolService bank API to curriculum read ports. */
export class SchoolServiceBankReader {
  constructor({ schoolService } = {}) {
    this.schoolService = schoolService;
  }

  listIds = () => (this.schoolService?.listBanks?.() || [])
    .map((bank) => bank.id)
    .filter(Boolean);

  getBankIssue = (id) => {
    try {
      this.schoolService.getBank(id);
      return null;
    } catch (error) {
      return error.code === 'WORKSHEET_INVALID' ? error.message : null;
    }
  };

  getBank = (id) => {
    try {
      return this.schoolService.getBank(id);
    } catch {
      return null;
    }
  };
}
