

import { readFileSync, writeFileSync } from 'fs';
import { getTransactions } from '../lib/buxfer.js';    
import yaml from 'js-yaml';


(async () => {

    const {budget} = yaml.load(readFileSync('data/budget/budget.yml', 'utf8'));
    const startDate = budget.timeframe.start.toISOString().slice(0, 10);
    const endDate = budget.timeframe.end.toISOString().slice(0, 10);
    const accounts = budget.accounts;

    //monthly: - category: Mortgage amount: 5475 labels: [housing]
    const transactions = yaml.load(readFileSync('data/budget/transactions.yml', 'utf8')).transactions
        .filter(({date, accountName}) => date >= startDate && date <= endDate && accounts.includes(accountName));
    const monthlyCategories = budget.monthly.map(({category, labels}) => [category, ...labels]);
    const periodicCategories = budget.periodic.map(({category, labels}) => [category, ...labels]);

    const categoryMap = budget.monthly.concat(budget.periodic).reduce((acc, {category, labels}) => {
        for(let label of labels) {
            acc[label] = category;
            acc[category] = category;
        }
        return acc;
    }
    , {});


    const isOverlap = (arr1, arr2) => arr1.some(tag => arr2.includes(tag));

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


})();
