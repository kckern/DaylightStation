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
    const shortTermBuckets      = monthList.reduce((acc, month) => shortTermBudgetReducer(acc, month, monthlyBudget, config), {})

    const unBudgetedTransactions = shortTermBuckets["Unbudgeted"]?.transactions || [];
    
    const periodSurplus = Object.values(monthlyBudget).reduce((acc, {surplus}) => acc + surplus, 0);
    const shortTermBudget_pre =  Object.values(shortTermBuckets).reduce((acc, {budget}) => acc + (budget||0), 0);
    const unBudgetedAmount = parseFloat((periodSurplus - shortTermBudget_pre).toFixed(2));
    const unclassifiedTransactionSum = unBudgetedTransactions.reduce((acc, {amount}) => acc + amount, 0);
    
  
    if(unBudgetedTransactions.length){

        console.log(unBudgetedTransactions.map(({date,description,amount,id})=>({  date,description,amount, url:`https://www.buxfer.com/transactions?tids=${id}`})));

        shortTermBuckets["Unbudgeted"] = shortTermBuckets["Unbudgeted"] || { budget: 0, spending: 0, balance: 0, debits: 0, credits: 0, transactions: [] };
        shortTermBuckets["Unbudgeted"]['balance'] = -unclassifiedTransactionSum; 

    }
    if (unBudgetedAmount !== 0) {
        let amountToAdjust = Math.abs(unBudgetedAmount);
    
        if (unBudgetedAmount > 0) {
            // Allocate surplus
            if (unclassifiedTransactionSum && unBudgetedAmount > unclassifiedTransactionSum) {
                shortTermBuckets["Unbudgeted"]['budget'] = unclassifiedTransactionSum;
                shortTermBuckets["Unbudgeted"]['balance'] = 0;
                shortTermBuckets["Unbudgeted"]['spending'] = unclassifiedTransactionSum;
                shortTermBuckets["Unbudgeted"]['debits'] = unclassifiedTransactionSum;
                shortTermBuckets["Unbudgeted"]['credits'] = 0;
                amountToAdjust = unBudgetedAmount - unclassifiedTransactionSum;
            }
    
            const flexibleBuckets = config.shortTerm.filter(({flex}) => flex).map(({label, flex}) => ({label, flex}));
            const flexWeightSum = flexibleBuckets.reduce((acc, {flex}) => acc + flex, 0);
            for (const {label, flex} of flexibleBuckets) {
                const percentage = flex / flexWeightSum;
                const allocation = parseFloat((amountToAdjust * percentage).toFixed(2));
                if (!shortTermBuckets[label]) continue;
                shortTermBuckets[label]['budget'] = (shortTermBuckets[label]['budget'] || 0) + allocation;
                shortTermBuckets[label]['balance'] = (shortTermBuckets[label]['balance'] || 0) + allocation;
            }

        } else {
            for (const label in shortTermBuckets) {
                const bucket = shortTermBuckets[label];
                if (bucket['balance'] > 0) {
                    const reduction = Math.min(bucket['balance'], amountToAdjust);
                    bucket['budget'] -= reduction;
                    bucket['balance'] -= reduction;
                    amountToAdjust -= reduction;
                    if (amountToAdjust <= 0) break;
                }
            }
            if (amountToAdjust > 0) {
                const flexibleBuckets = config.shortTerm.filter(({flex}) => flex).map(({label, flex}) => ({label, flex}));
                const flexWeightSum = flexibleBuckets.reduce((acc, {flex}) => acc + flex, 0);
    
                for (const {label, flex} of flexibleBuckets) {
                    const percentage = flex / flexWeightSum;
                    const reduction = parseFloat((amountToAdjust * percentage).toFixed(2));
                    shortTermBuckets[label]['budget'] -= reduction;
                    shortTermBuckets[label]['balance'] -= reduction;
                }
            }
        }
    }

    //for any bucket that has less than $50 balance remaining, reduce the budget to make the balance zero, 
    // and move the remaining amount to bucket with the most balance
    for (const label in shortTermBuckets) {
        const bucket = shortTermBuckets[label];
        bucket['percentLeft'] = Math.round(((bucket['balance'] / (bucket['budget'] + (bucket['credits'] || 0))) || 0) * 100);

        if (bucket['percentLeft'] < 5) {
            const amountToMove = Math.min(bucket['budget'], bucket['balance']);
            bucket['budget'] -= amountToMove;
            bucket['balance'] = 0;
            bucket['status'] = 'spent'; // Mark the bucket as spent

            // Find the bucket with the most balance to move the remaining amount
            const targetBucket = Object.values(shortTermBuckets).reduce((max, b) => (b.balance > max.balance ? b : max), { balance: 0 });
            if (targetBucket !== bucket && targetBucket.balance > 0) {
                targetBucket['budget'] += amountToMove;
                targetBucket['balance'] += amountToMove;
            }
        }
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