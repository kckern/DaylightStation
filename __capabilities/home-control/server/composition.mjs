import { TVControlAdapter } from "./adapters/tv/TVControlAdapter.mjs";
import { KioskAdapter } from "./adapters/kiosk/KioskAdapter.mjs";
import { TaskerAdapter } from "./adapters/tasker/TaskerAdapter.mjs";
import { RemoteExecAdapter } from "./adapters/remote-exec/RemoteExecAdapter.mjs";

export function createHomeAutomationAdapters(config) {
  // `httpClient` is the system HttpClient the kiosk and tasker adapters call
  // through. Both refuse to be built without one, so with none given they are
  // left out (and reported) instead of failing the whole composition.
  const { logger = console, haGateway: preloadedHaGateway, httpClient = null } = config;

  // Home Assistant gateway (provided by composition root)
  const haGateway = preloadedHaGateway ?? null;
  let tvAdapter = null;

  // TV control adapter (uses HA gateway)
  if (haGateway) {
    tvAdapter = new TVControlAdapter(
      { gateway: haGateway },
      { logger }
    );
  } else {
    logger.warn?.('homeAutomation.homeassistant.disabled', {
      reason: 'Missing baseUrl or token configuration'
    });
  }

  // Kiosk adapter (optional). KioskAdapter speaks Fully Kiosk's query-string
  // API only, with the password in the URL. A kiosk on another provider (the
  // Android kiosk app, `daylight-android`) is driven through the device
  // adapters selected by `content_control.provider` in devices.yml, so this
  // adapter is not built for it.
  let kioskAdapter = null;
  const kioskProvider = config.kiosk?.provider || 'fully-kiosk';
  if (config.kiosk?.host && kioskProvider !== 'fully-kiosk') {
    logger.warn?.('homeAutomation.kiosk.unsupportedProvider', { provider: kioskProvider });
  } else if (config.kiosk?.host && !httpClient) {
    logger.warn?.('homeAutomation.kiosk.disabled', { reason: 'no http client' });
  } else if (config.kiosk?.host) {
    kioskAdapter = new KioskAdapter(
      {
        host: config.kiosk.host,
        port: config.kiosk.port,
        password: config.kiosk.password,
        daylightHost: config.kiosk.daylightHost
      },
      { httpClient, logger }
    );
  }

  // Tasker adapter (optional)
  let taskerAdapter = null;
  if (config.tasker?.host && !httpClient) {
    logger.warn?.('homeAutomation.tasker.disabled', { reason: 'no http client' });
  } else if (config.tasker?.host) {
    taskerAdapter = new TaskerAdapter(
      {
        host: config.tasker.host,
        port: config.tasker.port
      },
      { httpClient, logger }
    );
  }

  // Remote exec adapter (optional)
  let remoteExecAdapter = null;
  if (config.remoteExec?.host) {
    remoteExecAdapter = new RemoteExecAdapter(
      {
        host: config.remoteExec.host,
        user: config.remoteExec.user,
        port: config.remoteExec.port,
        privateKey: config.remoteExec.privateKey,
        knownHostsPath: config.remoteExec.knownHostsPath
      },
      { logger }
    );
  }

  return {
    haGateway,
    tvAdapter,
    kioskAdapter,
    taskerAdapter,
    remoteExecAdapter
  };
}
