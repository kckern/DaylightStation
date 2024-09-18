

import { readFileSync, writeFileSync } from 'fs';
//import { getTransactions } from '../../lib/buxfer.js';    
import yaml from 'js-yaml';
import moment from 'moment';


function buildBudget(budget)
{
    budget.timeframe.start = moment.utc(budget.timeframe.start).format('YYYY-MM-DD');
    budget.timeframe.end = moment.utc(budget.timeframe.end).format('YYYY-MM-DD');
    const {start: budgetStart, end: budgetEnd} = budget.timeframe;
    const accounts = budget.accounts;
    const dayToDayCategories = budget.dayToDay.tags;
    const {monthlyBudget, shortTermBudgetAmount, monthlyCategories, dayToDayBudget, monthlyCategoryMap} = buildMonthlyBudget(budget.monthly,budget.dayToDay, budget.income, budgetStart, budgetEnd);
    const {shortTermBudget, shortTermCategories, shortTermCategoryMap} = buildshortTermBudget(shortTermBudgetAmount, budget.shortTerm);
    const {dayToDay} = budget;
    return {budgetStart, budgetEnd, accounts, dayToDayBudget, dayToDayCategories, monthlyBudget, monthlyCategories, shortTermBudget, shortTermCategories, shortTermCategoryMap, monthlyCategoryMap, shortTermBudgetAmount};
}
function buildshortTermBudget(shortTermBudgetAmount, shortTerm){
    const shortTermBudget = shortTerm.map(({tags, label, amount}) => {return {category:label, amount, tags}});
    const sumOfAllAmounts = shortTermBudget.map(({amount}) => amount).reduce((acc, val) => acc + parseInt(val, 10), 0);
    const remainingAmount = shortTermBudgetAmount - sumOfAllAmounts;
    if(remainingAmount > 0){ 
        shortTermBudget.push({category: 'Unbudgeted', amount: remainingAmount, tags: ['Shopping']});
    } else {
        // Subtract from largest categories, cascading down
        let remaining = Math.abs(remainingAmount);
        shortTermBudget.sort((a, b) => b.amount - a.amount);
        for(let i = 0; i < shortTermBudget.length; i++){
            if(remaining <= 0) break;
            const {amount} = shortTermBudget[i];
            const newAmount = amount - remaining;
            if(newAmount >= 0){
                shortTermBudget[i].amount = newAmount;
                break;
            } else {
                shortTermBudget[i].amount = 0;
                remaining += newAmount;
            }
        }
    }
    const shortTermCategoryMap = {};
    shortTermBudget.forEach(({ category, tags }) => {
      tags.forEach(tag =>  shortTermCategoryMap[tag] = category);
      shortTermCategoryMap[category] = category;
    });
    const shortTermCategories = shortTermBudget.map(({category,tags}) => [category,...tags]).flat();
    return {shortTermBudget, shortTermCategories,shortTermCategoryMap};
}


function buildMonthlyBudget(monthlyBudget, dayTodayData, incomeData, budgetStart, budgetEnd){

    const {amount:dayToDayAmount} = dayTodayData;
    const months = Array.from({ length: moment(budgetEnd).diff(moment(budgetStart), 'months') + 1 }, 
            (_, i) => moment(budgetStart).add(i, 'months').format('YYYY-MM'));
    const [{salary, payCheckCount, payFrequencyInDays, firstPaycheckDate, exceptions: salaryExceptions}, {extra: extraIncome}] = incomeData;

    const salaryExceptionsDict = salaryExceptions.reduce((acc, val) => {
        const [key, value] = Object.entries(val)[0];
        acc[key] = value;
        return acc;
    }, {}) || {};

    // make array of paychecks
    const payDays = Array.from({ length: payCheckCount }, (_, i) => moment(firstPaycheckDate).add(i * payFrequencyInDays, 'days').format('YYYY-MM-DD'));
    const budget = {};
    const dayToDayBudget = {};

    const buildFutureMonth = (month) => {

        //TODO: Handle a raise in the middle of the year
        const paycheckAmount = parseFloat(salary / payCheckCount).toFixed(2);

        const payDaysThisMonth = payDays.filter(payDay => moment(payDay).isBetween(moment(month).startOf('month'), moment(month).endOf('month'), null, '[]'));
        const payAmountsThisMonth = payDaysThisMonth.map(_ => paycheckAmount);
        const monthlySalary = payAmountsThisMonth.reduce((acc, val) => acc + parseInt(val, 10), 0);


        // Handle Day-to-Day Spending
        dayToDayBudget[month] = {amount: dayToDayAmount, transactions: []};
        
        // Load Budget
        budget[month] = budget[month] || {amount:0, income: 0, spent: 0, gained:0, netspent:0, remaining:0, categories: {}};

        // Load Income
        budget[month].income = parseFloat(budget[month].income);
        budget[month].income += salaryExceptionsDict?.[month] === null ? 0 : (salaryExceptionsDict?.[month] || monthlySalary);
        const extraIncomeThisMonth = extraIncome.filter(({months}) => months.includes(month)).reduce((acc, {amount}) => acc + amount, 0) || 0;
        budget[month].income += extraIncomeThisMonth;

        // Load Monthly Expenses
        let monthAmount = 0;
        for(const item of monthlyBudget){
            let {tags, label, amount, months, exceptions, frequency} = item;
            if(months && !months.includes(month)) continue;
            const exceptionDict = exceptions?.reduce((acc, val) => {
                const [key, value] = Object.entries(val)[0];
                acc[key] = value;
                return acc;
            }, {}) || {};

            const isExceptional = !!exceptionDict[month];
            const instanceCount = frequency === 'paycheck' ? payDaysThisMonth.length : 1;
            budget[month].categories[label] = budget[month].categories[label] || {amount: 0, remaining: 0, transactions: []};

            const amountToAdd = (exceptions?.[month] === null ? 0 : (exceptions?.[month] || amount)) * instanceCount;
            budget[month].categories[label].amount += amountToAdd;
            budget[month].categories[label].remaining += amountToAdd;
            monthAmount += amountToAdd;
        }
        budget[month].paychecks = payDaysThisMonth.map((date, i) => ({date, amount: parseFloat(payAmountsThisMonth[i])}));
        budget[month].amount = monthAmount;
    }

    for(const month of months){

        const currentMonthInt = parseInt(moment().format('YYYYMM'));
        const monthInt = parseInt(moment(month).format('YYYYMM'));
        if(monthInt >= currentMonthInt) buildFutureMonth(month);
        else budget[month] = {amount:0, income: 0, spent: 0, gained:0, netspent:0, remaining:0, categories: {}};
    }



    const shortTermBudgetAmount = months.map(month => budget[month].surplus).reduce((acc, val) => acc + parseInt(val, 10), 0);


    const monthlyCategoryMap = {};
    monthlyBudget.forEach(({ label, tags }) => {
      tags.forEach(tag =>  monthlyCategoryMap[tag] = label);
      monthlyCategoryMap[label] = label;
    });
    const monthlyCategories = monthlyBudget.map(({label,tags}) => [label,...tags]).flat().filter((v, i, a) => a.indexOf(v) === i);


    return {monthlyBudget: budget, shortTermBudgetAmount, monthlyCategories, dayToDayBudget, monthlyCategoryMap};
}


const isOverlap = (arr1, arr2) => {
  const match = arr1.find(tag => arr2.includes(tag));
  return match || false;
};

const shouldFilter = (transaction, {accounts, startDate, endDate}) => {
    const isInAccounts  = accounts.includes(transaction.accountName);
    const isAfterStart   = moment(transaction.date).isSameOrAfter(startDate);
    const isBeforeEnd    = moment(transaction.date).isSameOrBefore(endDate);
    const isOK = isInAccounts && isAfterStart && isBeforeEnd;
    if(!isOK) return false;
    return true;
};


const tallyTransactions = ({amount, transactions, category}) => {
    transactions = transactions || [];
    if(!transactions.length) return {amount, gained: 0, spent: 0, netspent: 0, remaining: amount, over: 0, transactions, planned: 0, category};
    const incomeTypes = ['income', 'investment sale'];
    const spent = parseFloat(transactions.reduce((acc, {transactionType, amount}) => acc + (!incomeTypes.includes(transactionType) ? amount : 0), 0).toFixed(2));
    const gained = parseFloat(transactions.reduce((acc, {transactionType, amount}) => acc + (incomeTypes.includes(transactionType) ? amount : 0), 0).toFixed(2));
    const roundedSpent = Math.round(spent * 100) / 100; // Round spent to nearest cent
    const remaining = Math.max(0,Math.round((amount - roundedSpent + gained) * 100) / 100); // Round remaining to nearest cent
    const over = Math.max(0, Math.round(((roundedSpent-gained) - amount) * 100) / 100); // Round over to nearest cent
    const planned = 0;
    amount = amount + gained;
    const netspent = parseFloat((spent - gained).toFixed(2));
    const r= {amount, gained, spent: roundedSpent, netspent, remaining, over, transactions, planned, category};
    if(!category) delete r.category;
    return r;
}

const fillBudgetWithTransactions = (budget) => {
    const {budgetStart, budgetEnd, accounts,  dayToDayCategories, monthlyCategories, shortTermCategoryMap, monthlyCategoryMap} = budget;
    const rawTransactions = yaml.load(readFileSync('data/budget/transactions.yml', 'utf8')).transactions;
    const transactions =  rawTransactions.filter((transaction)=>shouldFilter(transaction, {accounts, startDate: budgetStart, endDate: budgetEnd}));
    const checkIfTransfer = ({tagNames, type}) => {
        if(/(transfer|investment)/i.test(type)) return true;
        if(isOverlap(tagNames, ['Transfer','Payroll','Salary','Earnings'])) return true;
        return false;
    };
    const checkIfIncome = ({tagNames, type, expenseAmount}) => {
        if(isOverlap(tagNames, ['Salary','Bonus'])) return true;
        return false;
    };



    for(let transaction of transactions) {

        const {description, amount, date, accountName, tagNames: tags} = transaction;
        const month = moment(date).format('YYYY-MM');
        const isDayToDay    = isOverlap(tags, [...dayToDayCategories, "[Daily]"]);
        const isMonthly     = isOverlap(tags, [...monthlyCategories, "[Monthly]"]);
        const isIncome     = checkIfIncome(transaction);
        const isTransfer    = !isIncome && checkIfTransfer(transaction);


        const bucketKey = isIncome ? "income" : isTransfer ? "transfer" : isDayToDay ? 'dayToDay' : isMonthly ? 'monthly' : 'shortTerm';


        const addTransaction = (month, bucket, transaction) => {

            budget['dayToDayBudget'][month] = budget['dayToDayBudget'][month] || {amount: 0, transactions: []};

            const {tags:category} = transaction || {}; //todo: only 1 tag
            if(bucket === 'income') {
                budget['monthlyBudget'][month]['income_transactions'] = budget['monthlyBudget'][month]['income_transactions'] || [];
                budget['monthlyBudget'][month]['income_transactions'].push(transaction);
            }
            if(bucket === 'transfer') {
                budget['transfers'] = budget['transfers'] || {transactions: []};
                budget['transfers'].transactions.push(transaction);
            }
            if(bucket === 'dayToDay') budget['dayToDayBudget'][month].transactions.push(transaction);
            if (bucket === 'monthly') {
               const monthlyLabel = monthlyCategoryMap[category];
               if(!monthlyLabel) {
                bucket = 'shortTerm';
               }
               else{
                budget['monthlyBudget'][month].categories[monthlyLabel] = budget['monthlyBudget'][month].categories[monthlyLabel] 
                    || { transactions: [] , amount: 0, category: monthlyLabel};
                budget['monthlyBudget'][month].categories[monthlyLabel]['transactions'] = 
                    budget['monthlyBudget'][month].categories[monthlyLabel]?.['transactions'] || [];
                budget['monthlyBudget'][month].categories[monthlyLabel].transactions.push(transaction);
               }
            }
            if(bucket === 'shortTerm') {

                const shortTermLabel = shortTermCategoryMap[category] || "Unbudgeted";
                const shortTermKey = Object.keys(budget['shortTermBudget']).find(key => budget['shortTermBudget'][key].category === shortTermLabel);
                budget['shortTermBudget'][shortTermKey] = budget['shortTermBudget'][shortTermKey] || { transactions: [] , amount: 0, category: shortTermLabel};
                budget['shortTermBudget'][shortTermKey]['transactions'] = budget['shortTermBudget'][shortTermKey]?.['transactions'] || [];
                budget['shortTermBudget'][shortTermKey].transactions.push(transaction);

              }
            }
        addTransaction(month, bucketKey, transaction);
        
    }

    // Tally up Day to Day Spending
    for (const month in budget["dayToDayBudget"]) {
        budget["dayToDayBudget"][month] = tallyTransactions(budget["dayToDayBudget"][month]);
        budget["dayToDayBudget"][month] = fillDayToDayTransactions(budget["dayToDayBudget"][month], month);

    }
    // Tally up Monthly Expenses
    function processCategories(monthString, budget) {
        const month = budget["monthlyBudget"][monthString];
        const isFuture = moment(monthString).isAfter(moment().format('YYYY-MM'));
        month.spent = 0;
        for (const category in month.categories) {
            month.categories[category] = tallyTransactions(month.categories[category]);
            month.spent += month.categories[category].spent;
            month.gained += month.categories[category].gained;
            month.categories[category].amount += month.categories[category].gained;
        }
        const {amount,netspent} = budget["dayToDayBudget"][monthString];
        const dayToDayNetspent = isFuture ? amount : netspent;

        const monthNetSpent = parseFloat((
            
            isFuture? month.amount :month.spent - month.gained
        
        ).toFixed(2));
        const sumofPaychecks = month.paychecks?.reduce((acc, {amount}) => acc + amount, 0) || 0;
        const monthTopLine = parseFloat((parseFloat(month.income) || parseFloat(sumofPaychecks) || 0).toFixed(2));        
        const surplus = parseFloat((
            monthTopLine - monthNetSpent - dayToDayNetspent
        ).toFixed(2));
        month.summary = {
            monthTopLine,
            monthNetSpent,
            dayToDaySpentOrBudgeted: dayToDayNetspent,
            surplus,

        }
        budget["monthlyBudget"][monthString] = month;
    }
    
    for (const month in budget["monthlyBudget"]) processCategories(month, budget);
    const balance = false;
    const {shortTermBudget, shortTermStatus} = 
        balanceShortTermBudget(budget["shortTermBudget"], budget["shortTermBudgetAmount"], balance);
    budget["shortTermBudget"] = shortTermBudget;
    budget["shortTermStatus"] = shortTermStatus;
    delete budget["shortTermBudgetAmount"];

    return budget;
};


const balanceShortTermCategories = (shortTermBudget) => {

    const totalTransactionCount = shortTermBudget.reduce((acc, {transactions}) => acc + transactions.length, 0);


    const overages = shortTermBudget.filter(i => i.over > 0).sort((a, b) => b.over - a.over);

    for (const overage of overages) {

        const amountOver = overage.over;
        const [topSurplus] = shortTermBudget.filter(i => i.remaining > 0).sort((a, b) => b.remaining - a.remaining);
        console.log(`\n${overage.category} is over by ${amountOver}, it only had ${overage.amount} planned, but already spent ${overage.spent}`);
        if(!topSurplus) continue;
        if(topSurplus.remaining < amountOver) continue;
        const overKey = shortTermBudget.findIndex(i => i.category === overage.category);
        const surplusKey = shortTermBudget.findIndex(i => i.category === topSurplus.category);
        //handle over
        shortTermBudget[overKey].amount += amountOver;
        shortTermBudget[overKey].over = 0;
        //handle surplus
        shortTermBudget[surplusKey].amount -= amountOver;
        shortTermBudget[surplusKey].remaining = Math.max(0, shortTermBudget[surplusKey].remaining - amountOver);
        console.log(`\tMoved ${amountOver} from ${topSurplus.category} to ${overage.category}`);
    }


    return shortTermBudget;
};


const balanceShortTermBudget = (shortTermBudget, shortTermBudgetAmount, balance) => {

    //write out the short term budget to file yml and fs
    writeFileSync('data/budget/shortTermBudget.yml', yaml.dump(shortTermBudget));
    

    shortTermBudgetAmount = parseFloat(shortTermBudgetAmount.toFixed(2));

    for (const catKey in shortTermBudget) {
        shortTermBudget[catKey] = tallyTransactions(shortTermBudget[catKey]);
    }

    if(balance)
    shortTermBudget = balanceShortTermCategories(shortTermBudget);

    const shortTermStatus = { amount : shortTermBudgetAmount, gained:0, spent: 0, remaining: 0, over: 0};
    //delete budget["shortTermBudgetAmount"];
    shortTermStatus["gained"] = parseFloat(shortTermBudget.reduce((acc, {gained}) => acc + gained, 0).toFixed(2));
    shortTermStatus["spent"] = parseFloat(shortTermBudget.reduce((acc, {spent}) => acc + spent, 0).toFixed(2));
    shortTermStatus["remaining"] = parseFloat((shortTermStatus["amount"] - shortTermStatus["spent"]).toFixed(2));
    shortTermStatus["over"] = parseFloat(Math.max(0, shortTermStatus["spent"] - shortTermStatus["amount"]).toFixed(2));

    shortTermBudget = shortTermBudget.sort((a, b) => {
        if (a.category === "Unbudgeted") return 1;
        if (b.category === "Unbudgeted") return -1;
        return b.amount - a.amount;
    });

    //remove items with no amount and no transactions
    shortTermBudget = shortTermBudget.filter(({amount, transactions}) => amount > 0 || transactions.length > 0);

    return {shortTermBudget, shortTermStatus};
}



function fillDayToDayTransactions(monthlyDayToDayBudget, month){

    const {transactions} = monthlyDayToDayBudget;
    const todaysDate = moment().format('YYYY-MM-DD');
    const firstDay = moment(month).format('YYYY-MM-01');
    const lastDay = moment(month).endOf('month').format('YYYY-MM-DD');
    const numDays = moment(lastDay).diff(firstDay, 'days') + 1;
    const dailyBudget = Array.from({ length: numDays }, (_, i) => i +1);

    // Calculate daily balances
    const dailyBalances = {};
    const averageDailySpend = transactions.filter(({date}) => moment(date).isBefore(todaysDate))
    .reduce((acc, {amount, transactionType}) => acc + (transactionType !== 'income' ? amount : 0), 0) / dailyBudget.length;

    for(const day of dailyBudget){
        const date = `${month}-${day.toString().padStart(2, '0')}`;
        const prevDate = day ===1 ? null : moment(date).subtract(1, 'days').format('YYYY-MM-DD') || null;
        const isFuture = moment(date).isAfter(todaysDate);
        const startingBalance = dailyBalances[prevDate] ? parseFloat(dailyBalances[prevDate].endingBalance.toFixed(2)) : parseFloat(monthlyDayToDayBudget.amount.toFixed(2));
        dailyBalances[date] = {startingBalance, endingBalance: 0, spent: 0, gained: 0};
        if(!isFuture){
            const dailyTransactions = transactions.filter(({date: transactionDate}) => transactionDate === date);
            const dailySpend = dailyTransactions.reduce((acc, {amount, transactionType}) => acc + (transactionType !== 'income' ? amount : 0), 0);
            const dailyGain = dailyTransactions.reduce((acc, {amount, transactionType}) => acc + (transactionType === 'income' ? amount : 0), 0);
            dailyBalances[date].spent = parseFloat(dailySpend.toFixed(2));
            dailyBalances[date].gained = parseFloat(dailyGain.toFixed(2));
            dailyBalances[date].endingBalance = parseFloat((startingBalance + dailyGain - dailySpend).toFixed(2));
        }
        else{
            dailyBalances[date].spent = parseFloat(averageDailySpend.toFixed(2));
            dailyBalances[date].gained = 0;
            dailyBalances[date].endingBalance = parseFloat((startingBalance - averageDailySpend).toFixed(2));
            dailyBalances[date].isFuture = true;
        }
    }

    //set amount to amount - gained
    monthlyDayToDayBudget.amount = monthlyDayToDayBudget.amount - monthlyDayToDayBudget.gained;


    monthlyDayToDayBudget.dailyBalances = dailyBalances;

    return monthlyDayToDayBudget;
}



function balanceBudget(budget){

    return budget;
    //tighten each of the monthly items in the past
        //remove empty ones, change amounts to match acutals, and accrue the new remainder
    for(const month in budget["monthlyBudget"]){
        const {categories} = budget["monthlyBudget"][month];
        const isPast = moment(month).isBefore(moment().format('YYYY-MM'));
        if(!isPast) continue;

        //recalculate income from actual transactions
        const incomeTransactions = budget["monthlyBudget"][month]["income_transactions"];
        const income = incomeTransactions?.reduce((acc, {amount}) => acc + amount, 0) || 0;
        budget["monthlyBudget"][month].income = income;

        //Reset monthly budgets to match actuals
        for(const category in categories){
            const { spent, gained, transactions} = categories[category];
            const amount = spent - gained;
            if(transactions.length === 0){
                delete budget["monthlyBudget"][month].categories[category];
            } else {
                budget["monthlyBudget"][month].categories[category].amount = amount;
                budget["monthlyBudget"][month].categories[category].spent = spent;
                budget["monthlyBudget"][month].categories[category].over = 0;
                budget["monthlyBudget"][month].categories[category].planned = 0;
                budget["monthlyBudget"][month].categories[category].balanced = true;
            }
        }


        const sumFields = (field) => parseFloat(Object.values(budget["monthlyBudget"][month].categories).reduce((acc, { [field]: val }) => acc + val, 0).toFixed(2));
        budget["monthlyBudget"][month].spent = sumFields('spent');
        budget["monthlyBudget"][month].gained = sumFields('gained');
        budget["monthlyBudget"][month].remaining = sumFields('remaining');
        budget['monthlyBudget'][month].netspent = sumFields('spent') - sumFields('gained');

    }
    //gather the actual past income and projected future income
    const periodSurplus = Object.values(budget["monthlyBudget"]).reduce((acc, {summary}) => acc + summary.surplus, 0);



    //rebalance short term budget with the new surplus
    const {shortTermBudget, shortTermStatus} = 
        balanceShortTermBudget(budget["shortTermBudget"], periodSurplus, true);
    budget["shortTermBudget"] = shortTermBudget;
    budget["shortTermStatus"] = shortTermStatus;



    return budget;
}


(async () => {
    const budgetConfig = (yaml.load(readFileSync('data/budget/budget.yml', 'utf8'))).budget.sort((a, b) => a.timeframe.start - b.timeframe.start);
    const budgets = {};
    for(const budget of budgetConfig){
        const emptyBudget = buildBudget(budget);
        const budgetStart = moment(emptyBudget.budgetStart).format('YYYY-MM-DD');
        const fullBudget = fillBudgetWithTransactions(emptyBudget);
        const balancedBudget = balanceBudget(fullBudget);

        delete balancedBudget.shortTermCategoryMap;
        delete balancedBudget.monthlyCategoryMap;
        delete balancedBudget.dayToDayCategories;
        delete balancedBudget.monthlyCategories;
        delete balancedBudget.shortTermCategories;


        budgets[budgetStart] = balancedBudget;
    }



    writeFileSync('data/budget/finances.yml', yaml.dump(budgets));
})();

