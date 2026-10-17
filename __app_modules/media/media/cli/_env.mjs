// Shared reader for the repo-root .env, for media CLIs that run without the
// app bootstrap. Returns undefined when the file or the key is missing or the
// value is empty.
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// __app_modules/media/media/cli/ -> repo root
const ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));

export function readDotEnv(key) {
  if (!existsSync(ENV_FILE)) return undefined;
  return dotenv.parse(readFileSync(ENV_FILE))[key] || undefined;
}
