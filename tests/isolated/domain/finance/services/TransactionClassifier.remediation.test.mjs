import { TransactionClassifier } from '#domains/finance/services/TransactionClassifier.mjs';

describe('TransactionClassifier remediation', () => {
  test('labels a monthly transaction by its matching tag even when not the first tag', () => {
    const classifier = new TransactionClassifier({
      monthly: [{ label: 'Utilities', tags: ['Electric'] }]
    });
    const result = classifier.classify({ type: 'expense', tagNames: ['Untracked', 'Electric'] });
    expect(result).toEqual({ label: 'Utilities', bucket: 'monthly' });
  });

  test('labels a short-term transaction by its matching tag even when not the first tag', () => {
    const classifier = new TransactionClassifier({
      shortTerm: [{ label: 'Vacation', tags: ['Travel'] }]
    });
    const result = classifier.classify({ type: 'expense', tagNames: ['Misc', 'Travel'] });
    expect(result).toEqual({ label: 'Vacation', bucket: 'shortTerm' });
  });

  test('missing monthly label falls back to Uncategorized, not Shopping', () => {
    const classifier = new TransactionClassifier({
      monthly: [{ tags: ['Mystery'] }]
    });
    const result = classifier.classify({ type: 'expense', tagNames: ['Mystery'] });
    expect(result).toEqual({ label: 'Uncategorized', bucket: 'monthly' });
  });

  test('missing shortTerm label falls back to Uncategorized', () => {
    const classifier = new TransactionClassifier({
      shortTerm: [{ tags: ['MysteryFund'] }]
    });
    const result = classifier.classify({ type: 'expense', tagNames: ['MysteryFund'] });
    expect(result).toEqual({ label: 'Uncategorized', bucket: 'shortTerm' });
  });

  test('throws on config where a bucket tag collides with income/dayToDay tags', () => {
    expect(() => new TransactionClassifier({
      income: { tags: ['Paycheck'] },
      monthly: [{ label: 'Utilities', tags: ['Paycheck'] }]
    })).toThrow(/collision/i);
  });

  test('throws when a category LABEL collides with a dayToDay tag', () => {
    expect(() => new TransactionClassifier({
      dayToDay: { tags: ['Groceries'] },
      shortTerm: [{ label: 'Groceries', tags: ['FoodFund'] }]
    })).toThrow(/collision/i);
  });

  test('throws when a transferTag collides with income/dayToDay tags', () => {
    expect(() => new TransactionClassifier({
      income: { tags: ['RSU Vest'] },
      monthly: [{ label: 'Long-term Savings', tags: ['Brokerage'], transferTags: ['RSU Vest'] }]
    })).toThrow(/collision/i);
  });

  test('non-colliding config constructs fine', () => {
    expect(() => new TransactionClassifier({
      income: { tags: ['Paycheck'] },
      dayToDay: { tags: ['Groceries'] },
      monthly: [{ label: 'Utilities', tags: ['Electric'] }],
      shortTerm: [{ label: 'Vacation', tags: ['Travel'] }]
    })).not.toThrow();
  });

  // Cross-bucket collisions: a tag routing to two DIFFERENT buckets is
  // resolved silently by classify()'s fixed order — a config error.
  test('throws when a tag appears in both a monthly and a shortTerm bucket', () => {
    expect(() => new TransactionClassifier({
      monthly: [{ label: 'Utilities', tags: ['Water'] }],
      shortTerm: [{ label: 'Bills', tags: ['Water'] }]
    })).toThrow(/collision/i);
  });

  test('throws when a tag appears in both income and dayToDay', () => {
    expect(() => new TransactionClassifier({
      income: { tags: ['Cashback'] },
      dayToDay: { tags: ['Cashback'] }
    })).toThrow(/collision/i);
  });

  test('throws when a monthly LABEL equals a shortTerm bucket tag', () => {
    expect(() => new TransactionClassifier({
      monthly: [{ label: 'Insurance', tags: ['Premium'] }],
      shortTerm: [{ label: 'Health', tags: ['Insurance'] }]
    })).toThrow(/collision/i);
  });

  // A transferTag routes to the MONTHLY bucket, so a transferTag that also
  // names a monthly tag lands in the same bucket — NOT a collision.
  test('a transferTag that also names a monthly tag is not a collision', () => {
    expect(() => new TransactionClassifier({
      monthly: [{ label: 'Housing', tags: ['Rent'], transferTags: ['Rent'] }]
    })).not.toThrow();
  });

  test('error names each colliding tag with its buckets', () => {
    let err;
    try {
      new TransactionClassifier({
        monthly: [{ label: 'Utilities', tags: ['Water'] }],
        shortTerm: [{ label: 'Bills', tags: ['Water'] }]
      });
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.message).toMatch(/Water/);
    expect(err.message).toMatch(/monthly/);
    expect(err.message).toMatch(/shortTerm/);
  });

  // ---------------------------------------------------------------------------
  // Account-scoped plumbing (brokerage-side mirror legs)
  //
  // Buxfer reports the Fidelity side of a Payroll->Fidelity transfer as a plain
  // expense/income, so #isTransfer never sees it. Left alone, the sweep inflates
  // Long-term Savings and the deposit mirror inflates income; because deposits
  // and sweeps do not match dollar-for-dollar in a period, they overstate surplus.
  // ---------------------------------------------------------------------------
  const PLUMBING_CONFIG = {
    income: { tags: ['Income', 'Payroll'] },
    monthly: [{ label: 'Long-term Savings', tags: ['Investments', '401K'] }],
    plumbing: {
      accounts: ['Fidelity'],
      descriptions: ['Fidelity Cash Sweep', 'Coupang Payroll', 'Coupang']
    }
  };

  test('sweep expense in a plumbing account goes to transfer, not Long-term Savings', () => {
    const classifier = new TransactionClassifier(PLUMBING_CONFIG);
    expect(classifier.classify({
      type: 'expense', accountName: 'Fidelity',
      description: 'Fidelity Cash Sweep', tagNames: ['Investments'], amount: 6565.25
    })).toEqual({ label: 'Investments', bucket: 'transfer' });
  });

  test('deposit mirror income in a plumbing account goes to transfer, not income', () => {
    const classifier = new TransactionClassifier(PLUMBING_CONFIG);
    expect(classifier.classify({
      type: 'income', accountName: 'Fidelity',
      description: 'Coupang Payroll', tagNames: ['Payroll'], amount: 6565.25
    })).toEqual({ label: 'Payroll', bucket: 'transfer' });
  });

  test('the SAME description on the payroll account is still real income', () => {
    const classifier = new TransactionClassifier(PLUMBING_CONFIG);
    expect(classifier.classify({
      type: 'income', accountName: 'Payroll',
      description: 'Coupang Payroll', tagNames: ['Income'], amount: 9094.08
    })).toEqual({ label: 'Income', bucket: 'income' });
  });

  test('a real expense in a plumbing account is untouched', () => {
    const classifier = new TransactionClassifier(PLUMBING_CONFIG);
    expect(classifier.classify({
      type: 'expense', accountName: 'Fidelity',
      description: 'WinCo Foods', tagNames: ['Investments'], amount: 100
    })).toEqual({ label: 'Long-term Savings', bucket: 'monthly' });
  });

  test('plumbing beats transferTags — a sweep never becomes a monthly expense', () => {
    const classifier = new TransactionClassifier({
      ...PLUMBING_CONFIG,
      monthly: [{ label: 'Long-term Savings', tags: ['Investments'], transferTags: ['Investments'] }]
    });
    expect(classifier.classify({
      type: 'transfer', accountName: 'Fidelity',
      description: 'Fidelity Cash Sweep', tagNames: ['Investments'], amount: 6565.25
    })).toEqual({ label: 'Investments', bucket: 'transfer' });
  });

  test('matching is case- and whitespace-insensitive', () => {
    const classifier = new TransactionClassifier(PLUMBING_CONFIG);
    expect(classifier.classify({
      type: 'expense', accountName: '  fidelity ',
      description: '  FIDELITY CASH SWEEP  ', tagNames: ['Investments'], amount: 1
    }).bucket).toBe('transfer');
  });

  test('omitting plumbing config leaves classification unchanged', () => {
    const classifier = new TransactionClassifier({
      income: { tags: ['Income', 'Payroll'] },
      monthly: [{ label: 'Long-term Savings', tags: ['Investments'] }]
    });
    expect(classifier.classify({
      type: 'expense', accountName: 'Fidelity',
      description: 'Fidelity Cash Sweep', tagNames: ['Investments'], amount: 6565.25
    })).toEqual({ label: 'Long-term Savings', bucket: 'monthly' });
  });

  test('accounts without descriptions (or vice versa) is inert, not a catch-all', () => {
    const accountsOnly = new TransactionClassifier({
      ...PLUMBING_CONFIG, plumbing: { accounts: ['Fidelity'] }
    });
    expect(accountsOnly.classify({
      type: 'expense', accountName: 'Fidelity',
      description: 'Fidelity Cash Sweep', tagNames: ['Investments'], amount: 1
    }).bucket).toBe('monthly');

    const patternsOnly = new TransactionClassifier({
      ...PLUMBING_CONFIG, plumbing: { descriptions: ['Fidelity Cash Sweep'] }
    });
    expect(patternsOnly.classify({
      type: 'expense', accountName: 'Fidelity',
      description: 'Fidelity Cash Sweep', tagNames: ['Investments'], amount: 1
    }).bucket).toBe('monthly');
  });

  test('a transaction with no description is never plumbing', () => {
    const classifier = new TransactionClassifier(PLUMBING_CONFIG);
    expect(classifier.classify({
      type: 'expense', accountName: 'Fidelity', tagNames: ['Investments'], amount: 1
    }).bucket).toBe('monthly');
  });

  // ---------------------------------------------------------------------------
  // Description-routed short-term buckets (one-off projects)
  // ---------------------------------------------------------------------------
  const PROJECT_CONFIG = {
    income: { tags: ['Income'] },
    dayToDay: { tags: ['Groceries'] },
    monthly: [{ label: 'Utilities', tags: ['Electric'] }],
    shortTerm: [
      { label: 'Home & Auto', tags: ['Home Maintenance'] },
      { label: 'Bills, Fees & Gifts', tags: ['Fees'] },
      { label: 'Home Restoration', descriptions: ['Drywall', 'Advanced Water', 'Pike Plumbing'] }
    ]
  };

  test('a project transaction is pulled out of the bucket its tag would give it', () => {
    const c = new TransactionClassifier(PROJECT_CONFIG);
    expect(c.classify({ type: 'expense', description: 'Drywall', tagNames: ['Home Maintenance'] }))
      .toEqual({ label: 'Home Restoration', bucket: 'shortTerm' });
  });

  test('pulls across buckets — a Fees-tagged project item still routes to the project', () => {
    const c = new TransactionClassifier(PROJECT_CONFIG);
    expect(c.classify({ type: 'expense', description: 'Pike Plumbing and Sewer', tagNames: ['Fees'] }))
      .toEqual({ label: 'Home Restoration', bucket: 'shortTerm' });
  });

  test('same tag, different vendor, stays in the tag bucket', () => {
    const c = new TransactionClassifier(PROJECT_CONFIG);
    expect(c.classify({ type: 'expense', description: 'Ace Hardware', tagNames: ['Home Maintenance'] }))
      .toEqual({ label: 'Home & Auto', bucket: 'shortTerm' });
  });

  test('a project description never swallows income or day-to-day', () => {
    const c = new TransactionClassifier({
      ...PROJECT_CONFIG,
      shortTerm: [...PROJECT_CONFIG.shortTerm.slice(0, 2),
                  { label: 'Home Restoration', descriptions: ['Drywall', 'Coupang'] }]
    });
    expect(c.classify({ type: 'income', description: 'Coupang Payroll', tagNames: ['Income'] }).bucket)
      .toBe('income');
    expect(c.classify({ type: 'expense', description: 'Drywall Depot', tagNames: ['Groceries'] }).bucket)
      .toBe('day');
  });

  test('project routing beats a monthly tag', () => {
    const c = new TransactionClassifier(PROJECT_CONFIG);
    expect(c.classify({ type: 'expense', description: 'Drywall', tagNames: ['Electric'] }))
      .toEqual({ label: 'Home Restoration', bucket: 'shortTerm' });
  });

  test('the credit side of a project (an insurance payout) routes there too', () => {
    const c = new TransactionClassifier({
      ...PROJECT_CONFIG,
      shortTerm: [...PROJECT_CONFIG.shortTerm.slice(0, 2),
                  { label: 'Home Restoration', descriptions: ['Insurance Claim (Water Leak)'] }]
    });
    expect(c.classify({
      type: 'dividend', description: 'Insurance Claim (Water Leak)',
      tagNames: ['Home Maintenance'], amount: 4386.10, expenseAmount: -4386.10
    })).toEqual({ label: 'Home Restoration', bucket: 'shortTerm' });
  });

  test('two buckets claiming the same description throws at construction', () => {
    expect(() => new TransactionClassifier({
      shortTerm: [
        { label: 'Home Restoration', descriptions: ['Drywall'] },
        { label: 'Home & Auto', descriptions: ['Drywall'] }
      ]
    })).toThrow(/claimed by both/i);
  });

  test('the same description listed twice in one bucket is fine', () => {
    expect(() => new TransactionClassifier({
      shortTerm: [{ label: 'Home Restoration', descriptions: ['Drywall', 'drywall'] }]
    })).not.toThrow();
  });

  test('buckets without descriptions behave exactly as before', () => {
    const c = new TransactionClassifier({
      shortTerm: [{ label: 'Home & Auto', tags: ['Home Maintenance'] }]
    });
    expect(c.classify({ type: 'expense', description: 'Drywall', tagNames: ['Home Maintenance'] }))
      .toEqual({ label: 'Home & Auto', bucket: 'shortTerm' });
  });

  // ---------------------------------------------------------------------------
  // Id-pinned short-term buckets (CLOSED one-off projects)
  // ---------------------------------------------------------------------------
  const PINNED_CONFIG = {
    shortTerm: [
      { label: 'Home & Auto', tags: ['Home Maintenance'] },
      { label: 'Bills, Fees & Gifts', tags: ['Fees'] },
      { label: 'Home Restoration', ids: ['243638332', '245275560'] }
    ]
  };

  test('a pinned id routes to its project whatever its tag or description', () => {
    const c = new TransactionClassifier(PINNED_CONFIG);
    expect(c.classify({ id: '245275560', type: 'expense', description: 'Check Payment', tagNames: ['Fees'] }))
      .toEqual({ label: 'Home Restoration', bucket: 'shortTerm' });
  });

  test('numeric ids match string config entries', () => {
    const c = new TransactionClassifier(PINNED_CONFIG);
    expect(c.classify({ id: 243638332, type: 'expense', description: 'Pike Plumbing', tagNames: ['Home Maintenance'] }).label)
      .toBe('Home Restoration');
  });

  test('an UNpinned check payment is NOT swallowed by the closed project', () => {
    const c = new TransactionClassifier(PINNED_CONFIG);
    expect(c.classify({ id: '999999', type: 'expense', description: 'Check Payment', tagNames: ['Fees'] }))
      .toEqual({ label: 'Bills, Fees & Gifts', bucket: 'shortTerm' });
  });

  test('a FUTURE plumbing repair still lands in Home & Auto', () => {
    const c = new TransactionClassifier(PINNED_CONFIG);
    expect(c.classify({ id: '888888', type: 'expense', description: 'Pike Plumbing and Sewer', tagNames: ['Home Maintenance'] }))
      .toEqual({ label: 'Home & Auto', bucket: 'shortTerm' });
  });

  test('a pinned id beats a description pattern owned by another bucket', () => {
    const c = new TransactionClassifier({
      shortTerm: [
        { label: 'Home & Auto', tags: ['Home Maintenance'], descriptions: ['Pike Plumbing'] },
        { label: 'Home Restoration', ids: ['243638332'] }
      ]
    });
    expect(c.classify({ id: '243638332', type: 'expense', description: 'Pike Plumbing', tagNames: [] }).label)
      .toBe('Home Restoration');
  });

  test('two buckets pinning the same id throws at construction', () => {
    expect(() => new TransactionClassifier({
      shortTerm: [
        { label: 'Home Restoration', ids: ['1'] },
        { label: 'Home & Auto', ids: ['1'] }
      ]
    })).toThrow(/claimed by both/i);
  });

  test('buckets without ids behave exactly as before', () => {
    const c = new TransactionClassifier({ shortTerm: [{ label: 'Home & Auto', tags: ['Home Maintenance'] }] });
    expect(c.classify({ id: '243638332', type: 'expense', description: 'x', tagNames: ['Home Maintenance'] }).label)
      .toBe('Home & Auto');
  });
});
