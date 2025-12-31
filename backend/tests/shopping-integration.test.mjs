/**
 * Integration Tests for Shopping Harvester
 * 
 * These tests verify end-to-end functionality including actual file output.
 * Exit criteria: shopping.yml file is created in users/{username}/lifelog/
 * 
 * WRITES TO PRODUCTION DATA DIRECTORY - reads config from production mounts
 * 
 * @module tests/shopping-integration.test
 */

import { jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Read from dev mount which mirrors production structure
const DEV_MOUNT_BASE = '/Volumes/mounts/DockerDrive/Docker/DaylightStation';
const PROD_DATA_DIR = path.join(DEV_MOUNT_BASE, 'data');
const PROD_CONFIG_DIR = path.join(DEV_MOUNT_BASE, 'config');

// Load config from production config files
const loadProdConfig = () => {
    const appConfig = yaml.load(fs.readFileSync(path.join(PROD_CONFIG_DIR, 'config.app.yml'), 'utf8')) || {};
    const localConfig = yaml.load(fs.readFileSync(path.join(PROD_CONFIG_DIR, 'config.app-local.yml'), 'utf8')) || {};
    return { ...appConfig, ...localConfig };
};

// Get head of household from production household config
const getHeadOfHousehold = () => {
    const householdConfig = yaml.load(
        fs.readFileSync(path.join(PROD_DATA_DIR, 'households/default/household.yml'), 'utf8')
    );
    return householdConfig?.head || 'kckern';
};

// Store original env
const originalEnv = { ...process.env };
const originalPath = process.env.path;

// Mock googleapis with realistic responses
const mockGmailMessages = {
    list: jest.fn(),
    get: jest.fn()
};

jest.unstable_mockModule('googleapis', () => ({
    google: {
        auth: {
            OAuth2: jest.fn().mockImplementation(() => ({
                setCredentials: jest.fn()
            }))
        },
        gmail: jest.fn().mockReturnValue({
            users: {
                messages: mockGmailMessages
            }
        })
    }
}));

jest.unstable_mockModule('../lib/logging/logger.js', () => ({
    createLogger: () => ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    })
}));

// Mock AI gateway with realistic extraction
const mockChatWithJson = jest.fn();
jest.unstable_mockModule('../lib/ai/index.mjs', () => ({
    getAIGateway: jest.fn(() => ({
        chatWithJson: mockChatWithJson
    })),
    systemMessage: (content) => ({ role: 'system', content }),
    userMessage: (content) => ({ role: 'user', content })
}));

describe('Shopping Harvester Integration - PRODUCTION Output', () => {
    let harvestShopping;
    let shoppingFile;
    let testUser;
    let prodConfig;

    beforeAll(async () => {
        // Verify production mount is accessible
        if (!fs.existsSync(PROD_DATA_DIR)) {
            throw new Error(`Production data directory not mounted: ${PROD_DATA_DIR}`);
        }

        // Load config from production
        prodConfig = loadProdConfig();
        testUser = getHeadOfHousehold();
        
        shoppingFile = path.join(PROD_DATA_DIR, 'users', testUser, 'lifelog', 'shopping.yml');
        
        // Ensure lifelog directory exists
        const lifelogDir = path.dirname(shoppingFile);
        if (!fs.existsSync(lifelogDir)) {
            fs.mkdirSync(lifelogDir, { recursive: true });
        }

        // Set process.env.path to PRODUCTION data dir
        process.env.path = { data: PROD_DATA_DIR };
        
        // Use production Google OAuth config (or test fallbacks)
        process.env.GOOGLE_CLIENT_ID = prodConfig.GOOGLE_CLIENT_ID || 'test-client-id';
        process.env.GOOGLE_CLIENT_SECRET = prodConfig.GOOGLE_CLIENT_SECRET || 'test-secret';
        process.env.GOOGLE_REDIRECT_URI = prodConfig.GOOGLE_REDIRECT_URI || 'http://localhost/callback';
        process.env.OPENAI_API_KEY = prodConfig.OPENAI_API_KEY || 'test-key';

        // Import the module after env is configured
        const module = await import('../lib/shopping.mjs');
        harvestShopping = module.default;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        
        // Clean up any existing shopping.yml before each test
        if (fs.existsSync(shoppingFile)) {
            fs.unlinkSync(shoppingFile);
        }
    });

    afterAll(() => {
        // Restore original env
        process.env = originalEnv;
        process.env.path = originalPath;
    });

    /**
     * Helper to create a mock Gmail message
     */
    function createMockMessage(id, from, subject, body, date = 'Mon, 30 Dec 2025 10:00:00 -0600') {
        return {
            id,
            threadId: `thread_${id}`,
            snippet: body.substring(0, 100),
            payload: {
                mimeType: 'text/plain',
                headers: [
                    { name: 'Subject', value: subject },
                    { name: 'From', value: from },
                    { name: 'Date', value: date }
                ],
                body: {
                    data: Buffer.from(body).toString('base64')
                }
            }
        };
    }

    it('should create shopping.yml in PRODUCTION data directory', async () => {
        // Setup Gmail mock
        mockGmailMessages.list.mockResolvedValue({
            data: {
                messages: [{ id: 'amazon_msg_1' }]
            }
        });

        mockGmailMessages.get.mockResolvedValue({
            data: createMockMessage(
                'amazon_msg_1',
                'shipment-tracking@amazon.com',
                'Your Amazon.com order has shipped!',
                `Order #112-1234567-8901234
                
                USB-C Cable 6ft (2 pack) - $19.98
                Qty: 2 @ $9.99 each
                
                Subtotal: $19.98
                Tax: $1.65
                Total: $21.63`,
                'Wed, 25 Dec 2025 14:30:00 -0600'
            )
        });

        // Setup AI mock
        mockChatWithJson.mockResolvedValue({
            merchant: 'Amazon.com',
            order_id: '112-1234567-8901234',
            date: '2025-12-25',
            time: '14:30',
            items: [
                {
                    name: 'USB-C Cable 6ft (2 pack)',
                    quantity: 2,
                    unit_price: 9.99,
                    total_price: 19.98
                }
            ],
            subtotal: 19.98,
            tax: 1.65,
            shipping: 0,
            total: 21.63,
            currency: 'USD'
        });

        // Execute harvest
        const result = await harvestShopping(null, 'test-guid', {});

        // Verify the function returned success
        expect(result.success).toBe(true);
        expect(result.receipts.new).toBe(1);

        // EXIT CRITERIA: Verify shopping.yml file was created in PRODUCTION
        console.log(`\n=== PRODUCTION FILE PATH ===`);
        console.log(shoppingFile);
        expect(fs.existsSync(shoppingFile)).toBe(true);

        // Read and parse the file
        const fileContent = fs.readFileSync(shoppingFile, 'utf8');
        const data = yaml.load(fileContent);

        // PROOF: Output the actual file content
        console.log('\n=== PRODUCTION shopping.yml ===');
        console.log(fileContent);
        console.log('=== END ===\n');

        // Verify file structure
        expect(data).toHaveProperty('meta');
        expect(data).toHaveProperty('receipts');
        expect(data.meta.totalReceipts).toBe(1);
        expect(data.meta.timezone).toBe('America/Chicago');

        // Verify receipt data
        expect(data.receipts).toHaveLength(1);
        expect(data.receipts[0].merchant).toBe('Amazon.com');
        expect(data.receipts[0].total).toBe(21.63);
    });
});

/**
 * REAL BACKFILL TEST - Uses actual Gmail and OpenAI APIs
 * Run with: npm test -- backend/tests/shopping-integration.test.mjs -t "REAL BACKFILL"
 */
describe('Shopping Harvester - REAL BACKFILL from Dec 1', () => {
    it.skip('REAL BACKFILL - fetches actual emails from Dec 1, 2025', async () => {
        // This test uses REAL APIs - no mocks
        // Remove .skip to run it
        
        const DEV_MOUNT_BASE = '/Volumes/mounts/DockerDrive/Docker/DaylightStation';
        const PROD_DATA_DIR = `${DEV_MOUNT_BASE}/data`;
        const PROD_CONFIG_DIR = `${DEV_MOUNT_BASE}/config`;
        
        // Load real secrets
        const secretsConfig = yaml.load(fs.readFileSync(`${PROD_CONFIG_DIR}/config.secrets.yml`, 'utf8')) || {};
        const appConfig = yaml.load(fs.readFileSync(`${PROD_CONFIG_DIR}/config.app-local.yml`, 'utf8')) || {};
        const config = { ...appConfig, ...secretsConfig };
        
        // Get head of household
        const householdConfig = yaml.load(fs.readFileSync(`${PROD_DATA_DIR}/households/default/household.yml`, 'utf8'));
        const testUser = householdConfig?.head || 'kckern';
        
        // Set real env
        process.env.path = { data: PROD_DATA_DIR };
        process.env.GOOGLE_CLIENT_ID = config.GOOGLE_CLIENT_ID;
        process.env.GOOGLE_CLIENT_SECRET = config.GOOGLE_CLIENT_SECRET;
        process.env.GOOGLE_REDIRECT_URI = config.GOOGLE_REDIRECT_URI;
        process.env.OPENAI_API_KEY = config.OPENAI_API_KEY;
        
        // Import real module (no mocks)
        const { default: harvestShopping } = await import('../lib/shopping.mjs');
        
        // Execute with backfill from Dec 1
        const result = await harvestShopping(null, 'backfill-dec1', {
            query: { 
                full: 'true',
                since: '2025-12-01'
            }
        });
        
        console.log('\n=== REAL BACKFILL RESULT ===');
        console.log(JSON.stringify(result, null, 2));
        
        const shoppingFile = `${PROD_DATA_DIR}/users/${testUser}/lifelog/shopping.yml`;
        const fileContent = fs.readFileSync(shoppingFile, 'utf8');
        console.log('\n=== REAL shopping.yml ===');
        console.log(fileContent);
        
        expect(result.success).toBe(true);
    }, 120000); // 2 minute timeout for real API calls
});
