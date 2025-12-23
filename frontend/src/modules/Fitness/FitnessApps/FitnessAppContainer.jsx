import React, { useState } from 'react';
import { useFitnessContext } from '../../../context/FitnessContext.jsx';
import { getApp, getAppManifest } from './index';
import FitnessAppErrorBoundary from './FitnessAppErrorBoundary.jsx';
import FitnessAppLoader from './FitnessAppLoader.jsx';
import './FitnessAppContainer.scss';

const FitnessAppContainer = ({ appId, mode = 'standalone', onClose, config = {} }) => {
  const fitnessCtx = useFitnessContext();
  const AppComponent = getApp(appId);
  const manifest = getAppManifest(appId);
  const [loading, setLoading] = useState(true);

  if (!AppComponent) {
    return <div className="fitness-app-not-found">App not found: {appId}</div>;
  }

  const LoaderComponent = manifest?.loading?.custom
    ? manifest.loading.component
    : FitnessAppLoader;

  return (
    <div className={`fitness-app-container mode-${mode}`}>
      {mode !== 'sidebar' && mode !== 'mini' && (
        <div className="fitness-app-header">
          <span className="app-title">{manifest?.name || appId}</span>
          <button className="app-close-btn" onClick={onClose}>×</button>
        </div>
      )}
      <FitnessAppErrorBoundary
        appId={appId}
        manifest={manifest}
        sessionInstance={fitnessCtx.fitnessSessionInstance}
        onClose={onClose}
      >
        {loading && <LoaderComponent />}
        <AppComponent
          mode={mode}
          onClose={onClose}
          fitnessContext={fitnessCtx}
          config={config}
          onMount={() => setLoading(false)}
        />
      </FitnessAppErrorBoundary>
    </div>
  );
};

export default FitnessAppContainer;
