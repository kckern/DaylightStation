import {SupervisedActivity} from '../../../../__app_modules/household/supervision/browser/index.js';
import { useEffect, useMemo, lazy, Suspense } from "react";
import "./AppContainer.scss";
import { getApp } from "../../lib/appRegistry.js";
import { getChildLogger } from "../../lib/logging/singleton.js";

export function parseAppInput(open) {
  const raw = open?.app || open?.open || open;
  if (typeof raw !== 'string') return {app: raw, param: open?.param || null};
  const slash = raw.indexOf('/');
  return {app: slash < 0 ? raw : raw.slice(0, slash), param: (slash < 0 ? null : raw.slice(slash + 1)) || open?.param || null};
}

export function participantPropsForApp(entry, result) {
  const registration = entry?.participantLaunch;
  if (result?.schema !== 'participant-launch-result/v1' || result.kind !== 'ready' || !registration || registration.consumer?.id !== result.consumer?.id || registration.consumer?.version !== result.consumer?.version || registration.outputSchema !== result.output?.schema) return {};
  return {participantLaunch: result};
}

export default function AppContainer({ open, clear, participantLaunch }) {
  // Parse app string - may contain param after slash (e.g., "art/nativity")
  const {app, param} = parseAppInput(open);
  const logger = useMemo(() => getChildLogger({ app: 'app-container' }), []);

  useEffect(() => {
    logger.info('app-container-open', { app, param });
  }, [app, param, logger]);

  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key === "Escape") {
        clear();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clear]);

  const entry = getApp(app);

  const Component = useMemo(() => entry ? lazy(entry.component) : null, [entry]);

  if (!entry) {
    return (
      <div>
        <h2>App Container</h2>
        <pre>{JSON.stringify({ app, param, open }, null, 2)}</pre>
      </div>
    );
  }

  const appProps = { clear, ...participantPropsForApp(entry, participantLaunch) };
  if (entry.param?.name && param) {
    appProps[entry.param.name] = param;
  }

  return (
    <SupervisedActivity activityId={app==='school'?'school:workspace':`app:${app}`}><Suspense fallback={null}>
      <Component {...appProps} />
    </Suspense></SupervisedActivity>
  );
}
