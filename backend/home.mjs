import express from 'express';
const apiRouter = express.Router();


// Middleware for error handling
apiRouter.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: err.message });
});

apiRouter.get('/calendar',  async (req, res, next) => {
    return res.json({message: 'Hello from the calendar endpoint'});
});

apiRouter.get('/todo',  async (req, res, next) => {
    return res.json({message: 'Hello from the todo endpoint'});
});

export default apiRouter;