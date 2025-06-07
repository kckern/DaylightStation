import { detectFoodFromImage, generateCoachingMessage, itemizeFood} from "./gpt_food.mjs";
import nodeFetch from 'node-fetch';
import * as Jimp from 'jimp';
import moment from "moment-timezone";
import {  sendImageMessage, updateMessage, deleteMessage, updateMessageReplyMarkup, deleteSpecificMessage, sendMessage } from "./telegram.mjs";
import { clearNutrilistByLogUUID, getNutriCursor, getNutrilListByDate, loadNutrilogsNeedingListing, nutriLogAlreadyListed, saveMessage, saveNutriDay, saveNutrilist, saveNutrilog, setNutriCursor } from "./db.mjs";
//uuid
import { v4 as uuidv4 } from 'uuid';
const timezone = "America/Los_Angeles";


export const processFoodListData = async (jsondata, chat_id, message_id, key, revision) => {

    const uuid = jsondata.uuid;
    const timestamp = Math.floor( Date.now() / 1000);

    if(!jsondata.food?.length) return updateMessage(chat_id, {message_id, text: "🚫 No food items detected.", choices: [["❌ Discard"]], inline:true, key});

    //save message
    if(!revision) await saveNutrilog({uuid,chat_id, timestamp, chat_id, message_id, food_data: jsondata, status: "init"});
    const {food, date, time} = jsondata;

    const colors = {
        "green": "🟢",
        "yellow": "🟡",
        "orange": "🟠"
    };
    const dateString = moment.tz(date, timezone).format("ddd, D MMM YYYY");
    const msg = `🕒 ${dateString} ${time}

${Array.isArray(food) ? 
    (food
        .sort((a,b) => {
            const colorOrder = {green: 0, yellow: 1, orange: 2};
            if(!colorOrder[a.noom_color]) return 1;
            if (colorOrder[a.noom_color] === colorOrder[b.noom_color]) return b.amount - a.amount;
            return colorOrder[a.noom_color] - colorOrder[b.noom_color];
        })
        .map((foodItem, i) => {
        if(foodItem.item && foodItem.amount && foodItem.unit && foodItem.noom_color){
            const {icon, item, amount, unit, noom_color} = foodItem;
            return `${colors[noom_color]} ${item} ${amount}${unit}`;
        }
        else{
            return `🚫 Invalid food item: ${JSON.stringify(foodItem)}`
        }
    }).join('\n')) : 
    (`🚫 No food data:\n\n${JSON.stringify(jsondata)}`)}
`;



    
    console.log(`Updating message with food list:\n${msg}`);
    await updateMessage(chat_id, {message_id, text: msg, choices: [["✅ Accept", "❌ Discard", "🔄 Revise"]], inline:true, key});

    if(!revision) return true;

    //saveMessage = async (chatId, {messageId, senderId, senderName, text, foreign_key}) => {
    const bot_id = chat_id.match(/b(\d+)/)[1];

    await saveMessage(chat_id, {messageId:message_id, senderId: bot_id, senderName: "Nutribot", text: msg, foreign_key: {nutrilog: uuid}});


};

 

export const processImageUrl = async (url, chat_id) => {


    console.log(`Processing image URL: ${url}`);

    let imgUrl = url.trim();
    const firstReponsePromise = nodeFetch(imgUrl);
    const removeReportPromise = removeCurrentReport(chat_id);
    const [firstReponse] = await Promise.all([firstReponsePromise, removeReportPromise]);
    const contentType = firstReponse.headers.get('content-type');
    console.log({url,contentType});
    const isImage = /(image|application\/octet-stream)/.test(contentType);
    let fetchedHTML = null;
    if(!isImage){
        fetchedHTML = await firstReponse.text();
        imgUrl = (fetchedHTML.match(/<meta content=["']([^"']+)["'] property=["']og:image["']>/))?.[1];     
    }
    if(!imgUrl) return false;
    try {

        let msg = await sendImageMessage(chat_id, imgUrl, "🔬 Analyzing Image...");
        let message_id = msg.result?.message_id;
        //Retry with smaller image
        if(!message_id) return console.error('No message_id found for image message', msg);
        const base64url = await getBase64Url(imgUrl);
        const jsondata = await detectFoodFromImage(base64url);
        if(!jsondata) return updateMessage(chat_id, {message_id, text: "🚫 No food items detected.", choices: [["🔄 Try Again"]], inline:true, key:"caption"});
        jsondata.img_url = imgUrl;
        return await processFoodListData(jsondata, chat_id,message_id, "caption");
    } catch (err) {
        console.error(err);
        return false;
    }
};


export const getBase64Url = async (imgUrl) => {

    const fetchedImage = await nodeFetch(imgUrl);
    const arrayBuffer = await fetchedImage.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const image = await Jimp.read(buffer);
    const resizedImage = image.resize(800, Jimp.AUTO); // resize the width to 640px. Height is auto adjusted to maintain aspect ratio
    resizedImage.quality(50);
    const resizedBuffer = await resizedImage.getBufferAsync(Jimp.MIME_JPEG); // get the buffer of the resized image
    const imgSizeKb = Math.round(resizedBuffer.length / 1024);
    console.log(`Resized image size: ${imgSizeKb} KB`);
    const base64 = resizedBuffer.toString('base64');
    const base64url = `data:image/jpeg;base64,${base64}`;
    return base64url;
}


export const handlePendingNutrilogs = async (chat_id) => {

    console.log(`Handling pending nutrilogs for chat_id: ${chat_id}`);

    const log_items_all = loadNutrilogsNeedingListing(chat_id) || [];
    const log_items = [];
    for(const log_item of log_items_all){
        const {uuid} = log_item;
      //  console.log(`Checking if log item with UUID ${uuid} is already listed.`);
        const isAlreadyListed = nutriLogAlreadyListed(uuid, chat_id);
      //  console.log(`Is log item with UUID ${uuid} already listed? ${isAlreadyListed}`);
        if(!isAlreadyListed) log_items.push(log_item);
    }

    console.log(`loadNutrilogsNeedingListing`);
    console.log(`Processing ${log_items.length} log items`);

    let max_message_id = 0;
    for(const log_item of log_items){
     //   console.log(`Processing log item: ${JSON.stringify(log_item)}`);
        const {uuid, food_data, chat_id, message_id} = log_item;
        max_message_id = Math.max(max_message_id, message_id);
        const {food, date, time, img_url} = food_data || {};
        if(!Array.isArray(food)) {
            console.log(`Skipping log item with invalid food data: ${JSON.stringify(food_data)}`);
            continue;
        }
        if(!food.length) {
            console.log(`Skipping log item with empty food list: ${JSON.stringify(food_data)}`);
            continue;
        }
   //     console.log(`Itemizing food for log item with UUID: ${uuid}`);
        const items = await itemizeFood(food, img_url);
        console.log(`Itemized food: ${JSON.stringify(items)}`);
        const saveMe = items.map(item => ({...item, chat_id, date, timeofday: time, log_uuid: uuid}));
        console.log(`Clearing existing nutrilist for UUID: ${uuid}`);
        await clearNutrilistByLogUUID(uuid, chat_id);
        console.log(`Saving nutrilist: ${JSON.stringify(saveMe)}`);
        saveNutrilist(saveMe, chat_id);
    }
    return console.log(`Processed ${log_items.length} log items`);
}


export const postItemizeFood = async (chat_id, attempt) => {
    //TODO: Fix so that it doesn't axcepct vercel
    attempt = attempt || 1;
    const{nutribot_report_host} = process.env;
const reportImgUrl = `${nutribot_report_host}/foodreport?chat_id=${chat_id}&uuid=${uuidv4()}`;
    if(attempt > 3) return await sendMessage(chat_id, `🚫 Error generating report. Please try again later.\n${reportImgUrl}`);
    await removeCurrentReport(chat_id);
    const {message_id:tmp_msg_id} = await sendMessage(chat_id, "📊 Generating report...");
    //save tmp message id as report cursor
    const earlyCursor = await getNutriCursor(chat_id);
    earlyCursor.report = {message_id: tmp_msg_id};
    setNutriCursor(chat_id, earlyCursor);
    
    await handlePendingNutrilogs(chat_id);
    console.log(`Sending report image: ${reportImgUrl}`);
    const coachingMessage = await generateCoachingMessage(chat_id, attempt);
    const msg = await sendImageMessage(chat_id, reportImgUrl, coachingMessage);
    const {message_id} = msg?.result || {}
    await deleteMessage(chat_id, tmp_msg_id);
    if(!message_id) return await postItemizeFood(chat_id, attempt+1);
    const cursor = await getNutriCursor(chat_id);
    const currentReportId = cursor?.report?.message_id;
    cursor.report = {message_id};
    let a = new Promise((resolve) => resolve(true));
    if(currentReportId !== message_id)  a = deleteMessage(chat_id, currentReportId);
    const b = setNutriCursor(chat_id, cursor);
    const c = updateMessageReplyMarkup(chat_id, {message_id, choices:[["✅ Accept", "⬅️ Adjust"]], inline: true})
    await Promise.all([a,b,c]);
    return true;
}


export const removeCurrentReport = async (chat_id) => {
    const cursor = await getNutriCursor(chat_id);
    //{ "report": { "message_id": 687 } }
    const {report} = cursor || {};
    if(!report) return;
    const {message_id} = report || {};
    if(!message_id) return;
    const a = deleteSpecificMessage(chat_id, message_id);
    delete cursor.report;
    delete cursor.adjusting;
    const b = setNutriCursor(chat_id, cursor || {});
    await Promise.all([a,b]);
    return true;
}



export const compileDailyFoodReport = async (chat_id) => {
    const pastSevenDays = Array.from({length: 7}, (_, i) => moment.tz(timezone).subtract(i, 'days').format("YYYY-MM-DD"));
    const pastWeekOfFood = pastSevenDays.reduce((acc, date) => {
        const foodList = getNutrilListByDate(chat_id, date);
        const foodListKeys = Object.keys(foodList || {});
        if(!foodListKeys.length) return acc;
        const foodItems = [];
        const foodSums = {calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0};
        foodListKeys.forEach(key => {
            const item = foodList[key];
            //eg 30g of chicken breast (100 cal)
            const label = `${item.amount}${item.unit} ${item.item} (${item.calories || 0} cal)`;
            if(!item) return;
            foodItems.push(label);
            foodSums.calories += parseInt(item.calories || 0, 10);
            foodSums.protein += parseInt(item.protein || 0, 10);
            foodSums.carbs += parseInt(item.carbs || 0, 10);
            foodSums.fat += parseInt(item.fat || 0, 10);
            foodSums.fiber += parseInt(item.fiber || 0, 10);
            foodSums.sodium += parseInt(item.sodium || 0, 10);
            foodSums.sugar = (foodSums.sugar || 0) + parseInt(item.sugar || 0, 10);
            foodSums.cholesterol = (foodSums.cholesterol || 0) + parseInt(item.cholesterol || 0, 10);

        });
        acc[date] = {
            date,
            ...foodSums,
            food_items: foodItems,
        }
        delete acc[date].chat_id;
        delete acc[date].date;
        return acc;
    }, {});

    saveNutriDay({chat_id, daily_data: pastWeekOfFood});
    return pastWeekOfFood;

}