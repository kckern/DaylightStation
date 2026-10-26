import { createDurableJeopardyFixture } from './createDurableJeopardyFixture.mjs';
import { GamingSessionRestarts } from '../../__app_modules/games/party-games/server/application/runtime/GamingSessionRestarts.mjs';
// Isolated loopback preview: real gaming authority, no household boot or effects.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import express from 'express';
import yaml from 'js-yaml';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';
import { createServer, build } from 'vite';
import react from '../../frontend/node_modules/@vitejs/plugin-react/dist/index.mjs';
import { GamingMediaService } from '../../__app_modules/games/party-games/server/application/GamingMediaService.mjs';
import { FilesystemGamingMediaRepository } from '../../__app_modules/games/party-games/server/adapters/FilesystemGamingMediaRepository.mjs';
import { createGamingRouter } from '../../__app_modules/games/party-games/server/api/gaming.mjs';
import { GamingDiagnosticSessions } from '../../__app_modules/games/party-games/server/application/runtime/GamingDiagnosticSessions.mjs';
import { GameRuntime, SessionActorAuthorization } from '../../__capabilities/gaming/portable/kernel/index.mjs';
import { jeopardyRuleModule } from '../../__capabilities/gaming/portable/rulesets/jeopardy/index.mjs';
import { createQRCodeRouter } from '../../__backend/src/4_api/v1/routers/qrcode.mjs';
const root = process.cwd();
const read = name => yaml.load(fs.readFileSync(path.join(root, 'tests/_fixtures/group-play', name), 'utf8'));
const packs = new Map([['jeopardy:fhe-jeremiah', {
  ...read('jeremiah-open-book.yml'),
  rule_module: {
    id: 'jeopardy',
    version: 1
  },
  experience: {
    id: 'jeopardy',
    version: 1
  }
}], ['jeopardy:practice-isaiah', {
  ...read('isaiah-practice/content.yml'),
  ...read('isaiah-practice/rules.yml')
}]]);
const manifest = {
  id: 'jeopardy',
  version: 1,
  hash: 'b'.repeat(64),
  setup: {
    kind: 'teams'
  },
  surfaces: [{
    id: 'party-games',
    presenter: 'jeopardy-board'
  }]
};
const diagnostics = new GamingDiagnosticSessions({
  runtime: new GameRuntime({
    rulesets: [jeopardyRuleModule]
  }),
  authorization: new SessionActorAuthorization(),
  definitions: {
    getCurrent: async id => ({
      definition: packs.get(id),
      hash: 'a'.repeat(64),
      artifacts: {}
    })
  },
  manifestStore: {
    get: () => manifest
  },
  ids: {
    session: () => `game:${crypto.randomUUID()}`,
    command: () => `cmd:${crypto.randomUUID()}`,
    seed: () => 7
  }
});
// Express intentionally denies hidden path segments; worktrees live under .codex.
// Copy only reviewed media into an ephemeral ordinary directory for sendFile.
const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jeopardy-media-'));
fs.cpSync(process.env.GAMING_ACCEPTANCE_MEDIA_ROOT || path.join(root, 'tests/_fixtures/group-play/media'),mediaRoot,{recursive:true});
const app = express();
app.use(express.json());
// Server-established identity belongs solely to this loopback acceptance app.
app.use((req, res, next) => {
  req.roles = ['gaming-host'];
  next();
});
const durable = process.env.JEOPARDY_ACCEPTANCE_DURABLE === '1' ? await createDurableJeopardyFixture({ definition: packs.get('jeopardy:fhe-jeremiah') }) : null;
const application = {
  getEnvironmentProfile: () => ({
    defaults: {mute:true},
    household_members: [],
    team_presets: []
  }),
  listPartyGamesCatalog: () => [...packs].map(([id, p]) => ({
    id,
    definition_id: id,
    experience_id: 'jeopardy',
    content_id: id.split(':')[1],
    presenter_id: 'jeopardy-board',
    setup: 'teams',
    setup_profile: {
      kind: 'teams',
      anonymous_teams: p.party_games?.anonymous_teams || [{
        name: 'Blue Team',
        color: '#3273dc'
      }, {
        name: 'Gold Team',
        color: '#e6b325'
      }]
    },
    competition: true,
    valid: true
  })),
  createSession: request => durable ? durable.application.createSession({ ...request, definitionId: 'jeopardy:test' }) : diagnostics.createSession(request),
  resumeSession: (...args) => durable.application.resumeSession(...args),
  dispatch: (...args) => durable.application.dispatch(...args),
  closeSession: (...args) => durable.application.closeSession(...args),
  getDefinition: (...args) => durable.application.getDefinition(...args)
};
let wss;
app.use('/api/v1/gaming', createGamingRouter({
  gamingSessionRestarts: new GamingSessionRestarts(),
  gamingApplication: application,
  gamingDiagnostics: diagnostics,
  gamingMediaService: new GamingMediaService({
    repository: new FilesystemGamingMediaRepository({
      partyMediaRoot: mediaRoot
    })
  }),
  broadcastEvent: event => {
    for (const client of wss.clients) if (client.readyState === 1 && client.topics?.includes(event.topic)) client.send(JSON.stringify(event));
  }
}));
app.use('/api/v1/qrcode', createQRCodeRouter({
  contentExpression: {
    fromQuery: () => ({})
  },
  generateQRCode: ({
    data,
    size
  }) => QRCode.toString(data, {
    type: 'svg',
    width: size,
    margin: 2
  })
}));
app.post('/api/v1/logs', (_req, res) => res.sendStatus(204));
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/tests/_lib/jeopardy-acceptance-entry.jsx"></script></body></html>';
const shared = {
  root,
  configFile: false,
  cacheDir: path.join(root, '.superpowers/jeopardy-vite-cache'),
  plugins: [react(), {
    name: 'jeopardy-only',
    configureServer(vite) {
      vite.middlewares.use(app);
      vite.middlewares.use(async (req, res, next) => {
        if (req.url.startsWith('/screens/') || req.url.startsWith('/party-games/')) {
          res.setHeader('Content-Type', 'text/html');
          res.end(await vite.transformIndexHtml(req.url, html));
        } else next();
      });
    }
  }],
  resolve: {
    alias: {
      '@shared-interaction': path.join(root, 'shared/interaction'),
      '@shared-gaming': path.join(root, 'shared/gaming'),
      '@shared-music': path.join(root, 'shared/music'),
      '@shared-contracts': path.join(root, 'shared/contracts'),
      '@shared-presentation': path.join(root, 'shared/presentation/scenes'),
      '@': path.join(root, 'frontend/src'),
      'react-dom': path.join(root, 'frontend/node_modules/react-dom'),
      'react': path.join(root, 'frontend/node_modules/react'),
      'react-router-dom': path.join(root, 'frontend/node_modules/react-router-dom')
    }
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.JEOPARDY_ACCEPTANCE_PORT || 3111),
    strictPort: true,
    hmr: false,
    ws: false,
    fs: {
      allow: [root, fs.realpathSync('frontend/node_modules'), fs.realpathSync('frontend/node_modules/@fontsource/roboto')]
    }
  }
};
if (process.argv.includes('--build')) {
  const temp = path.join(root, '.superpowers/jeopardy-build');
  fs.mkdirSync(temp, {
    recursive: true
  });
  fs.writeFileSync(path.join(temp, 'index.html'), html.replace('/tests/_lib/', '../../tests/_lib/'));
  await build({
    ...shared,
    build: {
      outDir: path.join(temp, 'dist'),
      rollupOptions: {
        input: path.join(temp, 'index.html')
      }
    }
  });
  fs.rmSync(mediaRoot,{recursive:true,force:true});
  durable?.dispose();
} else {
  const server = await createServer(shared);
  wss = new WebSocketServer({
    server: server.httpServer,
    path: '/ws'
  });
  wss.on('connection', client => {
    client.on('message', raw => {
      try {
        const m = JSON.parse(raw);
        if (m.action === 'subscribe') client.topics = m.topics;
      } catch {}
    });
  });
  await server.listen();
  process.stdout.write(`JEOPARDY_ACCEPTANCE_READY http://127.0.0.1:${shared.server.port}\n`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    wss.close();
    await server.close();
    fs.rmSync(mediaRoot,{recursive:true,force:true});
    durable?.dispose();
    process.exit(0);
  });
}
