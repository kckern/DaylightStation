import axios from 'axios';
import { URLSearchParams } from 'url';
import dotenv from 'dotenv';
import isJSON from 'is-json';
dotenv.config();

const getToken = async () => {
    const {
        BUXFER_EMAIL,
        BUXFER_PW
    } = process.env;

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
	accounts = accounts || ["Fidelity", "CaptialOne"];
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

