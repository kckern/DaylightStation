/**
 * Config Health Check
 * 
 * Validates configuration on startup and logs status.
 * Helps diagnose missing config, paths, and environment issues.
 */

import fs from 'fs';
import path from 'path';

/**
 * Validate configuration and return any issues found
 * @param {object} options - Validation options
 * @param {object} options.logger - Logger instance (optional)
 * @param {boolean} options.verbose - Log all checks, not just issues
 * @returns {object} - { valid: boolean, issues: string[], warnings: string[] }
 */
export function validateConfig(options = {}) {
  const { logger, verbose = false } = options;
  const log = (level, event, data) => {
    if (logger && typeof logger[level] === 'function') {
      logger[level](event, data);
    } else if (verbose || level === 'error' || level === 'warn') {
      console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
        `[ConfigHealthCheck] ${event}:`, data
      );
    }
  };

  const issues = [];
  const warnings = [];
  const checks = {};

  // ============================================================
  // Check 1: Data Path
  // ============================================================
  const dataPath = process.env.path?.data;
  if (!dataPath) {
    issues.push('path.data not configured in process.env');
    checks.dataPath = { status: 'error', value: null };
  } else if (!fs.existsSync(dataPath)) {
    issues.push(`path.data directory does not exist: ${dataPath}`);
    checks.dataPath = { status: 'error', value: dataPath, exists: false };
  } else {
    checks.dataPath = { status: 'ok', value: dataPath, exists: true };
  }

  // ============================================================
  // Check 2: Users Directory
  // ============================================================
  if (dataPath) {
    const usersDir = path.join(dataPath, 'users');
    if (!fs.existsSync(usersDir)) {
      warnings.push(`users directory missing: ${usersDir}`);
      checks.usersDir = { status: 'warning', value: usersDir, exists: false };
    } else {
      // Count user profiles
      const userDirs = fs.readdirSync(usersDir).filter(d => {
        const stat = fs.statSync(path.join(usersDir, d));
        return stat.isDirectory() && !d.startsWith('.') && !d.startsWith('_') && d !== 'example';
      });
      checks.usersDir = { status: 'ok', value: usersDir, exists: true, userCount: userDirs.length };
    }
  }

  // ============================================================
  // Check 3: Fitness Config (household-scoped)
  // ============================================================
  if (dataPath) {
    // Check household-scoped path first (new structure)
    const householdFitnessConfig = path.join(dataPath, 'households', 'default', 'apps', 'fitness', 'config.yaml');
    const legacyFitnessConfig = path.join(dataPath, 'fitness', 'config.yaml');
    
    if (fs.existsSync(householdFitnessConfig)) {
      checks.fitnessConfig = { status: 'ok', value: householdFitnessConfig, exists: true, location: 'household' };
    } else if (fs.existsSync(legacyFitnessConfig)) {
      warnings.push(`fitness config using legacy path: ${legacyFitnessConfig} (should migrate to households/default/apps/fitness/)`);
      checks.fitnessConfig = { status: 'warning', value: legacyFitnessConfig, exists: true, location: 'legacy' };
    } else {
      warnings.push(`fitness config missing: checked ${householdFitnessConfig}`);
      checks.fitnessConfig = { status: 'warning', value: householdFitnessConfig, exists: false };
    }
  }

  // ============================================================
  // Check 4: Media Path
  // ============================================================
  const mediaPath = process.env.path?.media;
  if (!mediaPath) {
    warnings.push('path.media not configured');
    checks.mediaPath = { status: 'warning', value: null };
  } else if (!fs.existsSync(mediaPath)) {
    warnings.push(`path.media directory does not exist: ${mediaPath}`);
    checks.mediaPath = { status: 'warning', value: mediaPath, exists: false };
  } else {
    checks.mediaPath = { status: 'ok', value: mediaPath, exists: true };
  }

  // ============================================================
  // Check 5: Environment Detection
  // ============================================================
  const isDocker = fs.existsSync('/.dockerenv');
  const isDev = process.env.dev === true || process.env.dev === 'true';
  checks.environment = {
    status: 'ok',
    isDocker,
    isDev,
    nodeEnv: process.env.NODE_ENV || 'not set'
  };

  // ============================================================
  // Check 6: Critical Secrets (existence only, not values)
  // ============================================================
  const secretKeys = [
    'OPENAI_API_KEY',
    'LOGGLY_TOKEN'
  ];
  // Telegram tokens are per-bot now (TELEGRAM_NUTRIBOT_TOKEN, etc.) - checked separately
  const missingSecrets = secretKeys.filter(key => !process.env[key]);
  if (missingSecrets.length > 0) {
    warnings.push(`Optional secrets not configured: ${missingSecrets.join(', ')}`);
    checks.secrets = { status: 'warning', missing: missingSecrets };
  } else {
    checks.secrets = { status: 'ok', configured: secretKeys.length };
  }

  // ============================================================
  // Summary
  // ============================================================
  const valid = issues.length === 0;
  const result = {
    valid,
    issues,
    warnings,
    checks,
    summary: {
      issueCount: issues.length,
      warningCount: warnings.length,
      checksPassed: Object.values(checks).filter(c => c.status === 'ok').length,
      checksTotal: Object.keys(checks).length
    }
  };

  // Log results
  if (issues.length > 0) {
    log('error', 'config.validation.failed', { issues });
  }
  if (warnings.length > 0) {
    log('warn', 'config.validation.warnings', { warnings });
  }
  if (valid) {
    log('info', 'config.validation.passed', {
      dataPath,
      userCount: checks.usersDir?.userCount || 0,
      environment: checks.environment
    });
  }

  return result;
}

/**
 * Get a human-readable config status summary
 * @returns {string}
 */
export function getConfigStatusSummary() {
  const result = validateConfig({ verbose: false });
  
  const lines = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║                    CONFIG STATUS SUMMARY                      ║',
    '╠══════════════════════════════════════════════════════════════╣',
  ];

  // Environment
  const env = result.checks.environment;
  lines.push(`║  Environment: ${env.isDocker ? 'Docker' : 'Local Dev'} (NODE_ENV=${env.nodeEnv})`.padEnd(65) + '║');
  
  // Data path
  const dp = result.checks.dataPath;
  const dpStatus = dp.status === 'ok' ? '✓' : '✗';
  lines.push(`║  ${dpStatus} Data Path: ${dp.value || 'NOT SET'}`.padEnd(65).slice(0, 65) + '║');
  
  // Users
  const ud = result.checks.usersDir;
  if (ud) {
    const udStatus = ud.status === 'ok' ? '✓' : '⚠';
    lines.push(`║  ${udStatus} Users: ${ud.userCount || 0} profiles found`.padEnd(65) + '║');
  }
  
  // Summary
  lines.push('╠══════════════════════════════════════════════════════════════╣');
  const statusIcon = result.valid ? '✓' : '✗';
  const statusText = result.valid ? 'PASSED' : 'FAILED';
  lines.push(`║  ${statusIcon} Status: ${statusText} (${result.summary.issueCount} issues, ${result.summary.warningCount} warnings)`.padEnd(65) + '║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  
  return lines.join('\n');
}

export default { validateConfig, getConfigStatusSummary };
