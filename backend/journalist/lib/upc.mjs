import fetch from 'node-fetch';
import dotenv from 'dotenv';
import crypto from 'crypto';
import querystring from 'querystring';

dotenv.config();


const isValidImgUrl = async (url) => {  
    console.log('isValidImgUrl • Checking:', url);
    const response = await fetch(url);
    if (!response.ok) {

        console.log('isValidImgUrl • Invalid response:', response.status);
        return false;
    }
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
        console.log('isValidImgUrl • Invalid content type:', contentType);
        return false;
    }
    console.log('isValidImgUrl • Valid content type:', contentType);
    return true;
}



export const upcLookup = async (upc) => {
    console.log('Looking up UPC:', upc);
    const food_item = (await findFoodByBarcode(upc) || {});
    console.log( {food_item});
    const { ED_APP_ID, ED_APP_KEY,UPCITE } = process.env;
    const url = `https://api.edamam.com/api/food-database/v2/parser?upc=${upc}&app_id=${ED_APP_ID}&app_key=${ED_APP_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    const food = data.hints?.[0]?.food;

    const upcitemdb = await fetch('https://api.upcitemdb.com/prod/v1/lookup', {
        method: 'POST',
        headers: {
            "Content-Type": "application/json",
            "user_key": UPCITE,
            "key_type": "3scale"
        },
        body: JSON.stringify({ upc })
    });
    console.log(`curl -X POST -H "Content-Type: application/json" -H "user_key: ${UPCITE}" -H "key_type: 3scale" -d '{"upc":"${upc}"}' 'https://api.upcitemdb.com/prod/v1/lookup'`);
    const json = await upcitemdb.json();
    let image;
    const images = json?.items?.[0]?.images || []; 
    images.push(`https://images.barcodespider.com/upcimage/${upc}.jpg`);
    for (let img of (images || [])) 
        if (await isValidImgUrl(img)) { image = img;  break; } 

    if(!food) return { image };

    food.image = image;
    food.food_item = food_item;

    if(food.nutrients) {
        const keys = Object.keys(food.nutrients);
        const vals = Object.values(food.nutrients).map(val => Math.round(val * 100) / 100);
        const nutrients = keys.map((key, i) => `• ${key.toLowerCase()}: ${vals[i]}`).join('\n');
        food.nutrients = nutrients;
    }

    return food;
}
const generateNonce = (length = 5) => {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

const generateSignature = (url, method, params, consumerSecret) => {
    const paramString = querystring.stringify(params);
    const baseString = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramString)}`;
    const signingKey = `${consumerSecret}&`;
    const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
    return encodeURIComponent(signature);
}

// Generic function to make API requests to FatSecret
export const makeApiRequest = async (method, params) => {
    const { FS_APP_KEY, FS_APP_SECRET } = process.env;
    const url = `https://platform.fatsecret.com/rest/server.api`;
    params.oauth_consumer_key = FS_APP_KEY;
    params.oauth_signature_method = 'HMAC-SHA1';
    params.oauth_timestamp = Math.floor(Date.now() / 1000);
    params.oauth_nonce = generateNonce();
    params.oauth_version = '1.0';
    params.oauth_signature = generateSignature(url, 'GET', params, FS_APP_SECRET);
    const fullUrl = `${url}?${querystring.stringify(params)}`;
    const response = await fetch(fullUrl);
    const data = await response.json();
    return data;
}

// Specific function to find ID for a barcode
export const findIdForBarcode = async (barcode) => {
    const params = {
        method: 'food.find_id_for_barcode',
        barcode: barcode,
        format: 'json',
    };
    return await makeApiRequest('GET', params);
}

//Foods: Get By Id
export const getFoodById = async (food_id) => {
    const params = {
        method: 'food.get.v4',
        food_id: food_id,
        format: 'json',
    };
    return await makeApiRequest('GET', params);
}

export const findFoodByBarcode = async (barcode) => {
    try {
        const { food_id: { value: food_id_value } } = await findIdForBarcode(barcode);
        return await getFoodById(food_id_value);
    } catch (error) {
        console.error(error);
        return false;
    }
}