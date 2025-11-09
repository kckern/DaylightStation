import express from 'express';
import { loadFile, saveFile } from './lib/io.mjs';
import moment from 'moment-timezone';
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

// Lazy init OpenAI (will throw if key missing on first use only)
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const fitnessRouter = express.Router();

// Fitness config endpoint
fitnessRouter.get('/', (req, res) => {
    const fitnessData = loadFile('fitness/config');
    if(!fitnessData) return res.status(404).json({ error: 'Fitness configuration not found' });
    res.json(fitnessData);
});


fitnessRouter.post('/save_session', (req, res) => {
    const { sessionData } = req.body;
    if(!sessionData) return res.status(400).json({ error: 'Session data is required' });
    const sessionDate = sessionData.date || moment().tz("America/Los_Angeles").format('YYYY-MM-DD');
    const sessionDateTime = sessionData.time || moment().tz("America/Los_Angeles").format('YYYY-MM-DD HH.mm.ss');
    const filename = `fitness/sessions/${sessionDate}/${sessionDateTime}`;
    saveFile(filename, sessionData);
    //trigger printer (TODO)

    res.json({ message: 'Session data saved successfully', filename, sessionData });
});

// Voice memo ingestion & transcription
// Expects: { audioBase64, mimeType?, sessionId?, startedAt?, endedAt? }
// Returns: { ok, memo: { transcriptRaw, transcriptClean, createdAt, sessionId, durationSeconds } }
fitnessRouter.post('/voice_memo', async (req, res) => {
    try {
        if(!openai) return res.status(500).json({ ok:false, error: 'OPENAI_API_KEY not configured' });
        const { audioBase64, mimeType, sessionId, startedAt, endedAt } = req.body || {};
        if(!audioBase64 || typeof audioBase64 !== 'string') {
            return res.status(400).json({ ok:false, error: 'audioBase64 required' });
        }
        // Decode base64 (strip data URI prefix if present)
        const base64Data = audioBase64.replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const tmpDir = '/tmp';
        const ext = (mimeType && mimeType.includes('webm')) ? 'webm' : (mimeType && mimeType.includes('ogg') ? 'ogg' : 'mp4');
        const fileName = `voice-memo-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const filePath = path.join(tmpDir, fileName);
        fs.writeFileSync(filePath, buffer);

        // 1. Transcribe with Whisper
        const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: 'whisper-1'
        });
        const transcriptRaw = transcription?.text || '';

        // 2. Clean transcript with GPT-4o (remove obvious filler / mis-heard artifacts, keep intent)
        let transcriptClean = transcriptRaw;
        if (transcriptRaw) {
            try {
                const cleanResp = await openai.chat.completions.create({
                    model: 'gpt-4o',
                    messages: [
                        { role: 'system', content: 'You clean short workout voice memos. Remove duplicated words, filler like "uh", obvious transcription glitches, keep numeric data and intent. Return ONLY the cleaned text.' },
                        { role: 'user', content: transcriptRaw }
                    ],
                    temperature: 0.2,
                    max_tokens: 400
                });
                transcriptClean = cleanResp?.choices?.[0]?.message?.content?.trim() || transcriptRaw;
            } catch(cleanErr) {
                console.error('Clean transcript error:', cleanErr);
            }
        }

        // (Optional) Rough duration estimate via size (assuming ~32kbps opus -> 4KB/sec). Only if not provided.
        const durationSeconds = Math.round(buffer.length / 4096) || null;

        const memo = {
            sessionId: sessionId || null,
            transcriptRaw,
            transcriptClean,
            createdAt: Date.now(),
            startedAt: startedAt || null,
            endedAt: endedAt || null,
            durationSeconds
        };

        // (Optional future) Persist raw audio or memo to disk if desired.
        return res.json({ ok:true, memo });
    } catch (e) {
        console.error('voice_memo error', e);
        return res.status(500).json({ ok:false, error: e.message || 'voice memo failure' });
    }
});


export default fitnessRouter;
