// Telegram-style webhook test harness for nutribot webhook handler
// Conforms payload shape to what foodlog_hook.mjs expects (message + optional callback_query)

import nutribotWebhookHandler from "../handlers/webhook.mjs";

// Basic mock user/chat data
const USER_ID = 1234;
const USERNAME = "test_user";
const FIRST_NAME = "Test";
const CHAT_ID = 5678; // Normally same as USER_ID for private chats

// Simple mock req/res factory so we can call the Express-style handler directly
const createMockReqRes = (body) => {
    const logs = { json: null };
    const req = { body, traceId: `trace_${Date.now()}` };
    const res = {
        json(payload) { logs.json = payload; console.log("RES JSON ->", payload); return payload; },
        status(code){ this._status = code; return this; },
        send(txt){ console.log("RES SEND ->", this._status || 200, txt); return txt; }
    };
    return { req, res, logs };
};

// Build a Telegram text message update
const buildTextUpdate = (text, overrides = {}) => ({
    update_id: Math.floor(Math.random()*1e9),
    message: {
        message_id: overrides.message_id || Math.floor(Math.random()*10_000),
        from: {
            id: USER_ID,
            is_bot: false,
            first_name: FIRST_NAME,
            username: USERNAME,
            language_code: "en"
        },
        chat: {
            id: CHAT_ID,
            first_name: FIRST_NAME,
            username: USERNAME,
            type: "private"
        },
        date: Math.floor(Date.now()/1000),
        text,
        ...overrides.messageExtra
    }
});

// Build a Telegram callback query update (button press)
const buildCallbackUpdate = (data, originalMessage) => ({
    update_id: Math.floor(Math.random()*1e9),
    callback_query: {
        id: `cq_${Date.now()}`,
        from: {
            id: USER_ID,
            is_bot: false,
            first_name: FIRST_NAME,
            username: USERNAME
        },
        message: originalMessage, // Must include message_id, chat, etc.
        chat_instance: `ci_${Date.now()}`,
        data
    }
});

// Convenience wrappers
const sendText = async (text) => {
    const update = buildTextUpdate(text);
    const { req, res } = createMockReqRes(update);
    console.log("\n--- Sending Text Message ---\n", JSON.stringify(update, null, 2));
    await nutribotWebhookHandler(req, res);
    return update.message; // Return message object for chaining (e.g., callback)
};

const sendCallback = async (data, originalMessage) => {
    const update = buildCallbackUpdate(data, originalMessage);
    const { req, res } = createMockReqRes(update);
    console.log("\n--- Sending Callback Query ---\n", JSON.stringify(update, null, 2));
    await nutribotWebhookHandler(req, res);
};

// Test flow:
// 1. Send a text message ("One Apple")
// 2. Simulate user pressing an inline button (example: "✅ Accept")
const run = async () => {
    const originalMsg = await sendText("One Apple");

    // In a real flow, inline buttons would be attached to bot's response, not the user's original message.
    // For demonstration we just reuse the original message metadata to show callback structure.
    await sendCallback("✅ Accept", originalMsg);
};

run().catch(err => { console.error(err); process.exit(1); });