/** Aggregates the paper-surface verdicts for one standalone question bank. */
export class PaperBankCertificationService {
  constructor({ registry }) { this.registry = registry; }

  hasProfiles() {
    return this.#profiles().length > 0;
  }

  certify(bank) {
    const results = this.#profiles().map((profile) => this.registry.portFor(profile).certifyBank(bank, profile));
    if (results.some((result) => result.verdict === 'render')) return { verdict: 'render', reasons: [] };
    return { verdict: 'incompatible', reasons: results.flatMap((result) => result.reasons || []) };
  }

  #profiles() {
    return this.registry?.list().filter((profile) => profile.family === 'paper') ?? [];
  }
}

export default PaperBankCertificationService;
