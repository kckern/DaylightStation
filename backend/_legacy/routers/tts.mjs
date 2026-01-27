/**
 * TTS Router - Bridge to new Hardware infrastructure
 *
 * This module provides backward-compatible routing while delegating
 * to the new TTSAdapter in 2_adapters/hardware.
 *
 * @module routers/tts
 */

import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { loadFile, saveFile } from '../lib/io.mjs';
import cookieParser from 'cookie-parser';
import { createLogger } from '../lib/logging/logger.js';
import { storyTeller } from '../story/story.mjs';
import { TTSAdapter } from '../../src/2_adapters/hardware/tts/TTSAdapter.mjs';
import { HttpClient } from '../../src/0_system/services/HttpClient.mjs';

const ttsLogger = createLogger({
  source: 'backend',
  app: 'tts'
});

const ttsRouter = express.Router();
ttsRouter.use(express.json({ strict: false }));
ttsRouter.use(cookieParser());

// Lazy-initialized adapter and httpClient
let ttsAdapter = null;
let httpClient = null;

/**
 * Get or create TTS adapter
 * @returns {TTSAdapter}
 */
function getTTSAdapter() {
  if (ttsAdapter) return ttsAdapter;

  if (!httpClient) {
    httpClient = new HttpClient({ logger: ttsLogger });
  }

  ttsAdapter = new TTSAdapter({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'tts-1',
    defaultVoice: 'alloy'
  }, { httpClient, logger: ttsLogger });

  ttsLogger.info('tts.adapter.initialized');
  return ttsAdapter;
}

// ============================================================================
// Story Telling Endpoint (unchanged - uses GPT for story generation)
// ============================================================================

ttsRouter.all('/story', async (req, res) => {
  let { input, prompt } = req.body || {};
  if (!input && req.query) input = req.query.input;
  if (!prompt && req.query) prompt = req.query.prompt;

  input = (input || 'X').toUpperCase();

  let sessionId = req.body?.sessionId || req.query?.sessionId || req.cookies?.sessionId;
  let storybook, newSession = false;

  ttsLogger.info('tts.story.receivedInput', { input, sessionId });

  if (input === 'X' || !sessionId) {
    sessionId = uuidv4();
    storybook = loadFile(`story_gpt/story_gpt`).storybook || [];
    storybook.push({
      role: 'user',
      content: prompt || "Tell me a story about a princess and a dragon."
    });
    saveFile(`story_gpt/sessions/${sessionId}`, storybook);
    newSession = true;
    res.cookie('sessionId', sessionId, { httpOnly: true, sameSite: 'lax' });
  } else {
    storybook = loadFile(`story_gpt/sessions/${sessionId}`) || {};
    ttsLogger.info('tts.story.loadedStorybook', { sessionId, storybookLength: Array.isArray(storybook) ? storybook.length : 0 });
    if (!Array.isArray(storybook)) {
      ttsLogger.warn('tts.story.invalidStorybook', { sessionId });
      storybook = loadFile(`story_gpt/story_gpt`).storybook || {};
      storybook.push({
        role: 'user',
        content: prompt || "Tell me a story about a princess and a dragon."
      });
    } else {
      storybook.push({
        role: 'user',
        content: input
      });
      saveFile(`story_gpt/sessions/${sessionId}`, storybook);
    }
  }

  ttsLogger.info('tts.story.usingStorybook', { sessionId, length: storybook?.length });

  const { story, choices, storybook: updatedStorybook } = await storyTeller({
    prompt: newSession ? (prompt || "Tell me a story about Pokemon and a cat.") : null,
    storybook
  });

  saveFile(`story_gpt/sessions/${sessionId}`, updatedStorybook);

  return await respondWithAudio(
    { string: story, voice: 'alloy', instructions: 'Speak like a elementary school teacher reading a story to children.' },
    res
  );
});

// ============================================================================
// Speech Generation Endpoint
// ============================================================================

ttsRouter.all('/generate', async (req, res) => {
  const string = req.body?.string || req.query?.string || 'Hello world! This is a test of the text-to-speech system.';
  const voice = req.body?.voice || req.query?.voice || 'alloy';
  const instructions = req.body?.instructions || req.query?.instructions || 'Speak like a elementary school teacher reading a story to children.';

  return await respondWithAudio({ string, voice, instructions }, res);
});

// ============================================================================
// Helper Functions
// ============================================================================

async function respondWithAudio(input, res) {
  const { string, voice, instructions } = input;

  try {
    const audioStream = await getTTSAdapter().generateSpeech(string, { voice });

    if (audioStream && typeof audioStream.pipe === 'function') {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

      audioStream.on('error', (err) => {
        ttsLogger.error('tts.audio.streamError', { message: err?.message || err, stack: err?.stack });
        if (!res.headersSent) {
          res.status(500).json({ error: 'Error streaming audio' });
        }
      });

      audioStream.pipe(res);
    } else {
      res.status(500).json({ error: 'Error generating speech' });
    }
  } catch (err) {
    ttsLogger.error('tts.generateSpeech.failed', { message: err?.message || err, stack: err?.stack });
    res.status(500).json({ error: 'Error generating speech' });
  }
}

export default ttsRouter;
