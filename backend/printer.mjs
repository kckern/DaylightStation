import express from 'express';
import { thermalPrint, createTextPrint, createImagePrint, createReceiptPrint } from './lib/thermalprint.mjs';

const printerRouter = express.Router();

// Printer endpoints
printerRouter.get('/', (req, res) => {
    res.json({
        message: 'Thermal Printer API',
        status: 'success',
        endpoints: {
            'GET /': 'This help message',
            'POST /text': 'Print text with optional formatting',
            'POST /image': 'Print image from path or URL',
            'POST /receipt': 'Print receipt-style document',
            'POST /print': 'Print custom print job object'
        }
    });
});

// Print simple text
printerRouter.post('/text', async (req, res) => {
    try {
        const { text, options = {} } = req.body;
        
        if (!text) {
            return res.status(400).json({ error: 'Text is required' });
        }
        
        const printJob = createTextPrint(text, options);
        const success = await thermalPrint(printJob);
        
        res.json({
            success,
            message: success ? 'Text printed successfully' : 'Print failed',
            printJob
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Print image
printerRouter.post('/image', async (req, res) => {
    try {
        const { path, options = {} } = req.body;

        const imgpath = path || `${process.env.path.img}/bw/logo.png`;

        const printJob = createImagePrint(imgpath, options);
        const success = await thermalPrint(printJob);
        
        res.json({
            success,
            message: success ? 'Image printed successfully' : 'Print failed',
            printJob
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Print receipt
printerRouter.post('/receipt', async (req, res) => {
    try {
        const receiptData = req.body;
        
        if (!receiptData) {
            return res.status(400).json({ error: 'Receipt data is required' });
        }
        
        const printJob = createReceiptPrint(receiptData);
        const success = await thermalPrint(printJob);
        
        res.json({
            success,
            message: success ? 'Receipt printed successfully' : 'Print failed',
            printJob
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Print custom job
printerRouter.post('/print', async (req, res) => {
    try {
        const printObject = req.body;
        
        if (!printObject || !printObject.items) {
            return res.status(400).json({ error: 'Valid print object with items array is required' });
        }
        
        const success = await thermalPrint(printObject);
        
        res.json({
            success,
            message: success ? 'Print job completed successfully' : 'Print failed',
            printObject
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default printerRouter;
