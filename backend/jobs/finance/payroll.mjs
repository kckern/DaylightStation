import axios from '../../lib/http.mjs';
import { getTransactions, addTransaction } from '../../lib/buxfer.mjs';
import { loadFile, saveFile } from '../../lib/io.mjs';
import { configService } from '../../lib/config/ConfigService.mjs';
import { createLogger } from '../../lib/logging/logger.js';

const payrollLogger = createLogger({
  source: 'backend',
  app: 'payroll'
});

// Get payroll config from ConfigService (single source of truth)
const getPayrollConfig = () => {
  // Get from user auth via ConfigService
  const auth = configService.getUserAuth('payroll') || {};

  // Map config file fields to expected names
  // Config file: auth_cookie, base_url, company, employee_id, cookie_name
  const secrets = {
    PAYROLL_BASE: auth.base_url || auth.base,
    PAYROLL_AUTHKEY: auth.cookie_name || auth.authkey,
    PAYROLL_AUTH: auth.auth_cookie || auth.auth,
    PAYROLL_COMPANY: auth.company,
    PAYROLL_EMPLOYEE: auth.employee_id || auth.employee
  };

  const appConfig = {
    payroll_account_id: process.env.buxfer?.payroll_account_id,
    direct_deposit_account_id: process.env.buxfer?.direct_deposit_account_id
  };

  return { ...secrets, ...appConfig };
};

const  payrollSync = async (key,req) => {

  payrollLogger.info('payroll.sync.start', { key });
  const config = getPayrollConfig();
  const { PAYROLL_BASE, PAYROLL_AUTHKEY, PAYROLL_AUTH, PAYROLL_COMPANY, PAYROLL_EMPLOYEE, payroll_account_id, direct_deposit_account_id } = config;

    const authKey = req.query.token || PAYROLL_AUTH;

    const pastPaycheckData =     loadFile('households/default/apps/finances/payroll');

    const pastDates = Object.keys(pastPaycheckData.paychecks);

    const url = `https://${PAYROLL_BASE}/${PAYROLL_COMPANY}/${PAYROLL_EMPLOYEE}/paychecks`;
    payrollLogger.info('payroll.fetch.url', { url });
    const options = {
        method: 'GET',
        url,
        headers: {
          cookie: `${PAYROLL_AUTHKEY}=${authKey}`
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
          payrollLogger.info('payroll.paycheck.skip', { payEndDt, index: i, total: checkCount });
          continue;
        }
        const checkUrl = `https://${PAYROLL_BASE}/${PAYROLL_COMPANY}/${PAYROLL_EMPLOYEE}/paycheck-details/${id}`;
        const checkOptions = {
            method: 'GET',
            url: checkUrl,
            headers: {
              cookie: `${PAYROLL_AUTHKEY}=${authKey}`
            }
          };
          try{
            const checkResponse = await axios.request(checkOptions);
            const date = checkResponse.data.data.header.payEndDt;
            paychecks[date] = checkResponse.data.data;
            payrollLogger.info('payroll.paycheck.fetched', { date, index: i, total: checkCount });
          }
          catch(e) {
              const errorCode = e.response.status;
              payrollLogger.warn('payroll.paycheck.fetchError', { errorCode, id, index: i, total: checkCount, message: e?.message || e });
          }

            //sleep for 1 second to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 3000));
      }
    //  if(Object.keys(paychecks).length !== checkCount)  return payrollLogger.error('payroll.missingPaychecks');

        saveFile('households/default/apps/finances/payroll', {paychecks});


        //TODO: UPLOAD TO BUXFER
        //load dict
        const {mapping} = loadFile('households/default/apps/finances/payrollDict');
        
        let debits = [];
        let credits = [];
        let transfers = [];
        
        for(const date of Object.keys(paychecks)){
            const {header:{checkDt}, detail} = paychecks[date];
            const {key,taxData,earns,taxWithholdings,preTaxDedns,postTaxDedns,employerBenefits,employerBenefitsTaxable,employerBenefitsNonTaxable,totals,ptos,netPayDistributions,directDepositDistributions,flsaDetails} = detail;
            if(!checkDt) payrollLogger.error('payroll.noCheckDate', { date });
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
        saveFile('households/default/apps/finances/tmp', {transactions: allTransactions});

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

          payrollLogger.info('payroll.upload.count', { count: transactionNeedingUpload.length });
       for(const transaction of transactionNeedingUpload) {
            payrollLogger.info('payroll.upload.transaction', { date: transaction.date, amount: transaction.amount, desc: transaction.desc, category: transaction.category });
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
            payrollLogger.info('payroll.upload.success', { url: `https://www.buxfer.com/transactions?tids=${id}`, transactionId: id });

       }


      }catch(e) {
        const errorCode = e.response?.status;
        if(!errorCode) return payrollLogger.error('payroll.error', { message: e?.message || e });
        else if(errorCode === 401) return payrollLogger.error('payroll.auth.required', { errorCode });
       // else if(errorCode) return payrollLogger.error('payroll.fetch.error', { errorCode });
        payrollLogger.error('payroll.fetch.error', { errorCode });
        payrollLogger.error('payroll.fetch.error.details', { message: e?.message || e });
      }
}

export default payrollSync;

