import {  deleteMostRecentMessages, deleteMostRecentUnansweredMessage, deleteSpecificMessage, sendMessage, transcribeVoiceMessage } from './lib/telegram.mjs';
import {saveMessage, deleteUnprocessedQueue, findMostRecentUnansweredMessage, loadMessageFromDB} from './lib/db.mjs'
import {dearDiary, journalPrompt, slashCommand} from "./lib/journalist.mjs"
import { handleQuizAnswer } from './lib/quiz.mjs';
import dotenv from 'dotenv';
import { saveFile } from '../lib/io.mjs';
import { journalTrigger } from './trigger.mjs';
dotenv.config();


const {OPENAI_API_KEY, TELEGRAM_JOURNALIST_BOT_TOKEN, journalist: { journalist_telegram_bot_id }} = process.env;

export const postData = async (body,hostname,endpoint="telegram") =>{
    const timePromise = new Promise(resolve => { setTimeout(() => resolve(), 1000) });
    const httpPromise = fetch(`https://${hostname}/api/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return await Promise.race([timePromise,httpPromise])
}

export const processWebhookPayload = async (req, res) => {

    //if GET
    if (req.method === 'GET') return await journalTrigger(req, res);
    

    saveFile(`telegram/journalist_payload`, req.body);
    const {journalist: {journalist_telegram_bot_id:bot_id}} = process.env;

    const specialStarts = ["🎲", "❌"];
    try{

        if(!TELEGRAM_JOURNALIST_BOT_TOKEN || !OPENAI_API_KEY) {
            return res.status(500).send(`Cannot find needed API configuration.`);
        }
        const { body } = req;
        //console.log('Received message:', body);
        const user_id = body.message?.chat?.id || body.callback_query?.message?.chat?.id;
        const chatId = `b${bot_id}_u${user_id}`;

        


        if (!chatId) {
            console.log('Not a message');
            //remove circular reference from req
            //console.log(req);
            return res.status(200).send(`Not a message.`);
        }

        const messageText = body.message?.text;
        const messageVoice = body.message?.voice;
        const messageData = body.callback_query?.data;
        const mostRecentMessage = await findMostRecentUnansweredMessage(chatId, journalist_telegram_bot_id);
        const {foreign_key, msg_id} = mostRecentMessage || {};
        const msg_type = Object.keys(foreign_key || {})?.[0] || null;
        const msg_fkey = foreign_key?.[msg_type] || null;
        console.log({mostRecentMessage,msg_fkey, msg_type});
        //TODO: add handlers for specific msg_types, maybe as deep as dearDiary

        const isSlashCommand = messageText?.startsWith("/");

        if (messageText) {
            const text = body.message.text;
            const messageId = body.message.message_id;
            if(specialStarts.some((start) => text.startsWith(start))) 
                return await handleSpecialStarts(chatId, messageId, text, req,res);

            if(isSlashCommand) {
                await deleteSpecificMessage(chatId, messageId);
                console.log({isSlashCommand,text})
                await slashCommand(chatId, text);
                return res.status(200).send(`Slash command processed`);
            }
            
            const input = {messageId, senderId: body.message.from.id, senderName: body.message.from.first_name, text, foreign_key};
            await saveMessage(chatId, input);

            await dearDiary(chatId, text);
            return   res.status(200).send(`Text message processed`);

        }else if (messageVoice) {
            
            const text = await transcribeVoiceMessage(messageVoice);
            if(!text) return res.status(200).send(`No transcription.`);
            await sendMessage(chatId, `🎙️ Transcription:\n\n${text}`, {from:body.message.from, ignoreUnread:true});
            await dearDiary(chatId, text);
            return res.send(res, 200, `Voice message processed`);

        }else if (messageData) {
        
            const options = body.callback_query.message?.reply_markup?.inline_keyboard?.[0];
            //const messageText = body.callback_query.message?.text;
            const messageId = body.callback_query.message?.message_id;
            const choice = options.find((option) => option.callback_data === messageData);
            const reply = `${choice.text} ${choice.callback_data}`;

            const replyStartWithSpecial = specialStarts.some((start) => reply.startsWith(start));
            if(replyStartWithSpecial) return await handleSpecialStarts(chatId, messageId, reply, req,res);

            const [messageFromDB] = (await loadMessageFromDB(chatId, messageId)) || [null];
            const {foreign_key} = messageFromDB || {};
            const isQuiz = !!foreign_key?.quiz;

            //console.log({ messageFromDB,foreign_key, isQuiz});

           if(isQuiz) await handleQuizAnswer(chatId, {
                queue_uuid: foreign_key.queue,
                messageId,
                value: choice.callback_data,
                quizKey: foreign_key.quiz
            });


            return res.status(200).send(`Callback processed`);
           }
        else {
            //console.log('No text or voice message');
            res.status(200).send(`No text or voice message.`);
        }
        return true;

    }catch (error) {
        console.error('Error:', error);
        res.status(200).send(`Error: ${error}`);
        return true;
    }
}


const handleSpecialStarts = async (chatId,messageId, text,req, res) => {

    await deleteUnprocessedQueue(chatId);
    await deleteSpecificMessage(chatId, messageId);
    const mins = 1;
    const timeAgo = Math.floor(Date.now() / 1000) - (60 * mins);
    await deleteMostRecentMessages(chatId, 1, timeAgo);
    await deleteMostRecentUnansweredMessage(chatId, journalist_telegram_bot_id);
    const isRoll = text.startsWith("🎲");
    const hostname = req.headers.host;

    if(isRoll) await journalPrompt(chatId, {instructions:"change_subject"});

    res.status(200).send(`Special start processed`);


}