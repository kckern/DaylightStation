import path from 'node:path';
import { Scheduler } from '#system/scheduling/Scheduler.mjs';
import { LibbyCredentialProvider } from '#adapters/content/media/libby/LibbyCredentialProvider.mjs';
import { LibbyIdentityRenewalService, startIdentityRenewal } from '#adapters/content/media/libby/LibbyIdentityRenewalService.mjs';
import { LibbyClient } from '#adapters/content/media/libby/LibbyClient.mjs';
import { LibbyStreamLeaseService } from '#adapters/content/media/libby/LibbyStreamLeaseService.mjs';
import { LibbyStreamService } from '#apps/proxy/LibbyStreamService.mjs';
import { LibbyCoverService } from '#apps/proxy/LibbyCoverService.mjs';
import { LibbyBootstrapService } from '#apps/proxy/LibbyBootstrapService.mjs';
import { DaylightBrowserLibbyGateway } from '#adapters/content/media/libby/DaylightBrowserLibbyGateway.mjs';
import { LibbyStreamGateway } from '#adapters/content/media/libby/LibbyStreamGateway.mjs';

const PROVIDER_HOSTS = [
  'sentry.libbyapp.com',
  '.listen.libbyapp.com',
  'audioclips.cdn.overdrive.com',
];
const COVER_HOSTS = ['.od-cdn.com'];

function validCredentialOwner(value) {
  return typeof value === 'string' && value !== '.' && value !== '..'
    && /^[a-zA-Z0-9._-]+$/.test(value);
}

/** Compose one process-local Libby runtime shared by content and proxy adapters. */
export function createLibbyRuntime({ dataPath, username, fetch = globalThis.fetch, logger = console,
  browserBaseUrl = process.env.DAYLIGHT_BROWSER_URL || 'http://daylight-browser:3000', browserTimeoutMs = 75_000,
  renewalEnabled = Scheduler.shouldEnable(), startRenewal = startIdentityRenewal } = {}) {
  if (!dataPath) throw new Error('Libby runtime requires dataPath');
  if (!validCredentialOwner(username)) throw new Error('Libby runtime requires a valid username');
  const credentialPath = path.join(dataPath, 'users', username, 'auth', 'libby.yml');
  const credentials = new LibbyCredentialProvider({ filePath: credentialPath, logger });
  // The caller deadline must outlive the sidecar's 70s HTTP budget so a
  // categorical 504 wins the race over a transport-level abort.
  const bootstrapGateway = new DaylightBrowserLibbyGateway({ baseUrl: browserBaseUrl, fetch, timeoutMs: browserTimeoutMs });
  const bootstrapService = new LibbyBootstrapService({ bootstrapGateway });
  const client = new LibbyClient({ fetch, credentials, allowedHosts: PROVIDER_HOSTS, coverAllowedHosts: COVER_HOSTS, bootstrapService });
  const leases = new LibbyStreamLeaseService();
  const streamGateway = new LibbyStreamGateway({ fetch, allowedHosts: PROVIDER_HOSTS });
  const streamService = new LibbyStreamService({
    leases, client, streamGateway,
    scheduler: { setTimeout, clearTimeout, setInterval, clearInterval },
  });
  const coverService = new LibbyCoverService({ coverGateway: client });

  // The credential file is in the shared data tree, so exactly one instance may
  // rotate it; a second writer produces conflicted copies. Reuse the same signal
  // that decides which instance owns scheduled work.
  const identityRenewal = new LibbyIdentityRenewalService({ credentials, client, logger });
  let stopIdentityRenewal = () => {};
  if (renewalEnabled) {
    stopIdentityRenewal = startRenewal({ service: identityRenewal });
  } else {
    logger.info?.('libby.identity.renewal_disabled', { reason: 'instance does not own scheduled work' });
  }

  return { credentials, client, leases, streamGateway, streamService, coverService, credentialPath,
    identityRenewal, stopIdentityRenewal };
}

/** Read the normal household app boundary and compose Libby only when opted in. */
export function createConfiguredLibbyRuntime({ configService, householdId = null, dataPath, logger = console,
  fetch = globalThis.fetch, browserBaseUrl, factory = createLibbyRuntime } = {}) {
  const settings = configService?.getHouseholdAppConfig?.(householdId, 'libby') ?? null;
  if (!settings || settings.enabled !== true) return { config: null, runtime: null };
  const username = settings.credential_owner;
  if (!validCredentialOwner(username)) {
    throw new Error('Enabled Libby configuration requires a valid credential_owner');
  }
  const runtime = factory({ dataPath, username, fetch, logger, ...(browserBaseUrl ? { browserBaseUrl } : {}) });
  return { config: Object.freeze({ username }), runtime };
}

export default createLibbyRuntime;
