

import { readFileSync, writeFileSync } from 'fs';
import { getTransactions } from '../../lib/buxfer.js';    
import yaml from 'js-yaml';

const budgetPath = 'data/budget/budget.yml';

(async () => {

    const {budget} = yaml.load(readFileSync(budgetPath, 'utf8'));
    const startDate = budget.timeframe.start.toISOString().slice(0, 10);
    const endDate = budget.timeframe.end.toISOString().slice(0, 10);
    const accounts = budget.accounts;
    const transactions = await getTransactions({startDate, endDate, accounts});
    //save to transactions.yml
    writeFileSync('data/budget/transactions.yml', yaml.dump({transactions}));

})();
