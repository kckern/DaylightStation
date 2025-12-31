import moment from 'moment';
import { userLoadFile, userLoadCurrent } from './io.mjs';
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
 * Load data from appropriate source (lifelog or current)
 * @param {string} username - The username
 * @param {Object} sourceConfig - Source configuration with dataSource and dataPath
 * @returns {Object|Array|null} The loaded data
 */
const loadDataForSource = (username, sourceConfig) => {
    const { dataSource, dataPath } = sourceConfig;
    
    if (dataSource === 'current') {
        return userLoadCurrent(username, dataPath);
    }
    // Default to lifelog for 'lifelog' or unspecified (backward compat)
    return userLoadFile(username, dataPath);
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
            const data = loadDataForSource(username, sourceConfig);
            let value = 0;
            let label = '';
            let lastUpdate = null;

            if (sourceConfig.metric === 'days_since') {
                // LIFELOG: For date-keyed data, find the most recent date
                if (data && typeof data === 'object' && !Array.isArray(data)) {
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
                // CURRENT: Check count from current/ data
                // Support both new structure (object with countField) and old structure (array)
                if (data && typeof data === 'object' && !Array.isArray(data)) {
                    // New structure: { lastUpdated, taskCount/unreadCount, tasks/messages }
                    const countField = sourceConfig.countField || 'count';
                    value = data[countField] ?? 0;
                    lastUpdate = data.lastUpdated ? moment(data.lastUpdated).format('YYYY-MM-DD') : null;
                } else if (Array.isArray(data)) {
                    // Legacy: array of items
                    value = data.length;
                    lastUpdate = moment().format('YYYY-MM-DD');
                } else {
                    value = 0;
                }
                
                // Generate label based on source type
                const itemName = sourceConfig.itemName || id;
                label = `${value} ${itemName}${value === 1 ? '' : 's'}`;
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
