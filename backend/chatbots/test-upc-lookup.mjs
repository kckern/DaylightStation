/**
 * Standalone test script for LogFoodFromUPC
 * Tests with real UPC code: 0004132216918
 */

import { LogFoodFromUPC } from './bots/nutribot/application/usecases/LogFoodFromUPC.mjs';
import { RealUPCGateway } from './infrastructure/gateways/RealUPCGateway.mjs';
import { createLogger } from './_lib/logging/index.mjs';

// Mock messaging gateway for testing
class TestMessagingGateway {
  constructor() {
    this.messages = [];
    this.photos = [];
  }

  async sendMessage(conversationId, text) {
    const messageId = `msg-${Date.now()}`;
    this.messages.push({ messageId, conversationId, text });
    console.log(`📤 Sent message: ${text}`);
    return { messageId };
  }

  async updateMessage(conversationId, messageId, data) {
    console.log(`✏️  Updated message ${messageId}: ${data.text}`);
  }

  async deleteMessage(conversationId, messageId) {
    console.log(`🗑️  Deleted message ${messageId}`);
  }

  async sendPhoto(conversationId, imagePath, options = {}) {
    const messageId = `photo-${Date.now()}`;
    this.photos.push({ messageId, conversationId, imagePath, options });
    console.log(`📸 Sent photo: ${imagePath}`);
    if (options.caption) {
      console.log(`   Caption:\n${options.caption.split('\n').map(l => `   ${l}`).join('\n')}`);
    }
    if (options.choices) {
      console.log(`   Buttons: ${options.choices.length} rows`);
    }
    return { messageId };
  }
}

// Mock AI gateway for classification
class TestAIGateway {
  async chat(messages, options) {
    console.log('🤖 AI Classification (mock response)');
    // Return a default classification
    return JSON.stringify({
      icon: 'default',
      noomColor: 'yellow'
    });
  }
}

// Mock nutrilog repository
class TestNutrilogRepository {
  constructor() {
    this.logs = new Map();
  }

  async save(nutriLog) {
    this.logs.set(nutriLog.id, nutriLog);
    console.log(`💾 Saved NutriLog: ${nutriLog.id}`);
    console.log(`   Status: ${nutriLog.status}`);
    console.log(`   Items: ${nutriLog.items.length}`);
    if (nutriLog.items[0]) {
      const item = nutriLog.items[0];
      console.log(`   - ${item.label}: ${item.calories} cal, ${item.protein}g protein`);
    }
  }

  async findByUuid(uuid) {
    return this.logs.get(uuid) || null;
  }
}

// Mock config
const testConfig = {
  getUserTimezone: (userId) => 'America/Los_Angeles'
};

// Main test function
async function testLogFoodFromUPC() {
  console.log('🧪 Testing LogFoodFromUPC with UPC: 0004132216918\n');
  console.log('=' .repeat(60));

  const messagingGateway = new TestMessagingGateway();
  
  // Create fallback UPC lookup function for alternative APIs
  const fallbackUpcLookup = async (upc) => {
    // Try multiple API sources
    
    // 1. Try UPCitemdb
    console.log('🔍 Trying UPCitemdb.com as fallback...');
    try {
      const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${upc}`, {
        headers: { 'User-Agent': 'DaylightStation/1.0' }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.items && data.items.length > 0) {
          const item = data.items[0];
          console.log(`   ✅ Found in UPCitemdb: ${item.title}`);
          
          return {
            label: item.title,
            brand: item.brand || null,
            product_name: item.title,
            nutrients: {
              calories: 0, // UPCitemdb doesn't provide nutrition
              protein: 0,
              carbs: 0,
              fat: 0,
            },
            servingSizes: [{ quantity: 100, label: 'g' }],
            image_url: item.images?.[0] || null,
          };
        }
      }
      console.log(`   ❌ UPCitemdb: status ${response.status}`);
    } catch (error) {
      console.log(`   ❌ UPCitemdb error: ${error.message}`);
    }
    
    // 2. Try Barcode Spider API
    console.log('🔍 Trying Barcode Spider API...');
    try {
      const response = await fetch(`https://www.barcodelookup.com/${upc}`, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json, text/html'
        }
      });
      
      if (response.ok) {
        const text = await response.text();
        // Try to parse product name from HTML (basic scraping)
        const titleMatch = text.match(/<title>([^<]+)/);
        if (titleMatch) {
          const title = titleMatch[1].replace(' - Barcode Lookup', '').trim();
          if (title && title !== 'Barcode Lookup') {
            console.log(`   ✅ Found in Barcode Spider: ${title}`);
            return {
              label: title,
              product_name: title,
              nutrients: { calories: 0, protein: 0, carbs: 0, fat: 0 },
              servingSizes: [{ quantity: 100, label: 'g' }],
            };
          }
        }
      }
      console.log(`   ❌ Barcode Spider: no data found`);
    } catch (error) {
      console.log(`   ❌ Barcode Spider error: ${error.message}`);
    }
    
    return null;
  };
  
  const upcGateway = new RealUPCGateway({
    logger: createLogger({ source: 'test-upc', app: 'nutribot' }),
    upcLookup: fallbackUpcLookup,
  });
  const aiGateway = new TestAIGateway();
  const nutrilogRepository = new TestNutrilogRepository();
  const logger = createLogger({ source: 'test', app: 'nutribot' });

  const useCase = new LogFoodFromUPC({
    messagingGateway,
    upcGateway,
    aiGateway,
    nutrilogRepository,
    config: testConfig,
    logger,
  });

  try {
    const result = await useCase.execute({
      userId: 'test-user',
      conversationId: 'test-chat_test-user',
      upc: '0004132216918',
      messageId: 'test-msg-1',
    });

    console.log('\n' + '='.repeat(60));
    console.log('✅ Test completed successfully!\n');
    console.log('Result:');
    console.log(`  Success: ${result.success}`);
    console.log(`  NutriLog UUID: ${result.nutrilogUuid}`);
    
    if (result.product) {
      console.log('\nProduct Details:');
      console.log(`  Name: ${result.product.name}`);
      console.log(`  Brand: ${result.product.brand || 'N/A'}`);
      console.log(`  UPC: ${result.product.upc}`);
      console.log(`  Image URL: ${result.product.imageUrl || 'N/A'}`);
      console.log('\nNutrition (per serving):');
      console.log(`  Serving: ${result.product.serving?.size || 'N/A'} ${result.product.serving?.unit || ''}`);
      console.log(`  Calories: ${result.product.nutrition?.calories || 0}`);
      console.log(`  Protein: ${result.product.nutrition?.protein || 0}g`);
      console.log(`  Carbs: ${result.product.nutrition?.carbs || 0}g`);
      console.log(`  Fat: ${result.product.nutrition?.fat || 0}g`);
      console.log(`  Fiber: ${result.product.nutrition?.fiber || 0}g`);
      console.log(`  Sugar: ${result.product.nutrition?.sugar || 0}g`);
    }

    console.log('\nMessages sent:');
    console.log(`  Text messages: ${messagingGateway.messages.length}`);
    console.log(`  Photos: ${messagingGateway.photos.length}`);

    console.log('\nNutriLogs created:');
    console.log(`  Total logs: ${nutrilogRepository.logs.size}`);

  } catch (error) {
    console.error('\n❌ Test failed with error:');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
testLogFoodFromUPC().catch(console.error);
