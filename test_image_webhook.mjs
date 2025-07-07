#!/usr/bin/env node

/**
 * Test file to simulate image webhook for nutribot
 * Usage: node test_image_webhook.mjs
 */

import { processFoodLogHook } from './backend/journalist/foodlog_hook.mjs';
import { detectFoodFromImage } from './backend/journalist/lib/gpt_food.mjs';
import { processImageUrl } from './backend/journalist/lib/food.mjs';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

// Mock request and response objects
const createMockReq = (payload) => ({
    body: payload,
    query: {},
    headers: {
        host: 'localhost:3000'
    }
});

const createMockRes = () => {
    const res = {
        statusCode: 200,
        statusMessage: '',
        headers: {},
        body: '',
        status: function(code) {
            this.statusCode = code;
            return this;
        },
        send: function(data) {
            this.body = data;
            console.log(`Response: ${this.statusCode} - ${data}`);
            return this;
        },
        json: function(data) {
            this.body = JSON.stringify(data);
            console.log(`Response: ${this.statusCode} - ${JSON.stringify(data, null, 2)}`);
            return this;
        }
    };
    return res;
};

// Test image URLs (you can replace these with actual food images)
const TEST_IMAGES = [
    'https://images.unsplash.com/photo-1565299624946-b28f40a0ca4b?w=800', // Pizza
    'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=800',  // Salad
    'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?w=800', // Pancakes
    'https://images.unsplash.com/photo-1565958011703-44f9829ba187?w=800'  // Burger
];

// Test scenarios
const TEST_SCENARIOS = [
    {
        name: 'Direct Image URL Test',
        payload: {
            img_url: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ca4b?w=800',
            chat_id: 'test_chat_123'
        }
    },
    {
        name: 'Telegram Image Message Test',
        payload: {
            message: {
                message_id: 12345,
                chat: {
                    id: 575596036,
                    first_name: 'Test',
                    last_name: 'User',
                    username: 'testuser',
                    type: 'private'
                },
                photo: [
                    {
                        file_id: 'BAADBAADrwADBREAAWdAAgABFiIsRx4C',
                        file_unique_id: 'AgADrwADBREAAWdAAg',
                        file_size: 1253,
                        width: 90,
                        height: 67
                    },
                    {
                        file_id: 'BAADBAADrwADBREAAWdAAgABFiIsRx4C',
                        file_unique_id: 'AgADrwADBREAAWdAAg',
                        file_size: 18734,
                        width: 320,
                        height: 240
                    },
                    {
                        file_id: 'BAADBAADrwADBREAAWdAAgABFiIsRx4C',
                        file_unique_id: 'AgADrwADBREAAWdAAg',
                        file_size: 87234,
                        width: 800,
                        height: 600
                    }
                ],
                caption: 'My lunch today!'
            }
        }
    },
    {
        name: 'Text Description Test',
        payload: {
            message: {
                message_id: 12346,
                chat: {
                    id: 575596036,
                    first_name: 'Test',
                    last_name: 'User',
                    username: 'testuser',
                    type: 'private'
                },
                text: 'I had a grilled chicken breast with steamed broccoli and quinoa for dinner'
            }
        }
    }
];

// Function to test direct GPT food detection
async function testDetectFoodFromImage(imageUrl) {
    console.log('\n🔍 Testing detectFoodFromImage directly...');
    console.log(`Image URL: ${imageUrl}`);
    
    try {
        const result = await detectFoodFromImage(imageUrl);
        console.log('✅ detectFoodFromImage result:', JSON.stringify(result, null, 2));
        return result;
    } catch (error) {
        console.error('❌ detectFoodFromImage error:', error);
        return null;
    }
}

// Function to test image URL processing
async function testProcessImageUrl(imageUrl) {
    console.log('\n🔍 Testing processImageUrl...');
    console.log(`Image URL: ${imageUrl}`);
    
    const chat_id = 'test_b6898194425_u575596036';
    
    try {
        const result = await processImageUrl(imageUrl, chat_id);
        console.log('✅ processImageUrl completed');
        return result;
    } catch (error) {
        console.error('❌ processImageUrl error:', error);
        return null;
    }
}

// Function to test full webhook flow
async function testWebhookFlow(scenario) {
    console.log(`\n🚀 Testing Scenario: ${scenario.name}`);
    console.log('Payload:', JSON.stringify(scenario.payload, null, 2));
    
    const req = createMockReq(scenario.payload);
    const res = createMockRes();
    
    try {
        await processFoodLogHook(req, res);
        console.log('✅ Webhook processing completed');
        return res;
    } catch (error) {
        console.error('❌ Webhook processing error:', error);
        return res;
    }
}

// Function to test button press simulation
async function testButtonPress(action = 'accept') {
    console.log(`\n🔘 Testing Button Press: ${action}`);
    
    const buttonPayload = {
        callback_query: {
            id: 'test_callback_123',
            from: {
                id: 575596036,
                first_name: 'Test',
                last_name: 'User',
                username: 'testuser'
            },
            message: {
                message_id: 12345,
                chat: {
                    id: 575596036,
                    first_name: 'Test',
                    last_name: 'User',
                    username: 'testuser',
                    type: 'private'
                },
                date: Math.floor(Date.now() / 1000),
                text: '🟡 Test Food Item\n🔥 250 cal'
            },
            data: action === 'accept' ? '✅ Accept' : action === 'discard' ? '❌ Discard' : '🔄 Revise'
        }
    };
    
    const req = createMockReq(buttonPayload);
    const res = createMockRes();
    
    try {
        await processFoodLogHook(req, res);
        console.log('✅ Button press processing completed');
        return res;
    } catch (error) {
        console.error('❌ Button press processing error:', error);
        return res;
    }
}

// Function to simulate UPC input
async function testUPCInput(upc = '012000002014') {
    console.log(`\n🏷️ Testing UPC Input: ${upc}`);
    
    const upcPayload = {
        message: {
            message_id: 12347,
            chat: {
                id: 575596036,
                first_name: 'Test',
                last_name: 'User',
                username: 'testuser',
                type: 'private'
            },
            text: upc
        }
    };
    
    const req = createMockReq(upcPayload);
    const res = createMockRes();
    
    try {
        await processFoodLogHook(req, res);
        console.log('✅ UPC processing completed');
        return res;
    } catch (error) {
        console.error('❌ UPC processing error:', error);
        return res;
    }
}

// Main test runner
async function runTests() {
    console.log('🧪 Starting Nutribot Image Webhook Tests...');
    console.log('=' * 50);
    
    // Test 1: Direct GPT function
    await testDetectFoodFromImage(TEST_IMAGES[0]);
    
    // Test 2: Image URL processing
    await testProcessImageUrl(TEST_IMAGES[1]);
    
    // Test 3: Full webhook scenarios
    for (const scenario of TEST_SCENARIOS) {
        await testWebhookFlow(scenario);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait between tests
    }
    
    // Test 4: Button interactions
    await testButtonPress('accept');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await testButtonPress('discard');
    await new Promise(resolve => setTimeout(resolve, 1000));
    await testButtonPress('revise');
    
    // Test 5: UPC input
    await testUPCInput();
    
    console.log('\n🎉 All tests completed!');
}

// Command line interface
const args = process.argv.slice(2);
const command = args[0];

if (command === 'gpt') {
    // Test only GPT function
    const imageUrl = args[1] || TEST_IMAGES[0];
    testDetectFoodFromImage(imageUrl);
} else if (command === 'process') {
    // Test only image processing
    const imageUrl = args[1] || TEST_IMAGES[0];
    testProcessImageUrl(imageUrl);
} else if (command === 'webhook') {
    // Test webhook with specific scenario
    const scenarioIndex = parseInt(args[1]) || 0;
    const scenario = TEST_SCENARIOS[scenarioIndex];
    if (scenario) {
        testWebhookFlow(scenario);
    } else {
        console.error('Invalid scenario index. Available scenarios:');
        TEST_SCENARIOS.forEach((s, i) => console.log(`${i}: ${s.name}`));
    }
} else if (command === 'button') {
    // Test button press
    const action = args[1] || 'accept';
    testButtonPress(action);
} else if (command === 'upc') {
    // Test UPC input
    const upc = args[1] || '012000002014';
    testUPCInput(upc);
} else if (command === 'help') {
    console.log(`
Usage: node test_image_webhook.mjs [command] [options]

Commands:
  gpt [image_url]        - Test GPT food detection only
  process [image_url]    - Test image processing only
  webhook [scenario_id]  - Test webhook with specific scenario (0-2)
  button [action]        - Test button press (accept/discard/revise)
  upc [upc_code]        - Test UPC input
  help                  - Show this help message
  (no command)          - Run all tests

Examples:
  node test_image_webhook.mjs
  node test_image_webhook.mjs gpt https://example.com/pizza.jpg
  node test_image_webhook.mjs webhook 1
  node test_image_webhook.mjs button accept
  node test_image_webhook.mjs upc 012000002014
    `);
} else {
    // Run all tests
    runTests();
}
