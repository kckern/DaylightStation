

import { readFileSync, writeFileSync } from 'fs';
import { getTransactions } from '../../lib/buxfer.js';    
import yaml from 'js-yaml';
import moment from 'moment';


const budgetPath = 'data/budget/budget.yml';

(async () => {

    const {budget} = yaml.load(readFileSync(budgetPath, 'utf8'));    
    const [{timeframe:{start, end}, accounts}] = budget;
    const startDate = moment(start).format('YYYY-MM-DD');
    const endDate = moment(end).format('YYYY-MM-DD');
    const transactions = await getTransactions({startDate, endDate, accounts});
    //save to transactions.yml
    writeFileSync('data/budget/transactions.yml', yaml.dump({transactions}));

})();
