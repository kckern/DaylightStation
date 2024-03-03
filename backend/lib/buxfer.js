import axios from "axios";
import { saveFile } from "./io.js";


const getToken = async () => {
    const { BUXFER_EMAIL, BUXFER_PW } = process.env;

    const url = 'https://www.buxfer.com/api/login';
    const params = {
        email: BUXFER_EMAIL,
        password: BUXFER_PW
    };
    const { data:{response:{token}} } = await axios.post(url, params);
    return token
}

const getTransactions = async (req) => {
    //TODO: get this from config
   const startDate = req.query.startDate || '2024-01-01'; 
   const endDate = req.query.endDate || '2024-12-31';

    const token = await getToken();

    const accounts = ["Fidelity", "Quicksilver", "Chase Routing"];

    const command = 'transactions';

    let transactions = [];

    for (let account of accounts) {
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const params = { page, accountName: account, startDate, endDate };
            const url = `https://www.buxfer.com/api/${command}?token=${token}&${new URLSearchParams(params).toString()}`;
         
            const { data:{response} } = await axios.get(url);

            transactions = [...transactions, ...response.transactions];

            if (response.transactions.length === 0) {
                hasMore = false;
            } else {
                page++;
            }
        }
    }

    transactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    //save
    saveFile('buxfer', transactions);

    return transactions;
}

export default getTransactions