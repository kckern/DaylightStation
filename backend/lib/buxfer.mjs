import axios from 'axios';
import { URLSearchParams } from 'url';
import yaml from 'js-yaml';
import { readFileSync, writeFileSync } from 'fs';
import isJSON from 'is-json';
import { askGPT } from './gpt.js';
import moment from 'moment';


const { BUXFER_EMAIL, BUXFER_PW } = process.env;


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

   // console.log(`curl -X POST "${url}" -d "email=${BUXFER_EMAIL}&password=${BUXFER_PW}"`);
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
        //console.log(`Getting transactions for account: ${account}`);
		let page = 1;
		let hasMore = true;
		while (hasMore) {
            //console.log(`Getting transactions for account: ${account} page: ${page}`);
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


//delete if matches string in account ID
export const deleteTransactions = async ({accountId, matchString, startDate, endDate}) => {

    //delete backup file: data/budget/deletedTransactions.yml
    //load from yaml file
    const deletedTransactions = (() => { try { return yaml.load(readFileSync('./data/budget/deletedTransactions.yml', 'utf8')) || []; } catch { return {}; } })();
    const transactions = await getTransactions({startDate, endDate, accounts: [accountId]});
    const transactionsToDelete = transactions.filter(txn => txn.description.includes(matchString));
    console.log(`Deleting ${transactionsToDelete.length} transactions...`);
    for(let txn of transactionsToDelete) {
        const { id, description, amount, date } = txn;
        const r = await deleteTransaction(id);
        console.log(`Deleted: ${date} - ${id} - ${description} - ${amount}`);
        deletedTransactions[id] = { description, amount, date , accountId};
    }
    //save to yaml file
    const deletedTransactionsYml = yaml.dump(deletedTransactions);
    writeFileSync('./data/budget/deletedTransactions.yml', deletedTransactionsYml);

}

export const deleteTransaction = async (id) => {
    try{
        const token = await getToken();
        const url = `https://www.buxfer.com/api/transaction_delete?token=${token}`;
        const params = { id };
        const {data: { response } } = await axios.post(url, params);
        return response;
    }catch(e){
        console.log({id, error: e.message});
    }
}




export const processTransactions = async ({startDate, endDate, accounts}) => {

    const transactions = await getTransactions({startDate, endDate, accounts});

    const hasNoTag = (txn) => !txn.tagNames.length;
    const hasRawDescription = (txn) => /(^Direct|Pwp|xx|as of|\*|（|Privacycom)/ig.test(txn.description); //TODO: parameterize this

    const txn_to_process = transactions.filter(txn => hasNoTag(txn) || hasRawDescription(txn));
   // console.log(`Processing ${txn_to_process.length} transactions to categorize...`);
    txn_to_process.forEach(txn => console.log(`${txn.date} - ${txn.description}`));
    const {validTags, chat} = yaml.load(readFileSync('./data/budget/gpt.yml', 'utf8'));
    chat[0].content =  chat[0].content.replace("__VALID_TAGS__", JSON.stringify(validTags));

    for(let txn of txn_to_process) {
        const { description, id, tags,date  } = txn;
        const index = transactions.findIndex(t => t.id === id);
        const gpt_input = [...chat, {role:"user", content: description}];
        const json_string = await askGPT(gpt_input, 'gpt-4o-2024-08-06', { response_format: { type: "json_object" }});
        const is_json = isJSON(json_string);
        const { category, friendlyName, memo } = is_json ? JSON.parse(json_string) : { };
        if(friendlyName && validTags.includes(category)) {
            console.log(`${date} - ${id} - ${friendlyName} - ${category}`);
            const r = await updateTransacton(id, friendlyName, category, memo);
            transactions[index].tagNames = [category];
            transactions[index].description = friendlyName;
        }else console.log(`\x1b[31mFailed to categorize: ${date} - ${id} - ${description}\x1b[0m`);
    }
    //TODO Delete comp transactions from fidility
    const deleteIds = transactions
      .filter(txn => 
        (txn.description.includes('FDIC') || txn.description.includes('Redemption')) && 
        txn.accountId === 732539
      )
      .map(txn => txn.id);    
    
      for(let id of deleteIds) {
        const r = await deleteTransaction(id);
        console.log(`Deleted: ${id}`);
    }
    const saveMe =  transactions.filter(txn => !deleteIds.includes(txn.id));
    //console.log(saveMe);
    return saveMe;
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

export const addTransaction = async ({ accountId, amount, date, description, tags, type, status, toAccountId, fromAccountId }) => {
    try {
        const token = await getToken();
        const url = `https://www.buxfer.com/api/transaction_add?token=${token}`;
        const tagsString = Array.isArray(tags) ? tags.join(',') : tags;
        const params = { accountId, amount, date, description, tags: tagsString, type, status };
        if(toAccountId) params['toAccountId'] = toAccountId;
        if(fromAccountId) params['fromAccountId'] = fromAccountId;
        const { data: { response } } = await axios.post(url, params);
        return response;
    } catch (e) {
        console.log({ account, amount, date, description, tags, type, status, error: e.message });
    }
}