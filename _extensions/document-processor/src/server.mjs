import express from 'express';
import { processInbox } from './processor.mjs';

let status = { state: 'idle', lastRun: null, lastResult: null };

export function createServer(port = process.env.PORT || 8190) {
  const app = express();

  app.post('/process', async (req, res) => {
    if (status.state === 'processing') {
      return res.status(409).json({ error: 'Already processing a batch' });
    }
    status.state = 'processing';
    try {
      const result = await processInbox(console.log);
      status.lastRun = new Date().toISOString();
      status.lastResult = result;
      status.state = 'idle';
      res.json({ ok: true, result });
    } catch (err) {
      status.state = 'error';
      status.lastResult = { error: err.message };
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/status', (req, res) => {
    res.json(status);
  });

  return app.listen(port, () => {
    console.log(`Document processor API on :${port}`);
  });
}

export function setStatus(updates) {
  Object.assign(status, updates);
}

export function getStatus() {
  return status;
}
