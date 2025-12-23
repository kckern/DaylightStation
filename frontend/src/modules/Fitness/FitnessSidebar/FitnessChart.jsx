import React from 'react';
import FitnessChartApp from '../FitnessApps/apps/FitnessChartApp/index.jsx';

// Re-export helpers for backward compatibility
export {
	MIN_VISIBLE_TICKS,
	ZONE_COLOR_MAP,
	buildBeatsSeries,
	buildSegments,
	createPaths
} from './FitnessChart.helpers.js';

const FitnessChart = () => {
	return <FitnessChartApp mode="sidebar" onClose={() => {}} />;
};

export default FitnessChart;
