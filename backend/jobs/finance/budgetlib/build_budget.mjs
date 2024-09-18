import { dayToDayBudgetReducer, getMonthlyBudget, shortTermBudgetReducer, transferTransactionsReducer } from "./monthly_budget.mjs";
import moment from 'moment';
import { findBucket } from "./transactions.mjs";


export const buildBudget = (config, transactions)=>
{
    const { timeframe } = config;
    const budgetStart = new Date(timeframe.start).toISOString().slice(0, 10);
    const budgetEnd = new Date(timeframe.end).toISOString().slice(0, 10);

    const accounts = config.accounts;
    const monthlyBudget = getMonthlyBudget(config, transactions);
    const monthList = Object.keys(monthlyBudget);

    const dayToDayBudget        = monthList.reduce((acc, month) => dayToDayBudgetReducer(acc, month, monthlyBudget, config), {});
    const transferTransactions  = monthList.reduce((acc, month) => transferTransactionsReducer(acc, month, monthlyBudget), {});
    const shortTermBuckets = monthList.reduce((acc, month) => shortTermBudgetReducer(acc, month, monthlyBudget, config), {});

    const shortTermBudget = monthList.reduce((acc, month) => acc + monthlyBudget[month].surplus, 0);
    const shortTermSpending = Object.values(shortTermBuckets).reduce((acc, {spending}) => acc + spending, 0);
    const shortTermStatus = {
        budget: parseFloat(shortTermBudget.toFixed(2)),
        spending: parseFloat(shortTermSpending.toFixed(2)),
        balance: parseFloat((shortTermBudget - shortTermSpending).toFixed(2))
    };


    return {
        budgetStart,
        budgetEnd,
        accounts,
        dayToDayBudget: dayToDayBudget,
        monthlyBudget,
        shortTermBuckets,
        shortTermStatus,
        transferTransactions
    }
}