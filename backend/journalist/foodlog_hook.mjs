/**
 * REFACTORED ARCHITECTURE - MINIMAL CURSOR USAGE
 * ===============================================
 * 
 * This file has been refactored to minimize cursor usage and only use it where absolutely necessary.
 * 
 * CURSOR IS USED FOR:
 * 1. Revision Flow (cursor.revising) - Links text input to the message being revised
 * 2. Multi-level Adjustment Menus (cursor.adjusting) - Maintains navigation state across button presses
 * 
 * MESSAGE ID LOOKUP IS USED FOR:
 * 1. UPC Portion Selection - Button press includes message_id, lookup nutrilog directly
 * 2. Accept/Discard/Clear Actions - Standard button actions on specific messages
 * 3. UPC Queue Management - Database queries instead of cursor.upc_queue
 * 
 * BENEFITS:
 * - Simpler logic - fewer state transitions
 * - More reliable - database is source of truth
 * - Better debugging - less complex state management
 * - Cleaner separation - cursor only for conversation state, message_id for record actions
 */

import { compileDailyFoodReport, getBase64Url, postItemizeFood, processFoodListData, processImageUrl, removeCurrentReport } from "./lib/food.mjs";
import dotenv from 'dotenv';
import { deleteMessage, sendImageMessage, sendMessage, transcribeVoiceMessage, updateMessage, updateMessageReplyMarkup } from "./lib/telegram.mjs";
import { deleteMessageFromDB, deleteNutrilog, getNutriCursor, setNutriCursor, getNutrilogByMessageId, getSingleMidRevisionNutrilog, saveNutrilog, getNutrilListByDate, getNutrilListByID, deleteNuriListById, updateNutrilist, saveNutrilist, getPendingUPCNutrilogs, getTotalUPCNutrilogs, updateNutrilogStatus, getNonAcceptedNutrilogs } from "./lib/db.mjs";
import { detectFoodFromImage, detectFoodFromTextDescription } from "./lib/gpt_food.mjs";
import { upcLookup } from "./lib/upc.mjs";
import moment from "moment-timezone";
import { v4 as uuidv4 } from 'uuid';
import { titleCase } from "title-case";

dotenv.config();
//canvas, axios

import axios from 'axios';
import { createCanvas, loadImage, registerFont } from 'canvas';
import { saveFile } from "../lib/io.mjs";


const assumeOldNutrilogs = async (chat_id)=>{

    const logs = getNonAcceptedNutrilogs(chat_id);
    if(!logs || logs.length === 0) return false;
    for(const log of logs) {
        const {uuid,message_id} = log;
        await updateMessageReplyMarkup(chat_id,{ message_id, choices: [], inline: false });
        await updateNutrilogStatus(chat_id, uuid, 'assumed');
    }
    return logs.length === 0; // Return true if no logs left to assume, false if there are still logs pending
}



export const processFoodLogHook = async (req, res) => {

    const {TELEGRAM_NUTRIBOT_TOKEN:token,journalist:{journalist_user_id,nutribot_telegram_bot_id:bot_id}} = process.env;
    process.env.TELEGRAM_JOURNALIST_BOT_TOKEN = token; // TODO improve multi-bot support
    const payload = (req.body && Object.keys(req.body).length > 0) ? req.body : req.query;
    const user_id = parseInt(payload.message?.chat?.id || payload.chat_id || req.query.chat_id || journalist_user_id);
    const message_id = payload.message?.message_id || payload.message_id || payload.callback_query?.message?.message_id || null;
    //console.log({payload,user_id, bot_id});
    const chat_id = `b${bot_id}_u${user_id}`;
    if(!bot_id) return res.status(400).send('No bot id found');
    if(!chat_id) return res.status(400).send('No chat id found');
    await assumeOldNutrilogs(chat_id);
    const upcFromText = /^\d+$/.test(payload.message?.text || payload.text) ? payload.message?.text || payload.text : null;
    const upc = payload.upc || upcFromText || null;
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
    if(upc) return  await processUPC(chat_id,upc, message_id, res);
    if(payload.message?.voice) await processVoice(chat_id, payload.message);
    if(text) await processText(chat_id, payload.message.message_id, text);

    //console.log(payload);
    return res.status(200).send(`Foodlog webhook received`);
};



const processUPC = async (chat_id, upc, message_id, res) => {
    // Only remove current report if there are no pending UPC items
    const pendingUPCItems = await getPendingUPCNutrilogs(chat_id);
    
    if (pendingUPCItems.length === 0) {
        await removeCurrentReport(chat_id);
    }

    if(message_id){
        //delete the message if it exists
        try {
            await deleteMessage(chat_id, message_id);
        } catch (error) {
            console.error('Error deleting message:', error);
        }
    }

    const foodData = await upcLookup(upc);
    if (!foodData) return false;// await sendMessage(chat_id, `🚫 No results for UPC ${upc}`);

    const { image, label, nutrients } = foodData;
    const sevingSizeLabel = `${parseInt(foodData.servingSizes[0]?.quantity || "0")}${foodData.servingSizes[0]?.label || 'g'}`;
    const caption = `🔵 ${titleCase(label)} (${sevingSizeLabel})`
    

    // If no nutritional data is available, just show what we found
    if (nutrients && typeof nutrients === 'object' && Object.keys(nutrients).length > 0) {
        // Prompt user for serving quantity
        const choices = [
            [{ "1": "One serving" }],
            [{ "0.25": "¼" }, { "0.33": "⅓" }, { "0.5": "½" }, { "0.67": "⅔" }, { "0.75": "¾" }, { "0.8": "⅕" }],
            [{ "1.25": "×1¼" }, { "1.5": "×1½" }, { "1.75": "×1¾" }, { "2": "×2" }, { "3": "×3" }, { "4": "×4" }],
            ["❌ Cancel"]
        ];

        const imageMsgResult = await sendImageMessage(chat_id, image, caption);
        const message_id = imageMsgResult.message_id;

        if (!message_id) {
            console.error("Failed to send image message or get message_id for UPC item:", {upc, foodData});
            await sendMessage(chat_id, "Error: Could not display food item. Please try again.");
            // It's important to send a response to the HTTP request if this is an HTTP handler
            if (res && typeof res.status === 'function') {
                res.status(500).send("Failed to send image message");
            }
            return; // Stop further processing
        }

        await updateMessageReplyMarkup(chat_id, { message_id, choices, inline: true });

        //SAVE FOOD DATA TO NUTRILOG
        const nutrilogItem = {
            uuid: uuidv4(),
            chat_id,
            upc,
            food_data: foodData,
            message_id, // Use the message_id from the image message
            status: "init" // Indicates waiting for portion selection
        };
        await saveNutrilog(nutrilogItem);

        if (res && typeof res.status === 'function') {
            res.status(200).json({nutrilogItem});
        }
    } else {
        // If no nutritional data is found, ensure a message is sent to the user
        if (image) {
            const error_caption = `${caption}\n⬜ UPC: ${upc}\n🚫 No nutritional data found`;
            await sendImageMessage(chat_id, image, error_caption);
        } else {
            await sendMessage(chat_id, error_caption);
        }
        // Ensure res.status().send() is only called if res is a valid response object
        if (res && typeof res.status === 'function') {
            res.status(200).send(`No nutritional data found for UPC ${upc}`);
        }
    }
};

const processUPCServing = async (chat_id, message_id, factor, nutrilogItem) => {
    const { food_data: foodData, uuid } = nutrilogItem;
    
    const { nutrients } = foodData;
    const adjustedNutrients = Object.keys(nutrients).reduce((acc, key) => {
        acc[key] = nutrients[key] * factor;
        return acc;
    }, {});

    foodData.nutrients = adjustedNutrients;
    await saveToNutrilistFromUPCResult(chat_id, foodData);

    const servingUnit = foodData.servingSizes[0]?.label || 'g';
    const adjustedServingQuantity = foodData.servingSizes[0]?.quantity * factor || 100;
    const servingLabel = `${adjustedServingQuantity}${servingUnit}`;

    // Update the message to include the selected serving quantity
    const updatedText = `🔵 ${titleCase(foodData.label)} (${servingLabel}) (${factor}x serving)`;
    await updateMessage(chat_id, { message_id, text: updatedText, choices: [], inline: true, key: "caption" });

    // Update this nutrilog item to confirmed status
    await updateNutrilogStatus(chat_id, uuid, "confirmed", factor);

    // Check if all UPC items are now confirmed
    const readyForReport =  assumeOldNutrilogs(chat_id);
    
    if (readyForReport) {
        // All UPC items confirmed - generate report
        await compileDailyFoodReport(chat_id);
        await postItemizeFood(chat_id);
    }

    return true;
};

export const canvasImage = async (imageUrl, label) => {
    label = titleCase(label.toLowerCase());
    // make a canvas image from the imageUrl 720p hight and 1280px width, then place the give image centered fitting the canvas, and add the label at the bottom with a black background and white text.  no stretching.  Font: Roboto, size 24px, bold.
    const canvas = createCanvas(1280, 720);
    const ctx = canvas.getContext('2d');
    const fontDir = process.env.path?.font || './backend/journalist/fonts/roboto-condensed';
    const fontPath =fontDir + '/roboto-condensed/RobotoCondensed-Regular.ttf';
    registerFont(fontPath, { family: 'Roboto' });

    const colorPairs = [
        ['#264653', '#8ecae6'], // Dark blueish green and light blue text
        ['#03045e', '#caf0f8'], // Dark blue and light cyan text
        ['#6f1d1b', '#ffe6a7'], // Dark red and light peach text
        ['#7f5539', '#e6ccb2'], // Brown and light orange text
        ['#264653', '#f4a261'], // Dark blueish green and light orange text
    ];

    const [backColor, textColor] = colorPairs[Math.floor(Math.random() * colorPairs.length)];   


    ctx.fillStyle = backColor; // Black background
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = 'bold 48px Roboto';
    ctx.textAlign = 'center';
    ctx.fillStyle = textColor; // White text
    ctx.fillText(label, canvas.width / 2, canvas.height - 30); // Draw label at the bottom
    try {
        const image = await loadImage(imageUrl);

        // Calculate dimensions to fit the image within the canvas while maintaining aspect ratio
        const canvasAspectRatio = canvas.width / canvas.height;
        const imageAspectRatio = image.width / image.height;
        let width, height;

        if (imageAspectRatio > canvasAspectRatio) {
            // Image is wider than canvas - scale by width
            width = canvas.width * 0.8; // 80% of canvas width
            height = width / imageAspectRatio;
        } else {
            // Image is taller than canvas - scale by height
            height = canvas.height * 0.8; // 80% of canvas height
            width = height * imageAspectRatio;
        }

        // Center the image on the canvas
        const x = (canvas.width - width) / 2;
        const y = (canvas.height - height) / 2 * .80;

        // Save the current context state
        ctx.save();

        // Create a rounded rectangle clipping path
        const cornerRadius = Math.min(width, height) * 0.1; // 10% corner radius
        ctx.beginPath();
        ctx.moveTo(x + cornerRadius, y);
        ctx.lineTo(x + width - cornerRadius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + cornerRadius);
        ctx.lineTo(x + width, y + height - cornerRadius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - cornerRadius, y + height);
        ctx.lineTo(x + cornerRadius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - cornerRadius);
        ctx.lineTo(x, y + cornerRadius);
        ctx.quadraticCurveTo(x, y, x + cornerRadius, y);
        ctx.closePath();
        ctx.clip();

        // Draw the image within the rounded rectangle
        ctx.drawImage(image, x, y, width, height);

        // Restore the context state
        ctx.restore();

        // Draw a 3px solid black border around the rounded rectangle
        ctx.beginPath();
        ctx.moveTo(x + cornerRadius, y);
        ctx.lineTo(x + width - cornerRadius, y);
        ctx.quadraticCurveTo(x + width, y, x + width, y + cornerRadius);
        ctx.lineTo(x + width, y + height - cornerRadius);
        ctx.quadraticCurveTo(x + width, y + height, x + width - cornerRadius, y + height);
        ctx.lineTo(x + cornerRadius, y + height);
        ctx.quadraticCurveTo(x, y + height, x, y + height - cornerRadius);
        ctx.lineTo(x, y + cornerRadius);
        ctx.quadraticCurveTo(x, y, x + cornerRadius, y);
        ctx.closePath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'black';
        ctx.stroke();
    } catch (error) {
        console.error('Error loading image:', error.message,{imageUrl});
        return false; // Return false in case of failure
    }

    return canvas.toDataURL('image/png').replace('data:image/png;base64,', '');

}

const saveToNutrilistFromUPCResult = async (chat_id, foodData) => {
    const {label, nutrients, servingSizes, servingsPerContainer} = foodData;

    const nutrientsToSave = nutrients;
    const amount = servingsPerContainer * (servingSizes && servingSizes.length > 0 ? servingSizes.reduce((max, current) => current.quantity > max.quantity ? current : max).quantity : 100); // Default to 100g if no serving size is provided
    const unit = servingSizes && servingSizes.length > 0 ? servingSizes[0].label : 'g'; // Default to the label of the first serving size if available, otherwise grams
    const uuid = uuidv4();


    const foodItem = {
        uuid,
        item: titleCase(label),
        noom_color: "blue",
        amount: parseFloat(amount),
        unit: unit || 'g',
        calories: parseInt(nutrientsToSave.calories),
        fat: parseInt(nutrientsToSave.fat),
        protein: parseInt(nutrientsToSave.protein),
        carbs: parseInt(nutrientsToSave.carbs),
        sugar: parseInt(nutrientsToSave.sugar),
        fiber: parseInt(nutrientsToSave.fiber),
        sodium: parseInt(nutrientsToSave.sodium),
        cholesterol: parseInt(nutrientsToSave.cholesterol),
        chat_id,
        date: moment().tz("America/Los_Angeles").format('YYYY-MM-DD'),
        log_uuid: "UPC"
    };
    console.log('Saving food item to nutrilist:', foodItem);
    return saveNutrilist([foodItem],chat_id );
}


const processText = async (chat_id, input_message_id, text, source = 'text') => {
    await removeCurrentReport(chat_id);
    const cursor = await getNutriCursor(chat_id);

    if (cursor.revising) {
        const pendingNutrilog = await getSingleMidRevisionNutrilog(chat_id);
        if (pendingNutrilog && pendingNutrilog.uuid === cursor.revising.uuid) {
            return await processRevision(chat_id, input_message_id, text, pendingNutrilog);
        } else {
            // Cursor is out of sync with DB, clear it to prevent unexpected behavior
            delete cursor.revising;
            setNutriCursor(chat_id, cursor);
        }
    }

    console.log('Processing text:', { chat_id, input_message_id, text });
    await deleteMessage(chat_id, input_message_id);
    const icon = source === 'voice' ? '🎙️' : '📝';
    const { message_id } = await sendMessage(chat_id, `${icon} ${text}\n\n🔬 Analyzing description...`, { saveMessage: false });
    await processTextInput(chat_id, message_id, text);
};

const processVoice = async (chat_id, message) => {
    const voice = message.voice;
    const voice_message_id = message.message_id;
    const text = await transcribeVoiceMessage(voice);
    await processText(chat_id, voice_message_id, text, 'voice');
    return true;
};

const processImgMsg = async (file_id, chat_id, host, payload) => {

    await removeCurrentReport(chat_id);

    // Validate file_id
    if (!file_id || typeof file_id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(file_id)) {
        console.error('Invalid file_id:', file_id);
        await sendMessage(chat_id, '🚫 Invalid file identifier provided.');
        return false;
    }

    const tmpUrl = `${host}/telegram/img?file_id=${file_id}`;
    const message_id = payload.message.message_id;

    try {
        const a = await deleteMessage(chat_id, message_id);
        const b = await processImageUrl(tmpUrl, chat_id);
        await Promise.all([a, b]);
    } catch (error) {
        console.error('Error processing image message:', error);
        await sendMessage(chat_id, '🚫 Failed to process image message.');
        return false;
    }

    return true;
};


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
        setNutriCursor(chat_id, cursor);
        return await processRevisionButtonpress(chat_id, message_id, adjusting.date);
    }

    const {level} = adjusting;

    // Remove UPC handling from here - now handled by message ID lookup in processButtonpress

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
            [{"0.25":"¼"}, {"0.33":"⅓"}, {"0.5":"½"}, {"0.67":"⅔"}, {"0.75":"¾"}, {"0.8":"⅕"}],
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
        if(isNaN(factor) && choice === '🗑️ Delete'){
            console.log('Deleting item', {chat_id, uuid});
            const r = await deleteNuriListById(chat_id, uuid);
            console.log('Delete result', r);
            const cursor = await getNutriCursor(chat_id);
            delete cursor.adjusting;
            setNutriCursor(chat_id, cursor);
            return await postItemizeFood(chat_id);
        }
        if(isNaN(factor) && choice === '📅') {
            // Handle move day functionality
            cursor.adjusting.level = 3; // New level for date selection
            setNutriCursor(chat_id, cursor);
            const createRow = (start, end, today) => {
                return Array.from({length: end-start+1}, (_, i) => i + start)
                    .map(i => moment(today).subtract(i, 'days').format('YYYY-MM-DD'))
                    .map((j,i) => ({[j]: i === 0 && start === 1 ? "Yesterday" : `${start+i} days ago`}));
            }
            const today = moment().tz("America/Los_Angeles").format('YYYY-MM-DD');
            const firstRow = createRow(1, 3, today);
            const secondRow = createRow(4, 6, today);
            const choices = [[{[today]:"☀️ Today"}], firstRow, secondRow, ["↩️ Back"]];
            return await updateMessage(chat_id, {message_id, text: "📅 Move to which date?", choices, inline: true, key: "caption"});
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
    if(level === 3) { // We just received the new date for moving the item
        const uuid = cursor.adjusting.uuid;
        
        // Handle back button
        if(/^↩️/.test(choice)) {
            cursor.adjusting.level = 2; // Go back to adjustment menu
            setNutriCursor(chat_id, cursor);
            
            const listItem = await getNutrilListByID(chat_id, uuid);
            if(!listItem) return console.error('No list item found for uuid', {chat_id, uuid});
            const {item, noom_color, amount, unit, calories, fat, protein, carbs} = listItem || {};
            const emoji = noom_color === 'green' ? '🟢' : noom_color === 'yellow' ? '🟡' : noom_color === "orange" ? '🟠' : "🔴";
            const text = `${emoji} ${item.trim()} (${`${amount}`.trim()}${unit.trim()})\n🔥 ${parseInt(calories)} cal\n🧀 ${parseInt(fat)}g 🍖 ${parseInt(protein)}g 🍏 ${parseInt(carbs)}g\n\n↕️ How to adjust?`;
            const choices = [
                [{"0.25":"¼"}, {"0.33":"⅓"}, {"0.5":"½"}, {"0.67":"⅔"}, {"0.75":"¾"}, {"0.8":"⅕"}],
                [{"1.25":"×1¼"}, {"1.5":"×1½"}, {"1.75":"×1¾"}, {"2":"×2"}, {"3":"×3"}, {"4":"×4"}],
                ["🗑️ Delete", {"📅":"📅 Move Day"},"↩️ Done"]
            ];
            return await updateMessage(chat_id, {message_id, text, choices, inline: true, key: "caption"});
        }
        
        const newDate = moment.tz(choice, "America/Los_Angeles").format('YYYY-MM-DD');
        
        // Update the item's date
        await updateNutrilist(chat_id, uuid, { date: newDate });
        
        // Clear adjusting state
        delete cursor.adjusting;
        setNutriCursor(chat_id, cursor);
        
        // Show success and refresh the report
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

    // Handle cancel action directly
    if (choice === '❌ Cancel' || choice === '❌ Discard') {
        await deleteMessage(chat_id, messageId);
        
        // If canceling a UPC item, update its status
        const nutrilogItem = await getNutrilogByMessageId(chat_id, messageId);
        if (nutrilogItem?.upc) {
            await updateNutrilogStatus(chat_id, nutrilogItem.uuid, "canceled");
        }
        
        // Clean up any cursor state
        const cursor = await getNutriCursor(chat_id);
        if (cursor.adjusting) delete cursor.adjusting;
        if (cursor.revising) delete cursor.revising;
        setNutriCursor(chat_id, cursor);
        return true;
    }

    // First check if this is a UPC portion selection (message-based)
    const nutrilogItem = await getNutrilogByMessageId(chat_id, messageId);
    if (nutrilogItem?.upc && nutrilogItem.status === "init") {
        const factor = parseFloat(choice);
        if (!isNaN(factor)) {
            return await processUPCServing(chat_id, messageId, factor, nutrilogItem);
        }
    }

    // Check if this is a revision flow (cursor-based)
    const cursor = await getNutriCursor(chat_id);
    if (cursor.adjusting || leadingEmoji === '⬅️') {
        return processRevisionButtonpress(chat_id, messageId, choice);
    }

    // Handle standard nutrilog actions (message-based)
    if (nutrilogItem && !nutrilogItem.upc) {
        const {uuid, food_data} = nutrilogItem;
        if (!uuid) return console.error('No uuid found for nutrilog item', nutrilogItem);
        if (leadingEmoji === '✅') return await acceptFoodLog(chat_id, messageId, uuid, food_data);
        if (leadingEmoji === '❌') return await discardFoodLog(chat_id, messageId, uuid);
        if (leadingEmoji === '🔄') return await reviseFoodLog(chat_id, messageId, uuid, nutrilogItem);
    }

    // Handle simple navigation actions
    if (["✅","⭐"].includes(leadingEmoji)) return await clearKeyboard(chat_id, messageId);
    if (leadingEmoji === '↩️') return await postItemizeFood(chat_id);
    
    return false;
};

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

    //Handle any Pending Nutrilogs - restore original choices for previous revision
    const {revising} = cursor;
    if(revising?.message_id && revising?.uuid) {
        // Restore original choices for the previous item in revision
        await updateMessageReplyMarkup(chat_id, {
            message_id: revising.message_id, 
            choices: [["✅ Accept", "❌ Discard", "🔄 Revise"]], 
            inline: true
        });
        // Reset the previous nutrilog status back to initial state
        saveNutrilog({uuid: revising.uuid, chat_id, message_id: revising.message_id, food_data, status: "init"});
        delete cursor.revising;
        setNutriCursor(chat_id, cursor);
    }

    //Process Current Nutrilog
    cursor['revising'] = {message_id, uuid};
    setNutriCursor(chat_id, cursor);
    await updateMessageReplyMarkup(chat_id, {message_id, choices:[["🗒️ Input your revision:"]], inline: true});
    saveNutrilog({uuid, chat_id, food_data, message_id, status: "revising"});
    return true;

}

const processTextInput = async (chat_id, message_id, text) => {
    // Revision check is now handled in processText
    const jsondata = await detectFoodFromTextDescription(text);
    if (!jsondata) return updateMessage(chat_id, { message_id, text: "🚫 No food items detected.", choices: [["🔄 Try Again"]], inline: true, key: "caption" });
    jsondata.text = text;
    return await processFoodListData(jsondata, chat_id, message_id);
};


const processRevision = async (chat_id, feedback_message_id, text, {message_id, uuid, food_data}) => {

    console.log('Processing revision', {chat_id, feedback_message_id, text, message_id, uuid, food_data});
    
    // Clear the revising state from the cursor now that we have the revision text
    const cursor = await getNutriCursor(chat_id);
    if (cursor.revising) {
        delete cursor.revising;
        await setNutriCursor(chat_id, cursor);
    }

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

