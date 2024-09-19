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
    const shortTermBuckets      = monthList.reduce((acc, month) => shortTermBudgetReducer(acc, month, monthlyBudget, config), {});


  
    const periodSurplus = Object.values(monthlyBudget).reduce((acc, {surplus}) => acc + surplus, 0);
    const shortTermBudget_pre =  Object.values(shortTermBuckets).reduce((acc, {budget}) => acc + (budget||0), 0);

    const unBudgetedAmount = parseFloat((periodSurplus - shortTermBudget_pre).toFixed(2));
    if(unBudgetedAmount > 0){
        shortTermBuckets["Unbudgeted"] = shortTermBuckets["Unbudgeted"] || { budget: 0, spending: 0, balance: 0, debits: 0, credits: 0, transactions: [] };
        shortTermBuckets["Unbudgeted"]['budget']    = parseFloat((periodSurplus - shortTermBudget_pre).toFixed(2));
        shortTermBuckets["Unbudgeted"]['balance']   = parseFloat((shortTermBuckets["Unbudgeted"]['budget'] - shortTermBuckets["Unbudgeted"]['spending']).toFixed(2));
    }

    const shortTermBudget =  Object.values(shortTermBuckets).reduce((acc, {budget}) => acc + budget, 0);
    const shortTermSpending = Object.values(shortTermBuckets).reduce((acc, {spending}) => acc + spending, 0);
    const shortTermDebits = Object.values(shortTermBuckets).reduce((acc, {debits}) => acc + (debits||0), 0);
    const shortTermCredits = Object.values(shortTermBuckets).reduce((acc, {credits}) => acc + (credits||0), 0);
    const shortTermBalance =  Object.values(shortTermBuckets).reduce((acc, {balance}) => acc + balance, 0);

    const shortTermStatus = {
        budget: parseFloat(shortTermBudget.toFixed(2)),
        spending: parseFloat(shortTermSpending.toFixed(2)),
        debits: parseFloat(shortTermDebits.toFixed(2)),
        credits: parseFloat(shortTermCredits.toFixed(2)),
        balance: parseFloat((shortTermBalance).toFixed(2))
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