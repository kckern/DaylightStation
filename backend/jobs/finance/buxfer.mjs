

import { readFileSync, writeFileSync } from 'fs';
import { deleteTransactions, getTransactions } from '../../lib/buxfer.js';    
import yaml from 'js-yaml';
import moment from 'moment';


const budgetPath = 'data/budget/budget.config.yml';

(async () => {


    const {budget} = yaml.load(readFileSync(budgetPath, 'utf8'));    
    const [{timeframe:{start, end}, accounts}] = budget;
    const startDate = moment(start).format('YYYY-MM-DD');
    const endDate = moment(end).format('YYYY-MM-DD');

    await deleteTransactions({accountId: 732539, matchString: 'FDIC', startDate, endDate});

    //process.exit();

    const transactions = await getTransactions({startDate, endDate, accounts});
    //save to transactions.yml
    writeFileSync('data/budget/transactions.yml', yaml.dump({transactions}));

})();
