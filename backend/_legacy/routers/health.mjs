/**
 * Legacy Health Router Bridge
 *
 * This file now delegates to the new clean architecture implementation.
 * It maintains backward compatibility by providing the same endpoint interface.
 *
 * New implementation: backend/src/1_domains/health/
 * New router: backend/src/4_api/routers/health.mjs
 */

import express from 'express';
import moment from 'moment';
import { v4 as uuidv4 } from 'uuid';
import { userLoadFile } from '../lib/io.mjs';
import { configService } from '../lib/config/index.mjs';
import { createLogger } from '../lib/logging/logger.js';

// Import new architecture components
import { HealthAggregationService } from '../../src/1_domains/health/services/HealthAggregationService.mjs';
import { YamlHealthStore } from '../../src/2_adapters/persistence/yaml/YamlHealthStore.mjs';
import { userDataService } from '../../src/0_infrastructure/config/UserDataService.mjs';

const healthLogger = createLogger({ source: 'backend', app: 'health' });
const healthRouter = express.Router();

// Initialize new architecture components
let healthStore = null;
let healthService = null;

try {
    healthStore = new YamlHealthStore({
        userDataService,
        configService,
        logger: healthLogger
    });

    healthService = new HealthAggregationService({
        healthStore,
        logger: healthLogger
    });

    healthLogger.info('health.bridge.initialized', { architecture: 'new' });
} catch (error) {
    healthLogger.error('health.bridge.init.failed', { error: error.message });
}

// Stubbed nutribot functions (already stubbed in legacy)
const getNutriDaysBack = () => ({});
const getNutrilListByDate = () => [];
const getNutrilListByID = () => null;
const deleteNuriListById = () => ({ success: false });
const updateNutrilist = () => null;
const saveNutrilist = () => false;

// Default user for legacy single-user data access
const getDefaultUsername = () => {
    return configService.getHeadOfHousehold();
};

// JSON parsing middleware
healthRouter.use(express.json({ strict: false }));

// Error handling middleware
healthRouter.use((err, req, res, next) => {
    healthLogger.error('health.router.error', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method
    });
    res.status(500).json({ error: err.message });
});

// Async handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// =============================================================================
// Endpoints using NEW architecture
// =============================================================================

/**
 * GET /daily - Comprehensive daily health data (uses new architecture)
 */
healthRouter.get('/daily', asyncHandler(async (req, res) => {
    const days = parseInt(req.query.days) || 15;
    const username = getDefaultUsername();

    healthLogger.debug('health.daily.request', { username, days });

    if (healthService) {
        // Use new architecture
        const healthData = await healthService.aggregateDailyHealth(username, days, new Date());
        healthLogger.info('health.daily.success', { architecture: 'new' });
        return res.json({
            message: 'Daily health data retrieved successfully',
            data: healthData
        });
    }

    // Fallback to legacy (import dynamically to avoid circular deps)
    const dailyHealth = (await import('../lib/health.mjs')).default;
    const healthData = await dailyHealth();
    healthLogger.info('health.daily.success', { architecture: 'legacy' });
    res.json({
        message: 'Daily health data retrieved successfully',
        data: healthData
    });
}));

/**
 * GET /weight - Weight data (uses new architecture store)
 */
healthRouter.get('/weight', asyncHandler(async (req, res) => {
    const username = getDefaultUsername();

    if (healthStore) {
        const weightData = await healthStore.loadWeightData(username);
        return res.json({
            message: 'Weight data retrieved successfully',
            data: weightData
        });
    }

    // Fallback to legacy
    const weightData = userLoadFile(username, 'weight') || {};
    res.json({
        message: 'Weight data retrieved successfully',
        data: weightData
    });
}));

/**
 * GET /workouts - Strava workout data (uses new architecture store)
 */
healthRouter.get('/workouts', asyncHandler(async (req, res) => {
    const username = getDefaultUsername();

    if (healthStore) {
        const stravaData = await healthStore.loadStravaData(username);
        return res.json({
            message: 'Workout data retrieved successfully',
            data: stravaData
        });
    }

    // Fallback to legacy
    const stravaData = userLoadFile(username, 'strava') || {};
    res.json({
        message: 'Workout data retrieved successfully',
        data: stravaData
    });
}));

/**
 * GET /fitness - Fitness tracking data (uses new architecture store)
 */
healthRouter.get('/fitness', asyncHandler(async (req, res) => {
    const username = getDefaultUsername();

    if (healthStore) {
        const fitnessData = await healthStore.loadFitnessData(username);
        return res.json({
            message: 'Fitness data retrieved successfully',
            data: fitnessData
        });
    }

    // Fallback to legacy
    const fitnessData = userLoadFile(username, 'fitness') || {};
    res.json({
        message: 'Fitness data retrieved successfully',
        data: fitnessData
    });
}));

/**
 * GET /nutrition - Nutrition data (uses new architecture store)
 */
healthRouter.get('/nutrition', asyncHandler(async (req, res) => {
    const days = parseInt(req.query.days) || 30;
    const username = getDefaultUsername();

    if (healthStore) {
        const nutritionData = await healthStore.loadNutritionData(username);
        return res.json({
            message: 'Nutrition data retrieved successfully',
            data: nutritionData,
            days
        });
    }

    // Fallback to legacy stubbed function
    const { nutribot_chat_id } = process.env;
    if (!nutribot_chat_id) {
        return res.status(500).json({ error: 'Missing nutribot_chat_id environment variable' });
    }
    const nutritionData = getNutriDaysBack(nutribot_chat_id, days);
    res.json({
        message: 'Nutrition data retrieved successfully',
        data: nutritionData,
        days
    });
}));

/**
 * GET /coaching - Health coaching data (uses new architecture store)
 */
healthRouter.get('/coaching', asyncHandler(async (req, res) => {
    const username = getDefaultUsername();

    if (healthStore) {
        const coachingData = await healthStore.loadCoachingData(username);
        return res.json({
            message: 'Health coaching data retrieved successfully',
            data: coachingData
        });
    }

    // Fallback to legacy
    const coachingData = userLoadFile(username, 'health_coaching') || {};
    res.json({
        message: 'Health coaching data retrieved successfully',
        data: coachingData
    });
}));

// =============================================================================
// Legacy nutrilist CRUD endpoints (stubbed - kept for compatibility)
// =============================================================================

healthRouter.get('/nutrilist/:date', asyncHandler(async (req, res) => {
    const { date } = req.params;
    const { nutribot_chat_id } = process.env;

    if (!nutribot_chat_id) {
        return res.status(500).json({ error: 'Missing nutribot_chat_id environment variable' });
    }

    if (!date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const nutrilistData = getNutrilListByDate(nutribot_chat_id, date);
    res.json({
        message: 'Nutrilist items retrieved successfully',
        data: nutrilistData,
        date,
        count: nutrilistData.length
    });
}));

healthRouter.get('/nutrilist', asyncHandler(async (req, res) => {
    const today = moment().format('YYYY-MM-DD');
    const { nutribot_chat_id } = process.env;

    if (!nutribot_chat_id) {
        return res.status(500).json({ error: 'Missing nutribot_chat_id environment variable' });
    }

    const nutrilistData = getNutrilListByDate(nutribot_chat_id, today);
    res.json({
        message: "Today's nutrilist items retrieved successfully",
        data: nutrilistData,
        date: today,
        count: nutrilistData.length
    });
}));

healthRouter.get('/nutrilist/item/:uuid', asyncHandler(async (req, res) => {
    const { uuid } = req.params;
    const { nutribot_chat_id } = process.env;
    const item = getNutrilListByID(nutribot_chat_id, uuid);

    if (!item || Object.keys(item).length === 0) {
        return res.status(404).json({ error: 'Nutrilist item not found' });
    }

    res.json({
        message: 'Nutrilist item retrieved successfully',
        data: item
    });
}));

healthRouter.post('/nutrilist', asyncHandler(async (req, res) => {
    const { nutribot_chat_id } = process.env;
    const itemData = req.body;

    if (!itemData.item) {
        return res.status(400).json({ error: 'Item name is required' });
    }

    const newItem = {
        uuid: uuidv4(),
        item: itemData.item,
        unit: itemData.unit || 'g',
        amount: itemData.amount || null,
        noom_color: itemData.noom_color || 'blue',
        calories: itemData.calories || 0,
        fat: itemData.fat || 0,
        carbs: itemData.carbs || 0,
        protein: itemData.protein || 0,
        fiber: itemData.fiber || 0,
        sugar: itemData.sugar || 0,
        sodium: itemData.sodium || 0,
        cholesterol: itemData.cholesterol || 0,
        chat_id: nutribot_chat_id,
        date: itemData.date || moment().format('YYYY-MM-DD'),
        log_uuid: itemData.log_uuid || 'MANUAL'
    };

    const result = saveNutrilist([newItem], nutribot_chat_id);

    if (result) {
        res.status(201).json({
            message: 'Nutrilist item created successfully',
            data: newItem
        });
    } else {
        res.status(500).json({ error: 'Failed to create nutrilist item' });
    }
}));

healthRouter.put('/nutrilist/:uuid', asyncHandler(async (req, res) => {
    const { uuid } = req.params;
    const { nutribot_chat_id } = process.env;
    const updateData = req.body;

    const existingItem = getNutrilListByID(nutribot_chat_id, uuid);
    if (!existingItem || Object.keys(existingItem).length === 0) {
        return res.status(404).json({ error: 'Nutrilist item not found' });
    }

    const allowedFields = [
        'item', 'unit', 'amount', 'noom_color', 'calories', 'fat',
        'carbs', 'protein', 'fiber', 'sugar', 'sodium', 'cholesterol', 'date'
    ];
    const filteredUpdate = {};
    Object.keys(updateData).forEach(key => {
        if (allowedFields.includes(key)) {
            filteredUpdate[key] = updateData[key];
        }
    });

    const updatedItem = updateNutrilist(nutribot_chat_id, uuid, filteredUpdate);

    if (updatedItem) {
        res.json({
            message: 'Nutrilist item updated successfully',
            data: updatedItem
        });
    } else {
        res.status(500).json({ error: 'Failed to update nutrilist item' });
    }
}));

healthRouter.delete('/nutrilist/:uuid', asyncHandler(async (req, res) => {
    const { uuid } = req.params;
    const { nutribot_chat_id } = process.env;

    const existingItem = getNutrilListByID(nutribot_chat_id, uuid);
    if (!existingItem || Object.keys(existingItem).length === 0) {
        return res.status(404).json({ error: 'Nutrilist item not found' });
    }

    const result = deleteNuriListById(nutribot_chat_id, uuid);

    if (result.success) {
        res.json({
            message: 'Nutrilist item deleted successfully',
            uuid
        });
    } else {
        res.status(500).json({ error: 'Failed to delete nutrilist item' });
    }
}));

// =============================================================================
// Status endpoint
// =============================================================================

healthRouter.get('/status', asyncHandler(async (req, res) => {
    res.json({
        message: 'Health router is operational',
        timestamp: moment().toISOString(),
        architecture: healthService ? 'new' : 'legacy',
        endpoints: [
            '/daily - Get comprehensive daily health data',
            '/weight - Get weight tracking data',
            '/workouts - Get Strava workout data',
            '/fitness - Get fitness tracking data',
            '/nutrition - Get nutrition data (with optional ?days=N parameter)',
            '/coaching - Get health coaching messages',
            '/nutrilist - Get today\'s nutrilist items',
            '/nutrilist/:date - Get nutrilist items for specific date (YYYY-MM-DD)',
            '/nutrilist/item/:uuid - Get single nutrilist item by UUID',
            'POST /nutrilist - Create new nutrilist item',
            'PUT /nutrilist/:uuid - Update existing nutrilist item',
            'DELETE /nutrilist/:uuid - Delete nutrilist item',
            '/status - This endpoint'
        ]
    });
}));

export default healthRouter;

// Re-export new architecture components for direct usage
export { HealthAggregationService, YamlHealthStore };
