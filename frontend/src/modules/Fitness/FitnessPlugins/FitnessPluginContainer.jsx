import React, { useState } from 'react';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import { getPlugin, getPluginManifest } from './index';
import FitnessPluginErrorBoundary from './FitnessPluginErrorBoundary.jsx';
import FitnessPluginLoader from './FitnessPluginLoader.jsx';
import FitnessSidebar from '../FitnessSidebar.jsx';
import './FitnessPluginContainer.scss';

const FitnessPluginContainer = ({ pluginId, mode = 'standalone', onClose, config = {} }) => {
  const fitnessCtx = useFitnessContext();
  const PluginComponent = getPlugin(pluginId);
  const manifest = getPluginManifest(pluginId);
  const [loading, setLoading] = useState(true);

  if (!PluginComponent) {
    return <div className="fitness-plugin-not-found">Plugin not found: {pluginId}</div>;
  }

  const LoaderComponent = manifest?.loading?.custom
    ? manifest.loading.component
    : FitnessPluginLoader;

  const content = (
    <FitnessPluginErrorBoundary
      pluginId={pluginId}
      manifest={manifest}
      sessionInstance={fitnessCtx.fitnessSessionInstance}
      onClose={onClose}
    >
      <PluginComponent
        mode={mode}
        onClose={onClose}
        fitnessContext={fitnessCtx}
        config={config}
        onMount={() => setLoading(false)}
      />
    </FitnessPluginErrorBoundary>
  );

  if (manifest?.sidebar && mode !== 'minimal') {
    return (
      <div className={`fitness-plugin-container mode-${mode} has-sidebar`}>
        <div className="fitness-plugin-sidebar-layout">
          <div className="plugin-main-content">
            {content}
          </div>
          <div className="plugin-sidebar">
            <FitnessSidebar mode="plugin" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`fitness-plugin-container mode-${mode}`}>
      {content}
    </div>
  );
};

export default FitnessPluginContainer;
