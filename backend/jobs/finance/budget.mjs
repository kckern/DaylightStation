

import { readFileSync, writeFileSync } from 'fs';
//import { getTransactions } from '../../lib/buxfer.js';    
import yaml from 'js-yaml';
import moment from 'moment';


function buildBudget()
{
    const {budget} = yaml.load(readFileSync('data/budget/budget.yml', 'utf8'));
    budget.timeframe.start = moment.utc(budget.timeframe.start).format('YYYY-MM-DD');
    budget.timeframe.end = moment.utc(budget.timeframe.end).format('YYYY-MM-DD');
    const {start: budgetStart, end: budgetEnd} = budget.timeframe;
    const accounts = budget.accounts;
    const {monthlyBudget, periodicBudgetAmount, monthlyCategories} = buildMonthlyBudget(budget.monthly,budget.income, budgetStart, budgetEnd);
    const {periodicBudget, periodicCategories} = buildPeriodicBudget(periodicBudgetAmount, budget.periodic);
    return {budgetStart, budgetEnd, accounts, monthlyBudget, monthlyCategories, periodicBudget, periodicCategories};
}

function buildPeriodicBudget(periodicBudgetAmount, periodic){
    const periodicBudget = periodic.map(({category, amount}) => {return {category, amount}});
    const sumOfAllAmounts = periodicBudget.map(({amount}) => amount).reduce((acc, val) => acc + parseInt(val), 0);
    const remainingAmount = periodicBudgetAmount - sumOfAllAmounts;
    if(remainingAmount > 0){ periodicBudget.push({category: 'Unbudgeted', amount: remainingAmount}); }
    else{
        //substract from largest categories, cascading down
        let remaining = Math.abs(remainingAmount);
        periodicBudget.sort((a,b) => b.amount - a.amount);
        for(let i = 0; i < periodicBudget.length; i++){
            if(remaining <= 0) break;
            const {amount} = periodicBudget[i];
            const newAmount = amount - remaining;
            if(newAmount >= 0){
                periodicBudget[i].amount = newAmount;
                break;
            }
            else{
                periodicBudget[i].amount = 0;
                remaining += newAmount;
            }
        }

    }
    const periodicCategories = Array.from(new Set(periodic.flatMap(({category}) => 
        category.split(',').map(cat => cat.trim())
    ))).sort();
    return {periodicBudget,periodicCategories}
}


function buildMonthlyBudget(monthlyBudget, incomeData, budgetStart, budgetEnd){
    const months = Array.from({ length: moment(budgetEnd).diff(moment(budgetStart), 'months') + 1 }, 
            (_, i) => moment(budgetStart).add(i, 'months').format('YYYY-MM'));
    const [{salary,exceptions:salaryExceptions}, {extra:extraIncome}] = incomeData;
    const budget = {};
    let monthlyCategories = [];
    for(const month of months){
        // Load Budget
        budget[month] = budget[month] || {income: 0, expense:0,  surplus: 0, categories: {}};

        //Load Income
        budget[month].income += salaryExceptions?.[month]===null ? 0 : salaryExceptions?.[month] || salary;
        const extraIncomeThisMonth = extraIncome.filter(({months}) => months.includes(month)).reduce((acc, {amount}) => acc + amount, 0);
        budget[month].income += extraIncomeThisMonth;

        //Load Monthy Expenses
        for(const item of monthlyBudget){
            const {category, amount, months, exceptions} = item;
            const splitCategories = category.split(',').map(cat => cat.trim());
            monthlyCategories = [...monthlyCategories, ...splitCategories];
            if(months && !months.includes(month)) continue;
            if(exceptions && exceptions[month]===null) continue;
            budget[month].categories[category] = budget[month]?.categories?.[category] || 0;
            budget[month].categories[category] += exceptions?.[month]===null ? 0 : exceptions?.[month] || amount;
        }
        //Any remaining income is put into short term savings
        budget[month].expense = Object.keys(budget[month].categories)
            .map(category=>budget[month].categories[category])
            .reduce((acc, val) => acc + parseInt(val), 0);

        budget[month].surplus = budget[month].income - budget[month].expense;
    }

    const periodicBudgetAmount = months.map(month => budget[month].surplus).reduce((acc, val) => acc + parseInt(val), 0);
    //dedupe and sort categories
    monthlyCategories = [...new Set(monthlyCategories)].sort();

    return {monthlyBudget:budget, periodicBudgetAmount, monthlyCategories};
}
const isOverlap = (arr1, arr2) => arr1.some(tag => arr2.includes(tag));


(async () => {

    const emptyBudget = buildBudget();
    //const transactions = await getTransactions();
    //const fullBudget = fillBudgetWithTransactions(budget);


    writeFileSync('data/budget/finances.yml', yaml.dump({budget}));
})();


const fillBudgetWithTransactions = (budget) => {


    const transactions = yaml.load(readFileSync('data/budget/transactions.yml', 'utf8')).transactions
        .filter(({date, accountName}) => date >= startDate && date <= endDate && accounts.includes(accountName));

    for(let transaction of transactions) {
        const {description, amount, date, accountName, tagNames: tags} = transaction;
        const isMonthly = isOverlap(tags, monthlyCategories.flat());
        const isPeriodic = isOverlap(tags, periodicCategories.flat());
        const isUncategorized = !isMonthly && !isPeriodic;
        const budgetKey = isMonthly ? 'monthly' : 'periodic';
        const category = categoryMap[tags.find(tag => categoryMap[tag])] || 'Uncategorized';
        if(isUncategorized){
            const alreadyMadeUncategorized = budget[budgetKey].some(({category}) => category === 'Uncategorized');
            if(!alreadyMadeUncategorized) budget[budgetKey].push({category: 'Uncategorized', amount: 0, spent: 0, remaining: 0, transactions: []});
        }
        const categoryIndex = budget[budgetKey].map(({category}) => category).indexOf(category);
        console.log({tags,category, categoryIndex, budgetKey})
        const categoryExists = categoryIndex > -1;
        if(!categoryExists) {
            console.log(`Category ${category} does not exist in ${budgetKey}`);
            continue;
        }
        budget[budgetKey][categoryIndex].spent = (budget[budgetKey][categoryIndex].spent || 0) + amount;
        budget[budgetKey][categoryIndex].remaining = budget[budgetKey][categoryIndex].remaining || budget[budgetKey][categoryIndex].amount;
        budget[budgetKey][categoryIndex].remaining -= amount;
        budget[budgetKey][categoryIndex].transactions = budget[budgetKey][categoryIndex]?.transactions || [];
        budget[budgetKey][categoryIndex].transactions.push(transaction);
        //round spent and remaining to 2 decimal places
        budget[budgetKey][categoryIndex].spent = Math.round(budget[budgetKey][categoryIndex].spent * 100) / 100;
        budget[budgetKey][categoryIndex].remaining = Math.round(budget[budgetKey][categoryIndex].remaining * 100) / 100;

    }

    const totalSpent = budget.monthly.concat(budget.periodic).reduce((acc, {spent}) => acc + spent, 0);
    const totalRemaining = budget.monthly.concat(budget.periodic).reduce((acc, {remaining}) => acc + remaining, 0);

    

    //save to finances.yml
    writeFileSync('data/budget/finances.yml', yaml.dump({budget}));

    console.log({totalSpent, totalRemaining});
    return budget;
}