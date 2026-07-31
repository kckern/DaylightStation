/**
 * YAML persistence for printed action tokens (spec §6.1).
 *
 *   <dataDir>/household/apps/school/tokens/{body}.yml
 *
 * The `sch:` prefix never reaches the filesystem: a colon is legal in a POSIX
 * filename but the prefix is a routing marker, not identity, and stripping it
 * keeps one token to one file however it was scanned (with prefix, without, or
 * with the trailing whitespace a scanner appends).
 *
 * One token is one whole-file write, so there is no read-modify-write to lose —
 * except `revoke`, which is queued behind the same chain as every other write.
 */
import path from 'path';
import { promises as fs } from 'fs';
import yaml from 'js-yaml';
import { ITokenRegistry } from '#apps/school/ports/ITokenRegistry.mjs';
import { TOKEN_PREFIX } from '#domains/school/sessions/tokens.mjs';

// The mint charset is [A-Z0-9]; the bound is wide enough for a future format and
// narrow enough that "..", ".", "a/b" and hidden names cannot match.
const BODY_RE = /^[A-Za-z0-9]{4,64}$/;

const dumpYaml = (value) => yaml.dump(value, { indent: 2, lineWidth: -1, noRefs: true });

/** Scanned code → filesystem-safe body, or null when it could never be one of ours. */
function bodyOf(token) {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  const body = trimmed.startsWith(TOKEN_PREFIX) ? trimmed.slice(TOKEN_PREFIX.length) : trimmed;
  return BODY_RE.test(body) ? body : null;
}

export class YamlTokenRegistry extends ITokenRegistry {
  #configService;
  #writeChain = Promise.resolve();

  constructor(config = {}) {
    super();
    if (!config.configService || typeof config.configService.getHouseholdPath !== 'function') {
      throw new Error('YamlTokenRegistry: configService with getHouseholdPath() is required');
    }
    this.#configService = config.configService;
  }

  #root() { return this.#configService.getHouseholdPath('apps/school/tokens'); }

  #fileFor(body) { return path.join(this.#root(), `${body}.yml`); }

  #enqueue(run) {
    const queued = this.#writeChain.then(run);
    this.#writeChain = queued.catch(() => {});
    return queued;
  }

  async #write(body, record) {
    await fs.mkdir(this.#root(), { recursive: true });
    await fs.writeFile(this.#fileFor(body), dumpYaml(record), 'utf8');
  }

  /** @inheritdoc */
  async put(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('YamlTokenRegistry: record must be a mapping');
    }
    const body = bodyOf(record.token);
    if (!body) throw new Error(`YamlTokenRegistry: not a school token: ${record.token}`);
    return this.#enqueue(async () => {
      await this.#write(body, record);
      return record;
    });
  }

  /** @inheritdoc */
  async get(token) {
    const body = bodyOf(token);
    if (!body) return null;
    try {
      const raw = yaml.load(await fs.readFile(this.#fileFor(body), 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      return raw;
    } catch {
      // Missing OR unreadable: the resolver prints an explanation slip either
      // way, and one bad record must not poison the rest of the registry.
      return null;
    }
  }

  /** @inheritdoc */
  async revoke(token, { at } = {}) {
    const body = bodyOf(token);
    if (!body) return null;
    if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
      throw new Error('YamlTokenRegistry: revoke requires an ISO-8601 `at`');
    }
    return this.#enqueue(async () => {
      const record = await this.get(token);
      if (!record) return null;
      // First revocation wins: re-revoking is a retry, and moving the timestamp
      // would rewrite when the card actually stopped working.
      if (record.revokedAt) return record;
      const revoked = { ...record, revokedAt: at };
      await this.#write(body, revoked);
      return revoked;
    });
  }
}

export default YamlTokenRegistry;
