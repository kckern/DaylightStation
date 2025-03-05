import axios from 'axios';
import yaml from 'js-yaml';
import { readFileSync, writeFileSync } from 'fs';
import { getTransactions, addTransaction } from '../../lib/buxfer.mjs';


const __appDirectory = `/${(new URL(import.meta.url)).pathname.split('/').slice(1, -4).join('/')}`;
const configpath = `${__appDirectory}/config.app.yml`;
const secretspath = `${__appDirectory}/config.secrets.yml`;
const {  PAYROLL_BASE, PAYROLL_AUTHKEY, PAYROLL_AUTH, PAYROLL_COMPANY, PAYROLL_EMPLOYEE } = yaml.load(readFileSync(secretspath, 'utf8'));
const {  buxfer: {payroll_account_id, direct_deposit_account_id} } = yaml.load(readFileSync(configpath, 'utf8'));



(async () => {

    const pastPaycheckData = yaml.load(readFileSync('data/budget/payroll.yml', 'utf8'));
    const pastDates = Object.keys(pastPaycheckData.paychecks);

    const url = `https://${PAYROLL_BASE}/${PAYROLL_COMPANY}/${PAYROLL_EMPLOYEE}/paychecks`;
    console.log(url);
    const options = {
        method: 'GET',
        url,
        headers: {
          cookie: `${PAYROLL_AUTHKEY}=${PAYROLL_AUTH}`
        }
      };
      try{
        
      const response = await axios.request(options);
      const checks = response.data.data.checkSummaries;
      const paychecks = {};
      const checkCount = checks.length;
      for(const check of checks) {
        const i = (checks.indexOf(check) + 1);
        const {id,checkKey:{payEndDt}} = check;

        const alreadyRetrieved = pastDates.includes(payEndDt);
        if(alreadyRetrieved) {
          paychecks[payEndDt] = pastPaycheckData.paychecks[payEndDt];
          console.log(`Skipping paycheck for ${payEndDt} (${i}/${checkCount})`);
          continue;
        }
        const checkUrl = `https://${PAYROLL_BASE}/${PAYROLL_COMPANY}/${PAYROLL_EMPLOYEE}/paycheck-details/${id}`;
        const checkOptions = {
            method: 'GET',
            url: checkUrl,
            headers: {
              cookie: `${PAYROLL_AUTHKEY}=${PAYROLL_AUTH}`
            }
          };
          try{
            const checkResponse = await axios.request(checkOptions);
            const date = checkResponse.data.data.header.payEndDt;
            paychecks[date] = checkResponse.data.data;
            console.log(`Got paycheck for ${date}`);
          }
          catch(e) {
              const errorCode = e.response.status;
              console.log(`Error [${errorCode}] getting paycheck for ${id} (${i}/${checkCount})`);
          }

            //sleep for 1 second to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 3000));
      }
      if(Object.keys(paychecks).length !== checkCount)  return console.log('Error: Not all paychecks were retrieved');
        const paychecksPath = 'data/budget/payroll.yml';
        const paychecksYml = yaml.dump({paychecks});
        writeFileSync(paychecksPath, paychecksYml);


        //TODO: UPLOAD TO BUXFER
        //load dict
        const {mapping} = yaml.load(readFileSync('data/budget/payrollDict.yml', 'utf8'));
        
        let debits = [];
        let credits = [];
        let transfers = [];
        
        for(const date of Object.keys(paychecks)){
            const {header:{checkDt}, detail} = paychecks[date];
            const {key,taxData,earns,taxWithholdings,preTaxDedns,postTaxDedns,employerBenefits,employerBenefitsTaxable,employerBenefitsNonTaxable,totals,ptos,netPayDistributions,directDepositDistributions,flsaDetails} = detail;
            if(!checkDt) console.log('Error: No check date on date: ', date);
            function mapAndFilterTransactions(transactions, mapping, checkDt) {
              return transactions
                .map(i => ({ desc: i.desc || i.taxDesc || i.curEarnsDesc, amount: parseFloat(i.curTaxes || i.curDedns || i.curEarnsEarn), date: checkDt }))
                .filter(i => !!i.amount)
                .map(i => {
                  const match = mapping.find(m => i.desc.includes(m.input));
                  if (match && match.exclude) return null;
                  if (!match) return i;
                  return { ...i, desc: match.desc, category: match.cat };
                })
                .filter(i => !!i);
            }
            
            const currentDebits = mapAndFilterTransactions([...preTaxDedns, ...postTaxDedns, ...taxWithholdings], mapping, checkDt);
            const currentCredits = mapAndFilterTransactions(earns, mapping, checkDt);

            const netAmount = - parseFloat(totals.curNetPay);
            
            debits = debits.concat(currentDebits);
            credits = credits.concat(currentCredits);
            transfers.push({ desc: 'Net Pay', amount: netAmount, date: checkDt, category: 'Payroll' , type: 'transfer', toAccountId: direct_deposit_account_id });
        }
        const allTransactions = [...debits.map(i=>({...i, amount: -i.amount})), ...credits, ...transfers].sort((a,b) => new Date(a.date) - new Date(b.date));

        //write all transactions to file
        const transactionsPath = 'data/budget/tmp.yml';
        const transactionsYml = yaml.dump({transactions: allTransactions});
        writeFileSync(transactionsPath, transactionsYml);

        // get from allTransactions
        const startDate   = allTransactions.sort((a,b) => new Date(a.date) - new Date(b.date))[0].date;
        const endDate     = allTransactions.sort((a,b) => new Date(b.date) - new Date(a.date))[0].date;
        //Get Buxfer Payroll Transactions
        const buxferTransactions = await getTransactions({startDate, endDate, accounts: ['Payroll']});

        const transactionNeedingUpload = allTransactions.filter(t => {
          let needsUpload = false;
          let amount = Math.abs(t.amount);
          const matches = buxferTransactions.filter(b => b.date === t.date && b.amount === amount);
          if(matches.length === 0) needsUpload = true;
           return needsUpload;
        });

        console.log(`Transactions needing upload: ${transactionNeedingUpload.length}`);
       for(const transaction of transactionNeedingUpload) {
           console.log(`Uploading ${transaction.date} ${transaction.amount} ${transaction.desc} [${transaction.category}]`);
           const insert = {
            accountId: payroll_account_id,
            amount: transaction.amount,
            date: transaction.date,
            description: transaction.desc,
            tags: [transaction.category],
            type: transaction.type ?  transaction.type : transaction.amount < 0 ? 'expense' : 'income',
            toAccountId: transaction.toAccountId,
            status: 'cleared'
          };
            if(!insert.toAccountId) delete insert.toAccountId;
            else insert['fromAccountId'] = payroll_account_id;
            const r = await addTransaction(insert);
            const {id} = r;
            console.log(`\t🟢 Transaction added: https://www.buxfer.com/transactions?tids=${id}`);

       }


      }catch(e) {
        const errorCode = e.response?.status;
        if(!errorCode) return console.error(`Error Message: ${e.message}`);
        else if(errorCode === 401) return console.error('Error: Please fetch new auth token');
       // else if(errorCode) return console.error(`Error [${errorCode}] fetching paychecks`);
        console.error(`Error [${errorCode}] fetching paychecks`);
        console.error(e.message);
      }
}
)();

