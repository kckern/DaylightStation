import os from 'node:os';
import path from 'node:path';
import { appendTextFile } from '#system/utils/FileIO.mjs';

export function installCrashHandlers({ outputPath = path.join(os.tmpdir(), 'agent-crash.log'), logger = console } = {}) {
  process.on('uncaughtException', (error) => {
    appendTextFile(outputPath, `[${new Date().toISOString()}] UNCAUGHT: ${error.stack || error.message}\n`);
    logger.error('UNCAUGHT EXCEPTION:', error);
  });
  process.on('unhandledRejection', (reason) => {
    appendTextFile(outputPath, `[${new Date().toISOString()}] UNHANDLED REJECTION: ${reason?.stack || reason}\n`);
    logger.error('UNHANDLED REJECTION:', reason);
  });
}
