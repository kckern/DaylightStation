#!/usr/bin/env node

/**
 * FreshRSS CLI - Command-line interface for FreshRSS feed operations
 *
 * Interacts with a self-hosted FreshRSS instance via the GReader API.
 * Auth is read from per-user YAML files via DataService.
 *
 * Usage:
 *   node cli/freshrss.cli.mjs <command> [options]
 *
 * Commands:
 *   categories              List categories/folders
 *   feeds                   List subscribed feeds
 *   items <streamId>        Get items from a feed or category
 *   read <id> [id2...]      Mark items as read
 *   unread <id> [id2...]    Mark items as unread
 *   subscribe <url>         Subscribe to a new feed
 *
 * Options:
 *   --json                  Output as JSON
 *   --username <name>       User for auth (default: head of household)
 *   --count <n>             Number of items to fetch (default: 20)
 *   --unread-only           Only show unread items
 *   --folder <name>         Folder/label for new subscription
 *   --title <title>         Title for new subscription
 *
 * @module cli/freshrss
 */

import dotenv from 'dotenv';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { initConfigService, configService } from '#system/config/index.mjs';
import { hydrateProcessEnvFromConfigs } from '#system/logging/config.mjs';
import { DataService } from '#system/config/DataService.mjs';
import { FreshRSSFeedAdapter } from '#adapters/feed/FreshRSSFeedAdapter.mjs';

// ============================================================================
// Bootstrap
// ============================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
dotenv.config({ path: path.join(projectRoot, '.env') });

const isDocker = existsSync('/.dockerenv');
const baseDir = isDocker ? '/usr/src/app' : process.env.DAYLIGHT_BASE_PATH;

if (!baseDir) {
  console.error('Error: DAYLIGHT_BASE_PATH not set.');
  process.exit(1);
}

const dataDir = path.join(baseDir, 'data');
const configDir = path.join(dataDir, 'system', 'config');

hydrateProcessEnvFromConfigs(configDir);
initConfigService(dataDir);

const dataService = new DataService({ configService });

// ============================================================================
// Parse CLI args
// ============================================================================

const args = process.argv.slice(2);
const flags = {
  json: args.includes('--json'),
  unreadOnly: args.includes('--unread-only'),
  username: null,
  count: 20,
  folder: null,
  title: null,
};

// Extract named args
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--username' && args[i + 1]) flags.username = args[++i];
  if (args[i] === '--count' && args[i + 1]) flags.count = parseInt(args[++i], 10);
  if (args[i] === '--folder' && args[i + 1]) flags.folder = args[++i];
  if (args[i] === '--title' && args[i + 1]) flags.title = args[++i];
}

// Default username to head of household
if (!flags.username) {
  flags.username = configService.getHeadOfHousehold();
}

// Positional args (strip flags)
const flagsWithValues = new Set(['--username', '--count', '--folder', '--title']);
const positionalArgs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    if (flagsWithValues.has(args[i])) i++; // skip next (value)
    continue;
  }
  positionalArgs.push(args[i]);
}

const command = positionalArgs[0];
const commandArgs = positionalArgs.slice(1);

// ============================================================================
// Create adapter
// ============================================================================

const freshrssHost = configService.resolveServiceUrl('freshrss');
if (!freshrssHost) {
  console.error('Error: FreshRSS service URL not configured in services.yml');
  console.error('Expected: services.freshrss.<env> in data/system/config/services.yml');
  process.exit(1);
}

const adapter = new FreshRSSFeedAdapter({
  freshrssHost,
  dataService,
});

// ============================================================================
// GReader API helper for subscribe (not yet in adapter)
// ============================================================================

async function greaderSubscribe(feedUrl, title, folder, username) {
  const auth = dataService.user.read('auth/freshrss', username);
  if (!auth?.key) throw new Error('FreshRSS API key not configured');

  const body = new URLSearchParams();
  body.append('ac', 'subscribe');
  body.append('s', feedUrl.startsWith('feed/') ? feedUrl : `feed/${feedUrl}`);
  if (title) body.append('t', title);
  if (folder) body.append('a', `user/-/label/${folder}`);

  const url = `${freshrssHost}/api/greader.php/reader/api/0/subscription/edit`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `GoogleLogin auth=${auth.key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Subscribe failed (${response.status}): ${text}`);
  }
  return response.text();
}

// ============================================================================
// Commands
// ============================================================================

async function cmdCategories() {
  const categories = await adapter.getCategories(flags.username);

  if (flags.json) {
    console.log(JSON.stringify(categories, null, 2));
    return;
  }

  console.log('\nFreshRSS Categories:');
  console.log('='.repeat(60));
  for (const cat of categories) {
    console.log(`  ${cat.id}`);
    if (cat.type) console.log(`      type: ${cat.type}`);
  }
  if (categories.length === 0) console.log('  (none)');
  console.log();
}

async function cmdFeeds() {
  const feeds = await adapter.getFeeds(flags.username);

  if (flags.json) {
    console.log(JSON.stringify(feeds, null, 2));
    return;
  }

  console.log('\nFreshRSS Feeds:');
  console.log('='.repeat(70));
  for (const feed of feeds) {
    const cats = (feed.categories || []).map(c => c.label).join(', ');
    console.log(`\n  ${feed.title || '(untitled)'}`);
    console.log(`      id:  ${feed.id}`);
    if (feed.url) console.log(`      url: ${feed.url}`);
    if (cats) console.log(`      in:  ${cats}`);
  }
  if (feeds.length === 0) console.log('  (none)');
  console.log(`\n  Total: ${feeds.length} feed(s)\n`);
}

async function cmdItems(streamId) {
  if (!streamId) {
    console.error('Usage: freshrss items <streamId>');
    console.error('  streamId: feed ID (e.g., "feed/1") or label (e.g., "user/-/label/Tech")');
    process.exit(1);
  }

  const { items, continuation } = await adapter.getItems(streamId, flags.username, {
    count: flags.count,
    excludeRead: flags.unreadOnly,
  });

  if (flags.json) {
    console.log(JSON.stringify({ items, continuation }, null, 2));
    return;
  }

  console.log(`\nItems from: ${streamId}`);
  console.log('='.repeat(70));
  for (const item of items) {
    const date = item.published ? item.published.toLocaleDateString() : '';
    console.log(`\n  ${item.title || '(untitled)'}`);
    if (date) console.log(`      date:   ${date}`);
    if (item.author) console.log(`      author: ${item.author}`);
    if (item.feedTitle) console.log(`      feed:   ${item.feedTitle}`);
    if (item.link) console.log(`      link:   ${item.link}`);
    console.log(`      id:     ${item.id}`);
  }
  if (items.length === 0) console.log('  (no items)');
  console.log(`\n  Showing ${items.length} item(s)`);
  if (continuation) console.log(`  Continuation: ${continuation}`);
  console.log('');
}

async function cmdMarkRead(ids) {
  if (ids.length === 0) {
    console.error('Usage: freshrss read <id> [id2] [id3] ...');
    process.exit(1);
  }

  await adapter.markRead(ids, flags.username);
  console.log(`Marked ${ids.length} item(s) as read.`);
}

async function cmdMarkUnread(ids) {
  if (ids.length === 0) {
    console.error('Usage: freshrss unread <id> [id2] [id3] ...');
    process.exit(1);
  }

  await adapter.markUnread(ids, flags.username);
  console.log(`Marked ${ids.length} item(s) as unread.`);
}

async function cmdSubscribe(feedUrl) {
  if (!feedUrl) {
    console.error('Usage: freshrss subscribe <url> [--title "Title"] [--folder "Folder"]');
    process.exit(1);
  }

  console.error(`Subscribing to: ${feedUrl}`);
  if (flags.folder) console.error(`  Folder: ${flags.folder}`);
  if (flags.title) console.error(`  Title: ${flags.title}`);

  await greaderSubscribe(feedUrl, flags.title, flags.folder, flags.username);
  console.log(`Subscribed to ${feedUrl}`);
}

function showHelp() {
  console.log(`
FreshRSS CLI - Interact with FreshRSS via GReader API

Usage:
  node cli/freshrss.cli.mjs <command> [arguments] [options]

Commands:
  categories              List categories/folders
  feeds                   List subscribed feeds
  items <streamId>        Get items from a feed or category
  read <id> [...]         Mark item(s) as read
  unread <id> [...]       Mark item(s) as unread
  subscribe <url>         Subscribe to a new feed

Options:
  --json                  Output as JSON
  --username <name>       User for auth (default: head of household)
  --count <n>             Number of items to fetch (default: 20)
  --unread-only           Only show unread items
  --folder <name>         Folder/label for subscribe command
  --title <title>         Title for subscribe command

Examples:
  node cli/freshrss.cli.mjs categories
  node cli/freshrss.cli.mjs feeds
  node cli/freshrss.cli.mjs feeds --json
  node cli/freshrss.cli.mjs items "feed/1"
  node cli/freshrss.cli.mjs items "user/-/label/Tech" --count 10 --unread-only
  node cli/freshrss.cli.mjs read "tag:google.com,2005:reader/item/00000001"
  node cli/freshrss.cli.mjs subscribe "https://example.com/rss" --folder News --title "Example"
`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'categories':
      case 'cats':
        await cmdCategories();
        break;

      case 'feeds':
      case 'f':
        await cmdFeeds();
        break;

      case 'items':
      case 'i':
        await cmdItems(commandArgs[0]);
        break;

      case 'read':
      case 'r':
        await cmdMarkRead(commandArgs);
        break;

      case 'unread':
      case 'u':
        await cmdMarkUnread(commandArgs);
        break;

      case 'subscribe':
      case 'sub':
        await cmdSubscribe(commandArgs[0]);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
