import moment from 'moment';
import { userLoadFile } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import { createLogger } from './logging/logger.js';

const entropyLogger = createLogger({
    source: 'backend',
    app: 'entropy'
});

const getDefaultUsername = () => configService.getHeadOfHousehold();

/**
 * Calculate status based on value and thresholds
 * @param {number} value - The metric value
 * @param {Object} thresholds - Threshold configuration
 * @returns {string} 'green', 'yellow', or 'red'
 */
const calculateStatus = (value, thresholds) => {
    if (value <= thresholds.green) return 'green';
    if (value <= thresholds.yellow) return 'yellow';
    return 'red';
};

/**
 * Get entropy report for all configured sources
 * @returns {Promise<Object>} Entropy report
 */
export const getEntropyReport = async () => {
    const config = configService.getAppConfig('entropy');
    const username = getDefaultUsername();
    
    if (!config || !config.sources) {
        entropyLogger.warn('entropy.config.missing');
        return { items: [], summary: { green: 0, yellow: 0, red: 0 } };
    }

    const items = [];
    const summary = { green: 0, yellow: 0, red: 0 };

    for (const [id, sourceConfig] of Object.entries(config.sources)) {
        try {
            const data = userLoadFile(username, sourceConfig.dataPath);
            let value = 0;
            let label = '';
            let lastUpdate = null;

            if (sourceConfig.metric === 'days_since') {
                // For weight, data is an object with date keys
                // We need to find the most recent date
                if (data && typeof data === 'object') {
                    let dates = Object.keys(data);

                    // Special handling for weight data which forward-fills entries
                    // Real entries have a 'measurement' property
                    const hasMeasurements = dates.some(d => data[d] && data[d].measurement !== undefined);
                    if (hasMeasurements) {
                        dates = dates.filter(d => data[d] && data[d].measurement !== undefined);
                    }

                    dates.sort((a, b) => moment(b).diff(moment(a)));
                    const lastDate = dates[0];
                    
                    if (lastDate) {
                        lastUpdate = lastDate;
                        const daysDiff = moment().diff(moment(lastDate), 'days');
                        value = Math.max(0, daysDiff);
                        label = value === 0 ? 'Today' : `${value} day${value === 1 ? '' : 's'} ago`;
                    } else {
                        value = 999; // No data
                        label = 'No data';
                    }
                } else {
                    value = 999;
                    label = 'No data';
                }
            } else if (sourceConfig.metric === 'count') {
                // For gmail, data is an array of messages
                if (Array.isArray(data)) {
                    value = data.length;
                    label = `${value} email${value === 1 ? '' : 's'}`;
                    lastUpdate = moment().format('YYYY-MM-DD'); // Assumed fresh if file exists
                } else {
                    value = 0;
                    label = '0 emails';
                }
            }

            const status = calculateStatus(value, sourceConfig.thresholds);
            summary[status]++;

            items.push({
                id,
                name: sourceConfig.name,
                icon: sourceConfig.icon,
                status,
                value,
                label,
                lastUpdate
            });
        } catch (error) {
            entropyLogger.error('entropy.calculation.error', { source: id, error: error.message });
            items.push({
                id,
                name: sourceConfig.name,
                icon: sourceConfig.icon,
                status: 'red',
                value: -1,
                label: 'Error',
                error: true
            });
            summary.red++;
        }
    }

    return { items, summary };
};
