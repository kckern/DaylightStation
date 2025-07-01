import { compileDailyFoodReport, getBase64Url, postItemizeFood, processFoodListData, processImageUrl, removeCurrentReport } from "./lib/food.mjs";
import dotenv from 'dotenv';
import { deleteMessage, sendImageMessage, sendMessage, transcribeVoiceMessage, updateMessage, updateMessageReplyMarkup } from "./lib/telegram.mjs";
import { deleteMessageFromDB, deleteNutrilog, getNutriCursor, setNutriCursor, getNutrilogByMessageId, getPendingNutrilog, saveNutrilog,  getNutrilListByDate, getNutrilListByID, deleteNuriListById, updateNutrilist, saveNutrilist } from "./lib/db.mjs";
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

    // Periodically check for auto-confirmation of pending UPC items
    if (Math.random() < 0.1) { // 10% chance to check on each webhook
        await autoConfirmPendingUPCItems(chat_id);
    }

    //console.log(payload);
    return res.status(200).send(`Foodlog webhook received`);
};



const processUPC = async (chat_id, upc, message_id, res) => {
    // Only remove current report if there are no pending UPC items
    const cursor = await getNutriCursor(chat_id);
    const hasPendingUPC = cursor?.upc_queue && cursor.upc_queue.some(item => item.status === 'pending');
    
    if (!hasPendingUPC) {
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
            [{ "0.25": "¼" }, { "0.33": "⅓" }, { "0.5": "½" }, { "0.67": "⅔" }, { "0.75": "¾" }, { "0.8": "⅘" }],
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
            status: "init"
        };
        await saveNutrilog(nutrilogItem);

        let cursor = await getNutriCursor(chat_id);
        
        // Initialize UPC queue if it doesn't exist
        if (!cursor.upc_queue) {
            cursor.upc_queue = [];
        }
        
        // Add this UPC item to the queue
        const queueId = uuidv4(); // Unique identifier for this queue item
        cursor.upc_queue.push({
            id: queueId,
            upc,
            foodData,
            message_id,
            status: 'pending',
            timestamp: Date.now()
        });
        
        cursor.adjusting = { upc, foodData, message_id, queueId }; // Set level to 2 to indicate we're adjusting serving size
        cursor.upc = true; // Flag to indicate we're in UPC flow

        setNutriCursor(chat_id, cursor);
        // Ensure res.status().json() is only called if res is a valid response object



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

const processServingQuantity = async (chat_id, message_id, factor) => {
    const cursor = await getNutriCursor(chat_id);
    if (!cursor || !cursor.adjusting?.foodData) {
        await sendMessage(chat_id, `🚫 No food data found for UPC adjustment. Cursor: ${JSON.stringify(cursor)}`);
        return false;
    }

    const { foodData } = cursor.adjusting;

    const { nutrients } = foodData;
    const adjustedNutrients = Object.keys(nutrients).reduce((acc, key) => {
        acc[key] = nutrients[key] * factor;
        return acc;
    }, {});

    foodData.nutrients = adjustedNutrients;
    await saveToNutrilistFromUPCResult(chat_id, foodData);

    const servingUnit = foodData.servingSizes[0]?.label || 'g'; // Default to grams if no serving size is provided
    const adjustedServingQuantity = foodData.servingSizes[0]?.quantity * factor || 100; // Default to 100g if no serving size is provided
    const servingLabel = `${adjustedServingQuantity}${servingUnit}`; // e.g., "300g" 

    // Update the message to include the selected serving quantity
    const updatedText = `🔵 ${titleCase(foodData.label)} (${servingLabel}) (${factor}x serving)`;

    //update message with updated caption and clear choices
    await updateMessage(chat_id, { message_id, text: updatedText, choices: [], inline: true, key: "caption" });

    // Update the UPC queue item status
    if (cursor.upc_queue && cursor.adjusting?.queueId) {
        const queueItem = cursor.upc_queue.find(item => item.id === cursor.adjusting.queueId);
        if (queueItem) {
            queueItem.status = 'confirmed';
            queueItem.factor = factor;
        }
    }

    // Check if all UPC items in queue are confirmed
    const allConfirmed = cursor.upc_queue?.every(item => item.status === 'confirmed') ?? false;
    
    // Only generate report if all UPC items are confirmed
    if (allConfirmed) {
        await compileDailyFoodReport(chat_id);
        await postItemizeFood(chat_id);
        
        // Clear the UPC queue after generating report
        cursor.upc_queue = [];
        cursor.upc = false;
    } else {
        // Notify user about pending items
        await checkPendingUPCItems(chat_id);
    }

    delete cursor.adjusting;
    setNutriCursor(chat_id, cursor);
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
        console.error('Error loading image:', error);
        throw new Error('Failed to load image for canvas');
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

    const {level, upc} = adjusting;

    if(upc) {
        // Handle UPC adjustment
        const factor = parseFloat(choice);
        if(isNaN(factor)) return await sendMessage(chat_id, `🚫 Invalid factor selected for UPC adjustment. ${JSON.stringify(choice)}`);
        const result = await processServingQuantity(chat_id, message_id, factor);
        console.log('UPC adjustment result:', result);
        return result;

    }else if(level === 0) { //We just received the date
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
                [{"0.25":"¼"}, {"0.33":"⅓"}, {"0.5":"½"}, {"0.67":"⅔"}, {"0.75":"¾"}, {"0.8":"⅘"}],
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


const checkPendingUPCItems = async (chat_id) => {
    const cursor = await getNutriCursor(chat_id);
    if (!cursor?.upc_queue) return;
    
    const pendingItems = cursor.upc_queue.filter(item => item.status === 'pending');
    const confirmedItems = cursor.upc_queue.filter(item => item.status === 'confirmed');
    
    if (pendingItems.length > 0 && confirmedItems.length > 0) {
        const pendingCount = pendingItems.length;
        const confirmedCount = confirmedItems.length;
        const totalCount = cursor.upc_queue.length;
        
        // Send a status message
        await sendMessage(chat_id, `📊 Status: ${confirmedCount}/${totalCount} items confirmed. ${pendingCount} items still need portion selection. Report will generate after all items are confirmed.`);
    }
};

const autoConfirmPendingUPCItems = async (chat_id, timeoutMinutes = 5) => {
    const cursor = await getNutriCursor(chat_id);
    if (!cursor?.upc_queue) return false;
    
    const now = Date.now();
    let hasAutoConfirmed = false;
    
    for (const item of cursor.upc_queue) {
        if (item.status === 'pending') {
            // Check if item is older than timeout
            const itemAge = now - (item.timestamp || now);
            if (itemAge > timeoutMinutes * 60 * 1000) {
                // Auto-confirm with 1 serving
                item.status = 'confirmed';
                item.factor = 1;
                item.autoConfirmed = true;
                hasAutoConfirmed = true;
                
                // Update the message to show auto-confirmation
                const updatedText = `🔵 ${titleCase(item.foodData.label)} (1 serving) ⏰ Auto-confirmed`;
                await updateMessage(chat_id, { 
                    message_id: item.message_id, 
                    text: updatedText, 
                    choices: [], 
                    inline: true, 
                    key: "caption" 
                });
                
                // Save to nutrilist
                await saveToNutrilistFromUPCResult(chat_id, item.foodData);
            }
        }
    }
    
    if (hasAutoConfirmed) {
        // Check if all items are now confirmed
        const allConfirmed = cursor.upc_queue.every(item => item.status === 'confirmed');
        if (allConfirmed) {
            await compileDailyFoodReport(chat_id);
            await postItemizeFood(chat_id);
            cursor.upc_queue = [];
            cursor.upc = false;
            setNutriCursor(chat_id, cursor);
            
            const autoConfirmedCount = cursor.upc_queue.filter(item => item.autoConfirmed).length;
            await sendMessage(chat_id, `⏰ Auto-confirmed ${autoConfirmedCount} pending items with default serving sizes. Report generated.`);
        }
    }
    
    return hasAutoConfirmed;
};

const processButtonpress = async (body, chat_id) => {


    const messageId = body.callback_query.message?.message_id; 
    const choice = body.callback_query.data;
    const leadingEmoji = choice?.match(/^\S+/g)[0];
    console.log({leadingEmoji, choice});

    console.log('Processing button press', leadingEmoji);
    const cursor = await getNutriCursor(chat_id);

    // Handle cancel action directly
    if (choice === '❌ Cancel' || choice === '❌ Discard') {
        await deleteMessage(chat_id, messageId);
        
        // If canceling a UPC item, remove it from the queue
        if (cursor.upc_queue && cursor.adjusting?.queueId) {
            cursor.upc_queue = cursor.upc_queue.filter(item => item.id !== cursor.adjusting.queueId);
            
            // If no more UPC items in queue, clear UPC flag
            if (cursor.upc_queue.length === 0) {
                cursor.upc = false;
            }
        }
        
        if (cursor.adjusting) delete cursor.adjusting;
        setNutriCursor(chat_id, cursor);
        return true;
    }

    // Handle UPC flow
    if (cursor.upc) {
        const factor = parseFloat(choice);
        if (isNaN(factor)) {
            console.error('Invalid factor for UPC adjustment', {chat_id, messageId, choice});
            return false;
        }
        const result = await processServingQuantity(chat_id, messageId, factor);
        if (!result) {
            console.error('Failed to process serving quantity', {chat_id, messageId, choice});
            return false;
        }
        
        // Don't clear cursor.adjusting and cursor.upc here anymore - 
        // processServingQuantity handles this based on queue status
        return true;
    }

    // Handle revision flow
    if (cursor.adjusting || leadingEmoji === '⬅️') {
        return processRevisionButtonpress(chat_id, messageId, choice);
    }

    const nutrilogItem = await getNutrilogByMessageId(chat_id, messageId);
    console.log({nutrilogItem});
    if (!nutrilogItem) {
        if (["✅","⭐"].includes(leadingEmoji)) return await clearKeyboard(chat_id, messageId);
        if (leadingEmoji === '↩️') return await postItemizeFood(chat_id);
        return false;
    }

    const {uuid, food_data} = nutrilogItem;
    if (!uuid) return console.error('No uuid found for nutrilog item', nutrilogItem);
    if (leadingEmoji === '✅') return await acceptFoodLog(chat_id, messageId, uuid, food_data);
    if (leadingEmoji === '❌') return await discardFoodLog(chat_id, messageId, uuid);
    if (leadingEmoji === '🔄') return await reviseFoodLog(chat_id, messageId, uuid, nutrilogItem);
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

