import dotenv from 'dotenv';
import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment-timezone';
import { getBase64Url } from './food.mjs';
dotenv.config();


const extractJSON = (openaiResponse) => {
    const jsonString =  openaiResponse
    .replace(/^[^{\[]*/s, '')
    .replace(/[^}\]]*$/s, '').trim()

    console.log({jsonString});
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


const today = moment().tz('America/Los_Angeles').format('YYYY-MM-DD');
const dayOfWeek = moment().tz('America/Los_Angeles').format('dddd');
const timeAMPM = moment().tz('America/Los_Angeles').format('h:mm a');
const instructions = `List the food items in them, output in a JSON object which contains keys: 
                 - "food" an array with the food icon, item name, amount (integer), and unit (g, ml, etc.), and noom color (green, yellow, orange).
                 - "questions", with what you need to clarify uncertainties and possible answers. 
                 - "nutrition", with the estimated nutrition information.
                 - "date," the date of the meal.  Usually the current date (today is ${dayOfWeek}, ${today} at ${timeAMPM} ), but could be in the past, if the description mentions a timeframe, such as "yesterday" or "on wednesday".  If the date is already specified in a previous attempt, keep that one, unless the user specifies a new date.
                 - "time," the time of the meal.  Usually "midday" or "evening", but could be "morning" or "night".  Default is "midday".  Evening starts after 4:30pm.
                 
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
                    "questions": 
                        [
                            ["Is that a salad dressing or a sauce?", ["Sauce", "Dressing"]],
                            ["How big is that plate?", ["Dinner plate", "Side plate","Serving platter"]],
                            ["Are those carrots or sweet potatoes?", ["Carrots", "Sweet potatoes", "Neither"]],
                            ["What is under the sauce?", ["Pasta", "Rice", "Potatoes"]],
                            ["Is that a whole grain bread?", ["Yes", "No"]],
                        ]
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
                        ${icons}
`;

export const detectFoodFromImage = async (imgUrl, extras ,attempt) => {
    console.log('detectFoodFromImage', {imgUrl,extras});
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
       // response_format:{ type: "json_object" },
        messages: [
            {
                role: 'system',
                content: `You are nutrition seer. You look at images and process them like this:
                ${instructions}`
                
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
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const {error} = await response.json();
            console.error(error);
            throw new Error(`Failed to describe image.`);
        }
        const jsonResponse = await response.json();
        const description = jsonResponse.choices?.[0].message?.content;
        const json = extractJSON(description);
        json.uuid = uuidv4();

        return json;

    } catch (error) {

        console.error('Error describing image:', error);
        return await detectFoodFromImage(imgUrl,extras, attempt + 1);

    }
};


//detectFoodFromTextDescription
export const detectFoodFromTextDescription = async (text, attempt) => {
    attempt = attempt || 1;

    if(attempt > 3) return false;

    console.log('Analyzing text...');

    const data = {
        model: 'gpt-4o',
        messages: [
            {
                role: 'system',
                content: ``
            },
            {
                role: 'system',
                content: `You are nutrition reader. You read text descriptions of meals and snacks and process them like this:
                ${instructions}
                
                - Assume a single serving size unless otherwise specified.
                 - For a compound food, like a burrito, make sure you itemize the ingredients.  For example the food array might look like this:[ { "icon": "rice", "item": "Rice", "unit": "g", "amount": 150, "noom_color": "yellow" }, { "icon": "black_bean", "item": "Black Beans", "unit": "g", "amount": 130, "noom_color": "yellow" }, { "icon": "grilled_cheese", "item": "Grilled Chicken", "unit": "g", "amount": 100, "noom_color": "yellow" }, { "icon": "sauce", "item": "Sauce", "unit": "ml", "amount": 30, "noom_color": "yellow" }, { "icon": "vegetable", "item": "Mixed Vegetables", "unit": "g", "amount": 85, "noom_color": "green" }, { "icon": "cheese", "item": "Cheese", "unit": "g", "amount": 30, "noom_color": "orange" }, { "icon": "guacamole", "item": "Guacamole", "unit": "g", "amount": 30, "noom_color": "green" }, { "icon": "lettuce", "item": "Lettuce", "unit": "g", "amount": 20, "noom_color": "green" }, { "icon": "salsa", "item": "Salsa", "unit": "g", "amount": 30, "noom_color": "green" } ]
                `
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
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const {error} = await response.json();
            console.error(error);
            throw new Error(`Failed to describe text.`);
        }

        const jsonResponse = await response.json();
        const description = jsonResponse.choices?.[0].message?.content;
        const json = extractJSON(description);
        json.uuid = uuidv4();

        json.date = json.date || today;
        json.time = json.time || "midday";
        json.nutrition = json.nutrition || [];
        json.questions = json.questions || [];
        json.food = json.food || null;


        return json;

    } catch (error) {

        console.error('Error describing text:', error);
        return await detectFoodFromTextDescription(text, attempt + 1);

    }
};




export const itemizeFood = async (foodList, img, attempt) => {

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
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const {error} = await response.json();
            console.error(error);
            throw new Error(`Failed to itemize food.`);
        }
        const jsonResponse = await response.json();
        const new_data = jsonResponse.choices?.[0]?.message?.content.replace(/^[^\[]+/s, '').replace(/[^\]]+$/s, '').trim() || '[]';
        const json = (extractJSON(new_data))?.map(item => {
            item.uuid = uuidv4();
            return item;
        });
        if(!json?.length) {
            console.error('No JSON data:', jsonResponse.choices);
            return await itemizeFood(foodList, img, attempt + 1);
        }

        const validKeys = ['uuid','icon','item','unit','amount','noom_color','calories','fat','carbs','protein','fiber','sugar','sodium','cholesterol','chat_id','date','timeofday','log_uuid'];
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


