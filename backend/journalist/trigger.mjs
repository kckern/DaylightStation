import {  slashCommand } from "./lib/journalist.mjs";


export const journalTrigger =  async (req, res) => {

    try{
        const {journalist: {journalist_user_id,journalist_telegram_bot_id:bot_id}} = process.env;
        const user_id = req.body?.message?.from?.id || req.body?.callback_query?.from?.id || journalist_user_id;
        const {q} = req.query;
        const chatId =  `b${bot_id}_u${user_id}`;
        const msg = await slashCommand(chatId, q);
        const {message_id} = msg || {};
        return res.status(200).json({message_id});
    }
    catch(error){
        console.error('Error:', error?.response?.data?.error?.message || error.message);
        return res.status(500).send(`Error: ${error?.response?.data?.error?.message || error.message}`);
    }
    
}