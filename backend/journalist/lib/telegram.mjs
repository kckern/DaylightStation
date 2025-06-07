
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs';
import util from 'util';
import stream from 'stream';
import OpenAI from 'openai';
import { getMessages, saveMessage, findMostRecentUnansweredMessage, deleteMessageFromDB } from './db.mjs';
dotenv.config();


const {journalist_telegram_bot_id} = process.env.journalist;


const openai = new OpenAI(process.env.OPENAI_API_KEY);
const pipeline = util.promisify(stream.pipeline);
const telegramBotToken = ()=>process.env.TELEGRAM_JOURNALIST_BOT_TOKEN;


export const getRecentMessages = async (chatId) => {
    return  getMessages(chatId);
}

export const updateWebhook = async (bot_id, url) => {
    try {
        const response = await fetch(`https://api.telegram.org/bot${bot_id}/setWebhook?url=${encodeURIComponent(url)}`, {
            method: 'GET',
        });
        const json = await response.json();
        console.log('Update Webhook Result:', json);
        return json;
    } catch (error) {
        console.error('Error updating webhook:', error);
        return { ok: false, error: error.message };
    }
};



export const sendImageMessage = async (chat_id, image_url, caption) => {
    const user_id = chat_id.match(/u(\d+)/)[1];
    caption = caption || `📸 Image`;
    const body = JSON.stringify({
        chat_id: user_id,
        photo: image_url,
        caption
    });
    console.log('Send Image Message:', body);
    console.log(`\n\ncurl -X POST -H 'Content-Type: application/json' -d '${body}' https://api.telegram.org/bot${telegramBotToken()}/sendPhoto`);
    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken()}/sendPhoto`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body
    });
    const json = await response.json();
    return json;
}


export const sendMessage = async (chat_id, text, config) => {

    //tailing digits
    const user_id = chat_id.match(/u(\d+)/)[1];

    const choices = config?.choices || null;
    const ignoreUnread = config?.ignoreUnread || false;
    const inline = !!config?.inline;
    const foreign_key = config?.foreign_key || {};
    const saveMessageConfig = config?.saveMessage || true;
    if(!ignoreUnread) await deleteMostRecentUnansweredMessage(chat_id,journalist_telegram_bot_id);

    const rowsOfKeys = choices ? !Array.isArray(choices[0]) ? choices.map(choice => [choice]) : choices : null;


    console.log("sendMessage",{text, config},"rowsOfKeys:",rowsOfKeys)

    const reply_markup = choices ? {
        keyboard: rowsOfKeys,
        resize_keyboard: true,
        one_time_keyboard: true
    } : null;

    if(inline) {
        reply_markup.inline_keyboard = rowsOfKeys.map(choicesRow => choicesRow.map((choice,i) => {
            
            const objectKeys = (typeof choice === 'object') ? Object.keys(choice) : null;
            const callback_data = objectKeys ? objectKeys[0] : choice;
            const text = objectKeys ? choice[callback_data] : choice;
            return { text,  callback_data }
       }));

        delete reply_markup.keyboard;
    }

    const bodyObj = {
        chat_id:user_id,
        text,
        reply_markup,
        //parse_mode: 'MarkdownV2'
    };

    if(!choices) delete bodyObj.reply_markup;




    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken()}/sendMessage`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(bodyObj)
    });
    const json = await response.json();
    //console.log('Send Message Result:', json);

    const {result}  = json;

    if(!result) return await sendMessage(chat_id, `🚧 Error`);

    const from = config?.from || result.from;
    
    
    const input = {messageId: result.message_id, senderId: from.id, senderName: from.first_name, text, foreign_key};

    if(saveMessageConfig) await saveMessage(chat_id,input);

    return result;
}

export const getPhotoUrl = async (file_id) => {

    const url = `https://api.telegram.org/bot${telegramBotToken()}/getFile?file_id=${file_id}`;
    console.log('Get Photo URL:', url);
    const fileInfo = await fetch(url);
    const fileInfoJson = await fileInfo.json();
    const filePath = fileInfoJson.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${telegramBotToken()}/${filePath}`;
    return fileUrl;
}


export const transcribeVoiceMessage = async ({file_unique_id,file_id}) => {
    const fileUUID = file_unique_id;

    const audioFileFound = fs.existsSync(`/tmp/${fileUUID}.ogg`);
    const textFileFound = fs.existsSync(`/tmp/${fileUUID}.txt`);

    //Download Audio File
    if(textFileFound) return fs.readFileSync(`/tmp/${fileUUID}.txt`, 'utf8');


    const localfilePath= `/tmp/${fileUUID}.ogg`;
    if(!audioFileFound){
        const fileInfo = await fetch(`https://api.telegram.org/bot${telegramBotToken()}/getFile?file_id=${file_id}`);
        const fileInfoJson = await fileInfo.json();
        const filePath = fileInfoJson.result.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${telegramBotToken()}/${filePath}`;
        //console.log('Downloading file:', fileUrl);
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error(`unexpected response ${response.statusText}`);
        await pipeline(response.body, fs.createWriteStream(localfilePath));
    }

    //Transcribe Audio File
    //console.log('Sending file to OpenAI:', localfilePath);
    const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(localfilePath),
        model: 'whisper-1',
    });
    const { text } = transcription;
    fs.writeFileSync(`/tmp/${fileUUID}.txt`, text);

    //console.log('Transcription:', text);
    return text;
}

export const deleteMessage = async (chat_id, message_id) => {
    const user_id = chat_id.match(/u(\d+)/)[1];
    const deleteBody = JSON.stringify({
        chat_id:user_id,
        message_id
    });
    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken()}/deleteMessage`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: deleteBody
    });
    const json = await response.json();
    console.log('Delete Response:',deleteBody, json);
    return json;
}

export const deleteMostRecentUnansweredMessage = async (chatId, senderId) => {
    const mostRecentUnansweredMessage = await findMostRecentUnansweredMessage(chatId, senderId);
    //console.log('Most recent unanswered message:', mostRecentUnansweredMessage);
    if(mostRecentUnansweredMessage) {
        await deleteMessage(chatId, mostRecentUnansweredMessage.message_id);
        await deleteMessageFromDB(chatId, mostRecentUnansweredMessage.message_id);
    } 
}

export const deleteMostRecentMessages = async (chatId, count, timeLimit) => {
    count = count || 1;
    const messages = await getMessages(chatId);
    const timeframeMessages = timeLimit ? messages.filter((message) => message.timestamp > timeLimit) : messages;
    const message = timeframeMessages.slice(-1);
    if(!message.length) return;
    const mostRecentMessageId = message.message_id || message[0].message_id;
    await deleteMessage(chatId, mostRecentMessageId);
    await deleteMessageFromDB(chatId, mostRecentMessageId);
    if(count > 1) return await deleteMostRecentMessages(chatId, count - 1);
}

export const deleteSpecificMessage = async (chatId, messageId) => {
    await deleteMessage(chatId, messageId);
    await deleteMessageFromDB(chatId, messageId);
}

export const updateMessage = async (chat_id, {message_id, text, choices, inline, key}) => {

    console.log('updateMessageTop:', {chat_id,message_id, text, choices, inline, key});

    const user_id = chat_id.match(/u(\d+)/)[1];
    const reply_markup = Array.isArray(choices) ? {
        keyboard: choices.map(choice => [choice]),
        resize_keyboard: true,
        one_time_keyboard: true
    } : null;

    if(inline && reply_markup) {
        reply_markup.inline_keyboard = choices.map(choicesRow => choicesRow.map((choice,i) => {
            const objectKeys = (typeof choice === 'object') ? Object.keys(choice) : null;
            const callback_data = objectKeys ? objectKeys[0] : choice;
            const text = objectKeys ? choice[callback_data] : choice;
            return { text,  callback_data }
       }));
        delete reply_markup.keyboard;
    }
    const updateBody = {
        chat_id: user_id,
        message_id,
        text,
        reply_markup,
    };
    let endpoint = 'editMessageText';
    if(key) 
    {
        updateBody[key] = text;
        delete updateBody.text;
        endpoint = 'editMessageCaption';
    }
    if(!choices) delete updateBody.reply_markup;

    console.log('Update Message:', JSON.stringify(updateBody));

    try {
        const response = await fetch(`https://api.telegram.org/bot${telegramBotToken()}/${endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateBody)
        });
        //console.log('R Message Result:', response);
        const json = await response.json();
        console.log('Update Message Result:', json);
        return json;
    } catch (error) {
        console.error('Error during fetch:', error);
        return {};
    }

}
export const updateMessageReplyMarkup = async (chat_id, {message_id, choices, inline}) => {

    if(!choices) choices = [];

    if(Array.isArray(choices) && !Array.isArray(choices[0])) choices = [choices];

    const user_id = chat_id.match(/u(\d+)/)?.[1];
    let reply_markup = Array.isArray(choices) ? {
        keyboard: choices.map(choice => [choice]),
        resize_keyboard: true,
        one_time_keyboard: true
    } : null;

    if(inline && reply_markup) {
        reply_markup.inline_keyboard = choices.map(choicesRow => choicesRow.map((choice,i) => {
            
             const objectKeys = (typeof choice === 'object') ? Object.keys(choice) : null;
             const callback_data = objectKeys ? objectKeys[0] : choice;
             const text = objectKeys ? choice[callback_data] : choice;
             return { text,  callback_data }
        }));
        delete reply_markup.keyboard;
    }

    console.log('choices',choices);
    // If choices is empty, remove the keyboard or set an empty inline keyboard

    if (choices.length === 0) {
        if (inline) {
            // For inline keyboards, simply set an empty inline keyboard
            reply_markup = { inline_keyboard: [] };
        } else {
            // For non-inline (regular) keyboards, use remove_keyboard to hide it
            reply_markup = { remove_keyboard: true };
        }
    }

    const updateBody = {
        chat_id: user_id,
        message_id,
        reply_markup,
    };

    console.log('Update MessageMarkup:', JSON.stringify(updateBody));
    console.log('Update MessageMarkup reply_markup:', JSON.stringify(reply_markup));

    try {
        const response = await fetch(`https://api.telegram.org/bot${telegramBotToken()}/editMessageReplyMarkup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updateBody)
        });
        const json = await response.json();
        console.log('Update MessageMarkup Result:', json);
        return json;
    } catch (error) {
        console.error('Error during fetch:', error);
        return {};
    }

}