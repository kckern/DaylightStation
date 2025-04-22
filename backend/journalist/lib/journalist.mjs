

import { sendMessage, getRecentMessages, deleteMostRecentUnansweredMessage } from "./telegram.mjs";
import {  loadUnsentQueue, saveToQueue, updateQueue,  clearQueue } from "./db.mjs";
import { loadFile } from "../../lib/io.mjs";
import { askGPT } from "./gpt.mjs";
import crypto from 'crypto';
import fs from 'fs';

const { journalist:{journalist_telegram_bot_id:botTelegramId} } = process.env;
const md5 = (string) => {
  return crypto.createHash('md5').update(string).digest('hex');
};
function loadPromptTemplate(prompt_id, params = {}) {
  function fillPlaceholders(str) {
    return str.replace(/{{(\w+)}}/g, (_, key) => params[key] || "");
  }
  function processPromptRows(rows) {
    return rows.map((entry) => {
      const [role, rawContent] = Object.entries(entry)[0];
      if (Array.isArray(rawContent)) {
        return rawContent; 
      }
      const filled = fillPlaceholders(rawContent);
      return { role, content: filled };
    });
  }
  const templates = loadFile(`journalist/templates`);
  const template = templates[prompt_id];
  if (!template) return [];
  const finalPrompt = [];
  template.forEach((rows) => {
    const processedRows = processPromptRows(rows);
    processedRows.forEach((r) => {
      if (Array.isArray(r)) {
        finalPrompt.push(...r);
      } else {
        finalPrompt.push(r);
      }
    });
  });
  return finalPrompt;
}
const getRecentHistoryString = async (chatId, instructions) => {
  if(instructions==="change_subject") {
    return "[INFO] No History.";
  }
  const recentMessages = await getRecentMessages(chatId);
  const history = recentMessages.map((message) => {
    const { datetime, sender_name, text } = message;
    return `[${datetime}] ${sender_name}: ${text}`;
  });
  return "..." + history.join(' • ').slice(-3000);
};
function buildBiographerChat(historyChat, userEntry) {
  const historyString = historyChat
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
    .join('\n');
  return loadPromptTemplate("biographer", {
    MESSAGE_HISTORY: historyString,
    USER_ENTRY: userEntry
  });
}
function buildMultipleChoiceChat(history, comment, followup_question) {
  return loadPromptTemplate("multiple_choice", {
    HISTORY: history,
    COMMENT: comment,
    FOLLOWUP_QUESTION: followup_question
  });
}
function buildAutobiographerChat(recentHistoryString) {
  return loadPromptTemplate("autobiographer", {
    MESSAGE_HISTORY: recentHistoryString
  });
}
function buildTherapistAnalysisChat(recentHistoryString) {
  return loadPromptTemplate("therapist_analysis", {
    RECENT_HISTORY: recentHistoryString
  });
}
const multipleChoices = async (comment, followup_question, chatId, fn = ["🎲 Change Subject", "❌ Cancel"], attempt = 1) => {
  console.log("multipleChoices", { comment, followup_question, chatId, fn, attempt });
  const history = await getRecentHistoryString(chatId);
  const hash = md5(followup_question);
  if (fs.existsSync(`/tmp/${hash}.choices.json`)) {
    const items = JSON.parse(fs.readFileSync(`/tmp/${hash}.choices.json`)).map(choice=>[choice]);
    return [...items, fn];
  }
  const chat = buildMultipleChoiceChat(history, comment, followup_question);
  try {
    const response = await askGPT(chat, 'gpt-4o');
    console.log("CHOICEGPT.  Q:", followup_question, "R:", response);
    const jsonArray = response.replace(/^[^\[]*/, '').replace(/[^\]]*$/, '');
    const choices = JSON.parse(jsonArray);
    fs.writeFileSync(`/tmp/${hash}.choices.json`, JSON.stringify(choices));
    const choicesArray = choices.map((choice) => [choice]);
    choicesArray.push(fn);
    return choicesArray;
  } catch (error) {
    if (attempt < 10) {
      return multipleChoices(comment, followup_question, chatId, fn, attempt + 1);
    } else {
      return [];
    }
  }
};
/*
  7) DECISION LOGIC: Should we continue with queued questions or pivot?
*/
const evaluateResponsePath = async (history, response, queue) => {
    const chat = loadPromptTemplate("evaluate_response", {
        MESSAGE_HISTORY: history,
        RESPONSE: response,
        PLANNED_QUESTIONS: queue.map((q) => q.text).join(' • ')
    });
  const response_text = await askGPT(chat, 'gpt-4o');
  return /1/gi.test(response_text) ? true : false;
};
export const dearDiary = async (chatId, message, attempt = 1) => {
  if (attempt > 5) return false;
  const queued_messages = loadUnsentQueue(chatId);
  const history = await getRecentMessages(chatId);
  const historyChat = history.map((m) => ({
    role: m.sender_name === 'Journalist' ? 'assistant' : 'user',
    content: m.text
  }));
  if (queued_messages.length) {
    const stayTheCourse = await evaluateResponsePath(history, message, queued_messages);
    if (!stayTheCourse) {
      console.log(
        "Skipping queued questions:",
        queued_messages.map((q) => q.text).join(' • ')
      );
      clearQueue(chatId);
      fs.unlinkSync(`/tmp/${md5(message)}.response.txt`);
    } else {
      const {
        queued_message,
        uuid,
        choices,
        inline,
        foreign_key
      } = queued_messages[queued_messages.length - 1];
      const choiceArray =
        choices || (await multipleChoices(message, queued_message, chatId, ["🎲 Change Subject", "❌ Cancel"]));
      foreign_key.queue = uuid;
      const { message_id } = await sendMessage(chatId, queued_message, {
        choices: choiceArray,
        inline,
        foreign_key
      });
      await updateQueue(uuid, message_id);
      return { message_id, prompt: queued_message };
    }
  }
  const hash = md5(message || `${Date.now()}`);
  const cacheExists = fs.existsSync(`/tmp/${hash}.response.txt`);
  let response_text = null;
  if (cacheExists) {
    response_text = fs.readFileSync(`/tmp/${hash}.response.txt`).toString();
  } else {
    const chat = buildBiographerChat(historyChat, message);
    response_text = await askGPT(chat, 'gpt-4o');
  }
  if (!response_text) {
    return await sendMessage(chatId, `🚧 System Error`, {
      choices: [["🎲 Recover", "❌ Cancel"]]
    });
  }
  fs.writeFileSync(`/tmp/${hash}.response.txt`, response_text);
  let questionArray = [];
  response_text = response_text
    .replace(/^```\S+/, '')
    .replace(/```$/, '')
    .trim();
  if (/\[".*?"\]/gi.test(response_text)) {
    response_text = response_text
      .replace(/^[^\[]*/, '')
      .replace(/[^\]]*$/, '');
  }
  try {
    const parsedResponse = JSON.parse(response_text);
    if (Array.isArray(parsedResponse)) {
      questionArray = parsedResponse;
    }
  } catch (e) {
    questionArray = response_text
      .split(/[?]/)
      .filter((q) => q.trim().length > 0)
      .map((q) => q.trim() + '?')
      .filter((q) => /[a-zA-Z]/.test(q))
      .map((q) => q.replace(/.*?question": "/, ''));
  }
  console.log({ attempt, response_text, questionArray });
  if (!questionArray?.length) {
    return await dearDiary(chatId, message, attempt + 1);
  }
  if (questionArray.length > 1) {
    saveToQueue(chatId, {
      messages: questionArray.map((q) => `↘️ ${q.replace(/^[^a-zA-Z0-9]+/g, '')}`)
    });
    return await dearDiary(chatId, message);
  } else {
    const [question] = questionArray;
    const questions = question
      ?.split(/[?]/)
      .filter((q) => q.length > 1)
      .map((q) => q.trim() + '?');
    if (questions && questions.length > 1) {
      saveToQueue(chatId, {
        messages: questions.map((q) => `↘️ ${q.replace(/^[^a-zA-Z0-9]+/g, '')}`)
      });
      return await dearDiary(chatId, message);
    }
    const choices = await multipleChoices(message, question, chatId, [
      "🎲 Change Subject",
      "❌ Cancel"
    ]);
    const { message_id } = await sendMessage(chatId, `⏩ ${question}`, {
      choices
    });
    return { message_id, prompt: question };
  }
};

export const journalPrompt = async (chatId, config={}) => {
  const {instructions} = config;
  await deleteMostRecentUnansweredMessage(chatId, botTelegramId);
  const recentHistory =  await getRecentHistoryString(chatId,instructions);
  const chat =  buildAutobiographerChat(recentHistory);
  const prompt = await askGPT(chat, 'gpt-4o');
  if (!prompt) return await slashCommand(chatId);
  const choices = await multipleChoices("Ask me something about what’s going on in my life.", prompt, chatId);
  const { message_id } = await sendMessage(chatId, `📘 ${prompt}`, { choices });
  return { message_id, prompt };
};

const reviewPrompt = async (chatId) => {
  const prompt = "Let’s review the entries from the past few days. Ready to dive in?";
  await sendMessage(chatId, prompt);
  return prompt;
};

const yesterdayFillOut = async (chatId) => {
  return await journalPrompt(chatId);
};

const analyzePrompt = async (chatId) => {
  await deleteMostRecentUnansweredMessage(chatId, botTelegramId);
  const recentHistory = await getRecentHistoryString(chatId);
  const chat = buildTherapistAnalysisChat(recentHistory);
  const message = await askGPT(chat, 'gpt-4o');
  const { message_id } = await sendMessage(chatId, `📘 ${message}`);
  return { message_id, prompt: message };
};
/*
  10) SLASH COMMAND 
  -----------------------------------------------------------------
  Map slash-commands to functions. Defaults to journalPrompt.
*/
export const slashCommand = async (chatId, command) => {
  command = (command || "").replace(/^\/+/, '');
  const map = {
    journal: journalPrompt,
    prompt: journalPrompt,
    analyze: analyzePrompt,
    yesterday: yesterdayFillOut,
    review: reviewPrompt
  };
  console.log("slashCommand:", command);
  if (!map[command]) return await journalPrompt(chatId);
  return await map[command](chatId);
};
