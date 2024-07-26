import axios from 'axios';
import yaml from 'js-yaml';
import { readFileSync, writeFileSync } from 'fs';


const secrets = './config.secrets.yml';
const { PAYROLL_BASE, PAYROLL_AUTHKEY, PAYROLL_AUTH, PAYROLL_COMPANY, PAYROLL_EMPLOYEE } = yaml.load(readFileSync(secrets, 'utf8'));


(async () => {
    const url = `https://${PAYROLL_BASE}/${PAYROLL_COMPANY}/${PAYROLL_EMPLOYEE}/paychecks`;
    console.log(url);
    const options = {
        method: 'GET',
        url,
        headers: {
          cookie: `${PAYROLL_AUTHKEY}=${PAYROLL_AUTH}`
        }
      };
      
      const response = await axios.request(options);
      const checks = response.data.data.checkSummaries;
      const paychecks = {};
      for(const check of checks) {
        const {id} = check;
        const checkUrl = `https://${PAYROLL_BASE}/${PAYROLL_COMPANY}/${PAYROLL_EMPLOYEE}/paycheck-details/${id}`;
        const checkOptions = {
            method: 'GET',
            url: checkUrl,
            headers: {
              cookie: `${PAYROLL_AUTHKEY}=${PAYROLL_AUTH}`
            }
          };
          const checkResponse = await axios.request(checkOptions);
          const date = checkResponse.data.data.header.payEndDt;
          paychecks[date] = checkResponse.data.data;
          console.log(`Got paycheck for ${date}`);
      }
        const paychecksPath = 'data/budget/payroll.yml';
        const paychecksYml = yaml.dump({paychecks});
        writeFileSync(paychecksPath, paychecksYml);
}
)();

