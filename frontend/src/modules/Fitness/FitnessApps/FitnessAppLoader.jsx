import React from 'react';
import './FitnessAppLoader.scss';

const FitnessAppLoader = ({ message = 'Loading...' }) => (
  <div className="fitness-app-loader">
    <div className="loader-spinner" />
    <div className="loader-message">{message}</div>
  </div>
);

export default FitnessAppLoader;
