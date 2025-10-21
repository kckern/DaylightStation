
import dotenv from 'dotenv';
import fetch from '../../lib/httpFetch.mjs';
import crypto from 'crypto'; // Node.js crypto module
import qs from 'querystring'; // For URL query string manipulation
dotenv.config();

const { FS_KEY, FS_SECRET } = process.env;

const generateOAuthSignature = (method, url, params, tokenSecret = '') => {
  const sortedParams = qs.stringify(params).split('&').sort().join('&');
  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
  const signingKey = `${encodeURIComponent(FS_SECRET)}&${encodeURIComponent(tokenSecret)}`;
  const hash = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  return hash;
};
const fatSecretAPI = async (input_params) => {
    input_params = input_params || {};
  const baseUrl = "https://platform.fatsecret.com/rest/server.api";
  const method = "POST"; // Use POST or GET according to the API documentation
  const format = "json"; // Response format
  const oauth_nonce = crypto.randomBytes(16).toString('hex');
  const oauth_timestamp = Math.floor(new Date().getTime() / 1000);
  const params = {
    format: format,
    oauth_consumer_key: FS_KEY,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp,
    oauth_nonce,
    oauth_version: "1.0",
    ...input_params
  };
  params['oauth_signature'] = generateOAuthSignature(method, baseUrl, params);
  const response = await fetch(baseUrl, {
    method: method,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `OAuth oauth_consumer_key="${FS_KEY}", oauth_signature_method="HMAC-SHA1", oauth_timestamp="${oauth_timestamp}", oauth_nonce="${oauth_nonce}", oauth_version="1.0", oauth_signature="${encodeURIComponent(params.oauth_signature)}"`
    },
    body: qs.stringify(params)
  });
  const data = await response.json();
  return data;
};




export const fatSecretSearch = async (query) => {
  const input_params = {
    method: "foods.search",
    search_expression: query
  };
  const response = await fatSecretAPI(input_params);
  return response?.foods?.food || [];
}


export const fatSecretBarcode = async (barcode) => {
  const input_params = {
    method: "food.find_id_for_barcode",
    barcode: barcode
  };
  const response = await fatSecretAPI(input_params);
  console.log(response);
  return response?.food || [];
}


export const fatSecretLoadFood = async (food_id) => {
  const input_params = {
    method: "food.get.v4",
    food_id: food_id
  };
  const response = await fatSecretAPI(input_params);
  return response?.food || [];
}