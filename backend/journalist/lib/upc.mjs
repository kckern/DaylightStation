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


    // Fetch data from Edamam API
    const { ED_APP_ID, ED_APP_KEY } = process.env;
    const edamamUrl = `https://api.edamam.com/api/food-database/v2/parser?upc=${upc}&app_id=${ED_APP_ID}&app_key=${ED_APP_KEY}`;
    const edamamResponse = await fetch(edamamUrl);
    const edamamData = await edamamResponse.json();
    const food = edamamData.hints?.[0]?.food;

    // Fetch image from UPCItemDB
    const { UPCITE } = process.env;
    const upcItemDbResponse = await fetch('https://api.upcitemdb.com/prod/v1/lookup', {
        method: 'POST',
        headers: {
            "Content-Type": "application/json",
            "user_key": UPCITE,
            "key_type": "3scale"
        },
        body: JSON.stringify({ upc })
    });
    const upcItemDbData = await upcItemDbResponse.json();
    const images = upcItemDbData?.items?.[0]?.images || [];
    images.push(`https://images.barcodespider.com/upcimage/${upc}.jpg`);

    let image;
    for (let img of images) {
        if (await isValidImgUrl(img)) {
            image = img;
            break;
        }
    }

    // If Edamam data is available, use it
    if (food) {
        console.log('Edamam data found:', food);
        food.image = food.image || image;

        if (food.nutrients) {
            const keys = Object.keys(food.nutrients);
            const vals = Object.values(food.nutrients).map(val => Math.round(val * 100) / 100);
            const nutrientsFormatted = keys.map((key, i) => `• ${key.toLowerCase()}: ${vals[i]}`).join('\n');
            food.nutrientsFormatted = nutrientsFormatted;
        }

        return food;
    }

    // If no Edamam data, fallback to barcode data

    //openFoodFacts
    const off =  await openFoodFacts(upc);

    if (off) return off;


    return null;
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
        const foodIdResult = await findIdForBarcode(barcode);
        if (!foodIdResult || !foodIdResult.food_id) {
            console.warn(`No food_id found for barcode: ${barcode}`);
            return null; // Return null instead of false for better handling
        }
        const { value: food_id_value } = foodIdResult.food_id;
        return await getFoodById(food_id_value);
    } catch (error) {
        console.error(`Error retrieving food_id for barcode: ${barcode}`, error);
        return null; // Return null on error
    }
};


const openFoodFacts = async (barcode) => {
    try {
        console.log('OpenFoodFacts • Looking up barcode:', barcode);
        
        const response = await fetch(`https://world.openfoodfacts.net/api/v2/product/${barcode}.json`);
        if (!response.ok) {
            console.log('OpenFoodFacts • Invalid response:', response.status);
            return null;
        }
        
        const data = await response.json();
        
        if (!data.product || data.status !== 1) {
            console.log('OpenFoodFacts • No product found for barcode:', barcode);
            return null;
        }
        
        const product = data.product;
        console.log('OpenFoodFacts • Product found:', product.product_name);
        
        // Extract image
        let image = product.image_url || product.image_front_url;
        if (image && !(await isValidImgUrl(image))) {
            image = undefined;
        }
        
        // Format nutrition data similar to Edamam format
        const food = {
            label: product.product_name || product.product_name_en,
            brand: product.brands,
            image: image,
            nutrients: {}
        };

        console.log(Object.keys(product));
        
        // Add serving size if available
        if (product.serving_quantity && product.serving_quantity_unit) {
            //food.servingSizeStr = `${product.serving_quantity} ${product.serving_quantity_unit}`;
            food.servingSizes = [{quantity: product.serving_quantity, label: product.serving_quantity_unit}];
        }
        
        // Map OpenFoodFacts nutrients to similar format
        if (product.nutriments) {

            const nutrientMap = {
                calories: "energy-kcal",
                fat: "fat",
                protein: "protein",
                carbs: "carbohydrates",
                sugar: "sugars",
                fiber: "fiber",
                sodium: "sodium",
                cholesterol: "cholesterol"
            };


            
            Object.entries(nutrientMap).forEach(([offKey, standardKey]) => {
                if (product.nutriments[offKey] !== undefined) {
                    food.nutrients[standardKey] = Math.round(product.nutriments[offKey] * 100) / 100;
                }
            });
            
            // Format nutrients for display
            if (Object.keys(food.nutrients).length > 0) {
                const nutrientsFormatted = Object.entries(food.nutrients)
                    .map(([key, value]) => `• ${key.toLowerCase()}: ${value}`)
                    .join('\n');
                food.nutrientsFormatted = nutrientsFormatted;
            }
        }
        
        return food;
        
    } catch (error) {
        console.error('OpenFoodFacts • Error:', error);
        return null;
    }
}