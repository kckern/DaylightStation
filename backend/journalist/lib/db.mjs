import moment from 'moment-timezone';
import { v4 as uuidv4 } from 'uuid';
import { loadFile, saveFile } from '../../lib/io.mjs';

// Store paths (similar to "tables" in the old MySQL code)
const MESSAGES_STORE = 'journalist/messages';
const CRONJOBS_STORE = 'journalist/cronjobs';
const JOURNALENTRIES_STORE = 'journalist/journalentries';
const MESSAGEQUEUE_STORE = 'journalist/messagequeue';
const QUIZQUESTIONS_STORE = 'journalist/quizquestions';
const QUIZANSWERS_STORE = 'journalist/quizanswers'; // not used explicitly here, but might fit your usage
const NUTRILOGS_STORE = 'journalist/nutribot/nutrilogs';
const NUTRILIST_STORE = 'journalist/nutribot/nutrilists'; // not used explicitly here, but might fit your usage
const NUTRICURSORS_STORE= 'journalist/nutribot/nutricursors';
const ACTIVITIES_STORE = 'journalist/activities';
const WEIGHTS_STORE = 'journalist/weights';
const NUTRIDAY_STORE = 'journalist/nutribot/nutridays'; // not used explicitly, but mentioned
const NUTRICOACH_STORE = 'journalist/nutribot/nutricoach'; // not used explicitly, but mentioned
// If you need multiple data stores, you can define more as needed.


/* ------------------------------------------------------------------
 * Messages
 * ------------------------------------------------------------------ */

/**
 * Saves a message in the messages store.
 * @param {string} chatId
 * @param {object} param1 - { messageId, senderId, senderName, text, foreign_key }
 * @returns {object|null}
 */
export const saveMessage = (chatId, { messageId, senderId, senderName, text, foreign_key }) => {
  if (!text) return null;
  if (!chatId) return null;
  if (!messageId) return null;

  // Strip emoji from start of text
  const firstCharIsEmoji = text.codePointAt(0) > 255;
  const lastCharIsEmoji = text.codePointAt(text.length - 1) > 255;
  if (firstCharIsEmoji && !lastCharIsEmoji) {
    text = text.replace(/^\S+/g, '').trim();
  }

  text = text.trim().replace(/^Transcription:(\s|\n)+/ig, "").trim();
  const unix = Math.floor(Date.now() / 1000);

  try {
    const data = loadFile(MESSAGES_STORE + "/" + chatId) || {};
    const recordKey = `${chatId}_${messageId}`;
    data[recordKey] = {
      timestamp: unix,
      chat_id: chatId,
      message_id: messageId,
      sender_id: senderId || null,
      sender_name: senderName || 'Unknown',
      text,
      foreign_key: foreign_key || {}
    };
    // Sort by timestamp desc and save
    const sortedData = Object.fromEntries(
      Object.entries(data).sort(([, a], [, b]) => b.timestamp - a.timestamp)
    );
    saveFile(MESSAGES_STORE + "/" + chatId, sortedData);
    return data[recordKey];
  } catch (error) {
    console.error('Error saving message:', error);
    return null;
  }
};

/**
 * Retrieves a list of messages from a chat.
 * @param {string} chatId
 * @param {number} attempt
 * @param {number} max
 * @returns {Array}
 */
export const getMessages = (chatId, attempt = 1, max = 100) => {
  if (!chatId) return [];
  
  try {
    const data = loadFile(MESSAGES_STORE + "/" + chatId) || {};
    // Filter messages by chatId
    let rows = Object.values(data).filter(msg => msg.chat_id === chatId);
    // Sort by timestamp desc
    rows.sort((a, b) => b.timestamp - a.timestamp);
    // Limit
    rows = rows.slice(0, max);

    // Map & transform
    const mapped = rows.map((message) => {
      const m = { ...message };
      m.datetime = moment(m.timestamp * 1000).format('D MMM YYYY, h:mm A');
      m.sender_id = parseInt(m.sender_id, 10) || 0;
      m.message_id = parseInt(m.message_id, 10) || 0;
      if (m.foreign_key) {
        try {
          m.foreign_key = m.foreign_key
        } catch {}
      }
      return m;
    });

    // Sort ascending by timestamp before returning
    return mapped.sort((a, b) => a.timestamp - b.timestamp);
  } catch (error) {
    console.error('Error getting messages:', error);
    if (attempt >= 5) return [];
    return  getMessages(chatId, attempt + 1, max);
  }
};

/**
 * Finds the most recent unanswered message from a sender.
 * @param {string} chatId
 * @param {string|number} senderId
 * @returns {object|null}
 */
export const findMostRecentUnansweredMessage = (chatId, senderId) => {
  if (!chatId || !senderId) return null;
  
  console.log('findMostRecentUnansweredMessage:', { chatId, senderId });
  try {
    const history = getMessages(chatId);
    if(!history || history.length === 0) return null;
    const mostRecentMessage = history[history.length - 1];
    if (mostRecentMessage?.sender_id === senderId) return mostRecentMessage;
    return null;
  } catch (error) {
    console.error('Error finding most recent unanswered message:', error);
    return null;
  }
};

/**
 * Deletes a specific message.
 * @param {string} chatId
 * @param {string|number} messageId
 * @returns {object|null}
 */
export const deleteMessageFromDB = (chatId, messageId) => {
  if (!chatId || !messageId) return { success: false };
  
  try {
    const data = loadFile(MESSAGES_STORE + "/" + chatId) || {};
    const recordKey = `${chatId}_${messageId}`;
    if (data[recordKey]) {
      delete data[recordKey];
       saveFile(MESSAGES_STORE + "/" + chatId, data);
      return { success: true };
    }
    return { success: false };
  } catch (error) {
    console.error('Error deleting message:', error);
    return null;
  }
};

/* ------------------------------------------------------------------
 * Cron jobs
 * ------------------------------------------------------------------ */

/**
 * Loads all cron jobs.
 * @returns {Array}
 */
export const loadCronJobs = () => {
  try {
    const data = loadFile(CRONJOBS_STORE) || {};
    // Return as an array
    return Object.values(data);
  } catch (error) {
    console.error('Error getting cron jobs:', error);
    return [];
  }
};

/**
 * Updates a specific cron job with a new message ID.
 * @param {string} uuid
 * @param {string|number} message_id
 * @param {string} chat_id
 * @returns {object|null}
 */
export const updateCronJob = (uuid, message_id, chat_id) => {
  // Input validation
  if (!uuid || typeof uuid !== 'string') {
    console.error('updateCronJob: Invalid uuid parameter');
    return null;
  }

  if (!message_id || (typeof message_id !== 'string' && typeof message_id !== 'number')) {
    console.error('updateCronJob: Invalid message_id parameter');
    return null;
  }

  const lastRun = Math.floor(Date.now() / 1000);
  try {
    const data = loadFile(CRONJOBS_STORE) || {};
    if (!data || typeof data !== 'object') {
      console.error('updateCronJob: Invalid or missing cron jobs data');
      return null;
    }

    if (!data[uuid]) {
      console.error('updateCronJob: Cron job not found for uuid:', uuid);
      return null;
    }

    data[uuid].message_id = message_id;
    if (chat_id) data[uuid].chat_id = chat_id;
    data[uuid].last_run = lastRun;
    saveFile(CRONJOBS_STORE, data);
    return data[uuid];
  } catch (error) {
    console.error('Error updating cron job:', error);
    return null;
  }
};

/* ------------------------------------------------------------------
 * Journal
 * ------------------------------------------------------------------ */

/**
 * Saves a journal entry.
 * @param {string} chat_id
 * @param {string} date
 * @param {string} period
 * @param {string} entry
 * @param {any} src
 * @returns {object|null}
 */
export const saveJournalEntry = (chat_id, date, period, entry, src) => {
  if (!chat_id || !entry) {
    console.error('saveJournalEntry called with missing chat_id or entry');
    return null;
  }
  const uuid = uuidv4();
  try {
    const data = loadFile(JOURNALENTRIES_STORE) || {};
    data[uuid] = {
      uuid,
      chat_id,
      date,
      period,
      entry,
      src
    };
     saveFile(JOURNALENTRIES_STORE, data);
    return data[uuid];
  } catch (error) {
    console.error('Error saving journal entry:', error);
    return null;
  }
};

/* ------------------------------------------------------------------
 * Message queue
 * ------------------------------------------------------------------ */

/**
 * Loads messages from the unsent queue.
 * @param {string} chat_id
 * @returns {Array}
 */
export const loadUnsentQueue = (chat_id) => {
  if (!chat_id) return [];
  
  try {
    const data = loadFile(MESSAGEQUEUE_STORE) || {};
    // Filter by chat_id and message_id is null
    let rows = Object.values(data).filter(item => item.chat_id === chat_id && !item.message_id);
    // Order by timestamp ASC
    rows.sort((a, b) => a.timestamp - b.timestamp);
    // Return reversed at the end
    return rows.reverse();
  } catch (error) {
    console.error('Error loading unsent queue:', error);
    return [];
  }
};

/**
 * Updates a queue item with a message ID.
 * @param {string} uuid
 * @param {string|number} message_id
 * @returns {object|null}
 */
export const updateQueue = (uuid, message_id) => {
  // Input validation
  if (!uuid || typeof uuid !== 'string') {
    console.error('updateQueue: Invalid uuid parameter');
    return { success: false, error: 'Invalid uuid parameter' };
  }

  if (!message_id || (typeof message_id !== 'string' && typeof message_id !== 'number')) {
    console.error('updateQueue: Invalid message_id parameter');
    return { success: false, error: 'Invalid message_id parameter' };
  }

  try {
    const data = loadFile(MESSAGEQUEUE_STORE) || {};
    if (!data || typeof data !== 'object') {
      console.error('updateQueue: Invalid or missing message queue data');
      return { success: false, error: 'Invalid message queue data' };
    }

    if (!data[uuid]) {
      console.error('updateQueue: Queue item not found for uuid:', uuid);
      return { success: false, error: 'Queue item not found' };
    }

    data[uuid].message_id = message_id;
    saveFile(MESSAGEQUEUE_STORE, data);
    return { success: true, item: data[uuid] };
  } catch (error) {
    console.error('Error updating queue:', error);
    return { success: false, error: error.message || 'Unknown error occurred' };
  }
};

/**
 * Clears the entire message queue for a chat.
 * @param {string} chat_id
 * @returns {object|null}
 */
export const clearQueue = (chat_id) => {
  // Input validation
  if (!chat_id || typeof chat_id !== 'string') {
    console.error('clearQueue: Invalid chat_id parameter');
    return { success: false, error: 'Invalid chat_id parameter' };
  }
  
  try {
    const data = loadFile(MESSAGEQUEUE_STORE) || {};
    if (!data || typeof data !== 'object') {
      console.error('clearQueue: Invalid or missing message queue data');
      return { success: false, error: 'Invalid message queue data' };
    }

    const newData = {};
    let removedCount = 0;
    for (const [key, value] of Object.entries(data)) {
      if (value && value.chat_id !== chat_id) {
        newData[key] = value;
      } else if (value && value.chat_id === chat_id) {
        removedCount++;
      }
    }
    saveFile(MESSAGEQUEUE_STORE, newData);
    return { success: true, removedCount };
  } catch (error) {
    console.error('Error clearing queue:', error);
    return { success: false, error: error.message || 'Unknown error occurred' };
  }
};

/**
 * Saves multiple messages to the queue.
 * @param {string} chat_id
 * @param {object} param1 - { messages, choices, inlines, foreign_keys }
 * @returns {boolean|null}
 */
export const saveToQueue = (chat_id, { messages, choices, inlines, foreign_keys }) => {
  if (!chat_id || !messages || !Array.isArray(messages) || messages.length === 0) {
    console.error('saveToQueue called with missing chat_id or messages');
    return null;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const data = loadFile(MESSAGEQUEUE_STORE) || {};
    let i = 0;
    for (const message of messages) {
      const choicelist = choices?.[i] || null;
      const inline = !!inlines?.[i];
      const foreign_key = foreign_keys?.[i] || {};
      const uuid = uuidv4();
      data[uuid] = {
        uuid,
        timestamp,
        queued_message: message,
        chat_id,
        choices:choicelist,
        inline,
        foreign_key,
        message_id: null
      };
      i++;
    }
     saveFile(MESSAGEQUEUE_STORE, data);
    return true;
  } catch (error) {
    console.error('Error saving to queue:', error);
    return null;
  }
};

/**
 * Deletes unprocessed queue messages for a chat.
 * @param {string} chat_id
 * @returns {object|null}
 */
export const deleteUnprocessedQueue = (chat_id) => {
  if (!chat_id) return { success: false };
  
  try {
    const data = loadFile(MESSAGEQUEUE_STORE) || {};
    const newData = {};
    for (const [k, v] of Object.entries(data)) {
      if (!(v.chat_id === chat_id && !v.message_id)) {
        newData[k] = v;
      }
    }
     saveFile(MESSAGEQUEUE_STORE, newData);
    return { success: true };
  } catch (error) {
    console.error('Error deleting unprocessed queue:', error);
    return null;
  }
};

/* ------------------------------------------------------------------
 * Quiz
 * ------------------------------------------------------------------ */

/**
 * Loads quiz questions by category.
 * @param {string} category
 * @returns {Array}
 */
export const loadQuizQuestions = (category) => {
  if (!category) {
    console.error('loadQuizQuestions called with missing category');
    return [];
  }
  try {
    const data = loadFile(QUIZQUESTIONS_STORE) || {};
    // Filter
    const rows = Object.values(data).filter(q => q.category === category);
    return rows;
  } catch (error) {
    console.error('Error getting quiz questions:', error);
    return [];
  }
};

/**
 * Loads a question by category, preferring unasked questions first.
 * If no unasked remain, resets last_asked to null for that category and attempts again.
 * @param {string} category
 * @returns {object|null}
 */
export const loadQuestionByCategory = (category) => {
  // Input validation
  if (!category || typeof category !== 'string') {
    console.error('loadQuestionByCategory: Invalid category parameter');
    return null;
  }

  const attemptLoad = () => {
    try {
      const data = loadFile(QUIZQUESTIONS_STORE);
      if (!data || typeof data !== 'object') {
        console.error('loadQuestionByCategory: Invalid or missing quiz questions data');
        return null;
      }

      // Filter by last_asked = null (i.e., unasked)
      let rows = Object.values(data).filter(q => q && q.last_asked == null);
      if (category) {
        rows = rows.filter(q => q && q.category === category);
      }
      if (rows && rows.length > 0) {
        // Shuffle
        rows.sort(() => 0.5 - Math.random());
        return rows[0];
      } else {
        return null;
      }
    } catch (error) {
      console.error('Error loading question by category:', error);
      return null;
    }
  };

  let result = attemptLoad();
  if (!result && category) {
    // Reset all last_asked for the category
    try {
      const data = loadFile(QUIZQUESTIONS_STORE);
      if (!data || typeof data !== 'object') {
        console.error('loadQuestionByCategory: Invalid data when resetting last_asked');
        return null;
      }

      let resetCount = 0;
      for (const [k, v] of Object.entries(data)) {
        if (v && v.category === category) {
          v.last_asked = null;
          resetCount++;
        }
      }
      
      if (resetCount > 0) {
        saveFile(QUIZQUESTIONS_STORE, data);
        // Try fetching again
        result = attemptLoad();
      }
    } catch (error) {
      console.error('Error resetting last_asked:', error);
      return null;
    }
  }
  return result;
};

/**
 * Records an answer for a quiz question.
 * @param {string} uuid
 * @param {string|number} answer
 * @returns {object|null}
 */
export const answerQuizQuestion = (uuid, answer) => {
  // Input validation
  if (!uuid || typeof uuid !== 'string') {
    console.error('answerQuizQuestion: Invalid uuid parameter');
    return null;
  }

  if (answer === undefined || answer === null) {
    console.error('answerQuizQuestion: Invalid answer parameter');
    return null;
  }

  try {
    const data = loadFile(QUIZQUESTIONS_STORE);
    if (!data || typeof data !== 'object') {
      console.error('answerQuizQuestion: Invalid or missing quiz questions data');
      return null;
    }

    const question = data[uuid];
    if (!question) {
      console.error('answerQuizQuestion: Question not found for uuid:', uuid);
      return null;
    }

    // parse existing responses
    let responses = {};
    if (question.responses) {
      try {
        responses = typeof question.responses === 'object' ? question.responses : {};
      } catch (error) {
        console.error('answerQuizQuestion: Error parsing existing responses:', error);
        responses = {};
      }
    }

    // parse answer
    const isNumeric = /^\d+$/.test(String(answer));
    if (isNumeric) answer = parseInt(answer, 10);

    const timeZone = 'America/Los_Angeles';
    const todaysDate = moment().tz(timeZone).format('YYYY-MM-DD');
    responses[todaysDate] = answer;

    // save back
    question.responses = responses;
    data[uuid] = question;
    saveFile(QUIZQUESTIONS_STORE, data);

    return responses;
  } catch (error) {
    console.error('Error answering quiz question:', error);
    return null;
  }
};

/* ------------------------------------------------------------------
 * Messages (update, load)
 * ------------------------------------------------------------------ */

/**
 * Updates a message in the database.
 * @param {string} chat_id
 * @param {string|number} message_id
 * @param {object} values - { text, foreign_key }
 * @returns {object|null}
 */
export const updateDBMessage = (chat_id, message_id, values) => {
  if (!chat_id || !message_id || !values) {
    console.error('updateDBMessage called with missing parameters');
    return null;
  }
  try {
    const data = loadFile(MESSAGES_STORE + "/" + chat_id) || {};
    const recordKey = `${chat_id}_${message_id}`;
    if (!data[recordKey]) {
      return null;
    }
    const { text, foreign_key } = values;
    if (text !== undefined) data[recordKey].text = text;
    if (foreign_key !== undefined) {
      data[recordKey].foreign_key = foreign_key;
    }
     saveFile(MESSAGES_STORE + "/" + chat_id, data);
    return data[recordKey];
  } catch (error) {
    console.error('Error updating message:', error);
    return null;
  }
};

/**
 * Loads a message from the database by chatId and messageId.
 * @param {string} chat_id
 * @param {string|number} message_id
 * @returns {object|null}
 */
export const loadMessageFromDB = (chat_id, message_id) => {
  if (!chat_id || !message_id) {
    console.error('loadMessageFromDB called with missing parameters');
    return [];
  }
  try {
    const data = loadFile(MESSAGES_STORE + "/" + chat_id) || {};
    const recordKey = `${chat_id}_${message_id}`;
    return data[recordKey] ? [data[recordKey]] : [];
  } catch (error) {
    console.error('Error loading message from DB:', error);
    return [];
  }
};

/* ------------------------------------------------------------------
 * Nutrilog
 * ------------------------------------------------------------------ */

/**
 * Saves a nutrilog entry.
 * @param {object} param0 - { uuid, chat_id, timestamp, message_id, food_data, status, upc, factor, auto_confirmed }
 * @returns {object|null}
 */
export const saveNutrilog = ({ uuid, chat_id, timestamp, message_id, food_data, status, upc, factor, auto_confirmed }) => {
  console.log('Saving nutrilog:', { uuid, chat_id, message_id, food_data, status, upc, factor, auto_confirmed });
  if (!uuid || !chat_id) {
    console.error('saveNutrilog called with missing uuid or chat_id');
    return null;
  }

  try {
    const data = loadFile(NUTRILOGS_STORE + "/" + chat_id) || {};
    data[uuid] = {
      uuid,
      chat_id,
      timestamp: timestamp || Math.floor(Date.now() / 1000),
      message_id,
      food_data: food_data || {},
      status: status || 'pending',
      upc: upc || null,
      factor: factor || null,
      auto_confirmed: auto_confirmed || false
    };
     saveFile(NUTRILOGS_STORE + "/" + chat_id, data);
    return data[uuid];
  } catch (error) {
    console.error('Error saving nutrilog:', error);
    return null;
  }
};


export const saveNutriDay = ({ chat_id, daily_data }) => {
  if (!chat_id || !daily_data) {
    console.error('saveNutriDay called with missing chat_id or daily_data');
    return null;
  }

  try {
    const datesToUpsert = Object.keys(daily_data || {});
    const data = loadFile(NUTRIDAY_STORE + "/" + chat_id) || {};
    for (const date of datesToUpsert) {
      if (!data[date]) {
        data[date] = daily_data[date];
      } else {
        // Update existing entry
        for (const [k, v] of Object.entries(daily_data[date])) {
          data[date][k] = v;
        }
      }
    }
    saveFile(NUTRIDAY_STORE + "/" + chat_id, data);
    return true;
  } catch (error) {
    console.error('Error saving nutriday:', error);
    return null;
  }
}


export const getNutriDay = (chat_id, date) => {
  try {
    const data = loadFile(NUTRIDAY_STORE + "/" + chat_id) || {};
    if (data[date]) {
      return data[date];
    }
    return null;
  } catch (error) {
    console.error('Error getting nutriday:', error);
    return null;
  }
}

export const getNutriDaysBack = (chat_id, days = 7) => {
  try {
    const data = loadFile(NUTRIDAY_STORE + "/" + chat_id) || {};
    const today = moment().format('YYYY-MM-DD');
    const daysBack = [];
    for (let i = 0; i < days; i++) {
      const date = moment(today).subtract(i, 'days').format('YYYY-MM-DD');
      if (data[date]) {
        daysBack.push({ date, data: data[date] });
      }
    }
    return daysBack;
  } catch (error) {
    console.error('Error getting nutridays back:', error);
    return null;
  }
}

export const saveNutriCoach = ({ chat_id, date, message, mostRecentItems}) => {
  try {
    const data = loadFile(NUTRICOACH_STORE + "/" + chat_id) || {};
    data[date] = data[date] || [];
    data[date].push({
      timestamp: Math.floor(Date.now() / 1000),
      mostRecentItems,
      message
    });
     saveFile(NUTRICOACH_STORE + "/" + chat_id, data);
    return true;

}
  catch (error) {
    console.error('Error saving nutricoach:', error);
    return null;
  }
}


export const getNutriCoach = (chat_id, daysBack = 7) => {
  try {
    const data = loadFile(NUTRICOACH_STORE + "/" + chat_id) || {};
    const today = moment().format('YYYY-MM-DD');
    const coachData = [];
    for (let i = 0; i < daysBack; i++) {
      const date = moment(today).subtract(i, 'days').format('YYYY-MM-DD');
      if (data[date]) {
        coachData.push({ date, messages: data[date] });
      }
    }
    return coachData;
  } catch (error) {
    console.error('Error getting nutricoach data:', error);
    return null;
  }
}


/**
 * Retrieves a nutrilog by UUID.
 * @param {string} uuid
 * @returns {Array|null}
 */
export const getNutrilog = (uuid, chat_id) => {
  if (!uuid || !chat_id) {
    console.error('getNutrilog called with missing uuid or chat_id');
    return [];
  }
  try {
    const data = loadFile(NUTRILOGS_STORE + "/" + chat_id) || {};
    const entry = data[uuid];
    return entry ? [entry] : [];
  } catch (error) {
    console.error('Error getting nutrilog:', error);
    return [];
  }
};

export const getMostRecentNutrilog = (chat_id) => {
  if (!chat_id) {
    console.error('getMostRecentNutrilog called with missing chat_id');
    return null;
  }
  try {
    const data = loadFile(NUTRILOGS_STORE + "/" + chat_id) || {};
    // Sort by timestamp descending
    const logIds = Object.keys(data);
    if (logIds.length === 0) return null;
    
    const sorted = logIds.sort((a, b) => data[b].message_id - data[a].message_id);
    // Get the most recent one
    const mostRecentId = sorted[0];
    return data[mostRecentId] || null;
  } catch (error) {
    console.error('Error getting most recent nutrilog:', error);
    return null;
  }
}

export const getMostRecentNutrilistItems = (chat_id) => {
  if (!chat_id) {
    console.error('getMostRecentNutrilistItems called with missing chat_id');
    return [];
  }
  
  const mostRecentNutrilog = getMostRecentNutrilog(chat_id);
  if (!mostRecentNutrilog) {
    console.warn('No recent nutrilog found for chat_id:', chat_id);
    return [];
  }
  try {
    const data = loadFile(NUTRILIST_STORE + "/" + chat_id) || {};
    // Filter items that match the most recent nutrilog's log_uuid
    const rows = Object.values(data).filter(item => item.chat_id === chat_id && item.log_uuid === mostRecentNutrilog.uuid);
    // Sort by calories descending
    rows.sort((a, b) => {
      let aCals = 0, bCals = 0;
      try { aCals = a.food_data?.calories || 0; } catch {}
      try { bCals = b.food_data?.calories || 0; } catch {}
      return bCals - aCals;
    });
    return rows.map(item => (`${item.item} (${item.amount} ${item.unit})`));
  } catch (error) {
    console.error('Error getting most recent nutrilist items:', error);
    return [];
  }
}

/**
 * Retrieves nutrilist by date.
 * @param {string} chat_id
 * @param {string} date
 * @returns {Array|null}
 */
export const getNutrilListByDate = (chat_id, date) => {
  if (!chat_id || !date) {
    console.error('getNutrilListByDate called with missing chat_id or date');
    return [];
  }
  try {
    // This was originally referencing 'nutrilist' table, but in the new structure
    // you might keep them in the same nutrilogs store or a different file. 
    // Adjust as needed. For demonstration, assume it's the same store:
    const data = loadFile(NUTRILIST_STORE + "/" + chat_id) || {};
    const rows = Object.values(data).filter(item => item.chat_id === chat_id && item.date === date);
    const sorted =  rows.sort((a, b) => {
      const aCals = a.calories || 0;
      const bCals = b.calories || 0;
      return bCals - aCals;
    });
    console.log('Retrieved nutrilist by date:', { chat_id, date, count: sorted.length, sorted });
    return sorted;
  } catch (error) {
    console.error('Error getting nutrilist by date:', error);
    return [];
  }
};

/**
 * Retrieves nutrilist by UUID.
 * @param {string} chat_id
 * @param {string} uuid
 * @returns {object|null}
 */
export const getNutrilListByID = (chat_id, uuid) => {
  if (!chat_id || !uuid) {
    console.error('getNutrilListByID called with missing chat_id or uuid');
    return {};
  }
  try {
    const data = loadFile(NUTRILIST_STORE + "/" + chat_id) || {};
    const item = data[uuid];
    if (item && item.chat_id === chat_id) {
      return item;
    }
    return {};
  } catch (error) {
    //return empty object if not found
    console.error('Error getting nutrilist by ID:', error);
    return {};
  }
};

/**
 * Deletes a nutrilist entry by UUID.
 * @param {string} chat_id
 * @param {string} uuid
 * @returns {object|null}
 */
export const deleteNuriListById = (chat_id, uuid) => {
  if (!chat_id || !uuid) {
    console.error('deleteNuriListById called with missing chat_id or uuid');
    return { success: false };
  }
  
  try {
    const data = loadFile(NUTRILIST_STORE + "/" + chat_id) || {};
    
    if (data[uuid] && data[uuid].chat_id === chat_id) {
      const log_uuid = data[uuid].log_uuid;
      
      if (log_uuid) {
        const nutrilogData = loadFile(NUTRILOGS_STORE + "/" + chat_id) || {};
        if (nutrilogData[log_uuid]) {
          delete nutrilogData[log_uuid];
          saveFile(NUTRILOGS_STORE + "/" + chat_id, nutrilogData);
        }
      }

      delete data[uuid];
      saveFile(NUTRILIST_STORE + "/" + chat_id, data);
      return { success: true };
    }
    
    return { success: false };
  } catch (error) {
    console.error('Error deleting nutrilist by ID:', error);
    return { success: false };
  }
};

/**
 * Updates a nutrilist entry.
 * @param {string} uuid
 * @param {object} values
 * @returns {object|null}
 */
export const updateNutrilist = (chat_id, uuid, values) => {
  console.log('Updating nutrilist:', { chat_id, uuid, values });
  if (!chat_id || !uuid || !values) {
    console.error('updateNutrilist called with missing parameters');
    return null;
  }
  try {
    const data = loadFile(NUTRILIST_STORE + "/" + chat_id) || {};
    if (!data[uuid]) {
      return null;
    }
    for (const [k, v] of Object.entries(values)) {
      data[uuid][k] = v;
    }
     saveFile(NUTRILIST_STORE + "/" + chat_id, data);
    return data[uuid];
  } catch (error) {
    console.error('Error updating nutrilist:', error);
    return null;
  }
};

/**
 * Retrieves a nutrilog by message ID.
 * @param {string} chat_id
 * @param {string|number} message_id
 * @returns {object|null}
 */
export const getNutrilogByMessageId = (chat_id, message_id) => {
  console.log('Getting nutrilog by message_id:', { chat_id, message_id });
  if (!chat_id || !message_id) {
    console.error('getNutrilogByMessageId called with missing chat_id or message_id');
    return null;
  }
  try {
    const data = loadFile(NUTRILOGS_STORE + "/" + chat_id) || {};
    console.log('Loaded data:', data);
    const rows = Object.values(data).filter(item => item.chat_id === chat_id && item.message_id == message_id);
    return rows?.[0] || null;
  } catch (error) {
    console.error('Error getting nutrilog by message_id:', error);
    return null;
  }
};

/**
 * Retrieves the pending nutrilog for a chat.
 * @param {string} chat_id
 * @returns {object|null}
 */
export const getMidRevisionNutrilog = (chat_id) => {
  if (!chat_id) {
    console.error('getMidRevisionNutrilog called with missing chat_id');
    return null;
  }
  try {
    // The original logic references "getNutriCursor" to see if there's something "revising"
    const cursor = getNutriCursor(chat_id);
    if (cursor && cursor.revising) {
      const { uuid } = cursor.revising;
      const [nutrilog] = ( getNutrilog(uuid, chat_id) || [] );
      console.log('Found pending nutrilog:', { uuid, nutrilog });
      if (nutrilog) return nutrilog;
    }

    // fallback: look for a "revising" entry
    const data = loadFile(NUTRILOGS_STORE + "/" + chat_id) || {};
    // 1 minute old
    const oneMinuteOld = Math.floor(Date.now() / 1000) - 60;
    const rows = Object.values(data)
      .filter(item => item.chat_id === chat_id && item.status === 'revising')
      .sort((a, b) => b.timestamp - a.timestamp);
    return rows?.[0] || null;
  } catch (error) {
    console.error('Error getting pending nutrilogs:', error);
    return null;
  }
};


export const getNonAcceptedNutrilogs = (chat_id, minutesBack = 60) => {
  if (!chat_id) {
    console.error('getNonAcceptedNutrilogs called with missing chat_id');
    return [];
  }
  try {
    const data = loadFile(NUTRILOGS_STORE + "/" + chat_id) || {};
    // Filter out nutrilogs that are not accepted
    const rows = Object.values(data).filter(item =>
      item.chat_id === chat_id 
      && !['accepted', 'assumed'].includes(item.status)
      && item.timestamp >= (Math.floor(Date.now() / 1000) - (minutesBack * 60))
    );
    return rows;
  } catch (error) {
    console.error('Error getting non-accepted nutrilogs:', error);
    return [];
  }
};


/* ------------------------------------------------------------------
 * Journal messages
 * ------------------------------------------------------------------ */

/**
 * Loads journal messages within a time range.
 * @param {string} chat_id
 * @param {string} since
 * @param {string} until
 * @returns {Array|null}
 */
export const loadJournalMessages = (chat_id, since, until) => {
  if (!chat_id) {
    console.error('loadJournalMessages called with missing chat_id');
    return [];
  }
  
  const timeZone = 'America/Los_Angeles';
  since = since || moment().tz(timeZone).subtract(7, 'days').format('YYYY-MM-DD');
  until = until || moment().tz(timeZone).format('YYYY-MM-DD');
  const sinceUnix = Math.floor(moment(since).startOf('day').valueOf() / 1000);
  const untilUnix = Math.floor(moment(until).endOf('day').valueOf() / 1000);

  console.log('Loading journal entries:', { chat_id, since, until, sinceUnix, untilUnix });
  try {
    const data = loadFile(MESSAGES_STORE + "/" + chat_id) || {};
    const rows = Object.values(data).filter(item =>
      item.chat_id === chat_id &&
      item.timestamp >= sinceUnix &&
      item.timestamp <= untilUnix
    );

    const reduced = rows.map(entry => {
      const { timestamp, sender_name, text } = entry;
      const date = moment(timestamp * 1000).tz(timeZone).format('YYYY-MM-DD');
      const time = moment(timestamp * 1000).tz(timeZone).format('h:mm A');
      return { date, time, sender_name, text };
    }).reduce((acc, item) => {
      if (!acc[item.date]) acc[item.date] = [];
      acc[item.date].push(`[${item.time}] ${item.sender_name}: ${item.text}`);
      return acc;
    }, {});

    return Object.entries(reduced).map(([date, messages]) => [date, messages]);
  } catch (error) {
    console.error('Error getting journal entries:', error);
    return [];
  }
};

/* ------------------------------------------------------------------
 * Delete a nutrilog
 * ------------------------------------------------------------------ */

/**
 * Deletes a nutrilog by UUID.
 * @param {string} uuid
 * @returns {object|null}
 */
export const deleteNutrilog = (chat_id, uuid) => {
  try {
    const data = loadFile(NUTRILOGS_STORE + "/" + chat_id);
    if (data[uuid]) {
      delete data[uuid];
       saveFile(NUTRILOGS_STORE + "/" + chat_id, data);
      return { success: true };
    }
    return { success: false };
  } catch (error) {
    console.error('Error deleting nutrilog:', error);
    return null;
  }
};

/* ------------------------------------------------------------------
 * Nutrilist (food items)
 * ------------------------------------------------------------------ */

/**
 * Saves nutrilist items.
 * @param {Object|Array} items
 * @returns {boolean|null}
 */
export const saveNutrilist = (items, chat_id) => {
  console.log('saveNutrilist called with:', { items, chat_id });
  
  if (!chat_id) {
    console.error('saveNutrilist called with missing chat_id');
    return null;
  }
  
  // For demonstration, we'll reuse NUTRILOGS_STORE + "/" + chat_id or create a new store if needed.
  // In the original code, it inserts into "nutrilist" table. We'll assume we have a separate store:
  // "journalist/nutrilogs" or "journalist/nutrilist". Adjust as needed.
  if (!Array.isArray(items)) items = [items];
  
  if (!items.length) {
    console.log('No items to save');
    return true;
  }

  try {
    const data = loadFile(NUTRILIST_STORE + "/" + chat_id) || {};
    //console.log('Loaded existing data:', Object.keys(data));
    
    for (const item of items) {
      // The primary key is item.uuid
      if (!item.uuid) {
        item.uuid = uuidv4();
      }
      console.log('Saving item:', item.uuid, item.item);
      
      data[item.uuid] = {
        uuid: item.uuid,
        icon: item.icon,
        item: item.item,
        unit: item.unit,
        amount: item.amount,
        noom_color: item.noom_color,
        calories: item.calories,
        fat: item.fat,
        carbs: item.carbs,
        protein: item.protein,
        fiber: item.fiber,
        sugar: item.sugar,
        sodium: item.sodium,
        cholesterol: item.cholesterol,
        chat_id: item.chat_id,
        date: item.date,
        log_uuid: item.log_uuid
      };
    }
    
  //  console.log('Saving data with keys:', Object.keys(data));
    saveFile(NUTRILIST_STORE + "/" + chat_id, data);
    console.log('Successfully saved nutrilist');
    return true;
  } catch (error) {
    console.error('Error saving nutrilist:', error);
    return null;
  }
};

/**
 * Loads nutrilogs needing listing.
 * (In the original MySQL code, this was a stored procedure call.)
 * @param {string} chat_id
 * @returns {Array|null}
 */
export const loadNutrilogsNeedingListing = (chat_id) => {
  try {
    // We don't have stored procedures, so we can replicate logic:
    // Return all nutrilogs with status in ['accepted', 'assumed'], for example.
    const data = loadFile(NUTRILOGS_STORE + "/" + chat_id);
    const rows = Object.values(data).filter(item =>
      item.chat_id === chat_id &&
      (item.status === 'accepted' || item.status === 'assumed')
    );
    return rows;
  } catch (error) {
    console.error('Error getting nutrilogs needing listing:', error);
    return null;
  }
};

/**
 * Loads daily nutrition for a chat.
 * (Originally used CALL get_daily_nutrition(?))
 * @param {string} chat_id
 * @returns {Array|null}
 */
export const loadDailyNutrition = (chat_id) => {
  console.log('Loading daily nutrition:', { chat_id });
  // This depends on how you store daily nutrition. If you have a separate store:
  // "journalist/dailynutrition", you'd load from there. For demonstration:
  try {
    const data = loadFile(DAILY_NUTRITION_STORE);
    // Possibly filter by chat_id
    const rows = Object.values(data).filter(item => item.chat_id === chat_id);
    return rows;
  } catch (error) {
    console.error('Error getting daily nutrition:', error);
    return null;
  }
};

/**
 * Loads recent nutrilist entries from the last X days.
 * @param {string} chat_id
 * @param {number} days_since
 * @returns {Array|null}
 */
export const loadRecentNutriList = (chat_id, days_since = 14) => {
  try {
    const dateThreshold = moment().subtract(days_since, 'days').format('YYYY-MM-DD');
    const data = loadFile(NUTRILIST_STORE + "/" + chat_id);
    // Filter
    const rows = Object.values(data).filter(item => {
      if (item.chat_id !== chat_id) return false;
      // Compare item.date >= dateThreshold
      if (item.date && item.date >= dateThreshold) return true;
      return false;
    });
    return rows;
  } catch (error) {
    console.error('Error getting recent nutrilist:', error);
    return null;
  }
};

/**
 * Checks if a nutrilog is already listed.
 * @param {string} uuid
 * @returns {boolean}
 */
export const nutriLogAlreadyListed = (uuid, chat_id) => {
  try {
    const data = loadFile(NUTRILIST_STORE + "/" + chat_id) || {};
    // If there's any item with log_uuid = uuid
    const found = Object.values(data).some(item => item.log_uuid === uuid);
   // console.log(`Checking if nutrilog ${uuid} is already listed:`, found);
    return found;
  } catch (error) {
    console.error('Error checking if nutrilog is already listed:', error);
    return false;
  }
};

/* ------------------------------------------------------------------
 * NutriCursor
 * ------------------------------------------------------------------ */

/**
 * Sets the nutri cursor data.
 * @param {string} chat_id
 * @param {object} dataObj
 * @returns {boolean|null}
 */
export const setNutriCursor = (chat_id, dataObj) => {
  if (!chat_id) {
    console.error('setNutriCursor called with missing chat_id');
    return null;
  }
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const data = loadFile(NUTRICURSORS_STORE + "/" + chat_id) || {};
    data[chat_id] = {
      chat_id,
      timestamp,
      data: dataObj || {}
    };
     saveFile(NUTRICURSORS_STORE + "/" + chat_id, data);
    return true;
  } catch (error) {
    console.error('Error setting nutri cursor:', error);
    return null;
  }
};

/**
 * Gets the nutri cursor data.
 * @param {string} chat_id
 * @returns {object}
 */
export const getNutriCursor = (chat_id) => {
  if (!chat_id) {
    console.error('getNutriCursor called with missing chat_id');
    return {};
  }
  try {
    const data = loadFile(NUTRICURSORS_STORE + "/" + chat_id) || {};
    if (data[chat_id]) {
      const parsed = data[chat_id].data;
      return parsed || {};
    }
    return {};
  } catch (error) {
    console.error('Error getting nutri cursor:', error);
    return {};
  }
};

/**
 * Clears nutrilist by log UUID (deletes items).
 * @param {string} uuid
 * @returns {object|null}
 */
export const clearNutrilistByLogUUID = (uuid, chat_id) => {
  if (!uuid || !chat_id) {
    console.error('clearNutrilistByLogUUID called with missing uuid or chat_id');
    return { success: false, count: 0 };
  }
  try {
    const data = loadFile(NUTRILIST_STORE + "/" + chat_id) || {};
    let count = 0;
    for (const [k, v] of Object.entries(data)) {
      if (v.log_uuid === uuid) {
        delete data[k];
        count++;
      }
    }
     saveFile(NUTRILIST_STORE + "/" + chat_id, data);
    return { success: true, count };
  } catch (error) {
    console.error('Error clearing nutrilist by log uuid:', error);
    return { success: false, count: 0 };
  }
};

/* ------------------------------------------------------------------
 * Activities
 * ------------------------------------------------------------------ */

/**
 * Saves a list of activities.
 * @param {Array} activities
 * @returns {boolean|null}
 */
export const saveActivities = (activities) => {
  if (!activities || !Array.isArray(activities) || activities.length === 0) {
    console.error('saveActivities called with missing or empty activities array');
    return null;
  }
  try {
    const data = loadFile(ACTIVITIES_STORE) || {};
    for (const activity of activities) {
      const { date, chat_id, src, type, id, data: activityData } = activity;
      if (!date || !src || !id || !activityData) continue;
      const pk = `${chat_id}_${date}_${id}`;
      data[pk] = {
        date,
        chat_id,
        src,
        type,
        id,
        data: activityData
      };
    }
     saveFile(ACTIVITIES_STORE, data);
    return true;
  } catch (error) {
    console.error('Error saving activities:', error);
    return null;
  }
};

/**
 * Loads activities from the last X days.
 * @param {string} chat_id
 * @param {number} days_since
 * @returns {Array|null}
 */
export const loadActivities = (chat_id, days_since = 14) => {
  if (!chat_id) {
    console.error('loadActivities called with missing chat_id');
    return [];
  }
  try {
    const dateThreshold = moment().subtract(days_since, 'days').format('YYYY-MM-DD');
    const data = loadFile(ACTIVITIES_STORE) || {};
    const rows = Object.values(data).filter(act => {
      if (act.chat_id !== chat_id) return false;
      return (act.date >= dateThreshold);
    });
    return rows;
  } catch (error) {
    console.error('Error getting activities:', error);
    return [];
  }
};

/* ------------------------------------------------------------------
 * Weights
 * ------------------------------------------------------------------ */

/**
 * Saves weight records.
 * @param {Array} weights
 * @returns {boolean|null}
 */
export const saveWeight = (weights) => {
  if (!weights || !Array.isArray(weights) || weights.length === 0) {
    console.error('saveWeight called with missing or empty weights array');
    return null;
  }
  try {
    const data = loadFile(WEIGHTS_STORE) || {};
    for (const w of weights) {
      const { chat_id, src, date } = w;
      if (!chat_id || !src || !date) continue;
      const pk = `${chat_id}_${src}_${date}`;
      const kg = parseFloat((w.kg || 0).toFixed(2)) || null;
      const fat_ratio = parseFloat((w.fat_ratio || 0).toFixed(1)) || null;
      data[pk] = {
        chat_id,
        src,
        date,
        kg,
        fat_ratio
      };
    }
     saveFile(WEIGHTS_STORE, data);
    return true;
  } catch (error) {
    console.error('Error saving weights:', error);
    return null;
  }
};

/**
 * Loads weight records from the last X days.
 * @param {string} chat_id
 * @param {number} days_since
 * @returns {Array|null}
 */
export const loadWeight = (chat_id, days_since = 14) => {
  if (!chat_id) {
    console.error('loadWeight called with missing chat_id');
    return [];
  }
  try {
    const dateThreshold = moment().subtract(days_since, 'days').format('YYYY-MM-DD');
    const data = loadFile(WEIGHTS_STORE) || {};
    const rows = Object.values(data).filter(item => {
      return item.chat_id === chat_id && item.date >= dateThreshold;
    });
    // Sort ascending by date
    rows.sort((a, b) => new Date(a.date) - new Date(b.date));
    return rows;
  } catch (error) {
    console.error('Error getting weights:', error);
    return [];
  }
};

/* ------------------------------------------------------------------
 * Function Documentation
 * ------------------------------------------------------------------ 

1. saveMessage
2. getMessages
3. findMostRecentUnansweredMessage
4. deleteMessageFromDB
5. loadCronJobs
6. updateCronJob
7. saveJournalEntry
8. loadUnsentQueue
9. updateQueue
10. saveToQueue
11. deleteUnprocessedQueue
12. loadQuizQuestions
13. loadQuestionByCategory
14. attemptLoad (sub-function in loadQuestionByCategory)
15. answerQuizQuestion
16. updateDBMessage
17. loadMessageFromDB
18. saveNutrilog
19. getNutrilog
20. getNutrilListByDate
21. getNutrilListByID
22. deleteNuriListById
23. updateNutrilist
24. getNutrilogByMessageId
25. getMidRevisionNutrilog
26. loadJournalMessages
27. deleteNutrilog
28. saveNutrilist
29. loadNutrilogsNeedingListing
30. loadDailyNutrition
31. loadRecentNutriList
32. nutriLogAlreadyListed
33. setNutriCursor
34. getNutriCursor
35. clearNutrilistByLogUUID
36. saveActivities
37. loadActivities
38. saveWeight
39. loadWeight

------------------------------------------------------------------ */

/**
 * Deletes a specific message by chatId and messageId.
 * @param {string} chat_id
 * @param {string|number} message_id
 * @returns {object|null}
 */
export const deleteSpecificMessage = (chat_id, message_id) => {
  // Input validation
  if (!chat_id || (chat_id !== null && typeof chat_id !== 'string' && typeof chat_id !== 'number')) {
    console.error('deleteSpecificMessage: Invalid chat_id parameter');
    return { success: false, error: 'Invalid chat_id parameter' };
  }
  
  if (!message_id || (message_id !== null && typeof message_id !== 'string' && typeof message_id !== 'number')) {
    console.error('deleteSpecificMessage: Invalid message_id parameter');
    return { success: false, error: 'Invalid message_id parameter' };
  }

  try {
    const data = loadFile(MESSAGES_STORE + "/" + chat_id);
    if (!data || typeof data !== 'object') {
      console.error('deleteSpecificMessage: Invalid or missing data for chat_id:', chat_id);
      return { success: false, error: 'No data found for chat_id' };
    }

    const recordKey = `${chat_id}_${message_id}`;
    if (data[recordKey]) {
      delete data[recordKey];
      saveFile(MESSAGES_STORE + "/" + chat_id, data);
      return { success: true };
    }
    return { success: false, error: 'Message not found' };
  } catch (error) {
    console.error('Error deleting specific message:', error);
    return { success: false, error: error.message || 'Unknown error occurred' };
  }
};

/**
 * Gets all nutrilogs with pending UPC portion selection for a chat.
 * @param {string} chat_id 
 * @returns {Array} Array of nutrilogs with status "init" and non-null upc
 */
export const getPendingUPCNutrilogs = (chat_id) => {
  if (!chat_id) {
    console.error('getPendingUPCNutrilogs called with missing chat_id');
    return [];
  }
  try {
    const data = loadFile(NUTRILOGS_STORE + "/" + chat_id) || {};
    const rows = Object.values(data)
      .filter(item => 
        item.chat_id === chat_id && 
        ['init', 'revising'].includes(item.status) &&
        item.upc
      )
      .sort((a, b) => b.timestamp - a.timestamp);
    console.log('Found pending UPC nutrilogs:', { chat_id, count: rows.length });
    return rows;
  } catch (error) {
    console.error('Error getting pending UPC nutrilogs:', error);
    return [];
  }
};

/**
 * Gets the total count of UPC nutrilogs for today for a chat.
 * @param {string} chat_id 
 * @returns {number} Count of UPC nutrilogs from today
 */
export const getTotalUPCNutrilogs = (chat_id) => {
  if (!chat_id) {
    console.error('getTotalUPCNutrilogs called with missing chat_id');
    return 0;
  }
  try {
    const data = loadFile(NUTRILOGS_STORE + "/" + chat_id) || {};
    const today = moment().format('YYYY-MM-DD');
    const todayStart = moment(today).unix();
    const todayEnd = moment(today).add(1, 'day').unix();
    
    const rows = Object.values(data)
      .filter(item => 
        item.chat_id === chat_id && 
        item.upc &&
        item.timestamp >= todayStart &&
        item.timestamp < todayEnd
      );
    console.log('Found total UPC nutrilogs for today:', { chat_id, today, count: rows.length });
    return rows.length;
  } catch (error) {
    console.error('Error getting total UPC nutrilogs:', error);
    return 0;
  }
};

/**
 * Updates the status and related fields of a nutrilog.
 * @param {string} chat_id 
 * @param {string} uuid 
 * @param {string} status 
 * @param {number|null} factor 
 * @param {boolean|null} auto_confirmed 
 * @returns {object|null} Updated nutrilog or null if not found
 */
export const updateNutrilogStatus = (chat_id, uuid, status, factor = null, auto_confirmed = null) => {
  if (!chat_id || !uuid || !status) {
    console.error('updateNutrilogStatus called with missing parameters:', { chat_id, uuid, status });
    return null;
  }
  try {
    const data = loadFile(NUTRILOGS_STORE + "/" + chat_id) || {};
    if (!data[uuid]) {
      console.error('Nutrilog not found for update:', { chat_id, uuid });
      return null;
    }
    
    // Update the fields
    data[uuid].status = status;
    if (factor !== null) {
      data[uuid].factor = factor;
    }
    if (auto_confirmed !== null) {
      data[uuid].auto_confirmed = auto_confirmed;
    }
    data[uuid].updated_at = Math.floor(Date.now() / 1000);
    
    saveFile(NUTRILOGS_STORE + "/" + chat_id, data);
    console.log('Updated nutrilog status:', { chat_id, uuid, status, factor, auto_confirmed });
    return data[uuid];
  } catch (error) {
    console.error('Error updating nutrilog status:', error);
    return null;
  }
};
