import { readFileSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';
import moment from 'moment-timezone';
import { buildBudget } from './budgetlib/build_budget.mjs';

moment.tz.setDefault('America/Los_Angeles');


(async () => {
    const budgetConfig = (yaml.load(readFileSync('data/budget/budget.config.yml', 'utf8'))).budget.sort((a, b) => a.timeframe.start - b.timeframe.start);
    const rawTransactions = yaml.load(readFileSync('data/budget/transactions.yml', 'utf8')).transactions;
    const budgets = {};
    for(const budget of budgetConfig){
        const budgetStart = moment(budget.timeframe.start).toISOString().slice(0, 10);
        const budgetEnd = moment(budget.timeframe.end).toISOString().slice(0, 10);
        const transactions = rawTransactions.filter(txn => txn.date >= budgetStart && txn.date <= budgetEnd);
        budgets[budgetStart] = buildBudget(budget, transactions);
    }
    writeFileSync('data/budget/finances.yml', yaml.dump(budgets));
})();

