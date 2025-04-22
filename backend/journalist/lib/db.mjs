
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
const NUTRILOGS_STORE = 'journalist/nutrilogs';
const NUTRICURSORS_STORE = 'journalist/nutricursors';
const ACTIVITIES_STORE = 'journalist/activities';
const WEIGHTS_STORE = 'journalist/weights';
const DAILY_NUTRITION_STORE = 'journalist/dailynutrition'; // not used explicitly, but mentioned
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

  // Strip emoji from start of text
  const firstCharIsEmoji = text.codePointAt(0) > 255;
  const lastCharIsEmoji = text.codePointAt(text.length - 1) > 255;
  if (firstCharIsEmoji && !lastCharIsEmoji) {
    text = text.replace(/^\S+/g, '').trim();
  }

  text = text.trim().replace(/^Transcription:(\s|\n)+/ig, "").trim();
  const unix = Math.floor(Date.now() / 1000);

  try {
    const data = loadFile(MESSAGES_STORE) || {};
    const recordKey = `${chatId}_${messageId}`;
    data[recordKey] = {
      timestamp: unix,
      chat_id: chatId,
      message_id: messageId,
      sender_id: senderId,
      sender_name: senderName,
      text,
      foreign_key
    };
    // Sort by timestamp desc and save
    const sortedData = Object.fromEntries(
      Object.entries(data).sort(([, a], [, b]) => b.timestamp - a.timestamp)
    );
    saveFile(MESSAGES_STORE, sortedData);
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
  try {
    const data = loadFile(MESSAGES_STORE);
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
      m.sender_id = parseInt(m.sender_id, 10);
      m.message_id = parseInt(m.message_id, 10);
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
  console.log('findMostRecentUnansweredMessage:', { chatId, senderId });
  const history = getMessages(chatId);
  if(!history || history.length === 0) return null;
  const mostRecentMessage = history[history.length - 1];
  if (mostRecentMessage?.sender_id === senderId) return mostRecentMessage;
  return null;
};

/**
 * Deletes a specific message.
 * @param {string} chatId
 * @param {string|number} messageId
 * @returns {object|null}
 */
export const deleteMessageFromDB = (chatId, messageId) => {
  try {
    const data = loadFile(MESSAGES_STORE);
    const recordKey = `${chatId}_${messageId}`;
    if (data[recordKey]) {
      delete data[recordKey];
       saveFile(MESSAGES_STORE, data);
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
    const data = loadFile(CRONJOBS_STORE);
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
 * @returns {object|null}
 */
export const updateCronJob = (uuid, message_id) => {
  if (!message_id) return null;
  const lastRun = Math.floor(Date.now() / 1000);
  try {
    const data = loadFile(CRONJOBS_STORE);
    if (!data[uuid]) {
      // If it doesn't exist, you might want to skip or create it. We'll skip here.
      return null;
    }
    data[uuid].last_run = lastRun;
    data[uuid].message_id = message_id;
     saveFile(CRONJOBS_STORE, data);
    return data[uuid];
  } catch (error) {
    console.error('Error updating cron job:', error, { uuid, lastRun, message_id });
    return null;
  }
};

/* ------------------------------------------------------------------
 * Journal
 * ------------------------------------------------------------------ */

/**
 * Saves a journal entry.
 * @param {string} date
 * @param {string} period
 * @param {string} entry
 * @param {any} src
 * @returns {object|null}
 */
export const saveJournalEntry = (date, period, entry, src) => {
  const uuid = uuidv4();
  try {
    const data = loadFile(JOURNALENTRIES_STORE);
    data[uuid] = {
      uuid,
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
  try {
    const data = loadFile(MESSAGEQUEUE_STORE);
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
  if (!uuid || !message_id) {
    console.error('updateQueue called with missing parameters');
    return null;
  }
  try {
    const data = loadFile(MESSAGEQUEUE_STORE);
    if (!data[uuid]) {
      // If it doesn't exist, do nothing or create it. We'll skip here.
      return null;
    }
    data[uuid].message_id = message_id;
    saveFile(MESSAGEQUEUE_STORE, data);
    return data[uuid];
  } catch (error) {
    console.error('Error updating queue:', error);
    return null;
  }
};

/**
 * Clears the entire message queue for a chat.
 * @param {string} chat_id
 * @returns {object|null}
 */
export const clearQueue = (chat_id) => {
  try {
    const data = loadFile(MESSAGEQUEUE_STORE);
    const newData = {};
    for (const [key, value] of Object.entries(data)) {
      if (value.chat_id !== chat_id) {
        newData[key] = value;
      }
    }
    saveFile(MESSAGEQUEUE_STORE, {});
    return { success: true };
  } catch (error) {
    console.error('Error clearing queue:', error);
    return null;
  }
};

/**
 * Saves multiple messages to the queue.
 * @param {string} chat_id
 * @param {object} param1 - { messages, choices, inlines, foreign_keys }
 * @returns {boolean|null}
 */
export const saveToQueue = (chat_id, { messages, choices, inlines, foreign_keys }) => {
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
  try {
    const data = loadFile(MESSAGEQUEUE_STORE);
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
  try {
    const data = loadFile(QUIZQUESTIONS_STORE);
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
  const attemptLoad = () => {
    try {
      const data = loadFile(QUIZQUESTIONS_STORE);

      // Filter by last_asked = null (i.e., unasked)
      let rows = Object.values(data).filter(q => q.last_asked == null);
      if (category) {
        rows = rows.filter(q => q.category === category);
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
      for (const [k, v] of Object.entries(data)) {
        if (v.category === category) {
          v.last_asked = null;
        }
      }
       saveFile(QUIZQUESTIONS_STORE, data);
      // Try fetching again
      result = attemptLoad();
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
  try {
    const data = loadFile(QUIZQUESTIONS_STORE);
    const question = data[uuid];
    if (!question) {
      console.error('Question not found');
      return null;
    }

    // parse existing responses
    let responses = {};
    if (question.responses) {
      try {
        responses = question.responses;
      } catch {}
    }

    // parse answer
    const isNumeric = /^\d+$/.test(answer);
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
  try {
    const data = loadFile(MESSAGES_STORE);
    const recordKey = `${chat_id}_${message_id}`;
    if (!data[recordKey]) {
      return null;
    }
    const { text, foreign_key } = values;
    if (text !== undefined) data[recordKey].text = text;
    if (foreign_key !== undefined) {
      data[recordKey].foreign_key = foreign_key;
    }
     saveFile(MESSAGES_STORE, data);
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
  try {
    const data = loadFile(MESSAGES_STORE);
    const recordKey = `${chat_id}_${message_id}`;
    return data[recordKey] ? [data[recordKey]] : [];
  } catch (error) {
    console.error('Error loading message from DB:', error);
    return null;
  }
};

/* ------------------------------------------------------------------
 * Nutrilog
 * ------------------------------------------------------------------ */

/**
 * Saves a nutrilog entry.
 * @param {object} param0 - { uuid, chat_id, timestamp, message_id, food_data, status }
 * @returns {object|null}
 */
export const saveNutrilog = ({ uuid, chat_id, timestamp, message_id, food_data, status }) => {
  console.log('Saving nutrilog:', { uuid, chat_id, message_id, food_data, status });
  if (!uuid) {
    console.error('UUID is null');
    return null;
  }

  try {
    const data = loadFile(NUTRILOGS_STORE);
    data[uuid] = {
      uuid,
      chat_id,
      timestamp,
      message_id,
      food_data,
      status
    };
     saveFile(NUTRILOGS_STORE, data);
    return data[uuid];
  } catch (error) {
    console.error('Error saving nutrilog:', error);
    return null;
  }
};

/**
 * Retrieves a nutrilog by UUID.
 * @param {string} uuid
 * @returns {Array|null}
 */
export const getNutrilog = (uuid) => {
  if (!uuid) return null;
  try {
    const data = loadFile(NUTRILOGS_STORE);
    const entry = data[uuid];
    return entry ? [entry] : [];
  } catch (error) {
    console.error('Error getting nutrilog:', error);
    return null;
  }
};

/**
 * Retrieves nutrilist by date.
 * @param {string} chat_id
 * @param {string} date
 * @returns {Array|null}
 */
export const getNutrilListByDate = (chat_id, date) => {
  try {
    // This was originally referencing 'nutrilist' table, but in the new structure
    // you might keep them in the same nutrilogs store or a different file. 
    // Adjust as needed. For demonstration, assume it's the same store:
    const data = loadFile(NUTRILOGS_STORE);
    const rows = Object.values(data).filter(item => item.chat_id === chat_id && item.date === date);
    // Sort by calories descending -> But there's no field "calories" in the default. 
    // We can parse item.food_data if needed. Implementation may vary.
    rows.sort((a, b) => {
      let aCals = 0, bCals = 0;
      try { aCals = a.food_data?.calories || 0; } catch {}
      try { bCals = b.food_data?.calories || 0; } catch {}
      return bCals - aCals;
    });
    return rows;
  } catch (error) {
    console.error('Error getting nutrilist by date:', error);
    return null;
  }
};

/**
 * Retrieves nutrilist by UUID.
 * @param {string} chat_id
 * @param {string} uuid
 * @returns {object|null}
 */
export const getNutrilListByID = (chat_id, uuid) => {
  try {
    const data = loadFile(NUTRILOGS_STORE);
    const item = data[uuid];
    if (item && item.chat_id === chat_id) {
      return item;
    }
    return null;
  } catch (error) {
    console.error('Error getting nutrilist by ID:', error);
    return null;
  }
};

/**
 * Deletes a nutrilist entry by UUID.
 * @param {string} chat_id
 * @param {string} uuid
 * @returns {object|null}
 */
export const deleteNuriListById = (chat_id, uuid) => {
  try {
    const data = loadFile(NUTRILOGS_STORE);
    if (data[uuid] && data[uuid].chat_id === chat_id) {
      delete data[uuid];
       saveFile(NUTRILOGS_STORE, data);
      return { success: true };
    }
    return { success: false };
  } catch (error) {
    console.error('Error deleting nutrilist by ID:', error);
    return null;
  }
};

/**
 * Updates a nutrilist entry.
 * @param {string} uuid
 * @param {object} values
 * @returns {object|null}
 */
export const updateNutrilist = (uuid, values) => {
  try {
    const data = loadFile(NUTRILOGS_STORE);
    if (!data[uuid]) {
      return null;
    }
    for (const [k, v] of Object.entries(values)) {
      data[uuid][k] = v;
    }
     saveFile(NUTRILOGS_STORE, data);
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
  try {
    const data = loadFile(NUTRILOGS_STORE);
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
export const getPendingNutrilog = (chat_id) => {
  try {
    // The original logic references "getNutriCursor" to see if there's something "revising"
    const cursor = getNutriCursor(chat_id);
    if (cursor.revising) {
      const { uuid } = cursor.revising;
      const [nutrilog] = ( getNutrilog(uuid)) || [];
      console.log('Found pending nutrilog:', { uuid, nutrilog });
      if (nutrilog) return nutrilog;
    }

    // fallback: look for a "revising" entry
    const data = loadFile(NUTRILOGS_STORE);
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
  const timeZone = 'America/Los_Angeles';
  since = since || moment().tz(timeZone).subtract(7, 'days').format('YYYY-MM-DD');
  until = until || moment().tz(timeZone).format('YYYY-MM-DD');
  const sinceUnix = Math.floor(moment(since).startOf('day').valueOf() / 1000);
  const untilUnix = Math.floor(moment(until).endOf('day').valueOf() / 1000);

  console.log('Loading journal entries:', { chat_id, since, until, sinceUnix, untilUnix });
  try {
    const data = loadFile(MESSAGES_STORE);
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
    return null;
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
export const deleteNutrilog = (uuid) => {
  try {
    const data = loadFile(NUTRILOGS_STORE);
    if (data[uuid]) {
      delete data[uuid];
       saveFile(NUTRILOGS_STORE, data);
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
export const saveNutrilist = (items) => {
  // For demonstration, we'll reuse NUTRILOGS_STORE or create a new store if needed.
  // In the original code, it inserts into "nutrilist" table. We'll assume we have a separate store:
  // "journalist/nutrilogs" or "journalist/nutrilist". Adjust as needed.
  if (!Array.isArray(items)) items = [items];

  try {
    const data = loadFile(NUTRILOGS_STORE);
    for (const item of items) {
      // The primary key is item.uuid
      if (!item.uuid) {
        item.uuid = uuidv4();
      }
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
     saveFile(NUTRILOGS_STORE, data);
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
    const data = loadFile(NUTRILOGS_STORE);
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
    const data = loadFile(NUTRILOGS_STORE);
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
export const nutriLogAlreadyListed = (uuid) => {
  try {
    const data = loadFile(NUTRILOGS_STORE);
    // If there's any item with log_uuid = uuid
    const found = Object.values(data).some(item => item.log_uuid === uuid);
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
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const data = loadFile(NUTRICURSORS_STORE);
    data[chat_id] = {
      chat_id,
      timestamp,
      data: dataObj
    };
     saveFile(NUTRICURSORS_STORE, data);
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
  try {
    const data = loadFile(NUTRICURSORS_STORE);
    if (data[chat_id]) {
      const parsed = data[chat_id].data;
      return parsed;
    }
    return {};
  } catch (error) {
    console.error('Error getting nutri cursor:', error);
    return null;
  }
};

/**
 * Clears nutrilist by log UUID (deletes items).
 * @param {string} uuid
 * @returns {object|null}
 */
export const clearNutrilistByLogUUID = (uuid) => {
  try {
    const data = loadFile(NUTRILOGS_STORE);
    let count = 0;
    for (const [k, v] of Object.entries(data)) {
      if (v.log_uuid === uuid) {
        delete data[k];
        count++;
      }
    }
     saveFile(NUTRILOGS_STORE, data);
    return { success: true, count };
  } catch (error) {
    console.error('Error clearing nutrilist by log uuid:', error);
    return null;
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
  try {
    const data = loadFile(ACTIVITIES_STORE);
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
  try {
    const dateThreshold = moment().subtract(days_since, 'days').format('YYYY-MM-DD');
    const data = loadFile(ACTIVITIES_STORE);
    const rows = Object.values(data).filter(act => {
      if (act.chat_id !== chat_id) return false;
      return (act.date >= dateThreshold);
    });
    return rows;
  } catch (error) {
    console.error('Error getting activities:', error);
    return null;
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
  try {
    const data = loadFile(WEIGHTS_STORE);
    for (const w of weights) {
      const { chat_id, src, date } = w;
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
  try {
    const dateThreshold = moment().subtract(days_since, 'days').format('YYYY-MM-DD');
    const data = loadFile(WEIGHTS_STORE);
    const rows = Object.values(data).filter(item => {
      return item.chat_id === chat_id && item.date >= dateThreshold;
    });
    // Sort ascending by date
    rows.sort((a, b) => new Date(a.date) - new Date(b.date));
    return rows;
  } catch (error) {
    console.error('Error getting weights:', error);
    return null;
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
25. getPendingNutrilog
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