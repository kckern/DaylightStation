import axios from 'axios';
import express from 'express';
import { generateSpeech } from './lib/gpt.js';
import fs from 'fs';
import { storyTeller } from './story/story.mjs';
import { v4 as uuidv4 } from 'uuid';
import { loadFile, saveFile } from './lib/io.mjs';
import cookieParser from 'cookie-parser';


const ttsRouter = express.Router();
ttsRouter.use(express.json({
    strict: false // Allows parsing of JSON with single-quoted property names
}));





ttsRouter.use(cookieParser());
ttsRouter.all('/story', async (req, res) => {
    let { input, prompt } = req.body || {};
    // If not in body, check query
    if (!input && req.query) input = req.query.input;
    if (!prompt && req.query) prompt = req.query.prompt;

    input = (input || 'X').toUpperCase();

    // Try to get sessionId from cookie if not in body/query
    let sessionId = req.body?.sessionId || req.query?.sessionId || req.cookies?.sessionId;
    let storybook, newSession = false;

    console.log(`Received input: ${input}, sessionId: ${sessionId}`);

    if (input === 'X' || !sessionId) {
        // Start a new session
        sessionId = uuidv4();
        // Let storyTeller handle the cold start prompt from story_gpt
        storybook = loadFile(`story_gpt/story_gpt`).storybook || [];
        storybook.push({
            role: 'user',
            content: prompt || "Tell me a story about a princess and a dragon."
        });
        saveFile(`story_gpt/sessions/${sessionId}`, storybook);
        newSession = true;
        // Set sessionId as a cookie
        res.cookie('sessionId', sessionId, { httpOnly: true, sameSite: 'lax' });
    } 
    else{

        storybook = loadFile(`story_gpt/sessions/${sessionId}`) || {};
        console.log(`Loaded storybook for session ${sessionId}:`, storybook);
        if (!Array.isArray(storybook)){
            console.warn(`Invalid storybook format for session ${sessionId}, initializing new session.`);
            storybook = loadFile(`story_gpt/story_gpt`).storybook || {};
            storybook.push({
                role: 'user',
                content: prompt || "Tell me a story about a princess and a dragon."
            });
        }
        else{

            storybook.push({
                role: 'user',
                content: input
            });
            saveFile(`story_gpt/sessions/${sessionId}`, storybook);
        }
    }



    console.log(`Using storybook for session ${sessionId}:`, storybook, sessionId);

    // Get story and choices from GPT
    const { story, choices, storybook: updatedStorybook } = await storyTeller({
        prompt: newSession ? (prompt || "Tell me a story about Pokemon and a cat.") : null,
        storybook
    });

    saveFile(`story_gpt/sessions/${sessionId}`, updatedStorybook);

    // Respond with audio and session info
    return await respondWithAudio(
        { string: story, voice: 'alloy', instructions: 'Speak like a elementary school teacher reading a story to children.' },
        res
    );
});




ttsRouter.all('/generate', async (req, res) => {

    const string = req.body?.string || req.query?.string || 'Hello world! This is a test of the text-to-speech system.';
    const voice = req.body?.voice || req.query?.voice || 'alloy';
    const instructions = req.body?.instructions || req.query?.instructions || 'Speak like a elementary school teacher reading a story to children.';

    return await respondWithAudio({ string, voice, instructions }, res);

});




const respondWithAudio = async (input, res) => {
    const {string, voice, instructions} = input;

    const filename = await generateSpeech(string, voice, instructions);
    if (filename) {
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', 'inline'); // Force play in browser
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate'); // Prevent caching

        fs.stat(filename, (err, stats) => {
            if (err || !stats.isFile()) {
            res.status(500).json({ error: 'Error reading audio file' });
            return;
            }
            res.setHeader('Content-Length', stats.size);
            const stream = fs.createReadStream(filename);
            stream.on('error', () => {
            res.status(500).json({ error: 'Error reading audio file' });
            });
            stream.pipe(res);
        });

        return; // Prevent further response handling
    } else {
        res.status(500).json({ error: 'Error generating speech' });
    }
};




export default ttsRouter;


