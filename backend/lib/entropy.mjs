import moment from 'moment';
import { userLoadFile, userLoadCurrent, userLoadProfile } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import { createLogger } from './logging/logger.js';
import ArchiveService from './ArchiveService.mjs';

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
 * For archive-enabled services with days_since metric, uses fast path
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
 * Fast path for archive-enabled services: get most recent timestamp without loading full file
 * @param {string} username - The username
 * @param {string} service - Service name (dataPath)
 * @returns {Object|null} { timestamp, date, data } or null
 */
const getArchiveFastPath = (username, service) => {
    if (!ArchiveService.isArchiveEnabled(service)) {
        return null;
    }
    return ArchiveService.getMostRecentTimestamp(username, service);
};

/**
 * Get entropy report for all configured sources
 * @returns {Promise<Object>} Entropy report
 */
export const getEntropyReport = async () => {
    const username = getDefaultUsername();
    const profile = userLoadProfile(username);
    const config = profile?.apps?.entropy || configService.getAppConfig('entropy');
    
    if (!config || !config.sources) {
        entropyLogger.warn('entropy.config.missing');
        return { items: [], summary: { green: 0, yellow: 0, red: 0 } };
    }

    const items = [];
    const summary = { green: 0, yellow: 0, red: 0 };

    // Process all sources in parallel for better performance
    const sourceEntries = Object.entries(config.sources);
    const results = await Promise.all(
        sourceEntries.map(async ([id, sourceConfig]) => {
            try {
                let value = 0;
                let label = '';
                let lastUpdate = null;
                let lastItem = null;

                if (sourceConfig.metric === 'days_since') {
                    // FAST PATH: For archive-enabled services, use getMostRecentTimestamp
                    // This reads only the hot storage file and gets the first entry
                    const fastResult = getArchiveFastPath(username, sourceConfig.dataPath);
                    
                    if (fastResult) {
                        // Archive fast path succeeded
                        const lastDateOnly = moment.unix(fastResult.timestamp).format('YYYY-MM-DD');
                        const todayOnly = moment().format('YYYY-MM-DD');
                        const daysDiff = moment(todayOnly).diff(moment(lastDateOnly), 'days');
                        
                        value = Math.max(0, daysDiff);
                        label = value === 0 ? 'Today' : `${value} day${value === 1 ? '' : 's'} ago`;
                        lastUpdate = fastResult.date;
                        lastItem = fastResult.data;
                    } else {
                        // SLOW PATH: Load full data for non-archive services
                        const data = loadDataForSource(username, sourceConfig);
                        let lastDate = null;
                        let itemsToProcess = data;

                // Handle nested list property (e.g. { messages: [...] })
                if (sourceConfig.listProperty && data && data[sourceConfig.listProperty]) {
                    itemsToProcess = data[sourceConfig.listProperty];
                }

                // Handle filtering
                if (sourceConfig.filter && Array.isArray(itemsToProcess)) {
                    itemsToProcess = itemsToProcess.filter(item => {
                        const { field, operator, value } = sourceConfig.filter;
                        const itemValue = item[field];
                        if (operator === 'ne') return itemValue !== value;
                        if (operator === 'eq') return itemValue === value;
                        return true;
                    });
                }

                if (Array.isArray(itemsToProcess)) {
                    // Array of objects - find max date in specified field
                    const dateField = sourceConfig.dateField || 'date';
                    const validItems = itemsToProcess.filter(item => item && item[dateField]);
                    
                    if (validItems.length > 0) {
                        // Sort by date descending - use format array to handle both ISO and human-readable dates
                        const dateFormats = ['YYYY-MM-DD', 'DD MMM YYYY, HH:mm', moment.ISO_8601];
                        validItems.sort((a, b) => moment(b[dateField], dateFormats).diff(moment(a[dateField], dateFormats)));
                        lastDate = validItems[0][dateField];
                        lastItem = validItems[0];
                    }
                } else if (itemsToProcess && typeof itemsToProcess === 'object') {
                    let dates = Object.keys(itemsToProcess);
                    
                    // Filter out invalid date keys (must be YYYY-MM-DD format)
                    const validDateRegex = /^\d{4}-\d{2}-\d{2}$/;
                    dates = dates.filter(d => validDateRegex.test(d));
                    
                    dates.sort((a, b) => moment(b).diff(moment(a)));

                    // Iterate sorted dates to find the first one that matches criteria
                    for (const date of dates) {

                        const dayData = itemsToProcess[date];
                        if (!dayData) continue;

                        if (Array.isArray(dayData)) {
                            // Array of items for this day (e.g. todoist, clickup)
                            if (sourceConfig.filter) {
                                const match = dayData.find(item => {
                                    const { field, operator, value } = sourceConfig.filter;
                                    const itemValue = item[field];
                                    if (operator === 'ne') return itemValue !== value;
                                    if (operator === 'eq') return itemValue === value;
                                    return true;
                                });
                                if (match) {
                                    lastDate = date;
                                    lastItem = match;
                                    break;
                                }
                            } else {
                                // No filter, just existence - take the last one (assuming chronological order in array or just taking one)
                                lastDate = date;
                                lastItem = dayData[dayData.length - 1];
                                break;
                            }
                        } else {
                            // Object data (e.g. weight, fitness)
                            // If checkField is specified, ensure it exists
                            if (sourceConfig.checkField) {
                                if (dayData[sourceConfig.checkField] !== undefined) {
                                    lastDate = date;
                                    lastItem = dayData;
                                    break;
                                }
                            } else if (dayData.measurement !== undefined) {
                                // Legacy support for weight
                                lastDate = date;
                                lastItem = dayData;
                                break;
                            } else {
                                // Default: just existence of key is enough
                                lastDate = date;
                                lastItem = dayData;
                                break;
                            }
                        }
                    }
                }

                if (lastDate) {
                    lastUpdate = lastDate;

                    // Use date-only comparison to avoid timestamp precision issues
                    // Support multiple date formats (ISO, human-readable)
                    const dateFormats = ['YYYY-MM-DD', 'DD MMM YYYY, HH:mm', moment.ISO_8601];
                    const lastDateOnly = moment(lastDate, dateFormats).format('YYYY-MM-DD');
                    const todayOnly = moment().format('YYYY-MM-DD');
                    const daysDiff = moment(todayOnly).diff(moment(lastDateOnly), 'days');
                    
                    value = Math.max(0, daysDiff);
                    label = value === 0 ? 'Today' : `${value} day${value === 1 ? '' : 's'} ago`;

                } else {
                    value = 999; // No data
                    label = 'No data';
                }
            } // End of else (slow path) block
            } else if (sourceConfig.metric === 'count') {
                // CURRENT: Check count from current/ data
                const data = loadDataForSource(username, sourceConfig);
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

            let url = null;
            if (sourceConfig.url) {
                url = sourceConfig.url;
                if (lastItem) {
                    url = url.replace(/{(\w+)}/g, (_, key) => lastItem[key] || '');
                }
            } else if (lastItem && lastItem.url) {
                url = lastItem.url;
            }

            const status = calculateStatus(value, sourceConfig.thresholds);

            return {
                id,
                name: sourceConfig.name,
                icon: sourceConfig.icon,
                status,
                value,
                label,
                lastUpdate,
                url
            };
        } catch (error) {
            entropyLogger.error('entropy.calculation.error', { source: id, error: error.message });
            return {
                id,
                name: sourceConfig.name,
                icon: sourceConfig.icon,
                status: 'red',
                value: -1,
                label: 'Error',
                error: true
            };
        }
    })
    );

    // Build summary from results
    results.forEach(item => {
        items.push(item);
        summary[item.status]++;
    });

    return { items, summary };
};
