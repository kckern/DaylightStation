import { useEffect, useMemo, lazy, Suspense } from "react";
import "./AppContainer.scss";
import { getApp } from "../../lib/appRegistry.js";
import { getChildLogger } from "../../lib/logging/singleton.js";

export default function AppContainer({ open, clear }) {
  // Parse app string - may contain param after slash (e.g., "art/nativity")
  const rawApp = open?.app || open?.open || open;
  const [app, paramFromApp] = typeof rawApp === 'string' ? rawApp.split('/') : [rawApp, null];
  const param = paramFromApp || open?.param || null;
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

  if (!entry) {
    return (
      <div>
        <h2>App Container</h2>
        <pre>{JSON.stringify({ app, param, open }, null, 2)}</pre>
      </div>
    );
  }

  const Component = lazy(entry.component);
  const appProps = { clear };
  if (entry.param?.name && param) {
    appProps[entry.param.name] = param;
  }

  return (
    <Suspense fallback={null}>
      <Component {...appProps} />
    </Suspense>
  );
}
