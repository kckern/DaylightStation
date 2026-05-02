export class FinanceReadSkill {
  static name = 'finance_read';

  #fin;
  #logger;
  #config;

  constructor({ finance, logger = console, config = {} }) {
    if (!finance?.accountBalances) throw new Error('FinanceReadSkill: finance (IFinanceRead) required');
    this.#fin = finance;
    this.#logger = logger;
    this.#config = { ...config };
  }

  get name() { return FinanceReadSkill.name; }
  getConfig() { return { ...this.#config }; }

  getPromptFragment(_s) {
    return `## Finance
Use these tools to answer questions about household money.
- \`account_balances\`: current balances across all accounts.
- \`recent_transactions\`: filter by days, account name, or tag (category).
- \`budget_summary\`: summary of income and category spending for the current budget period.
Round dollar amounts when speaking; do not read every cent unless asked.`;
  }

  getTools() {
    const fin = this.#fin;
    const log = this.#logger;
    return [
      {
        name: 'account_balances',
        description: 'Get current balances of all household accounts.',
        parameters: { type: 'object', properties: {} },
        async execute() {
          const accounts = await fin.accountBalances();
          log.info?.('brain.skill.finance.balances', { count: accounts.length });
          return { accounts };
        },
      },
      {
        name: 'recent_transactions',
        description: 'List recent transactions, optionally filtered by account or tag.',
        parameters: {
          type: 'object',
          properties: {
            days: { type: 'number' },
            account: { type: 'string' },
            tag: { type: 'string' },
            limit: { type: 'number' },
          },
        },
        async execute({ days = 7, account, tag, limit = 25 }) {
          const tx = await fin.recentTransactions({ days, account, tag, limit });
          log.info?.('brain.skill.finance.transactions', { days, count: tx.length });
          return { transactions: tx };
        },
      },
      {
        name: 'budget_summary',
        description: 'Summarize income and spending for a budget period (default: current).',
        parameters: { type: 'object', properties: { period_start: { type: 'string' } } },
        async execute({ period_start }) {
          const summary = await fin.budgetSummary({ periodStart: period_start });
          log.info?.('brain.skill.finance.budget', { periodStart: summary.asOf });
          return summary;
        },
      },
    ];
  }
}

export default FinanceReadSkill;
