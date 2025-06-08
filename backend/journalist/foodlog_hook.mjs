import { compileDailyFoodReport, getBase64Url, postItemizeFood, processFoodListData, processImageUrl, removeCurrentReport } from "./lib/food.mjs";
import dotenv from 'dotenv';
import { deleteMessage, sendImageMessage, sendMessage, transcribeVoiceMessage, updateMessage, updateMessageReplyMarkup } from "./lib/telegram.mjs";
import { deleteMessageFromDB, deleteNutrilog, getNutriCursor, setNutriCursor, getNutrilogByMessageId, getPendingNutrilog, saveNutrilog,  getNutrilListByDate, getNutrilListByID, deleteNuriListById, updateNutrilist } from "./lib/db.mjs";
import { detectFoodFromImage, detectFoodFromTextDescription } from "./lib/gpt_food.mjs";
import { upcLookup } from "./lib/upc.mjs";
import moment from "moment-timezone";
dotenv.config();


export const processFoodLogHook = async (req, res) => {

    const {TELEGRAM_NUTRIBOT_TOKEN:token,journalist:{journalist_user_id,nutribot_telegram_bot_id:bot_id}} = process.env;
    process.env.TELEGRAM_JOURNALIST_BOT_TOKEN = token; // TODO improve multi-bot support
    const payload = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;
    const user_id = parseInt(payload.message?.chat?.id || payload.chat_id || req.query.chat_id || journalist_user_id);
    //console.log({payload,user_id, bot_id});
    const chat_id = `b${bot_id}_u${user_id}`;
    if(!bot_id) return res.status(400).send('No bot id found');
    if(!chat_id) return res.status(400).send('No chat id found');
    const upc = payload.upc;
    console.log({upc, chat_id, payload, body: req.body, query: req.query});
    const img_url       = payload.img_url?.trim();
    const img_id        = payload.message?.photo?.reduce((acc, cur) => (cur.width > acc.width) ? cur : acc).file_id || payload.message?.document?.file_id;
    const hostname = req.headers.host;
    const protocol =  /localhost/.test(hostname) ? 'http' : 'https';
    const host = `${protocol}://${hostname}`;
    const text = payload.message?.text;
    if(payload.callback_query) await processButtonpress(payload, chat_id);
    if(img_url) await processImageUrl(img_url,chat_id);
    if(img_id) await processImgMsg(img_id, chat_id, host, payload);
    if(upc) await processUPC(chat_id,upc);
    if(payload.message?.voice) await processVoice(chat_id, payload.message);
    if(text) await processText(chat_id, payload.message.message_id, text);

    //console.log(payload);
    return res.status(200).send(`Foodlog webhook received`);
};



const processUPC = async (chat_id, upc) => {
    const foodData = await upcLookup(upc);
    console.log({foodData,chat_id,upc});
    if(!foodData) return await sendMessage(chat_id, `🚫 No results for UPC ${upc}`);
    const {image, label, nutrients} = foodData;
    if(image) {
        if(label) 
        {
            if(nutrients) return await sendImageMessage(chat_id, image,`${label}\n\n${(nutrients)}`);
            else return await sendImageMessage(chat_id, image, label);
        }else{
            if(nutrients) return await sendImageMessage(chat_id, image,`${(nutrients)}`);
            else return await sendImageMessage(chat_id, image, `🚫 No nutritional info found for UPC ${upc}`);
        }
    }
    if(label) {
        if(nutrients)  return await sendMessage(chat_id, `${label}\n\n${(nutrients)}`);
        else return await sendMessage(chat_id, label);
    }
    return await sendMessage(chat_id, `🚫 No results for UPC ${upc}`);
}

const processText = async (chat_id, input_message_id, text) => {

    await removeCurrentReport(chat_id);
    const pendingNutrilog = await getPendingNutrilog(chat_id);
    if(pendingNutrilog) return await processRevision(chat_id, input_message_id, text, pendingNutrilog);
    console.log('Processing text:', {chat_id, input_message_id, text});
    await deleteMessage(chat_id, input_message_id);
    const {message_id} = await sendMessage(chat_id, `📝 ${text}\n\n🔬 Analyzing description...`, {saveMessage: false}); 
    await processTextInput(chat_id, message_id, text);  
}

const processVoice = async (chat_id, message) => {
    const voice = message.voice;
    const voice_message_id = message.message_id;
    const text = await transcribeVoiceMessage(voice);
    await deleteMessage(chat_id, voice_message_id);
    const {message_id} = await sendMessage(chat_id, `🎙️ ${text}\n\n🔬 Analyzing description...`, {saveMessage: false}); 
    await processTextInput(chat_id, message_id, text);
    return true;
}

const processImgMsg = async (file_id, chat_id, host, payload) => {

    await removeCurrentReport(chat_id);
    const tmpUrl = `${host}/api/img?file_id=${file_id}`;
    const message_id = payload.message.message_id;
    const a = await deleteMessage(chat_id, message_id);
    const b = await processImageUrl(tmpUrl, chat_id);
    await Promise.all([a,b]);
 
    return true;   

}


const processRevisionButtonpress = async (chat_id, message_id, choice) => {

    const cursor = await getNutriCursor(chat_id);
    console.log('Processing revision button press', {chat_id, message_id, choice, cursor});
    const {adjusting} = cursor;
    if(!adjusting) {
        cursor.adjusting = {message_id, level: 0};
        setNutriCursor(chat_id, cursor);
        const date = moment().tz("America/Los_Angeles").format('YYYY-MM-DD');
        return await processRevisionButtonpress(chat_id, message_id, date);
    }

    if(/^↩️/.test(choice)) {
        delete cursor.adjusting;
        setNutriCursor(chat_id, cursor);
        const choices = [["✅ Accept", "⬅️ Adjust"]];
        return await updateMessage(chat_id, {message_id, text: "", choices, inline: true, key: "caption"})
    }

    if(/^[☀️]/.test(choice)){
        if (cursor && cursor.adjusting) {
            cursor.adjusting.level = 0;
            if ('uuid' in cursor.adjusting) {
                delete cursor.adjusting.uuid;
            }
            if ('date' in cursor.adjusting) {
                delete cursor.adjusting.date;
            }
        }
        setNutriCursor(chat_id, cursor);
        const createRow = (start, end, today) => {
            return Array.from({length: end-start+1}, (_, i) => i + start)
                .map(i => moment(today).subtract(i, 'days').format('YYYY-MM-DD'))
                .map((j,i) => ({[j]: i === 0 && start === 1 ? "Yesterday" : `${start+i} days ago`}));
        }
        const today = moment().tz("America/Los_Angeles").format('YYYY-MM-DD');
        const firstRow = createRow(1, 3, today);
        const secondRow = createRow(4, 6, today);
        const thirdRow = createRow(7, 9, today);
        const choices = [[{[today]:"☀️ Today"}], firstRow, secondRow, thirdRow, ["↩️ Done"]];
        //save cursor
        setNutriCursor(chat_id, cursor);
        return await updateMessage(chat_id, {message_id, text: "📅 Select Date to Adjust:", choices, inline: true, key: "caption"});
    }

    if(/^[⏭️]/.test(choice)) {
        cursor.adjusting = {
            level: 0,
            date: adjusting.date,
            offset: adjusting.offset ? adjusting.offset + 9 : 9
        };
        await setNutriCursor(chat_id, cursor);
        return await processRevisionButtonpress(chat_id, message_id, adjusting.date);
    }

    const {level} = adjusting;
    if(level === 0) { //We just received the date
        cursor.adjusting.level = 1;
        const offset = cursor.adjusting.offset || 0;
        const date = moment.tz(choice, "America/Los_Angeles").format('YYYY-MM-DD');
        cursor.adjusting.date = date;
        console.log({date_choice:choice,offset});
        const foodItems =  getNutrilListByDate(chat_id, date);
        console.log({foodItems,offset});
        let sliced = foodItems.slice(offset,offset+9);
        if(!sliced.length) sliced = foodItems.slice(0,9);
        const choices = sliced.reduce((acc, cur, idx) => {
                const {uuid, item} = cur;
                if(idx % 3 === 0) acc.push([]);
                const entry = {};
                entry[uuid] = item;
                acc[acc.length-1].push(entry);
                return acc;
            }, []);
        choices.push(["⏭️ Next","☀️ Other Day","↩️ Done"]);
        const a =  setNutriCursor(chat_id, cursor);
        console.log({choices});
        const friendlyDate = moment(date).format('ddd, D MMM YYYY');
        const b = updateMessage(chat_id, {message_id, text: `📅 ${friendlyDate}\n🍽️ Select Food Item to Adjust:`, choices, inline: true, key: "caption"});
        await Promise.all([a,b]);
        return true;
    }
    if(level === 1) { //We just received the food item
        cursor.adjusting.level = 2;
        const uuid = choice;
        cursor.adjusting.uuid = uuid;
        const listItem = await getNutrilListByID(chat_id, uuid);
        if(!listItem) return console.error('No list item found for uuid', {chat_id, uuid});
        const {item, noom_color, amount, unit, calories, fat, protein, carbs} = listItem || {};
        const emoji = noom_color === 'green' ? '🟢' : noom_color === 'yellow' ? '🟡' : noom_color === "orange" ? '🟠' : "🔴";
        const text = `${emoji} ${item.trim()} (${`${amount}`.trim()}${unit.trim()})\n🔥 ${parseInt(calories)} cal\n🧀 ${parseInt(fat)}g 🍖 ${parseInt(protein)}g 🍏 ${parseInt(carbs)}g\n\n↕️ How to adjust?`;
        const choices = [
            [{"0.25":"¼"}, {"0.33":"⅓"}, {"0.5":"½"}, {"0.67":"⅔"}, {"0.75":"¾"}, {"0.8":"⅘"}],
            [{"1.25":"×1¼"}, {"1.5":"×1½"}, {"1.75":"×1¾"}, {"2":"×2"}, {"3":"×3"}, {"4":"×4"}],
            ["🗑️ Delete", {"📅":"📅 Move Day"},"↩️ Done"]
        ];
        const a = setNutriCursor(chat_id, cursor);
        const b = updateMessage(chat_id, {message_id, text, choices, inline: true, key: "caption"});
        await Promise.all([a,b]);
        return true;
    }
    if(level === 2) { //We just received the revision
        const uuid = cursor.adjusting.uuid;
        const factor = parseFloat(choice);
        if(isNaN(factor) && /^[🗑️]/.test(choice)){
            console.log('Deleting item', {chat_id, uuid});
            const r = await deleteNuriListById(chat_id, uuid);
            console.log('Delete result', r);
            const cursor = await getNutriCursor(chat_id);
            delete cursor.adjusting;
            setNutriCursor(chat_id, cursor);
            return await postItemizeFood(chat_id);
        }
        if(isNaN(factor) && /^📅/.test(choice)) {
            //TODO: change date menu
            return await processRevisionButtonpress(chat_id, message_id, `↩️`);
        }
        const listItem = await getNutrilListByID(chat_id, uuid);
        const numericFields = ['amount', 'calories', 'fat', 'protein', 'carbs', 'sugar', 'fiber', 'sodium', 'cholesterol'];
        const revisedItem = numericFields.reduce((acc, cur) => {
            acc[cur] = parseInt(listItem[cur] * factor);
            return acc;
        }, {});
       // console.log({listItem,revisedItem, factor, uuid});
        await updateNutrilist(chat_id, uuid, revisedItem);
        delete cursor.adjusting;
        setNutriCursor(chat_id, cursor);
        return await postItemizeFood(chat_id);

    }
    
    return false;


}

const processButtonpress = async (body, chat_id) => {


    const messageId = body.callback_query.message?.message_id; 
    const choice = body.callback_query.data;
    const leadingEmoji = choice?.match(/^\S+/g)[0];
    console.log({leadingEmoji, choice});

    console.log('Processing button press', leadingEmoji);
    const cursor = await getNutriCursor(chat_id);
    if(cursor.adjusting || leadingEmoji === '⬅️') {
        return processRevisionButtonpress(chat_id, messageId, choice);
    }
    const nutrilogItem = await getNutrilogByMessageId(chat_id, messageId);
    console.log({nutrilogItem});
    if(!nutrilogItem) {
        if(["✅","⭐"].includes(leadingEmoji)) return await clearKeyboard(chat_id, messageId);
        if(leadingEmoji === '↩️') return await postItemizeFood(chat_id);
        return false;
    }
    const {uuid, food_data} = nutrilogItem;
    if(!uuid) return console.error('No uuid found for nutrilog item', nutrilogItem);
    //console.log({uuid, food_data});
    if(leadingEmoji === '✅') return await acceptFoodLog(chat_id, messageId, uuid, food_data);
    if(leadingEmoji === '❌') return await discardFoodLog(chat_id, messageId, uuid);
    if(leadingEmoji === '🔄') return await reviseFoodLog(chat_id, messageId, uuid, nutrilogItem);
    return false;
}

const clearPendingCursor = async (chat_id) => {
    const cursor = await getNutriCursor(chat_id);
    if(cursor.revising) delete cursor.revising;
    setNutriCursor(chat_id, cursor);
}

const acceptFoodLog = async (chat_id, message_id, uuid, food_data) => {

    console.log('Accepting message', {chat_id, message_id, uuid, food_data});

    const a = clearKeyboard(chat_id, message_id);
    const b = saveNutrilog({uuid, message_id, chat_id, food_data, status: "accepted"});
    const c = clearPendingCursor(chat_id);
    await Promise.all([a, b, c]);
    compileDailyFoodReport(chat_id);
    await postItemizeFood(chat_id);
};

const discardFoodLog = async (chat_id, messageId, uuid) => {

    console.log('Discarding message', {chat_id, messageId});
    const a = deleteMessage(chat_id, messageId);
    const b = deleteMessageFromDB(chat_id, messageId);
    const c = clearPendingCursor(chat_id);
    const d = deleteNutrilog(chat_id, uuid);
    await Promise.all([a,b,c,d]);
    return true;
}

const clearKeyboard = async (chat_id, message_id) => {
    await updateMessageReplyMarkup(chat_id, {message_id, choices:[], inline: true});
}

const reviseFoodLog = async (chat_id, message_id, uuid, {food_data}) => {

    const cursor = await getNutriCursor(chat_id);

    //Handle any Pending Nutrilogs
    const {revising} = cursor;
    if(revising?.message_id && revising?.uuid) {
        await updateMessageReplyMarkup(chat_id, {message_id:revising.message_id, choices:["✅ Accept", "❌ Discard", "🔄 Revise"], inline: true});
        saveNutrilog({uuid:revising.uuid,chat_id, message_id,food_data, status: "init"});
        delete cursor.revising;
        setNutriCursor(chat_id, cursor);
    }

    //Process Current Nutrilog
    cursor['revising'] = {message_id, uuid};
    setNutriCursor(chat_id, cursor);
    await updateMessageReplyMarkup(chat_id, {message_id, choices:["🗒️ Input your revision:"], inline: true});
    saveNutrilog({uuid,chat_id, food_data,message_id, status: "revising"});
    return true;

}

const processTextInput = async (chat_id, message_id, text) => {

    const logItemBeingRevisedPromise = getPendingNutrilog(chat_id);
    const removeReportPromise = removeCurrentReport(chat_id);
    const [logItemBeingRevised, removeReport] = await Promise.all([logItemBeingRevisedPromise, removeReportPromise]);
    if(logItemBeingRevised) return await processRevision(chat_id, message_id, text, logItemBeingRevised);
    const jsondata = await detectFoodFromTextDescription(text);
    if(!jsondata) return updateMessage(chat_id, {message_id, text: "🚫 No food items detected.", choices: [["🔄 Try Again"]], inline:true, key:"caption"});
    jsondata.text = text;
    return await processFoodListData(jsondata, chat_id,message_id);
}


const processRevision = async (chat_id, feedback_message_id, text, {message_id, uuid, food_data}) => {

    console.log('Processing revision', {chat_id, feedback_message_id, text, message_id, uuid, food_data});
    const a =  deleteMessage(chat_id, feedback_message_id);
    const {img_url} = food_data;
    const c = updateMessage(chat_id, {message_id, text: "🔄 Revising...", choices: [], inline:true, key: img_url ? "caption" : null});
    await Promise.all([a,c]);
    const rev_promise = img_url ? 
        processImageRevision(   chat_id, text, { uuid, message_id, img_url, food_data}) : 
        processTextRevision(    chat_id, text, { uuid, message_id, food_data});
    await rev_promise;

}

const processImageRevision = async (chat_id, text, {uuid, message_id, img_url, food_data}) => {
    await removeCurrentReport(chat_id);
    const base64Url = await getBase64Url(img_url);
    const new_food_data = await detectFoodFromImage(base64Url, {food_data, text});
    new_food_data.img_url = img_url;
    new_food_data.text = text;
    saveNutrilog({uuid,chat_id, message_id,food_data:new_food_data, status: "revised"});
    return await processFoodListData(new_food_data, chat_id, message_id, "caption", true);
}

const processTextRevision = async (chat_id, text, {uuid, message_id, food_data}) => {
    await removeCurrentReport(chat_id);
    const {text:food_text} = food_data;
    const new_food_data = await detectFoodFromTextDescription(text, {food_data, text:food_text});
    new_food_data.text = food_data.text + ' • ' + text;
    saveNutrilog({uuid, chat_id, message_id,food_data:new_food_data, status: "revised"});
    return await processFoodListData(new_food_data, chat_id, message_id, null, true);
}

