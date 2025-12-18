import express from 'express';
const JournalistRouter = express.Router();

// STUBBED: journalist folder removed
// All journalist endpoints are now disabled

JournalistRouter.all('*', async (req, res) => {
    return res.status(503).json({
        error: 'Journalist module has been removed',
        message: 'This functionality is no longer available'
    });
});

export default JournalistRouter;
