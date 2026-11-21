import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';

const dist = path.resolve(process.env.BROWSER_PLATFORM_DIST || 'frontend/dist');
const index = path.join(dist, 'index.html');

if (!existsSync(index)) {
  throw new Error(`No frontend build at ${dist}. Run npm run build --prefix frontend first.`);
}

const app = express();
app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'No fixture for this request' });
});
app.use(express.static(dist));
app.get('/{*path}', (_request, response) => response.sendFile('index.html', { root: dist }));

app.listen(Number(process.argv[2]), '127.0.0.1');
