/**
 * Shopping Harvester Backfill Test
 * 
 * REAL INTEGRATION TEST - uses actual Gmail API and AI extraction
 * Backfills shopping receipts from Dec 1, 2025 to production
 * 
 * Run with: npm test -- backend/tests/shopping-backfill.test.mjs
 * 
 * @module tests/shopping-backfill.test
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

// Read from dev mount which mirrors production structure
const DEV_MOUNT_BASE = '/Volumes/mounts/DockerDrive/Docker/DaylightStation';
const PROD_DATA_DIR = path.join(DEV_MOUNT_BASE, 'data');
const PROD_CONFIG_DIR = path.join(DEV_MOUNT_BASE, 'config');

// Load secrets from production config files
const loadProdSecrets = () => {
    const secretsPath = path.join(PROD_CONFIG_DIR, 'config.secrets.yml');
    if (!fs.existsSync(secretsPath)) {
        throw new Error(`Secrets file not found: ${secretsPath}`);
    }
    return yaml.load(fs.readFileSync(secretsPath, 'utf8')) || {};
};

// Load app config from production
const loadProdConfig = () => {
    const appConfig = yaml.load(fs.readFileSync(path.join(PROD_CONFIG_DIR, 'config.app.yml'), 'utf8')) || {};
    const localConfigPath = path.join(PROD_CONFIG_DIR, 'config.app-local.yml');
    const localConfig = fs.existsSync(localConfigPath) 
        ? yaml.load(fs.readFileSync(localConfigPath, 'utf8')) || {}
        : {};
    return { ...appConfig, ...localConfig };
};

// Get head of household from production household config
const getHeadOfHousehold = () => {
    const householdConfig = yaml.load(
        fs.readFileSync(path.join(PROD_DATA_DIR, 'households/default/household.yml'), 'utf8')
    );
    return householdConfig?.head;
};

// Get user's Google auth token
const getUserGoogleAuth = (username) => {
    const authPath = path.join(PROD_DATA_DIR, 'users', username, 'auth', 'google.yml');
    if (!fs.existsSync(authPath)) {
        throw new Error(`Google auth not found for user ${username}: ${authPath}`);
    }
    return yaml.load(fs.readFileSync(authPath, 'utf8'));
};

describe('Shopping Harvester Backfill - REAL Gmail + AI', () => {
    let harvestShopping;
    let shoppingFile;
    let testUser;
    let secrets;
    let prodConfig;

    beforeAll(async () => {
        // Verify production mount is accessible
        if (!fs.existsSync(PROD_DATA_DIR)) {
            throw new Error(`Production data directory not mounted: ${PROD_DATA_DIR}`);
        }

        // Load production config and secrets
        secrets = loadProdSecrets();
        prodConfig = loadProdConfig();
        testUser = getHeadOfHousehold();
        
        console.log(`\n=== BACKFILL CONFIG ===`);
        console.log(`User: ${testUser}`);
        console.log(`Data Dir: ${PROD_DATA_DIR}`);
        
        // Verify user has Google auth
        const googleAuth = getUserGoogleAuth(testUser);
        if (!googleAuth?.refresh_token) {
            throw new Error(`No Google refresh_token for user ${testUser}`);
        }
        console.log(`Google Auth: Found refresh token`);

        shoppingFile = path.join(PROD_DATA_DIR, 'users', testUser, 'lifelog', 'shopping.yml');
        
        // Ensure lifelog directory exists
        const lifelogDir = path.dirname(shoppingFile);
        if (!fs.existsSync(lifelogDir)) {
            fs.mkdirSync(lifelogDir, { recursive: true });
        }

        // Set process.env.path to PRODUCTION data dir
        process.env.path = { data: PROD_DATA_DIR };
        
        // Set REAL credentials from production secrets
        process.env.GOOGLE_CLIENT_ID = secrets.GOOGLE_CLIENT_ID;
        process.env.GOOGLE_CLIENT_SECRET = secrets.GOOGLE_CLIENT_SECRET;
        process.env.GOOGLE_REDIRECT_URI = secrets.GOOGLE_REDIRECT_URI || 'http://localhost:3112/auth/google/callback';
        process.env.OPENAI_API_KEY = secrets.OPENAI_API_KEY;

        console.log(`GOOGLE_CLIENT_ID: ${process.env.GOOGLE_CLIENT_ID ? 'SET' : 'MISSING'}`);
        console.log(`OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'SET' : 'MISSING'}`);
        console.log(`=== END CONFIG ===\n`);

        // Import the REAL module (no mocks!)
        const module = await import('../lib/shopping.mjs');
        harvestShopping = module.default;
    }, 30000);

    it('should backfill shopping receipts from Jan 1, 2025 (ALL OF 2025)', async () => {
        // Clear existing file to do full backfill
        if (fs.existsSync(shoppingFile)) {
            console.log('Removing existing shopping.yml for clean backfill...');
            fs.unlinkSync(shoppingFile);
        }

        console.log('\n=== STARTING BACKFILL FROM JAN 1, 2025 - ALL OF 2025 ===');
        console.log('This will query REAL Gmail and use REAL AI extraction...');
        console.log('Watch the file being updated incrementally!\n');

        // Set up interval to show progress
        let lastReceiptCount = 0;
        const progressInterval = setInterval(() => {
            if (fs.existsSync(shoppingFile)) {
                const currentData = yaml.load(fs.readFileSync(shoppingFile, 'utf8'));
                const currentCount = currentData.receipts?.length || 0;
                if (currentCount > lastReceiptCount) {
                    console.log(`[PROGRESS] ${currentCount} receipts processed so far...`);
                    lastReceiptCount = currentCount;
                }
            }
        }, 2000); // Check every 2 seconds

        try {
            // Execute harvest with backfill date for all of 2025
            const result = await harvestShopping(null, 'backfill-2025', {
                query: { 
                    full: 'true',
                    since: '2025-01-01'
                }
            });

            clearInterval(progressInterval);

            console.log('\n=== HARVEST RESULT ===');
            console.log(JSON.stringify(result, null, 2));

            // Verify result
            expect(result.success).toBe(true);

            // EXIT CRITERIA: Verify shopping.yml file was created
            console.log(`\n=== OUTPUT FILE ===`);
            console.log(shoppingFile);
            expect(fs.existsSync(shoppingFile)).toBe(true);

            // Read and display the file
            const fileContent = fs.readFileSync(shoppingFile, 'utf8');
            const data = yaml.load(fileContent);

            console.log('\n=== PRODUCTION shopping.yml (SUMMARY) ===');
            console.log(`Total receipts: ${data.meta.totalReceipts}`);
            console.log(`Total items: ${data.meta.totalItems}`);
            console.log(`Last sync: ${data.meta.lastSync}`);
            console.log(`=== END ===\n`);

            // Verify structure
            expect(data).toHaveProperty('meta');
            expect(data).toHaveProperty('receipts');
            
            console.log(`\n=== SUMMARY ===`);
            console.log(`Receipts processed: ${result.receipts.processed}`);
            console.log(`New: ${result.receipts.new}`);
            console.log(`Skipped (duplicates): ${result.receipts.skipped}`);
            console.log(`Errors: ${result.receipts.errors}`);
            
            if (data.receipts?.length > 0) {
                console.log(`\nFirst 5 receipts:`);
                data.receipts.slice(0, 5).forEach((r, i) => {
                    console.log(`  ${i + 1}. ${r.date} - ${r.merchant} - $${r.total} (${r.items?.length || 0} items)`);
                });
                if (data.receipts.length > 5) {
                    console.log(`  ... and ${data.receipts.length - 5} more`);
                }
            } else {
                console.log(`\nNo receipts found in date range`);
            }
        } finally {
            clearInterval(progressInterval);
        }
    }, 300000); // 5 minute timeout for real API calls
});
