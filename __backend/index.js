import { main } from './src/5_composition/serverMain.mjs';

main().catch((err) => {
  console.error('[FATAL] Server initialization failed:', err.message, err.stack);
  process.exit(1);
});
