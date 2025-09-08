import express from 'express';
import { loadFile, saveFile } from './lib/io.mjs';
import { broadcastToWebsockets } from './websocket.js';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment-timezone';

const gratitudeRouter = express.Router();

// Route to send a new gratitude/desire item via WebSocket
// Usage: GET /api/gratitude/new?text=My custom gratitude item
gratitudeRouter.get('/new', (req, res) => {
    try {
        const { text } = req.query;
        
        if (!text) {
            return res.status(400).json({ 
                error: 'Missing required parameter: text' 
            });
        }

        // Create item object with unique ID and user input text
        const itemData = {
            id: Date.now(), // Use timestamp as unique ID
            text: text.trim()
        };

        // Create WebSocket payload
        const payload = {
            item: itemData,
            timestamp: new Date().toISOString(),
            type: 'gratitude_item',
            isCustom: true // Flag to indicate this is a custom user input
        };

        // Broadcast to WebSocket clients
        broadcastToWebsockets(payload);

        res.json({ 
            status: 'success',
            message: 'Custom item sent to gratitude selector',
            item: itemData,
            payload
        });
    } catch (error) {
        console.error('Error sending gratitude item:', error);
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
});

// Placeholder function for printer integration
export function getSelectionsForPrint() {
    // This function is referenced by printer.mjs
    // Return empty selections for now - can be implemented later
    return {
        gratitude: [],
        desires: []
    };
}

export default gratitudeRouter;
