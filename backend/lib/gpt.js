import fetch from './httpFetch.mjs';
import { appendFile } from 'fs';
import yaml from 'js-yaml';
import { readFileSync } from 'fs';
import axios from './http.mjs';
import crypto from 'crypto';
import fs from 'fs';

const __appDirectory = `/${(new URL(import.meta.url)).pathname.split('/').slice(1, -3).join('/')}`;
const secretspath = `${__appDirectory}/config.secrets.yml`;
const { OPENAI_API_KEY} = yaml.load(readFileSync(secretspath, 'utf8'));

const models = {
    'gpt-3.5-turbo-0125'        : {in: 0.0000005,   out: 0.0000015,  context_window: 4096, flagship: true},
    'gpt-3.5-turbo'             : {in: 0.0000005,   out: 0.0000015,  context_window: 4096},
    'gpt-3.5-turbo-1106'        : {in: 0.000001,    out: 0.000002,   context_window: 4096},
    'gpt-3.5-turbo-instruct'    : {in: 0.0000015,   out: 0.000002,   context_window: 4096},
    'gpt-3.5-turbo-0613'        : {in: 0.0000015,   out: 0.0000025,  context_window: 4096},

    'gpt-3.5-turbo-16k'         : {in: 0.000001,    out: 0.0000025,  context_window: 16385},
    'gpt-3.5-turbo-16k-0613'    : {in: 0.000001,    out: 0.0000025,  context_window: 16385},

    'gpt-4'                     : {in: 0.00003,     out: 0.00006,    context_window: 8192},
    'gpt-4-0613'                : {in: 0.00003,     out: 0.00006,    context_window: 8192},
    'gpt-4-32k'                 : {in: 0.00006,     out: 0.00012,    context_window: 32768},
    'gpt-4-32k-0613'            : {in: 0.00006,     out: 0.00012,    context_window: 32768},

    'gpt-4-0125-preview'        : {in: 0.00001,     out: 0.00003,    context_window: 128000},
    'gpt-4-turbo-preview'       : {in: 0.00001,     out: 0.00003,    context_window: 128000},
    'gpt-4-1106-preview'        : {in: 0.00001,     out: 0.00003,    context_window: 128000},
    'gpt-4-vision-preview'      : {in: 0.00001,     out: 0.00003,    context_window: 128000},
    'gpt-4-1106-vision-preview' : {in: 0.00001,     out: 0.00003,    context_window: 128000},

    'gpt-4o-2024-08-06'        : {in: 0.00001,     out: 0.00003,    context_window: 128000},
    'gpt-4o'                  : {in: 0.00001,     out: 0.00003,    context_window: 128000, flagship: true},
}


const logGPT = (model, promptTokens, completionTokens, generated_text) => {
  const logPath = '/tmp/gpt.log';
  const timestamp = new Date().toISOString();
  const snippet = generated_text.length > 100 ? `${generated_text.substring(0, 100)}...` : generated_text;
  const cost =  (promptTokens * models[model].in + completionTokens * models[model].out).toFixed(5);
  const logMessage = `${timestamp} - ${model} - $${cost} - ${promptTokens}:${completionTokens} ${snippet}\n`;

  // Check if the file exists, and if not, create it and then log the message.
  appendFile(logPath, logMessage, (err) => {
    if (err) {
      console.error('Error writing to log file:', err);
    }
  });
};

export const askGPT = async (messages, model = 'gpt-4o', extraconfig) => {

  const msgIsString = typeof messages === 'string'; 
  if(msgIsString) messages = [
    {role: 'system', content: 'You a helpful assistant, I need your help.'},
    {role: 'user', content: messages}
  ];

  const modelFound = Object.keys(models).includes(model);
  if(!modelFound && /-4/.test(model)) model =  Object.keys(models).find(m => /-4/.test(m) && models[m].flagship);
  if(!modelFound) model =  Object.keys(models).find(m => /-3/.test(m) && models[m].flagship);



  //console.log('Asking GPT:', model, messages);



  try {
    const data = {
      model,
      messages: messages,
      temperature: 1,
      //max_tokens: leftOverTokens,
      n: 1,
      ...(extraconfig || {})
    };
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify(data)
    });


    const openAIResponse = await response.json();

    //console.log(openAIResponse, openAIResponse?.choices[0]);
    if(openAIResponse?.error?.message) return `☠️ ${openAIResponse?.error?.message}`;

    const { prompt_tokens, completion_tokens, total_tokens } = openAIResponse.usage || {};
    const generated_text = openAIResponse?.choices?.[0]?.message?.content || false;


  //console.log({messages,generated_text})
    
    logGPT(model,prompt_tokens, completion_tokens, generated_text);

    return generated_text;
  } catch(error) {
    console.error('Error:', error?.response?.data?.error?.message || error.message);
    return false;
  }
};


export async function generateSpeech(text, voice, instructions) {
  try {
    // Example for OpenAI TTS API with axios
    const response = await axios({
      method: 'post',
      url: 'https://api.openai.com/v1/audio/speech',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        model: 'tts-1',
        input: text,
        voice,
        // ...other params...
      },
      responseType: 'stream'
    });

    return response.data; // This is a readable stream
  } catch (error) {
    const line = error?.shortMessage || `${error?.message || 'TTS request failed'}`;
    console.error(`[TTS] ${line}`);
    throw error; // rethrow to allow upstream handling while keeping logs clean
  }
}



export const askGPTWithJSONOutput = async (messages, model = 'gpt-4o', extraconfig) => {

  messages[0].content += '\n\nPlease respond with a valid JSON object.';
  const response = await askGPT(messages, model, extraconfig);
  if (!response) return false;

  try {
    let txt = response.trim();
    // Remove markdown code fences if present
    if (/^```/.test(txt)) {
      txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
    }
    // Attempt to isolate first JSON object if extra prose present
    const firstBrace = txt.indexOf('{');
    const lastBrace = txt.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      txt = txt.slice(firstBrace, lastBrace + 1);
    }
    return JSON.parse(txt);
  } catch (error) {
    console.error('Error parsing JSON response:', error.message);
    return false;
  }
};


export default { askGPT };
