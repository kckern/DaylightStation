import React from 'react';
import './FitnessPluginLoader.scss';

const FitnessPluginLoader = ({ message = 'Loading...' }) => (
  <div className="fitness-plugin-loader">
    <div className="loader-spinner" />
    <div className="loader-message">{message}</div>
  </div>
);

export default FitnessPluginLoader;
