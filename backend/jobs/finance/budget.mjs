import { refreshFinancialData } from '../../lib/budget.mjs';


(async ()=>{
     const noDL = process.argv[2] === '0';
     await refreshFinancialData(noDL);
})()