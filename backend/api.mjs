
import express from 'express';
import { processWebhookPayload } from './journalist/telegram_hook.mjs';
// Legacy foodlog_hook kept as fallback, but routing through new chatbots framework
import { processFoodLogHook } from './journalist/foodlog_hook.mjs';
import { foodReport, scanBarcode, canvasImageEndpoint } from './journalist/food_report.mjs';
import { updateWebhook } from './journalist/lib/telegram.mjs';
import imageHandler from './journalist/img.mjs';
import moment from 'moment-timezone';

// Import UPC lookup function from journalist
import { upcLookup } from './journalist/lib/upc.mjs';

// New chatbots framework
import { createNutribotRouter } from './chatbots/nutribot/server.mjs';
import { NutribotContainer } from './chatbots/nutribot/container.mjs';
import { getConfigProvider } from './chatbots/_lib/config/index.mjs';
import { UserResolver } from './chatbots/_lib/users/UserResolver.mjs';
import { TelegramGateway } from './chatbots/infrastructure/messaging/TelegramGateway.mjs';
import { OpenAIGateway } from './chatbots/infrastructure/ai/OpenAIGateway.mjs';
import { RealUPCGateway } from './chatbots/infrastructure/gateways/RealUPCGateway.mjs';
import { NutriLogRepository } from './chatbots/nutribot/repositories/NutriLogRepository.mjs';
import { NutriListRepository } from './chatbots/nutribot/repositories/NutriListRepository.mjs';
import { NutriCoachRepository } from './chatbots/nutribot/repositories/NutriCoachRepository.mjs';
import { FileConversationStateStore } from './chatbots/infrastructure/persistence/FileConversationStateStore.mjs';
import { CanvasReportRenderer } from './chatbots/adapters/http/CanvasReportRenderer.mjs';
import { createLogger } from './chatbots/_lib/logging/index.mjs';

const apiRouter = express.Router();
apiRouter.use(express.json({
    strict: false // Allows parsing of JSON with single-quoted property names
}));

// ==================== Dev Proxy Mode ====================
// When enabled, forwards all requests to LOCAL_DEV_HOST for rapid local development
let proxyMode = false;

async function proxyRequest(req, res) {
    const localDevHost = process.env.LOCAL_DEV_HOST;
    if (!localDevHost) {
        return res.status(500).json({ error: 'LOCAL_DEV_HOST not configured' });
    }
    
    const targetUrl = `http://${localDevHost}${req.originalUrl}`;
    console.log(`[PROXY] ${req.method} ${req.originalUrl} → ${targetUrl}`);
    
    try {
        const fetchOptions = {
            method: req.method,
            headers: {
                'content-type': req.headers['content-type'] || 'application/json',
                'x-telegram-bot-api-secret-token': req.headers['x-telegram-bot-api-secret-token'] || '',
                'x-forwarded-for': req.ip || req.headers['x-forwarded-for'] || '',
                'x-proxy-source': 'daylight-station-container',
            },
        };
        
        // Add body for non-GET requests
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
            fetchOptions.body = JSON.stringify(req.body);
        }
        
        const response = await fetch(targetUrl, fetchOptions);
        const contentType = response.headers.get('content-type') || '';
        
        // Set response status
        res.status(response.status);
        
        // Forward content-type header
        if (contentType) {
            res.set('content-type', contentType);
        }
        
        // Buffer and send response
        if (contentType.includes('application/json')) {
            const json = await response.json();
            return res.json(json);
        } else {
            const text = await response.text();
            return res.send(text);
        }
    } catch (error) {
        console.error(`[PROXY] Error forwarding to ${targetUrl}:`, error.message);
        return res.status(502).json({ 
            error: 'Proxy error', 
            message: error.message,
            targetUrl 
        });
    }
}

// Proxy toggle endpoint - must be before proxy middleware
apiRouter.all('/proxy_toggle', (req, res) => {
    proxyMode = !proxyMode;
    const localDevHost = process.env.LOCAL_DEV_HOST || 'not configured';
    console.log(`[PROXY] Mode toggled: ${proxyMode ? 'ON' : 'OFF'} → ${localDevHost}`);
    return res.status(200).json({
        proxyMode,
        targetHost: localDevHost,
        message: proxyMode 
            ? `Proxy ENABLED - all requests forwarding to http://${localDevHost}`
            : 'Proxy DISABLED - using local container handlers'
    });
});

// Proxy middleware - forwards all requests when proxyMode is enabled
apiRouter.use(async (req, res, next) => {
    // Skip proxy for the toggle endpoint itself
    if (req.path === '/proxy_toggle') {
        return next();
    }
    
    if (proxyMode) {
        return proxyRequest(req, res);
    }
    
    return next();
});

// Initialize NutriBot container with real dependencies
let nutribotRouter = null;
const initNutribotRouter = async () => {
    if (nutribotRouter) return nutribotRouter;
    
    const logger = createLogger({ source: 'api', app: 'nutribot' });
    
    try {
        const configProvider = getConfigProvider();
        const nutribotConfig = configProvider.getNutribotConfig();
        const chatbotsConfig = configProvider.get('chatbots');
        
        // Create UserResolver for username lookups
        const userResolver = new UserResolver(chatbotsConfig, { logger });
        
        // Get storage paths from config
        const storageConfig = chatbotsConfig?.data?.nutribot || {};
        const basePath = storageConfig.basePath || 'lifelog/nutrition';
        const paths = storageConfig.paths || {
            nutrilog: '{username}/nutrilog',
            nutrilist: '{username}/nutrilist',
            nutricursor: '{username}/nutricursor',
            nutriday: '{username}/nutriday',
            report_state: '{username}/report_state',
        };
        
        // Create a NutriBotConfig adapter with UserResolver-based paths
        const config = {
            ...nutribotConfig,
            storage: { basePath, paths },
            // Path getters that resolve username from conversationId
            getNutrilogPath: (userId) => {
                const username = userResolver.resolveUsername(userId) || userId;
                return `${basePath}/${paths.nutrilog.replace('{username}', username)}`;
            },
            getNutrilistPath: (userId) => {
                const username = userResolver.resolveUsername(userId) || userId;
                return `${basePath}/${paths.nutrilist.replace('{username}', username)}`;
            },
            getNutricursorPath: (userId) => {
                const username = userResolver.resolveUsername(userId) || userId;
                return `${basePath}/${paths.nutricursor.replace('{username}', username)}`;
            },
            getNutridayPath: (userId) => {
                const username = userResolver.resolveUsername(userId) || userId;
                return `${basePath}/${paths.nutriday.replace('{username}', username)}`;
            },
            getNutricoachPath: (userId) => {
                const username = userResolver.resolveUsername(userId) || userId;
                const coachPath = paths.nutricoach || '{username}/nutricoach';
                return `${basePath}/${coachPath.replace('{username}', username)}`;
            },
            getReportStatePath: (userId) => {
                const username = userResolver.resolveUsername(userId) || userId;
                return `${basePath}/${paths.report_state.replace('{username}', username)}`;
            },
            getStatePath: (userId) => {
                // Alias for conversation state (nutricursor)
                const username = userResolver.resolveUsername(userId) || userId;
                return `${basePath}/${paths.nutricursor.replace('{username}', username)}`;
            },
            // User settings methods
            getUserTimezone: (userId) => {
                // Get timezone from user config or default
                const username = userResolver.resolveUsername(userId);
                const users = chatbotsConfig?.users || {};
                const user = users[username];
                return user?.timezone || configProvider.get('weather')?.timezone || 'America/Los_Angeles';
            },
            getUserGoals: (userId) => {
                // Get goals from user config or defaults
                const username = userResolver.resolveUsername(userId);
                const users = chatbotsConfig?.users || {};
                const user = users[username];
                const defaults = {
                    calories: 2000,
                    protein: 150,
                    carbs: 200,
                    fat: 65,
                    fiber: 30,
                    sodium: 2300,
                };
                return { ...defaults, ...(user?.goals || {}) };
            },
        };
        
        logger.info('nutribot.config.paths', { basePath, paths, userCount: userResolver.getAllUsernames().length });
        
        // Create real infrastructure dependencies
        const aiGateway = new OpenAIGateway(
            { apiKey: configProvider.getOpenAIKey() },
            { logger }
        );
        
        const messagingGateway = new TelegramGateway(
            { token: nutribotConfig.telegram.token, botId: nutribotConfig.telegram.botId },
            { logger, aiGateway }  // Pass aiGateway for voice transcription
        );
        
        const upcGateway = new RealUPCGateway({
            upcLookup,  // Pass the journalist upcLookup function
            logger
        });
        
        const nutrilogRepository = new NutriLogRepository({
            config,
            logger
        });
        
        const nutrilistRepository = new NutriListRepository({
            config,
            logger
        });
        
        const nutricoachRepository = new NutriCoachRepository({
            config,
            logger
        });
        
        const conversationStateStore = new FileConversationStateStore({
            storePath: basePath,
            userResolver,
            logger
        });
        
        const reportRenderer = new CanvasReportRenderer({
            fontsPath: './backend/journalist/fonts',
            iconsPath: './backend/journalist/icons',
            logger
        });
        
        // Create container with dependencies
        const container = new NutribotContainer(config, {
            messagingGateway,
            aiGateway,
            upcGateway,
            nutrilogRepository,
            nutrilistRepository,
            nutricoachRepository,
            conversationStateStore,
            reportRenderer,
            logger
        });
        
        // Create router
        nutribotRouter = createNutribotRouter(container);
        logger.info('nutribot.router.initialized', { status: 'success' });
        return nutribotRouter;
    } catch (error) {
        logger.error('nutribot.router.init.failed', { error: error.message, stack: error.stack });
        // Fall back to legacy handler
        return null;
    }
};

const timezone = (req, res) => {
    const timezone = process.env.TIMEZONE || 'America/Los_Angeles';
    const today = moment().tz(timezone).format('YYYY-MM-DD');
    const dayOfWeek = moment().tz(timezone).format('dddd');
    const timeAMPM = moment().tz(timezone).format('h:mm a');
    const unix = moment().tz(timezone).unix();
    const momentTimezone = moment.tz.guess();
    res.status(200).json({
        timezone,
        today,
        dayOfWeek,
        timeAMPM,
        unix,
        momentTimezone
    });
}


apiRouter.all(  '/journalist',    processWebhookPayload);

// Route /foodlog to new chatbots framework (with fallback to legacy)
apiRouter.all('/foodlog', async (req, res, next) => {
    const body = req.body || {};
    const query = req.query || {};
    
    // Direct UPC input - route to new framework's /upc endpoint
    const upc = body.upc || query.upc;
    if (upc && !body.message && !body.callback_query && !body.update_id) {
        try {
            const router = await initNutribotRouter();
            if (router) {
                req.url = '/upc';
                return router(req, res, next);
            }
        } catch (error) {
            console.error('NutriBot UPC handler error, falling back to legacy:', error.message);
        }
        return processFoodLogHook(req, res);
    }
    
    // Direct image URL input - route to new framework's /image endpoint
    const imgUrl = body.img_url || query.img_url;
    if (imgUrl && !body.message && !body.callback_query) {
        try {
            const router = await initNutribotRouter();
            if (router) {
                req.url = '/image';
                return router(req, res, next);
            }
        } catch (error) {
            console.error('NutriBot image handler error, falling back to legacy:', error.message);
        }
        return processFoodLogHook(req, res);
    }
    
    // Direct text input - route to new framework's /text endpoint
    const text = body.text || query.text;
    if (text && !body.message && !body.callback_query && !body.update_id) {
        try {
            const router = await initNutribotRouter();
            if (router) {
                req.url = '/text';
                return router(req, res, next);
            }
        } catch (error) {
            console.error('NutriBot text handler error, falling back to legacy:', error.message);
        }
        return processFoodLogHook(req, res);
    }
    
    // Telegram webhook payloads go through new framework
    try {
        const router = await initNutribotRouter();
        if (router) {
            // Rewrite path for the subrouter (expects /webhook)
            req.url = '/webhook';
            return router(req, res, next);
        }
    } catch (error) {
        console.error('NutriBot router error, falling back to legacy:', error.message);
    }
    // Fallback to legacy handler
    return processFoodLogHook(req, res);
});

apiRouter.all(  '/foodreport',    foodReport);
apiRouter.all(  '/nutribot/images/:param1/:param2/:param3?', canvasImageEndpoint);
//add a handler for processImageUrl?
apiRouter.all(  '/telegram/img',        imageHandler);
apiRouter.all(  '/barcode',         scanBarcode);
apiRouter.all(  '/time',         timezone);
apiRouter.all('/:env(dev|prod)', async (req, res) => {
    const env = req.params.env;
    const journalistHook = env === 'dev' ? process.env.journalist.journalist_dev_hook : process.env.journalist.journalist_prod_hook;
    const nutribotHook = env === 'dev' ? process.env.journalist.nutribot_dev_hook : process.env.journalist.nutribot_prod_hook;

    const journalistWebhookResult = await updateWebhook(process.env.TELEGRAM_JOURNALIST_BOT_TOKEN, journalistHook);
    //wait 2 seconds to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
    const nutribotWebhookResult = await updateWebhook(process.env.TELEGRAM_NUTRIBOT_TOKEN, nutribotHook);

    res.status(200).json({ 
        message: `${env.charAt(0).toUpperCase() + env.slice(1)} webhooks updated successfully.`,
        results: {
            journalistWebhook: journalistWebhookResult,
            nutribotWebhook: nutribotWebhookResult
        }
    });
});
apiRouter.all(  '/*',        async (req, res) => {
    return res.status(404).json({error: `Invalid endpoint. You tried to access ${req.method} ${req.originalUrl} but this endpoint does not exist. `});
});


export default apiRouter;