import axios from 'axios';
import { URLSearchParams } from 'url';
import yaml from 'js-yaml';
import { readFileSync } from 'fs';
import isJSON from 'is-json';
import { askGPT } from './gpt.js';
import moment from 'moment';

const secrets = './config.secrets.yml';
const { BUXFER_EMAIL, BUXFER_PW } = yaml.load(readFileSync(secrets, 'utf8'));


const getToken = async () => {
    // If a token already exists in process.env, return it
    if (process.env.BUXFER_TOKEN) {
        return process.env.BUXFER_TOKEN;
    }
    const url = 'https://www.buxfer.com/api/login';
    const params = {
        email: BUXFER_EMAIL,
        password: BUXFER_PW
    };

    console.log(`curl -X POST "${url}" -d "email=${BUXFER_EMAIL}&password=${BUXFER_PW}"`);
    const {data: { response: { token } } } = await axios.post(url, params);

    // Save the token to process.env
    process.env.BUXFER_TOKEN = token;

    return token;
}
export const getTransactions = async ({startDate, endDate,  accounts, tagName}) => { 
	const token = await getToken();
	startDate = startDate || '2022-01-01';
	endDate = endDate || '2024-12-31';
	accounts = accounts || ["Fidelity", "CaptialOne","Payroll"];
	const command = 'transactions';
	let transactions = [];
	for (let account of accounts) {
        console.log(`Getting transactions for account: ${account}`);
		let page = 1;
		let hasMore = true;
		while (hasMore) {
            console.log(`Getting transactions for account: ${account} page: ${page}`);
			const params ={ page, accountName: account, startDate, endDate };
            if(tagName) params.tagName = tagName;
			const url = `https://www.buxfer.com/api/${command}?token=${token}&${new URLSearchParams(params).toString()}`;
			const {
				data: {
					response
				}
			} = await axios.get(url);
			transactions = [...transactions, ...response.transactions];
			if (response.transactions.length === 0) {
				hasMore = false;
			}
			else {
				page++;
			}
		}
	}
	transactions.sort((a, b) => new Date(b.date) - new Date(a.date)); //save 

	return transactions;
}





export const processTransactions = async () => {

    const endDate = moment().format('YYYY-MM-DD');
    const startDate = moment(endDate).subtract(1, 'months').format('YYYY-MM-DD');
    const transactions = await getTransactions({startDate, endDate});

    const hasNoTag = (txn) => !txn.tagNames.length;
    const hasRawDescription = (txn) => /(^Direct|Pwp|xx|as of|\*|（|Privacycom)/ig.test(txn.description); //TODO: parameterize this

    const txn_to_process = transactions.filter(txn => hasNoTag(txn) || hasRawDescription(txn));
    console.log(`Processing ${txn_to_process.length} transactions to categorize...`);
    txn_to_process.forEach(txn => console.log(`${txn.date} - ${txn.description}`));
    const {validTags, chat} = yaml.load(readFileSync('./data/budget/gpt.yml', 'utf8'));
    chat[0].content =  chat[0].content.replace("__VALID_TAGS__", JSON.stringify(validTags));

    for(let txn of txn_to_process) {
        const { description, id, tags,date  } = txn;
        const gpt_input = [...chat, {role:"user", content: description}];
        const json_string = await askGPT(gpt_input, 'gpt-3.5-turbo', { response_format: { type: "json_object" }});
        const is_json = isJSON(json_string);
        const { category, friendlyName, memo } = is_json ? JSON.parse(json_string) : { };
        if(friendlyName && validTags.includes(category)) {
            console.log(`${date} - ${id} - ${friendlyName} - ${category}`);
            const r = await updateTransacton(id, friendlyName, category, memo);
        }else console.log(`\x1b[31mFailed to categorize: ${date} - ${id} - ${description}\x1b[0m`);
    }
    //TODO Delete comp transactions from fidility
}

export const updateTransacton = async (id, description, tags, memo) =>{
    try{
        
    //console.log(`Updating transaction: ${id} with description: ${description}, tag: ${tags}, memo: ${memo}`);
    const token = await getToken();
    const url = `https://www.buxfer.com/api/transaction_edit?token=${token}`;
    const params = { id, description, tags, memo };
    const {data: { response } } = await axios.post(url, params);
    return response;

    }catch(e){
        console.log({id, description, tags, memo, error: e.message});
    }
}

