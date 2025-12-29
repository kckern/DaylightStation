import express from 'express';
import dailyHealth from '../lib/health.mjs';
import { loadFile, userLoadFile } from '../lib/io.mjs';
import { userDataService } from '../lib/config/UserDataService.mjs';
import { configService } from '../lib/config/ConfigService.mjs';
// STUBBED: journalist folder removed
// import { getNutriDaysBack, getNutrilListByDate, getNutrilListByID, deleteNuriListById, updateNutrilist, saveNutrilist } from './journalist/lib/db.mjs';
const getNutriDaysBack = () => ({});
const getNutrilListByDate = () => [];
const getNutrilListByID = () => null;
const deleteNuriListById = () => ({ success: false });
const updateNutrilist = () => null;
const saveNutrilist = () => false;
import moment from 'moment';
import { v4 as uuidv4 } from 'uuid';

// Default user for legacy single-user data access
// TODO: Get from request context or authentication
const getDefaultUsername = () => {
  // Use head of household from config (never hardcode usernames)
  return configService.getHeadOfHousehold();
};

const healthRouter = express.Router();

// Middleware for JSON parsing
healthRouter.use(express.json({
    strict: false // Allows parsing of JSON with single-quoted property names
}));

// Middleware for error handling
healthRouter.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
});

// Get comprehensive health data (includes weight, workouts, nutrition)
healthRouter.get('/daily', async (req, res, next) => {
    try {
        const healthData = await dailyHealth();
        res.json({ 
            message: 'Daily health data retrieved successfully',
            data: healthData
        });
    } catch (error) {
        next(error);
    }
});

// Get weight data specifically
healthRouter.get('/weight', async (req, res, next) => {
    try {
        const username = getDefaultUsername();
        const weightData = userLoadFile(username, 'weight') || {};
        res.json({ 
            message: 'Weight data retrieved successfully',
            data: weightData
        });
    } catch (error) {
        next(error);
    }
});

// Get workout data (Strava)
healthRouter.get('/workouts', async (req, res, next) => {
    try {
        const username = getDefaultUsername();
        const stravaData = userLoadFile(username, 'strava') || {};
        res.json({ 
            message: 'Workout data retrieved successfully',
            data: stravaData
        });
    } catch (error) {
        next(error);
    }
});

// Get fitness data
healthRouter.get('/fitness', async (req, res, next) => {
    try {
        const username = getDefaultUsername();
        const fitnessData = userLoadFile(username, 'fitness') || {};
        res.json({ 
            message: 'Fitness data retrieved successfully',
            data: fitnessData
        });
    } catch (error) {
        next(error);
    }
});

// Get nutrition data
healthRouter.get('/nutrition', async (req, res, next) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const { nutribot_chat_id } = process.env;
        
        if (!nutribot_chat_id) {
            return res.status(500).json({ error: 'Missing nutribot_chat_id environment variable' });
        }
        
        const nutritionData = getNutriDaysBack(nutribot_chat_id, days);
        res.json({ 
            message: 'Nutrition data retrieved successfully',
            data: nutritionData,
            days: days
        });
    } catch (error) {
        next(error);
    }
});

// NUTRILIST CRUD ENDPOINTS

// GET all nutrilist items for a specific date
healthRouter.get('/nutrilist/:date', async (req, res, next) => {
    try {
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
            date: date,
            count: nutrilistData.length
        });
    } catch (error) {
        next(error);
    }
});

// GET nutrilist items for today (convenience endpoint)
healthRouter.get('/nutrilist', async (req, res, next) => {
    try {
        const today = moment().format('YYYY-MM-DD');
        const { nutribot_chat_id } = process.env;
        
        if (!nutribot_chat_id) {
            return res.status(500).json({ error: 'Missing nutribot_chat_id environment variable' });
        }
        
        const nutrilistData = getNutrilListByDate(nutribot_chat_id, today);
        res.json({ 
            message: 'Today\'s nutrilist items retrieved successfully',
            data: nutrilistData,
            date: today,
            count: nutrilistData.length
        });
    } catch (error) {
        next(error);
    }
});

// GET single nutrilist item by UUID
healthRouter.get('/nutrilist/item/:uuid', async (req, res, next) => {
    try {
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
    } catch (error) {
        next(error);
    }
});

// POST - Create new nutrilist item
healthRouter.post('/nutrilist', async (req, res, next) => {
    try {
        const { nutribot_chat_id } = process.env;
        const itemData = req.body;
        
        // Validate required fields
        if (!itemData.item) {
            return res.status(400).json({ error: 'Item name is required' });
        }
        
        // Set defaults and add metadata
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
    } catch (error) {
        next(error);
    }
});

// PUT - Update existing nutrilist item
healthRouter.put('/nutrilist/:uuid', async (req, res, next) => {
    try {
        const { uuid } = req.params;
        const { nutribot_chat_id } = process.env;
        const updateData = req.body;
        
        // Check if item exists
        const existingItem = getNutrilListByID(nutribot_chat_id, uuid);
        if (!existingItem || Object.keys(existingItem).length === 0) {
            return res.status(404).json({ error: 'Nutrilist item not found' });
        }
        
        // Filter out non-updatable fields
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
    } catch (error) {
        next(error);
    }
});

// DELETE nutrilist item
healthRouter.delete('/nutrilist/:uuid', async (req, res, next) => {
    try {
        const { uuid } = req.params;
        const { nutribot_chat_id } = process.env;
        
        // Check if item exists
        const existingItem = getNutrilListByID(nutribot_chat_id, uuid);
        if (!existingItem || Object.keys(existingItem).length === 0) {
            return res.status(404).json({ error: 'Nutrilist item not found' });
        }
        
        const result = deleteNuriListById(nutribot_chat_id, uuid);
        
        if (result.success) {
            res.json({ 
                message: 'Nutrilist item deleted successfully',
                uuid: uuid
            });
        } else {
            res.status(500).json({ error: 'Failed to delete nutrilist item' });
        }
    } catch (error) {
        next(error);
    }
});

// Get health coaching data
healthRouter.get('/coaching', async (req, res, next) => {
    try {
        const username = getDefaultUsername();
        const coachingData = userLoadFile(username, 'health_coaching') || {};
        res.json({ 
            message: 'Health coaching data retrieved successfully',
            data: coachingData
        });
    } catch (error) {
        next(error);
    }
});

// Health status endpoint
healthRouter.get('/status', async (req, res, next) => {
    try {
        res.json({ 
            message: 'Health router is operational',
            timestamp: moment().toISOString(),
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
    } catch (error) {
        next(error);
    }
});

export default healthRouter;
