import { readFileSync, writeFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import moment from 'moment-timezone';
import { buildBudget } from './budgetlib/build_budget.mjs';
import { processTransactions } from './buxfer.mjs';

moment.tz.setDefault('America/Los_Angeles');


export const compileBudget = async () => {
    const budgetConfig = yaml.load(readFileSync('data/budget/budget.config.yml', 'utf8'));
    const budgetList = budgetConfig.budget.sort((a, b) => a.timeframe.start - b.timeframe.start);
    const { mortgage } = budgetConfig;
    const rawTransactions = yaml.load(readFileSync('data/budget/transactions.yml', 'utf8')).transactions;
    //Apply Memos
    const transactionMemos = yaml.load(readFileSync('data/budget/transaction.memos.yml', 'utf8'));
   for(const txnId of Object.keys(transactionMemos)){
        const txnIndex = rawTransactions.findIndex(txn => `${txn.id}` === txnId);
        if(txnIndex !== -1) rawTransactions[txnIndex]['memo'] = transactionMemos[txnId]; 
      
    }
    const budgets = {};
    for(const budget of budgetList){
        const budgetStart = moment(budget.timeframe.start).toISOString().slice(0, 10);
        const budgetEnd = moment(budget.timeframe.end).toISOString().slice(0, 10);
        const transactions = rawTransactions.filter(txn => txn.date >= budgetStart && txn.date <= budgetEnd);
        budgets[budgetStart] = buildBudget(budget, transactions);
    }
    writeFileSync('data/budget/finances.yml', yaml.dump({budgets,mortgage}));
}

const budgetPath = 'data/budget/budget.config.yml';
export const refreshFinancialData = async (noDL) => {
    let transactions;

    if (!noDL) {
        const { budget } = yaml.load(readFileSync(budgetPath, 'utf8'));
        const [{ timeframe: { start, end }, accounts }] = budget;
        const startDate = moment(start).format('YYYY-MM-DD');
        const endDate = moment(end).format('YYYY-MM-DD');

        transactions = await processTransactions({ startDate, endDate, accounts });
        writeFileSync('data/budget/transactions.yml', yaml.dump({ transactions }));
    } else {
        ({ transactions } = yaml.load(readFileSync('data/budget/transactions.yml', 'utf8')));
    }

    await compileBudget();
    return { status: 'success', transactionCount: transactions.length };
}