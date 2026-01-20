#!/usr/bin/env node
// Quick baseline capture script using test server factory
// Usage: DATA_PATH=... NODE_OPTIONS=--experimental-vm-modules node tests/integration/api/_utils/captureQuick.mjs

import { createTestServer } from './testServer.mjs';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASELINES_DIR = path.resolve(__dirname, '../_baselines');

async function capture() {
  console.log('Creating test server with Plex...');
  const { app, config } = await createTestServer({ includePlex: true });
  console.log('Plex config:', config.plex?.host ? 'configured' : 'not configured');

  // Missing baselines to capture
  const toCapture = [
    // Local content
    { path: '/api/local-content/primary/10', file: 'local-content/primary-10.json', category: 'local-content' },
    { path: '/api/local-content/talk/ldsgc202410/20', file: 'local-content/talk-ldsgc202410-20.json', category: 'local-content' },
    { path: '/api/local-content/poem/remedy/01', file: 'local-content/poem-remedy-01.json', category: 'local-content' },
    { path: '/api/local-content/scripture/bom/sebom/31103', file: 'local-content/scripture-1-nephi-1.json', category: 'local-content' },
    // Filesystem (audio files - use actual path with .mp3 extension)
    { path: '/api/play/filesystem/audio/songs/hymn/_ldsgc/113.mp3', file: 'filesystem/filesystem-hymn-audio.json', category: 'filesystem' },
    // Folder (lists) - use URL-encoded folder names with spaces
    { path: '/api/list/folder/TVApp', file: 'folder/folder-tvapp.json', category: 'folder' },
    { path: '/api/list/folder/TVApp/playable', file: 'folder/folder-tvapp-playable.json', category: 'folder' },
    { path: '/api/list/folder/Cartoons', file: 'folder/folder-cartoons.json', category: 'folder' },
    { path: '/api/list/folder/Scripture', file: 'folder/folder-scripture.json', category: 'folder' },
    { path: '/api/list/folder/Music', file: 'folder/folder-music.json', category: 'folder' },
    // Plex (requires live Plex server)
    { path: '/api/list/plex/81061', file: 'plex/plex-list-81061.json', category: 'plex' },
    { path: '/api/list/plex/456724', file: 'plex/plex-list-456724.json', category: 'plex' },
    { path: '/api/list/plex/622894', file: 'plex/plex-list-622894.json', category: 'plex' },
    { path: '/api/list/plex/154382', file: 'plex/plex-list-154382.json', category: 'plex' },
    { path: '/api/play/plex/660440', file: 'plex/plex-play-660440.json', category: 'plex' },
  ];

  console.log(`Capturing ${toCapture.length} baselines...\n`);

  for (const { path: endpoint, file, category } of toCapture) {
    const res = await request(app).get(endpoint);
    if (res.status === 200) {
      const fullPath = `${BASELINES_DIR}/${file}`;
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });

      const baseline = {
        ...res.body,
        _meta: {
          captured: new Date().toISOString(),
          source: endpoint,
          category
        }
      };

      fs.writeFileSync(fullPath, JSON.stringify(baseline, null, 2));
      console.log(`  OK   ${file}`);
    } else {
      console.log(`  FAIL ${endpoint} - status ${res.status}`);
    }
  }

  console.log('\nDone!');
}

capture().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
