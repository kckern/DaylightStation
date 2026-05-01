/**
 * PersonalContextLoader (F-101)
 *
 * Loads a per-user personal playbook (YAML) and projects it into a markdown
 * bundle suitable for splicing into the HealthCoachAgent system prompt.
 *
 * Source: data/users/{userId}/lifelog/archives/playbook/playbook.yml
 * Output: 1.5–3K-token markdown string with profile, calibration, named
 *         periods, and patterns sections (severity-sorted).
 *
 * Token budget is enforced via a rough char-count proxy (1 token ≈ 4 chars).
 * If over budget, lower-severity patterns are dropped first, then older named
 * periods, and finally a hard truncate is applied as a last resort.
 *
 * Path traversal is blocked synchronously by validating userId against
 * /^[a-zA-Z0-9_-]+$/ before any I/O is attempted.
 *
 * Location: backend/src/3_applications/health/PersonalContextLoader.mjs
 */

import path from 'path';

const USER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_TOKEN_BUDGET = 3000;
const CHARS_PER_TOKEN = 4;
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

export class PersonalContextLoader {
  #dataService;
  #archiveRoot;
  #tokenBudget;
  #charBudget;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.dataService - Has `readYaml(absPath)` returning parsed YAML or null
   * @param {string} [config.archiveRoot='data/users'] - Root directory holding per-user archives
   * @param {number} [config.tokenBudget=3000] - Soft cap on output size (token-count proxy)
   * @param {Object} [config.logger] - Logger with debug/info/warn/error methods (defaults to console)
   */
  constructor(config = {}) {
    if (!config.dataService || typeof config.dataService.readYaml !== 'function') {
      throw new Error('PersonalContextLoader requires dataService with readYaml()');
    }
    this.#dataService = config.dataService;
    this.#archiveRoot = config.archiveRoot || 'data/users';
    this.#tokenBudget = config.tokenBudget || DEFAULT_TOKEN_BUDGET;
    this.#charBudget = this.#tokenBudget * CHARS_PER_TOKEN;
    this.#logger = config.logger || console;
  }

  /**
   * Load and render the personal context bundle for a user.
   * @param {string} userId
   * @returns {Promise<string>} markdown bundle, or '' if playbook is missing
   */
  async load(userId) {
    if (!userId || typeof userId !== 'string' || !USER_ID_PATTERN.test(userId)) {
      throw new Error(`Invalid userId: must match ${USER_ID_PATTERN}`);
    }

    const playbookPath = path.join(
      this.#archiveRoot,
      userId,
      'lifelog/archives/playbook/playbook.yml',
    );

    this.#logger.debug?.('personal_context.load_start', { userId, path: playbookPath });

    const playbook = await this.#dataService.readYaml(playbookPath);

    if (!playbook || typeof playbook !== 'object') {
      this.#logger.info?.('personal_context.playbook_missing', { userId, path: playbookPath });
      return '';
    }

    const bundle = this.#render(playbook);

    this.#logger.debug?.('personal_context.load_complete', {
      userId,
      chars: bundle.length,
      approxTokens: Math.ceil(bundle.length / CHARS_PER_TOKEN),
    });

    return bundle;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  #render(playbook) {
    const profileSection = this.#renderProfile(playbook.profile);
    const calibrationSection = this.#renderCalibration(playbook.calibration);
    const periods = this.#collectPeriods(playbook.named_periods);
    const patterns = this.#collectPatterns(playbook.patterns);

    let bundle = this.#assemble(profileSection, calibrationSection, periods, patterns);

    if (bundle.length <= this.#charBudget) {
      return bundle;
    }

    // Step 1: keep only high-severity patterns.
    const highPatterns = patterns.filter(p => p.severity === 'high');
    bundle = this.#assemble(profileSection, calibrationSection, periods, highPatterns);
    if (bundle.length <= this.#charBudget) {
      this.#logger.warn?.('personal_context.truncated', {
        stage: 'patterns_high_only',
        chars: bundle.length,
      });
      return bundle;
    }

    // Step 2: also trim named periods (keep most recent by `from`).
    const recentPeriods = [...periods]
      .sort((a, b) => (b.from || '').localeCompare(a.from || ''))
      .slice(0, 3);
    bundle = this.#assemble(profileSection, calibrationSection, recentPeriods, highPatterns);
    if (bundle.length <= this.#charBudget) {
      this.#logger.warn?.('personal_context.truncated', {
        stage: 'periods_trimmed',
        chars: bundle.length,
      });
      return bundle;
    }

    // Step 3: hard truncate.
    const suffix = '\n\n_(truncated)_';
    const truncated = bundle.slice(0, Math.max(0, this.#charBudget - suffix.length)) + suffix;
    this.#logger.warn?.('personal_context.truncated', {
      stage: 'hard_truncate',
      chars: truncated.length,
    });
    return truncated;
  }

  #assemble(profileSection, calibrationSection, periods, patterns) {
    const parts = ['## Personal Context', ''];

    if (profileSection) {
      parts.push(profileSection, '');
    }
    if (calibrationSection) {
      parts.push(calibrationSection, '');
    }

    const periodsSection = this.#renderPeriods(periods);
    if (periodsSection) {
      parts.push(periodsSection, '');
    }

    const patternsSection = this.#renderPatterns(patterns);
    if (patternsSection) {
      parts.push(patternsSection, '');
    }

    return parts.join('\n').trimEnd() + '\n';
  }

  #renderProfile(profile) {
    if (!profile || typeof profile !== 'object') return '';
    const lines = ['### Profile'];

    const goal = (profile.goal_context || '').trim();
    if (goal) lines.push(goal);

    const truths = Array.isArray(profile.truths) ? profile.truths.filter(Boolean) : [];
    if (truths.length) {
      lines.push('', '**Truths:**');
      for (const t of truths) {
        lines.push(`- ${String(t).trim()}`);
      }
    }
    return lines.join('\n');
  }

  #renderCalibration(calibration) {
    if (!calibration || typeof calibration !== 'object') return '';
    const lines = ['### Calibration'];

    if (calibration.last_dexa !== undefined && calibration.last_dexa !== null) {
      lines.push(`- Last DEXA: ${this.#formatDate(calibration.last_dexa)}`);
    }
    if (calibration.consumer_bia_lean_offset_lbs !== undefined) {
      lines.push(`- Consumer-BIA lean offset: ${calibration.consumer_bia_lean_offset_lbs} lbs`);
    }
    if (calibration.consumer_bia_body_fat_offset_pct !== undefined) {
      lines.push(`- Consumer-BIA body-fat offset: ${calibration.consumer_bia_body_fat_offset_pct} pct`);
    }
    return lines.length > 1 ? lines.join('\n') : '';
  }

  #collectPeriods(namedPeriods) {
    if (!namedPeriods || typeof namedPeriods !== 'object') return [];
    return Object.entries(namedPeriods).map(([name, body]) => {
      const summary = (body?.description || '')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        .join(' ');
      return {
        name,
        from: body?.from ? this.#formatDate(body.from) : null,
        to: body?.to ? this.#formatDate(body.to) : null,
        summary,
      };
    });
  }

  #renderPeriods(periods) {
    if (!periods || !periods.length) return '';
    const lines = ['### Named Periods'];
    for (const p of periods) {
      const range = p.from && p.to ? ` (${p.from} → ${p.to})` : '';
      const summary = p.summary ? `: ${this.#firstSentence(p.summary)}` : '';
      lines.push(`- **${p.name}**${range}${summary}`);
    }
    return lines.join('\n');
  }

  #collectPatterns(patterns) {
    if (!Array.isArray(patterns)) return [];
    return patterns
      .filter(p => p && p.name)
      .map(p => ({
        name: p.name,
        type: p.type || 'failure_mode',
        severity: SEVERITY_RANK[p.severity] !== undefined ? p.severity : 'medium',
        description: (p.description || '').trim(),
      }))
      .sort((a, b) => {
        const ra = SEVERITY_RANK[a.severity] ?? 99;
        const rb = SEVERITY_RANK[b.severity] ?? 99;
        return ra - rb;
      });
  }

  #renderPatterns(patterns) {
    if (!patterns || !patterns.length) return '';
    const failures = patterns.filter(p => p.type === 'failure_mode');
    const successes = patterns.filter(p => p.type === 'success_mode');

    const lines = ['### Patterns'];

    if (failures.length) {
      lines.push('**Failure modes:**');
      for (const p of failures) {
        lines.push(`- **${p.name}** [${p.severity}]: ${this.#firstSentence(p.description)}`);
      }
    }
    if (successes.length) {
      if (failures.length) lines.push('');
      lines.push('**Success modes:**');
      for (const p of successes) {
        lines.push(`- **${p.name}** [${p.severity}]: ${this.#firstSentence(p.description)}`);
      }
    }
    return lines.length > 1 ? lines.join('\n') : '';
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  #firstSentence(text) {
    if (!text) return '';
    const flattened = String(text).replace(/\s+/g, ' ').trim();
    const match = flattened.match(/^(.+?[.!?])(\s|$)/);
    return match ? match[1] : flattened;
  }

  #formatDate(value) {
    if (value instanceof Date) {
      return value.toISOString().slice(0, 10);
    }
    return String(value);
  }
}

export default PersonalContextLoader;
