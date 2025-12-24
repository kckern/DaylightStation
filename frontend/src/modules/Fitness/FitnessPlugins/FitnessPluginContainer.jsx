import React, { useState } from 'react';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import { getPlugin, getPluginManifest } from './index';
import FitnessPluginErrorBoundary from './FitnessPluginErrorBoundary.jsx';
import FitnessPluginLoader from './FitnessPluginLoader.jsx';
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

  return (
    <div className={`fitness-plugin-container mode-${mode}`}>
      <FitnessPluginErrorBoundary
        pluginId={pluginId}
        manifest={manifest}
        sessionInstance={fitnessCtx.fitnessSessionInstance}
        onClose={onClose}
      >
        {loading && <LoaderComponent />}
        <PluginComponent
          mode={mode}
          onClose={onClose}
          fitnessContext={fitnessCtx}
          config={config}
          onMount={() => setLoading(false)}
        />
      </FitnessPluginErrorBoundary>
    </div>
  );
};

export default FitnessPluginContainer;
