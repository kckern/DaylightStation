import React, { useState } from 'react';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import { getModule, getModuleManifest } from './index';
import FitnessModuleErrorBoundary from './FitnessModuleErrorBoundary.jsx';
import FitnessModuleLoader from './FitnessModuleLoader.jsx';
import FitnessSidebar from '../FitnessSidebar.jsx';
import './FitnessModuleContainer.scss';

const FitnessModuleContainer = ({ pluginId, mode = 'standalone', onClose, config = {} }) => {
  const fitnessCtx = useFitnessContext();
  const ModuleComponent = getModule(pluginId);
  const manifest = getModuleManifest(pluginId);
  const [loading, setLoading] = useState(true);

  if (!ModuleComponent) {
    return <div className="fitness-module-not-found">Module not found: {pluginId}</div>;
  }

  const LoaderComponent = manifest?.loading?.custom
    ? manifest.loading.component
    : FitnessModuleLoader;

  const content = (
    <FitnessModuleErrorBoundary
      pluginId={pluginId}
      manifest={manifest}
      sessionInstance={fitnessCtx.fitnessSessionInstance}
      onClose={onClose}
    >
      <ModuleComponent
        mode={mode}
        onClose={onClose}
        fitnessContext={fitnessCtx}
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
