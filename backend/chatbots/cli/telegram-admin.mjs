#!/usr/bin/env node
/**
 * Telegram Bot Management CLI
 * @module cli/telegram-admin
 * 
 * Usage:
 *   node backend/chatbots/cli/telegram-admin.mjs <command> [options]
 * 
 * Commands:
 *   status <bot>              Show bot status (webhook, commands)
 *   webhook:set <bot> <env>   Set webhook to dev or prod
 *   webhook:info <bot>        Show current webhook info
 *   webhook:delete <bot>      Delete webhook (for polling mode)
 *   commands:list <bot>       List current slash commands
 *   commands:set <bot>        Set commands from preset
 *   commands:delete <bot>     Delete all commands
 * 
 * Bots: nutribot, journalist
 * Environments: dev, prod
 */

import { ConfigProvider, getConfigProvider } from '../_lib/config/index.mjs';
import { TelegramBotManager, COMMAND_PRESETS } from '../_lib/telegram/index.mjs';

const BOTS = ['nutribot', 'journalist'];

function printUsage() {
  console.log(`
Telegram Bot Management CLI
===========================

Usage:
  node backend/chatbots/cli/telegram-admin.mjs <command> [bot] [options]

Commands:
  status <bot>              Show bot status (webhook, commands, info)
  webhook:set <bot> <env>   Set webhook URL (env: dev|prod)
  webhook:info <bot>        Show current webhook configuration
  webhook:delete <bot>      Delete webhook (switch to polling)
  commands:list <bot>       List current slash commands
  commands:set <bot>        Set commands from preset
  commands:delete <bot>     Delete all slash commands

Bots: ${BOTS.join(', ')}

Examples:
  telegram-admin.mjs status nutribot
  telegram-admin.mjs webhook:set nutribot prod
  telegram-admin.mjs commands:set nutribot
  telegram-admin.mjs commands:list journalist
`);
}

function getBotManager(botName) {
  if (!BOTS.includes(botName)) {
    console.error(`❌ Unknown bot: ${botName}`);
    console.error(`   Available bots: ${BOTS.join(', ')}`);
    process.exit(1);
  }

  const config = getConfigProvider();
  const token = config.getTelegramToken(botName);
  
  if (!token) {
    console.error(`❌ No token found for ${botName}`);
    console.error(`   Set TELEGRAM_${botName.toUpperCase()}_TOKEN in environment or config.secrets.yml`);
    process.exit(1);
  }

  const botId = config.getTelegramBotId(botName);
  return new TelegramBotManager({ token, botId });
}

function getWebhookUrls(botName) {
  const config = getConfigProvider();
  const botConfig = botName === 'nutribot' 
    ? config.getNutribotConfig() 
    : config.getJournalistConfig();
  
  // Get webhooks directly from app config
  const chatbots = config.getAppConfig().chatbots || {};
  const bot = chatbots.bots?.[botName] || {};
  const webhooks = bot.webhooks || {};
  
  // Fallback URLs
  const defaultUrls = {
    nutribot: { dev: 'https://api-dev.kckern.net/foodlog', prod: 'https://daylightstation-api.kckern.net/foodlog' },
    journalist: { dev: 'https://api-dev.kckern.net/journalist', prod: 'https://daylightstation-api.kckern.net/journalist' },
  };
  
  return {
    dev: webhooks.dev || defaultUrls[botName]?.dev,
    prod: webhooks.prod || defaultUrls[botName]?.prod,
  };
}

// ==================== Commands ====================

async function cmdStatus(botName) {
  console.log(`\n📊 Status for ${botName}\n`);
  
  const manager = getBotManager(botName);
  const status = await manager.getStatus();

  console.log('Bot Info:');
  console.log(`  ID:       ${status.bot.id}`);
  console.log(`  Username: @${status.bot.username}`);
  console.log(`  Name:     ${status.bot.firstName}`);
  
  console.log('\nWebhook:');
  if (status.webhook.url) {
    console.log(`  URL:             ${status.webhook.url}`);
    console.log(`  Pending Updates: ${status.webhook.pendingUpdateCount}`);
    if (status.webhook.lastErrorMessage) {
      console.log(`  ⚠️  Last Error:   ${status.webhook.lastErrorMessage}`);
      console.log(`      Error Time:  ${status.webhook.lastErrorDate}`);
    }
  } else {
    console.log('  (not configured - using polling mode)');
  }

  console.log('\nCommands:');
  if (status.commands.length > 0) {
    status.commands.forEach(cmd => console.log(`  ${cmd}`));
  } else {
    console.log('  (no commands configured)');
  }
  
  console.log();
}

async function cmdWebhookSet(botName, env) {
  if (!['dev', 'prod'].includes(env)) {
    console.error(`❌ Invalid environment: ${env}`);
    console.error('   Use: dev or prod');
    process.exit(1);
  }

  const manager = getBotManager(botName);
  const webhooks = getWebhookUrls(botName);
  
  console.log(`\n🔗 Setting webhook for ${botName} to ${env}...`);
  console.log(`   URL: ${webhooks[env]}\n`);

  const result = await manager.switchEnvironment(env, webhooks);
  
  if (result.success) {
    console.log(`✅ Webhook updated successfully!`);
    console.log(`   Environment:     ${result.environment}`);
    console.log(`   URL:             ${result.url}`);
    console.log(`   Pending Updates: ${result.pendingUpdates}`);
  } else {
    console.error('❌ Webhook update may have failed. Current status:');
    const info = await manager.getWebhookInfo();
    console.log(`   Current URL: ${info.url || '(none)'}`);
  }
  console.log();
}

async function cmdWebhookInfo(botName) {
  const manager = getBotManager(botName);
  const info = await manager.getWebhookInfo();
  
  console.log(`\n🔗 Webhook Info for ${botName}\n`);
  console.log(`  URL:                    ${info.url || '(not set)'}`);
  console.log(`  Custom Certificate:     ${info.has_custom_certificate}`);
  console.log(`  Pending Update Count:   ${info.pending_update_count}`);
  console.log(`  Max Connections:        ${info.max_connections || 'default'}`);
  console.log(`  Allowed Updates:        ${(info.allowed_updates || []).join(', ') || 'all'}`);
  
  if (info.last_error_date) {
    console.log(`\n  ⚠️  Last Error:`);
    console.log(`      Time:    ${new Date(info.last_error_date * 1000).toISOString()}`);
    console.log(`      Message: ${info.last_error_message}`);
  }
  console.log();
}

async function cmdWebhookDelete(botName) {
  const manager = getBotManager(botName);
  
  console.log(`\n🗑️  Deleting webhook for ${botName}...`);
  
  await manager.deleteWebhook({ dropPendingUpdates: false });
  
  console.log('✅ Webhook deleted. Bot is now in polling mode.\n');
}

async function cmdCommandsList(botName) {
  const manager = getBotManager(botName);
  const commands = await manager.getCommands();
  
  console.log(`\n📋 Commands for ${botName}\n`);
  
  if (commands.length === 0) {
    console.log('  (no commands configured)');
  } else {
    commands.forEach(cmd => {
      console.log(`  /${cmd.command} - ${cmd.description}`);
    });
  }
  console.log();
}

async function cmdCommandsSet(botName) {
  const manager = getBotManager(botName);
  const preset = COMMAND_PRESETS[botName];
  
  if (!preset) {
    console.error(`❌ No command preset defined for ${botName}`);
    process.exit(1);
  }

  console.log(`\n⚙️  Setting commands for ${botName}...\n`);
  console.log('Commands to set:');
  preset.forEach(cmd => {
    console.log(`  /${cmd.command} - ${cmd.description}`);
  });
  
  await manager.setCommands(preset);
  
  console.log('\n✅ Commands updated successfully!\n');
}

async function cmdCommandsDelete(botName) {
  const manager = getBotManager(botName);
  
  console.log(`\n🗑️  Deleting all commands for ${botName}...`);
  
  await manager.deleteCommands();
  
  console.log('✅ All commands deleted.\n');
}

// ==================== Main ====================

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const command = args[0];
  const botName = args[1];
  const extra = args[2];

  try {
    switch (command) {
      case 'status':
        if (!botName) { printUsage(); process.exit(1); }
        await cmdStatus(botName);
        break;
        
      case 'webhook:set':
        if (!botName || !extra) { printUsage(); process.exit(1); }
        await cmdWebhookSet(botName, extra);
        break;
        
      case 'webhook:info':
        if (!botName) { printUsage(); process.exit(1); }
        await cmdWebhookInfo(botName);
        break;
        
      case 'webhook:delete':
        if (!botName) { printUsage(); process.exit(1); }
        await cmdWebhookDelete(botName);
        break;
        
      case 'commands:list':
        if (!botName) { printUsage(); process.exit(1); }
        await cmdCommandsList(botName);
        break;
        
      case 'commands:set':
        if (!botName) { printUsage(); process.exit(1); }
        await cmdCommandsSet(botName);
        break;
        
      case 'commands:delete':
        if (!botName) { printUsage(); process.exit(1); }
        await cmdCommandsDelete(botName);
        break;
        
      case 'help':
      case '--help':
      case '-h':
        printUsage();
        break;
        
      default:
        console.error(`❌ Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Error: ${error.message}\n`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
