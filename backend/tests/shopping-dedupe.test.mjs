/**
 * Shopping Dedupe Quick Test
 * Verifies deduplication is working without running full backfill
 */

import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { userLoadFile } from '../lib/io.mjs';

const DEV_MOUNT_BASE = '/Volumes/mounts/DockerDrive/Docker/DaylightStation';
const PROD_DATA_DIR = path.join(DEV_MOUNT_BASE, 'data');
const PROD_CONFIG_DIR = path.join(DEV_MOUNT_BASE, 'config');

const loadProdSecrets = () => {
    const secretsPath = path.join(PROD_CONFIG_DIR, 'config.secrets.yml');
    return yaml.load(fs.readFileSync(secretsPath, 'utf8')) || {};
};

const getHeadOfHousehold = () => {
    const householdConfig = yaml.load(
        fs.readFileSync(path.join(PROD_DATA_DIR, 'households/default/household.yml'), 'utf8')
    );
    return householdConfig?.head;
};

describe('Shopping Dedupe Verification', () => {
    let harvestShopping;
    let testUser;
    let secrets;
    let initialData;

    beforeAll(async () => {
        secrets = loadProdSecrets();
        testUser = getHeadOfHousehold();
        
        // Set env FIRST before importing io.mjs-dependent modules
        process.env.path = { data: PROD_DATA_DIR };
        process.env.GOOGLE_CLIENT_ID = secrets.GOOGLE_CLIENT_ID;
        process.env.GOOGLE_CLIENT_SECRET = secrets.GOOGLE_CLIENT_SECRET;
        process.env.GOOGLE_REDIRECT_URI = secrets.GOOGLE_REDIRECT_URI || 'http://localhost:3112/auth/google/callback';
        process.env.OPENAI_API_KEY = secrets.OPENAI_API_KEY;
        
        // NOW load initial state using io.mjs
        initialData = userLoadFile(testUser, 'shopping');
        
        console.log(`\n=== INITIAL STATE ===`);
        console.log(`Total receipts: ${initialData?.meta?.totalReceipts || 0}`);
        console.log(`False positives tracked: ${initialData?.meta?.false_positives?.length || 0}`);

        const module = await import('../lib/shopping.mjs');
        harvestShopping = module.default;
    }, 10000);

    it('should skip all existing receipts (dedupe test)', async () => {
        console.log('\n=== RUNNING DEDUPE TEST (last 7 days) ===');
        console.log('This should skip most/all emails as duplicates...\n');

        const startTime = Date.now();
        
        // Run harvest with default (7 days back)
        const result = await harvestShopping(null, 'dedupe-test', { query: {} });

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        
        console.log(`\n=== RESULT (completed in ${elapsed}s) ===`);
        console.log(JSON.stringify(result, null, 2));

        expect(result.success).toBe(true);

        // Load final state using io.mjs
        const finalData = userLoadFile(testUser, 'shopping');
        
        console.log(`\n=== COMPARISON ===`);
        console.log(`Initial receipts: ${initialData?.meta?.totalReceipts || 0}`);
        console.log(`Final receipts: ${finalData?.meta?.totalReceipts || 0}`);
        console.log(`New receipts added: ${result.receipts.new}`);
        console.log(`Skipped (duplicates): ${result.receipts.skipped}`);
        console.log(`False positives: ${finalData?.meta?.false_positives?.length || 0}`);

        // Verify dedupe worked (most should be skipped OR nothing found in last 7 days)
        const totalEmails = result.receipts.processed + result.receipts.skipped + result.receipts.errors;
        if (totalEmails > 0) {
            expect(result.receipts.skipped).toBeGreaterThan(0);
            console.log(`\n✅ Deduplication is working! Skipped ${result.receipts.skipped} duplicates.`);
        } else {
            console.log(`\n✅ No new emails in last 7 days (expected behavior)`);
        }
    }, 60000); // 1 minute timeout
});
