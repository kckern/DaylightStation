import React, { useState, useRef, useCallback } from 'react';
import { useFitnessContext } from "../context/FitnessContext.jsx";
import { getModule, getModuleManifest } from "../index.js";
import FitnessModuleErrorBoundary from "./FitnessModuleErrorBoundary.jsx";
import FitnessSidebar from "./FitnessSidebar.jsx";
import "./FitnessModuleContainer.scss";

const FitnessModuleContainer = ({ moduleId, mode = 'standalone', deviceId = null, onClose, config = {} }) => {
  const fitnessCtx = useFitnessContext();
  const ModuleComponent = getModule(moduleId);
  const manifest = getModuleManifest(moduleId);
  const [, setLoading] = useState(true);
  const closeGuardRef = useRef(null);
  const moduleIdRef = useRef(moduleId);
  moduleIdRef.current = moduleId;
  const registerCloseGuard = useCallback(guard => { closeGuardRef.current = guard; }, []);
  const requestClose = useCallback(async () => {
    const guard = closeGuardRef.current;
    if (!guard) { onClose?.(); return; }
    const result = await guard();
    if (result?.status === 'ok' && closeGuardRef.current === guard && moduleIdRef.current === moduleId) onClose?.();
  }, [moduleId, onClose]);

  if (!ModuleComponent) {
    return <div className="fitness-module-not-found">Module not found: {moduleId}</div>;
  }

  
  const content = (
    <FitnessModuleErrorBoundary
      moduleId={moduleId}
      manifest={manifest}
      sessionInstance={fitnessCtx.fitnessSessionInstance}
      onClose={requestClose}
    >
      <ModuleComponent
        mode={mode}
        registerCloseGuard={registerCloseGuard}
        onClose={requestClose}
        fitnessContext={fitnessCtx}
        deviceId={deviceId}
        config={config}
        onMount={() => setLoading(false)}
      />
    </FitnessModuleErrorBoundary>
  );

  if (manifest?.sidebar && mode !== 'minimal') {
    return (
      <div className={`fitness-module-container mode-${mode} has-sidebar`}>
        <div className="fitness-module-sidebar-layout">
          <div className="module-main-content">
            {content}
          </div>
          <div className="module-sidebar">
            <FitnessSidebar mode="module" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`fitness-module-container mode-${mode}`}>
      {content}
    </div>
  );
};

export default FitnessModuleContainer;
