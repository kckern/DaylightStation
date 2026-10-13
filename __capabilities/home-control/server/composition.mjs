import { TVControlAdapter } from "./adapters/tv/TVControlAdapter.mjs";
import { KioskAdapter } from "./adapters/kiosk/KioskAdapter.mjs";
import { TaskerAdapter } from "./adapters/tasker/TaskerAdapter.mjs";
import { RemoteExecAdapter } from "./adapters/remote-exec/RemoteExecAdapter.mjs";

export function createHomeAutomationAdapters(config) {
  const { logger = console, haGateway: preloadedHaGateway } = config;

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

  // Kiosk adapter (optional)
  let kioskAdapter = null;
  if (config.kiosk?.host) {
    kioskAdapter = new KioskAdapter(
      {
        host: config.kiosk.host,
        port: config.kiosk.port,
        password: config.kiosk.password,
        daylightHost: config.kiosk.daylightHost
      },
      { logger }
    );
  }

  // Tasker adapter (optional)
  let taskerAdapter = null;
  if (config.tasker?.host) {
    taskerAdapter = new TaskerAdapter(
      {
        host: config.tasker.host,
        port: config.tasker.port
      },
      { logger }
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
