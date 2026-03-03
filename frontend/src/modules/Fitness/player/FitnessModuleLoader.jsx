import React from 'react';
import './FitnessModuleLoader.scss';

const FitnessModuleLoader = ({ message = 'Loading...' }) => (
  <div className="fitness-module-loader">
    <div className="loader-spinner" />
    <div className="loader-message">{message}</div>
  </div>
);

export default FitnessModuleLoader;
