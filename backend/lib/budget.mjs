import { readFileSync, writeFileSync } from 'fs';
import yaml from 'js-yaml';
import moment from 'moment-timezone';
import { buildBudget } from './budgetlib/build_budget.mjs';
import { processTransactions } from './buxfer.mjs';

moment.tz.setDefault('America/Los_Angeles');


export const compileBudget = async () => {
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
}

const budgetPath = 'data/budget/budget.config.yml';

export const refreshFinancialData = async () => {

    const {budget} = yaml.load(readFileSync(budgetPath, 'utf8'));    
    const [{timeframe:{start, end}, accounts}] = budget;
    const startDate = moment(start).format('YYYY-MM-DD');
    const endDate = moment(end).format('YYYY-MM-DD');

    const transactions = await processTransactions({startDate, endDate, accounts});
    writeFileSync('data/budget/transactions.yml', yaml.dump({transactions}));
    await compileBudget();
    return {status: 'success', transactionCount: transactions.length};
}
