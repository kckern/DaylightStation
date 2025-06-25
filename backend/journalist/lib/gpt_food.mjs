import dotenv from 'dotenv';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment-timezone';
import { getBase64Url } from './food.mjs';
import { getMostRecentNutrilistItems, getNutriDay, getNutriDaysBack, getNutrilListByDate, getNutrilog, saveNutriCoach } from './db.mjs';
import { loadFile, saveFile } from '../../lib/io.mjs';
import crypto from 'crypto';
dotenv.config();


const md5 = (string) => {
    string = string.toString();
    return crypto.createHash("md5").update(string).digest("hex");
}


const extractJSON = (openaiResponse) => {
    const jsonString =  openaiResponse
    .replace(/^[^{\[]*/s, '')
    .replace(/[^}\]]*$/s, '').trim()

  
    let json = {};
    try {
        json = JSON.parse(jsonString);
    } catch (error) {
        console.error('Failed to parse JSON:', error.message);
        console.error('JSON:', openaiResponse);
        return {};
    }
    return json;

}

const icons = `almond apple_sauce apple artichoke asparagus avocado bacon bagel baguette baked_beans bamboo banana bananapepper bar beef beer beet biscuit biscuitcracker black_bean black_olive blackberry blueberry_bagel blueberry breadsticks breakfast breakfastsandwich broccoli brown_spice brown_sugar brownie brussels_sprout burrito butter cabbage cake calamari calories candy candybar carrot_cupcake carrot cashew casserole cauliflower celery cereal_bar cereal cheese cheesecake cherry chestnut chicken_wing chicken chickentenders chickpea chocolate_chip_bagel chocolate_frosting chocolate_milk_shake chocolate chocolatechip chocolatechips christmas_cookie churro cider cinnamon_roll clam coconut coffee coleslaw cookie corn cornbread cottage_cheese crab cracker cranberry cream croissant crouton cucumber cupcake curry date default deli_meat dinner_roll dish donut dumpling eclair egg_roll egg eggplant enchilada falafel fern fig filbert fish fowl french_fries french_toast fritter fruit_cocktail fruit_leather game garlic gobo_root gourd graham_cracker grain grapefruit grapes green_bean green_bell_pepper green_dip green_olive green_spice grilled_cheese 
guava gummybear hamburger_bun hamburger_patty hamburger hash hazelnut honey horseradish hot_dog_bun hot_dog hotpot ice_cream_bar ice_cream_sandwich ice_cream iced_coffee iced_tea jam jicama juice kale kebab ketchup kiwi lamb lasagna latte leeks lemon lemonade lime lobster macadamia macandcheese mango marshmallow mayonnaise meatballs melon milk_shake milk mixed_drink mixed_nuts molassescookie muffin mushroom mustard nigirisushi oatmeal octopus oil okra omelette onion orange_juice orange orangechicken pancakes papaya parfait parsnip pasta pastry pattysandwich pavlova peach peanut_butter peanut pear peas pecan peppers persimmon pickle pie_apple pie pill pine_nut pineapple pistachio pitasandwich pizza plum pocky pomegranate popcorn popsicle pork porkchop pot_pie potato_chip potato_salad potato powdereddrink prawn pretzel prune pudding pumpkin quesadilla quiche radish raisin ranch_dressing raspberry ravioli red_bean red_bell_pepper red_dip red_spice red_velvet_cookie red_wine relish rhubarb ribs rice_cake rice roll romaine salad salt sandwich sauce sausage seaweed seed sesame_bagel shallot shrimp smoothie snack snap_bean soft_drink souffle soup sour_cream soy_nut soysauce spaghetti_squash spinach springroll sprouts squash starfruit stewbrown stewyellow stir_fry stirfrynoodles strawberry_milk_shake strawberry stuffing sub_sandwich sugarcookie sushi syrup taco taro tater_tots tea tempura toast toaster_pastry tofu tomato tomatosoup tortilla_chip tortilla tostada turkey turnip turnover vanilla_cupcake vegetable waffles walnut water_chestnut water watermelon white_bean white_bread white_sugar white_wine wrap yam yellow_bell_pepper yellow_drink yellow_frosting yellow_spice yogurt zucchini`.replace(/\n/g, ' ');


    const timezone = process.env.TIMEZONE || 'America/Los_Angeles';
export const getCurrentTimeDetails = () => {
    const timezone = process.env.TIMEZONE || 'America/Los_Angeles';

    const today = moment().tz(timezone).format('YYYY-MM-DD');
    const dayOfWeek = moment().tz(timezone).format('dddd');
    const timeAMPM = moment().tz(timezone).format('h:mm a');
    const hourOfDayInt = parseInt(moment().tz(timezone).hour());
    const unix = moment().tz(timezone).unix();
    const momentTimezone = moment.tz.guess();

    const time = hourOfDayInt < 12 ? "morning" : hourOfDayInt < 17 ? "midday" : hourOfDayInt < 21 ? "evening" : "night";

    return { today,timezone, dayOfWeek, timeAMPM, hourOfDayInt, unix, momentTimezone, time };
};

// Replace hardcoded timezone with variable

export const getInstructions = () => {

    const { today, dayOfWeek, timeAMPM, timezone, unix, momentTimezone, time } = getCurrentTimeDetails();
    return `List the food items in them, output in a JSON object which contains keys: 
                 - "food" an array with the food icon, item name, amount (integer), and unit (g, ml, etc.), and noom color (green, yellow, orange).
                 - "date," the date of the meal.  Usually the current date (today is ${dayOfWeek}, ${today} at ${timeAMPM}, TZ: ${timezone} (${momentTimezone}), unix time: ${unix} ), but could be in the past, if the description mentions a timeframe, such as "yesterday" or "on wednesday".  If the date is already specified in a previous attempt, keep that one, unless the user specifies a new date.
                 - "time," the time of the meal.  Usually "midday" or "evening", but could be "morning" or "night".  Default is "${time}", unless the user specifies a different time for the meal.
                 
                 For example:
                    { 
                    "date": "2024-04-01",
                    "time": "midday",
                    "food": 
                    [
                        {
                          "icon": "mango",
                          "item": "Mango",
                          "unit": "g",
                          "amount": 150,
                          "noom_color": "yellow"
                        },
                        {
                          "icon": "apple",
                          "item": "Apple",
                          "unit": "g",
                          "amount": 100,
                          "noom_color": "green"
                        },
                        {
                          "icon": "kale",
                          "item": "Kale",
                          "unit": "g",
                          "amount": 67,
                          "noom_color": "green"
                        },
                        {
                          "icon": "powdereddrink",
                          "item": "Visalus",
                          "unit": "g",
                          "amount": 26,
                          "noom_color": "yellow"
                        },
                        {
                          "icon": "peanut_butter",
                          "item": "Jif Crunchy Peanut Butter",
                          "unit": "g",
                          "amount": 32,
                          "noom_color": "orange"
                        }
                      ],
                    }
                    
                    Additional instructions:
                     - Markdown output is prohibited
                     - Consumer is a backend processor without markdown render environment
                     - you are communicating with an API, not a user
                     - Begin all AI responses with the character ‘{’ to produce valid JSON
                     - Assume that each food item string will be used to search for nutrition information in a database.
                     - Therefore, avoid parenthes, compound "or" statements, and other non-general words that would compromise the search.
                     - "item" is not a unit; estimate the amount in grams, milliliters, or other standard units.
                     - You are welcome to name brands if you can identify them.
                     - Ignore items in the background or the periphery of the image.
                     - If you know the UPC or other identifier, you can include it as the 4th item (key val object) in the food array.
                     - Do not include any commentary, just JSON data.
                     - Sort the food items so that the largest portion is first, the second largest is second, smallest is last, etc.

                     - Noom colors are: green, yellow, orange.
                        1. Green Foods: These are foods with the lowest calorie density, meaning they provide the least amount of calories for the greatest amount of volume. They make great options for filling up without overdoing it on calories. Examples include frozen vegetables, canned vegetables, jarred salsa, canned tuna, frozen fruits, whole grain bread, whole grain pasta, quinoa, and rolled oats.
                        2. Yellow Foods: These foods have a moderate calorie density, so they fall in the middle range. It's recommended to be mindful of portions when consuming yellow foods. Examples include instant potatoes, low-sodium canned soups, chickpeas, frozen fish, frozen chicken, popcorn, whole wheat or corn tortillas, and white rice and pasta.
                        3. Orange Foods: These have the highest calorie density, meaning they pack the most calories for the smallest amount of food. The system recommends being even more mindful of portions when eating orange foods. Examples include frozen entrees, dried beans, nut butters, jerky, dried fruits, crackers, biscuits, bagels, and protein powders.

                     - Food icon must be selected from one of the following:
                        ${icons}`;
};


// Abstract GPT call function
const gptCall = async (endpoint, payload) => {
    try {
        const response = await axios.post(endpoint, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            }
        });
        const month = moment().tz(timezone).format('YYYY-MM');
        saveFile(`gpt/food/${month}/${Date.now()}`, {in: payload, out: response.data});

        return response.data;
    } catch (error) {
        console.error('Error during GPT call:', error);
        throw error;
    }
};

// Update detectFoodFromImage to use gptCall
export const detectFoodFromImage = async (imgUrl, extras, attempt = 1) => {
    //console.log('detectFoodFromImage', {imgUrl,extras});
    attempt = attempt || 1;
    extras = extras || {};

    const {food_data,text} = extras;

    const extra_messages = food_data && text ? [
        { role: "assistant", content: JSON.stringify(food_data)},
        { role: "user", content: `Close, but needs some revisions based on clarifications from the user.` },
        { role: "assistant", content: `What did this user say?`},
        { role: "user", content: `User clarification: “${text}”` },
        { role: "assistant", content: `I see, I think I know what to change and adjust.  Shall I proceed?`},
        { role: "user", content: `Yes, please proceed; revise the food list.  Do not remove any items, just add to, replace, or correct item(s), unless the clarification you received tells you explicitly to remove any specific item(s) or that a stated item is not present.`},
        { role: "assistant", content: `Got it.  Should I still response in pure JSON format?`},
        { role: "user", content: `Yes, please respond in pure JSON format, no commentary or markdown.`}
    ] : [];


    if(attempt > 3) return false;

    console.log('Analyzing image...');

    const data = {
        model: 'gpt-4o',
        messages: [
            {
                role: 'system',
                content: `You are nutrition seer. You look at images and process them like this:
                ${getInstructions()}`
            
            },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'This is my food.  What should I be logging?' },
                    { type: 'image_url', image_url: { url: imgUrl } },
                ]
            },
            ...extra_messages
        ],
        max_tokens: 1000
    };

    try {
        const response = await gptCall('https://api.openai.com/v1/chat/completions', data);
        const description = response.choices?.[0]?.message?.content;
        const json = extractJSON(description);
        json.uuid = uuidv4();
        return json;
    } catch (error) {
        console.error('Error describing image:', error);
        return await detectFoodFromImage(imgUrl, extras, attempt + 1);
    }
};


// Update detectFoodFromTextDescription to use gptCall
export const detectFoodFromTextDescription = async (text, attempt = 1) => {
    attempt = attempt || 1;

    if(attempt > 3) return false;

    console.log('Analyzing text...');

    const data = {
        model: 'gpt-4o',
        messages: [
            {
                role: 'system',
                content: `You are nutrition reader. You read text descriptions of meals and snacks and process them like this:
                ${getInstructions()}`
            },
            {
                role: 'user',
                content: [
                    { type: 'text', text: text }
                ]
            }
        ],
        max_tokens: 1000
    };

    try {
        const response = await gptCall('https://api.openai.com/v1/chat/completions', data);
        const description = response.choices?.[0]?.message?.content;
        const json = extractJSON(description);
        json.uuid = uuidv4();
        json.date = json.date || today;
        json.time = json.time || "midday";
        json.food = json.food || null;
        return json;
    } catch (error) {
        console.error('Error describing text:', error);
        return await detectFoodFromTextDescription(text, attempt + 1);
    }
};

// Update itemizeFood to use gptCall
export const itemizeFood = async (foodList, img, attempt = 1) => {

    console.log('itemizeFood', {foodList,img});
    attempt = attempt || 1;

    const foodString = foodList.map(item => item.item).join(' • ');
    console.log(`Itemizing food: ${foodString}`, {attempt,img});
    if(attempt > 3) return false;

    foodList = foodList || [ { "icon": "peanut_butter", "item": "Crunchy Peanut Butter", "unit": "g", "amount": 60, "noom_color": "orange" }, { "icon": "cheddar", "item": "Colby Jack Cheddar Cheese", "unit": "g", "amount": 64, "noom_color": "orange" } ]

    const instructions = `Take the given food list and expand the values of each item to include the following:  calories, fat, carbs, protein, fiber, sugar, sodium, and cholesterol.
    
    Return only a JSON array, no commentary or markdown.  Your output will be consumed by a backend processor usign JSON.parse().

    Start every response with the character '[' to produce valid JSON array.
    `;

    const imgExtraMessages = img ? [{
        role: "assistant",
        content: `I see you included an image.  Shall I describe the food in the image?`
    },
    {
        role: "user",
        content: `No, simply use the image to inform your food itemization task as usual.  Reply in JSON, as you normally would.`
    }] : [];

    const messages = [
        {
            role: 'system',
            content: `${instructions}`
        },
        {
            role: 'user',
            content: JSON.stringify([ { "icon": "peanut_butter", "item": "Crunchy Peanut Butter", "unit": "g", "amount": 60, "noom_color": "orange" }, { "icon": "cheddar", "item": "Colby Jack Cheddar Cheese", "unit": "g", "amount": 64, "noom_color": "orange" } ])
        },
        {
            role: 'assistant',
            content: `[ { "icon": "peanut_butter", "item": "Crunchy Peanut Butter", "unit": "g", "amount": 60, "noom_color": "orange", "calories": 340, "fat": 16, "carbs": 15, "protein": 18, "fiber": 3, "sugar": 7, "sodium": 250, "cholesterol": 0 }, { "icon": "cheddar", "item": "Colby Jack Cheddar Cheese", "unit": "g", "amount": 64, "noom_color": "orange", "calories": 220, "fat": 18, "carbs": 0, "protein": 14, "fiber": 0, "sugar": 0, "sodium": 360, "cholesterol": 60 } ]`
        },
        {
            role: 'user',
            content: JSON.stringify([ { "icon": "ramen", "item": "Korean Instant Ramen (Spicy)", "unit": "package", "amount": 1, "noom_color": "orange" }, { "icon": "egg", "item": "Soft Boiled Egg", "unit": "g", "amount": 50, "noom_color": "green" }, { "icon": "green_onion", "item": "Chopped Green Onion", "unit": "g", "amount": 10, "noom_color": "green" }, { "icon": "seaweed", "item": "Dried Seaweed", "unit": "g", "amount": 5, "noom_color": "green" }, { "icon": "kimchi", "item": "Kimchi", "unit": "g", "amount": 50, "noom_color": "green" } ])
        },
        {
            role: 'assistant',
            content: `[ { "icon": "ramen", "item": "Korean Instant Ramen (Spicy)", "unit": "package", "amount": 1, "noom_color": "orange", "calories": 500, "fat": 20, "carbs": 66, "protein": 10, "fiber": 3, "sugar": 3, "sodium": 1580, "cholesterol": 0 }, { "icon": "egg", "item": "Soft Boiled Egg", "unit": "g", "amount": 50, "noom_color": "green", "calories": 68, "fat": 5, "carbs": 1, "protein": 6, "fiber": 0, "sugar": 1, "sodium": 62, "cholesterol": 186 }, { "icon": "green_onion", "item": "Chopped Green Onion", "unit": "g", "amount": 10, "noom_color": "green", "calories": 3, "fat": 0.1, "carbs": 0.6, "protein": 0.2, "fiber": 0.2, "sugar": 0.2, "sodium": 1, "cholesterol": 0 }, { "icon": "seaweed", "item": "Dried Seaweed", "unit": "g", "amount": 5, "noom_color": "green", "calories": 17, "fat": 0, "carbs": 3, "protein": 2, "fiber": 0.5, "sugar": 0, "sodium": 87, "cholesterol": 0 }, { "icon": "kimchi", "item": "Kimchi", "unit": "g", "amount": 50, "noom_color": "green", "calories": 15, "fat": 1, "carbs": 2, "protein": 1, "fiber": 1, "sugar": 1, "sodium": 670, "cholesterol": 0 } ]`
        },
        {
            role: 'user',
            content: JSON.stringify([ { "icon": "steak", "item": "Grilled Sirloin Steak", "unit": "g", "amount": 200, "noom_color": "orange" }, { "icon": "sweet_potato", "item": "Baked Sweet Potato", "unit": "g", "amount": 150, "noom_color": "yellow" }, { "icon": "green_beans", "item": "Steamed Green Beans", "unit": "g", "amount": 100, "noom_color": "green" }, { "icon": "red_wine", "item": "Red Wine", "unit": "ml", "amount": 150, "noom_color": "yellow" } ])
        },
        {
            role: 'assistant',
            content: `[ { "icon": "steak", "item": "Grilled Sirloin Steak", "unit": "g", "amount": 200, "noom_color": "orange", "calories": 366, "fat": 14, "carbs": 0, "protein": 58, "fiber": 0, "sugar": 0, "sodium": 122, "cholesterol": 153 }, { "icon": "sweet_potato", "item": "Baked Sweet Potato", "unit": "g", "amount": 150, "noom_color": "yellow", "calories": 135, "fat": 0.2, "carbs": 31, "protein": 2.5, "fiber": 5, "sugar": 6.5, "sodium": 72, "cholesterol": 0 }, { "icon": "green_beans", "item": "Steamed Green Beans", "unit": "g", "amount": 100, "noom_color": "green", "calories": 35, "fat": 0.1, "carbs": 8, "protein": 2, "fiber": 3.4, "sugar": 1.5, "sodium": 6, "cholesterol": 0 }, { "icon": "red_wine", "item": "Red Wine", "unit": "ml", "amount": 150, "noom_color": "yellow", "calories": 125, "fat": 0, "carbs": 3.8, "protein": 0.1, "fiber": 0, "sugar": 0.9, "sodium": 5, "cholesterol": 0 } ]`
        },
        {
            role: 'user',
            content: JSON.stringify([ { "icon": "egg", "item": "Scrambled Eggs", "unit": "g", "amount": 100, "noom_color": "green" }, { "icon": "bacon", "item": "Bacon Strips", "unit": "g", "amount": 50, "noom_color": "red" }, { "icon": "whole_wheat_bread", "item": "Whole Wheat Toast", "unit": "slice", "amount": 2, "noom_color": "yellow" }, { "icon": "avocado", "item": "Sliced Avocado", "unit": "g", "amount": 50, "noom_color": "green" }, { "icon": "orange_juice", "item": "Fresh Orange Juice", "unit": "ml", "amount": 200, "noom_color": "yellow" } ])
        },
        {
            role: 'assistant',
            content: `[ { "icon": "egg", "item": "Scrambled Eggs", "unit": "g", "amount": 100, "noom_color": "green", "calories": 150, "fat": 11, "carbs": 1, "protein": 13, "fiber": 0, "sugar": 1, "sodium": 142, "cholesterol": 372 }, { "icon": "bacon", "item": "Bacon Strips", "unit": "g", "amount": 50, "noom_color": "red", "calories": 250, "fat": 20, "carbs": 1, "protein": 17, "fiber": 0, "sugar": 0, "sodium": 1300, "cholesterol": 50 }, { "icon": "whole_wheat_bread", "item": "Whole Wheat Toast", "unit": "slice", "amount": 2, "noom_color": "yellow", "calories": 140, "fat": 2, "carbs": 28, "protein": 6, "fiber": 4, "sugar": 4, "sodium": 280, "cholesterol": 0 }, { "icon": "avocado", "item": "Sliced Avocado", "unit": "g", "amount": 50, "noom_color": "green", "calories": 80, "fat": 7, "carbs": 4, "protein": 1, "fiber": 3, "sugar": 0, "sodium": 0, "cholesterol": 0 }, { "icon": "orange_juice", "item": "Fresh Orange Juice", "unit": "ml", "amount": 200, "noom_color": "yellow", "calories": 94, "fat": 0.2, "carbs": 21, "protein": 1.7, "fiber": 0.4, "sugar": 17, "sodium": 2, "cholesterol": 0 } ]`
        },
        {
            role: 'user',
            content: (img && attempt < 2) ? [
                { type: 'text', text:  JSON.stringify(foodList)},
                { type: 'image_url', image_url: { url: (await getBase64Url(img)) }}
            ] : JSON.stringify(foodList)
        },
        ...imgExtraMessages
    ];

    const data = {
        model: img ? 'gpt-4o' : 'gpt-4o',
        messages,
        max_tokens: 4096
    };

    try {
        const response = await gptCall('https://api.openai.com/v1/chat/completions', data);
        const new_data = response.choices?.[0]?.message?.content.replace(/^[^\[]+/s, '').replace(/[^\]]+$/s, '').trim() || '[]';
        const json = (extractJSON(new_data))?.map(item => {
            item.uuid = uuidv4();
            return item;
        });

        if (!json?.length) {
            console.error('No JSON data:', response.choices);
            return await itemizeFood(foodList, img, attempt + 1);
        }

        const validKeys = ['uuid', 'icon', 'item', 'unit', 'amount', 'noom_color', 'calories', 'fat', 'carbs', 'protein', 'fiber', 'sugar', 'sodium', 'cholesterol', 'chat_id', 'date', 'timeofday', 'log_uuid'];
        const validated_data = json.map(item => {
            //substitue keys

        const subKeys = [["color","noom_color"],["time","timeofday"],["cal","calories"]["carbohydrates","carbs"],["sugars","sugar"],["sodiums","sodium"],["cholesterols","cholesterol"],["fats","fat"],["proteins","protein"],["fibers","fiber"]];
        for (const pair of subKeys) {
            if(!pair || !Array.isArray(pair)) continue;
            const [key, subkey] = pair;
            if (item[key]) {
                item[subkey] = item[key];
                delete item[key];
            }
        }
            //delete any remaining invalid keys
            Object.keys(item).forEach(key => {
                if(!validKeys.includes(key)) delete item[key];
            });
            return item;
        });
        return validated_data;
    } catch (error) {
        console.error('Error itemizing food:', error);
        return false;
    }

}




export const generateCoachingMessage = async (chat_id, attempt=1)=>{
    try {
        const todaysDate = moment().tz('America/Los_Angeles').format('YYYY-MM-DD');
        
        // Get today's food items and calculate total calories
        const todaysItems = getNutrilListByDate(chat_id, todaysDate) || [];
        const todaysTotalCalories = todaysItems.reduce((total, item) => {
            return total + (parseInt(item.calories || 0, 10));
        }, 0);
        
        // Get most recent items for context
        const mostRecentItems = getMostRecentNutrilistItems(chat_id);
        const recentCalories = mostRecentItems.reduce((total, item) => {
            return total + (parseInt(item.calories || 0, 10));
        }, 0);
        
        // Check if this logging crosses any calorie thresholds
        const thresholds = [400, 1000, 1600];
        const previousCalories = todaysTotalCalories - recentCalories;
        let crossedThreshold = null;
        
        for (const threshold of thresholds) {
            if (previousCalories < threshold && todaysTotalCalories >= threshold) {
                crossedThreshold = threshold;
                break;
            }
        }
        
        let coachingMessage = '';
        
        if (crossedThreshold) {
            // Generate major coaching message for threshold crossing using GPT
            const dailyBudget = 2000;
            const remainingCalories = dailyBudget - todaysTotalCalories;
            
            const data = {
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: `You are a supportive nutrition coach providing milestone celebration messages when users cross calorie thresholds.
                        The user just crossed the ${crossedThreshold} calorie threshold for the day.
                        Provide a 2-3 sentence encouraging message that:
                        - Acknowledges this milestone
                        - Provides appropriate guidance for their current calorie level
                        - Maintains a positive, supportive tone
                        
                        Their daily total is now ${todaysTotalCalories} calories.
                        They have ${remainingCalories > 0 ? remainingCalories + ' calories remaining' : 'exceeded their budget by ' + Math.abs(remainingCalories) + ' calories'} in their daily budget.`
                    },
                    {
                        role: 'user',
                        content: `I just crossed the ${crossedThreshold} calorie threshold. My daily total is now ${todaysTotalCalories} calories. Recent foods: ${JSON.stringify(mostRecentItems.map(item => `${item.item} (${item.amount}${item.unit})`))}`
                    }
                ],
                max_tokens: 1500
            };
            
            try {
                const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                    model: 'gpt-4o',
                    messages: [
                        {
                            role: 'system',
                            content: `You are a supportive nutrition coach providing milestone celebration messages when users cross calorie thresholds.
                            The user just crossed the ${crossedThreshold} calorie threshold for the day.
                            Provide a 2-3 sentence encouraging message that:
                            - Acknowledges this milestone
                            - Provides appropriate guidance for their current calorie level
                            - Maintains a positive, supportive tone
                            
                            Their daily total is now ${todaysTotalCalories} calories.
                            They have ${remainingCalories > 0 ? remainingCalories + ' calories remaining' : 'exceeded their budget by ' + Math.abs(remainingCalories) + ' calories'} in their daily budget.`
                        },
                        {
                            role: 'user',
                            content: `I just crossed the ${crossedThreshold} calorie threshold. My daily total is now ${todaysTotalCalories} calories. Recent foods: ${JSON.stringify(mostRecentItems.map(item => `${item.item} (${item.amount}${item.unit})`))}`
                        }
                    ],
                    max_tokens: 1500
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                    }
                });
                
                coachingMessage = response.data.choices?.[0].message?.content || `Great milestone! You've reached ${crossedThreshold} calories today.`;
            } catch (gptError) {
                console.error('Error getting GPT threshold message:', gptError);
                // Fallback threshold messages if GPT fails
                switch (crossedThreshold) {
                    case 400:
                        coachingMessage = "Great start to your day! You've hit 400 calories - a solid foundation. Keep focusing on nutrient-dense foods to fuel your body well.";
                        break;
                    case 1000:
                        coachingMessage = "You're now at 1000 calories for the day - well into your nutritional stride! This is a good milestone. Consider how your energy levels are feeling and stay mindful of your remaining calorie budget.";
                        break;
                    case 1600:
                        coachingMessage = "You've reached 1600 calories today - that's substantial nutrition! Take a moment to assess your hunger and energy levels. If you're feeling satisfied, you might consider lighter options for the rest of the day.";
                        break;
                    default:
                        coachingMessage = `Great milestone! You've reached ${crossedThreshold} calories today.`;
                }
            }
        } else {
            // Generate minor coaching message using GPT
            const dailyBudget = 2000;
            const remainingCalories = dailyBudget - todaysTotalCalories;
            
            const data = {
                model: 'gpt-4o',
                messages: [
                    {
                        role: 'system',
                        content: `You are a supportive nutrition coach providing brief, encouraging responses to food logging. 
                        Keep responses to 1 sentence or a short phrase. Be positive and motivating.
                        The user has logged ${recentCalories} calories just now, bringing their daily total to ${todaysTotalCalories} calories.
                        They have ${remainingCalories > 0 ? remainingCalories + ' calories remaining' : 'exceeded their budget by ' + Math.abs(remainingCalories) + ' calories'}.
                        Respond appropriately to their current situation with a brief, encouraging message.`
                    },
                    {
                        role: 'user',
                        content: `Most recent food items logged: ${JSON.stringify(mostRecentItems.map(item => `${item.item} (${item.amount}${item.unit})`))}. 
                        Today's total so far: ${todaysTotalCalories} calories.`
                    }
                ],
                max_tokens: 1000
            };
            
            try {
                const response = await axios.post('https://api.openai.com/v1/chat/completions', {
                    model: 'gpt-4o',
                    messages: [
                        {
                            role: 'system',
                            content: `You are a supportive nutrition coach providing brief, encouraging responses to food logging. 
                            Keep responses to 1 sentence or a short phrase. Be positive and motivating.
                            The user has logged ${recentCalories} calories just now, bringing their daily total to ${todaysTotalCalories} calories.
                            They have ${remainingCalories > 0 ? remainingCalories + ' calories remaining' : 'exceeded their budget by ' + Math.abs(remainingCalories) + ' calories'}.
                            Respond appropriately to their current situation with a brief, encouraging message.`
                        },
                        {
                            role: 'user',
                            content: `Most recent food items logged: ${JSON.stringify(mostRecentItems.map(item => `${item.item} (${item.amount}${item.unit})`))}. 
                            Today's total so far: ${todaysTotalCalories} calories.`
                        }
                    ],
                    max_tokens: 1000
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                    }
                });
                
                coachingMessage = response.data.choices?.[0].message?.content || 'Great job logging that!';
            } catch (gptError) {
                console.error('Error getting GPT minor message:', gptError);
                // Fallback to simple messages if GPT fails
                const fallbackMessages = [
                    "Good job logging that!",
                    "Thanks for keeping track!",
                    "Nice choice!",
                    "Keep it up!",
                    "Great logging!"
                ];
                const randomIndex = Math.floor(Math.random() * fallbackMessages.length);
                coachingMessage = fallbackMessages[randomIndex];
            }
        }
        
        // Save the coaching message
        saveNutriCoach({
            chat_id,
            date: todaysDate,
            message: coachingMessage,
            mostRecentItems: JSON.stringify(mostRecentItems)
        });
        
        return coachingMessage;
        
    } catch (error) {
        console.error('Error getting coaching message:', error);
        if(attempt < 3) return await generateCoachingMessage(chat_id, attempt + 1);
        return 'Keep going - you got this!';
    }
}

export const generateCoachingMessageForDailyHealth = async (maxAttempts = 5, attempt = 1) => {
    if (attempt > maxAttempts) return null;
    

    const dailyHealth = loadFile(`lifelog/health`);
    const dailyCoaching = loadFile(`lifelog/health_coaching`);
    let cursor_date = null;
    const history = [];
    let inputHash = null;
    const dates = Object.keys(dailyHealth).sort();

    for (const date of dates) {
        const coachingData = dailyCoaching?.[date] || null;

        if (coachingData) {
            const savedHash = coachingData.hash || null;
            inputHash = md5(JSON.stringify(dailyHealth[date]));
           // console.log({ date, savedHash, inputHash });
            if (savedHash === inputHash) continue;
        }

        history.push({
            role: 'user',
            content: JSON.stringify(dailyHealth[date]),
        });
        cursor_date = date;
        break;
    }

    if (!cursor_date) return null;

    const instructions = `You are a supportive nutrition and health coach providing daily summary messages based on the user's food intake and health data.
    Each day, you receive a JSON object with the following keys:
    - date: The date of the log entry (YYYY-MM-DD)
    - lbs: The user's weight in pounds
    - fat_percent: The user's body fat percentage
    - weekly_delta: The change in weight over the past week
    - calorie_balance: The net calorie balance for the day (calories consumed - calories burned)
    - calories: Total calories consumed
    - protein: Total protein consumed (grams)
    - carbs: Total carbohydrates consumed (grams)
    - fat: Total fat consumed (grams)
    - fiber: Total fiber consumed (grams)
    - sodium: Total sodium consumed (mg)
    - sugar: Total sugar consumed (grams)
    - cholesterol: Total cholesterol consumed (mg)
    - food_items: An array of strings describing the food items consumed, each prefixed with a colored circle indicating its Noom color (🟢 green, 🟡 yellow, 🟠 orange)
    - steps: Total steps taken
    - workouts: An array of strings describing the workouts performed, including duration and calories burned
    Your task is to generate coaching messages in a JSON object with the following format:
    {
        "date": "2024-04-01",
        "nutrition": {
            "observation": "Your calorie deficit has been consistent, averaging -500 calories per day over the past week, but your protein intake is slightly below the recommended 100g.",
            "guidance": "Find ways to increase protein intake, such as adding a protein shake or lean meats to your meals."
        },
        "weight_and_composition": {
            "observation": "Your weight is stable at 180.5 lbs with a slight decrease in body fat to 23.96%.",
            "guidance": "Watch out for small weight gains; consider adjusting your calorie intake or increasing activity."
        },
        "fitness_and_activity": {
            "observation": "You averaged 10,000 steps per day and completed 3 workouts this week, burning an average of 200 calories per session.",
            "guidance": "Given your calorie deficit, keep the cardio light and focus on strength training to preserve muscle mass."
        },
        "overall": {
            "observation": "Overall, you're making good progress with a consistent calorie deficit and stable weight.",
            "guidance": "Keep up the good work, but focus on hitting your protein targets and maintaining muscle mass."
        },
    }, {
        "date": "2024-04-02",
        "nutrition": {
            "observation": "The smoothie you had was a great choice, especially with the added spinach and chia seeds, it helpted you keep your fiber intake up, and calories under 1500.",
            "guidance": "If this meal suits you, consider making it a regular part of your diet."
        },
        "weight_and_composition": {
            "observation": "Trends are stable, but rate of change is slowing.",
            "guidance": "It's probably just water weight, so go easy on the sodium and carbs, like that pasta dish you had last night—probably not the best choice."
        },
        "fitness_and_activity": {
            "observation": "The cardio session probably felt good, but it didn't dent your calorie balance much. Remember, abs are made in the kitchen.",
            "guidance": "Keep the cardio light and focus on strength training to preserve muscle mass. Flexibility and balance work are also good options."
        },
        "overall": {
            "observation": "You've finally hit a consistent calorie deficit, and the scale is moving in the right direction.",
            "guidance": "Keep up the good work, but focus on hitting your protein targets and maintaining muscle mass."
        }
    }
    Tips:
    - Use a positive, supportive tone, but call out bad choices or concerning trends.
    - Be specific in your observations, not just numbers, but food choices and exercise habits.
    - Infer meals based on food items.  Eg, "smoothie" might not be listed, but if the food items are banana, spinach, chia seeds, almond milk, you can infer a smoothie.
    - Be specific about workouts, but speak conversationally.  Eg, "That workout keep your unbroken streak alive, nice job! You've been at it for 30 days now, impressive dedication."
    - Consider already-provided coaching messages in the conversation history to maintain continuity and avoid repetition, and acknowledge any progress or changes that appear to be a result of previous coaching. Eg, "Today's food choices are compensating for the high sodium yesterday, nice job."
`;

    const input = {
        model: 'gpt-4o',
        messages: [
            {
                role: 'system',
                content: `${instructions}`,
            },
            ...history,
        ],
        max_tokens: 1500,
    };

    try {
        const response = await gptCall('https://api.openai.com/v1/chat/completions', input);
        const coachingData = response.choices?.[0]?.message?.content || '{}';
        const coachingMessage = extractJSON(coachingData);
        coachingMessage.hash = inputHash;
        dailyCoaching[cursor_date] = coachingMessage;

        const sortedKeysDesc = Object.keys(dailyCoaching).sort().reverse();
        const sortedCoaching = Object.fromEntries(sortedKeysDesc.map((key) => [key, dailyCoaching[key]]));
        saveFile(`lifelog/health_coaching`, sortedCoaching);

        // Ensure the hash is saved correctly in the first iteration
        if (dailyCoaching[cursor_date]?.hash !== inputHash) {
            dailyCoaching[cursor_date].hash = inputHash;
            saveFile(`lifelog/health_coaching`, dailyCoaching);
        }

        // Recursively process the next date
        return await generateCoachingMessageForDailyHealth(maxAttempts, attempt + 1);
    } catch (error) {
        console.error('Error generating daily health coaching message:', error);
        return null;
    }
};