#!/usr/bin/env node
/**
 * CLI Chat Simulator - Entry Point
 * @module cli/index
 * 
 * Interactive CLI for testing chatbots without server/webhook infrastructure.
 * 
 * Usage:
 *   node cli/index.mjs                    # Interactive bot selection
 *   node cli/index.mjs --bot nutribot     # Start with NutriBot
 *   node cli/index.mjs --bot journalist   # Start with Journalist
 *   node cli/index.mjs --debug            # Enable verbose logging
 *   node cli/index.mjs --session mytest   # Use named session (persists)
 *   node cli/index.mjs --real-ai          # Use real OpenAI API
 */

import { parseArgs } from 'node:util';
import { CLIChatSimulator } from './CLIChatSimulator.mjs';
import { createLogger } from '../_lib/logging/index.mjs';

// Parse command line arguments
const { values: args } = parseArgs({
  options: {
    bot: {
      type: 'string',
      short: 'b',
      description: 'Bot to start with (nutribot, journalist)',
    },
    debug: {
      type: 'boolean',
      short: 'd',
      default: false,
      description: 'Enable debug logging',
    },
    session: {
      type: 'string',
      short: 's',
      description: 'Named session for persistence',
    },
    'real-ai': {
      type: 'boolean',
      default: false,
      description: 'Use real OpenAI API instead of mock responses',
    },
    help: {
      type: 'boolean',
      short: 'h',
      default: false,
      description: 'Show help',
    },
  },
  strict: true,
  allowPositionals: false,
});

// Show help
if (args.help) {
  console.log(`
🤖 Chatbot CLI Simulator

Interactive CLI for testing chatbots without server/webhook infrastructure.

Usage:
  node cli/index.mjs [options]

Options:
  -b, --bot <name>      Start with specific bot (nutribot, journalist)
  -d, --debug           Enable debug logging
  -s, --session <name>  Use named session (state persists between runs)
  --real-ai             Use real OpenAI API instead of mock responses
  -h, --help            Show this help message

Examples:
  node cli/index.mjs                        # Interactive mode
  node cli/index.mjs --bot nutribot         # Start directly with NutriBot
  node cli/index.mjs --debug --session dev  # Debug mode with 'dev' session
  node cli/index.mjs --real-ai              # Use actual OpenAI API

Special Inputs:
  [photo:/path/to/image.jpg]  Simulate sending a photo
  [voice:text to say]         Simulate voice message
  [upc:012345678901]          Simulate barcode scan

Commands:
  /help     Show available commands
  /switch   Switch to another chatbot
  /clear    Clear conversation history
  /state    Show current conversation state
  /debug    Toggle debug logging
  /quit     Exit the CLI
`);
  process.exit(0);
}

// Create logger for entry point
const logger = createLogger({ source: 'cli:main', app: 'cli' });

// Main entry point
async function main() {
  logger.info('cli.starting', { args });

  // Create simulator
  const simulator = new CLIChatSimulator({
    bot: args.bot,
    debug: args.debug,
    sessionName: args.session,
    useRealAI: args['real-ai'],
  });

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('cli.interrupted');
    await simulator.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('cli.terminated');
    await simulator.stop();
    process.exit(0);
  });

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    logger.error('cli.uncaughtException', { error: error.message, stack: error.stack });
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('cli.unhandledRejection', { reason: String(reason) });
    console.error('\n❌ Unhandled promise rejection:', reason);
    process.exit(1);
  });

  try {
    // Initialize and start
    await simulator.initialize();
    await simulator.start();
  } catch (error) {
    logger.error('cli.startError', { error: error.message, stack: error.stack });
    console.error('\n❌ Failed to start:', error.message);
    
    if (args.debug) {
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// Run
main();
