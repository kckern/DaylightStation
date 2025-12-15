/**
 * RealUPCGateway Unit Test
 * Tests against OpenFoodFacts API directly (no journalist dependencies)
 */

import { RealUPCGateway } from './RealUPCGateway.mjs';

const TEST_UPC = '021000055340';

// Simple OpenFoodFacts lookup (no gpt_food.mjs dependency)
async function openFoodFactsLookup(barcode) {
  const response = await fetch(`https://world.openfoodfacts.net/api/v2/product/${barcode}.json`);
  if (!response.ok) return null;
  
  const data = await response.json();
  if (!data.product || data.status !== 1) return null;
  
  const product = data.product;
  const nutrients = product.nutriments || {};
  
  return {
    label: product.product_name || product.product_name_en,
    brand: product.brands,
    image: product.image_url || product.image_front_url,
    noom_color: 'yellow', // Default
    icon: '🍽️',
    servingSizes: product.serving_quantity 
      ? [{ quantity: parseInt(product.serving_quantity), label: product.serving_quantity_unit || 'g' }]
      : [{ quantity: 100, label: 'g' }],
    servingsPerContainer: product.product_quantity && product.serving_quantity
      ? parseFloat(product.product_quantity) / parseFloat(product.serving_quantity)
      : 1,
    nutrients: {
      calories: nutrients['energy-kcal'] || 0,
      protein: nutrients.proteins || 0,
      carbs: nutrients.carbohydrates || 0,
      fat: nutrients.fat || 0,
      fiber: nutrients.fiber || 0,
      sugar: nutrients.sugars || 0,
      sodium: nutrients.sodium || 0,
    },
  };
}

async function testLookup() {
  console.log(`\n🔍 Testing UPC lookup: ${TEST_UPC}\n`);
  
  const gateway = new RealUPCGateway({ upcLookup: openFoodFactsLookup });
  const result = await gateway.lookup(TEST_UPC);
  
  if (!result) {
    console.log('❌ No result returned');
    process.exit(1);
  }
  
  console.log('✅ Product found:');
  console.log(`   Name: ${result.name}`);
  console.log(`   Brand: ${result.brand}`);
  console.log(`   Image: ${result.imageUrl}`);
  console.log(`   Icon: ${result.icon}`);
  console.log(`   Noom Color: ${result.noomColor}`);
  console.log(`   Serving: ${result.serving?.size}${result.serving?.unit}`);
  console.log('\n📊 Nutrition per serving:');
  console.log(`   Calories: ${result.nutrition?.calories}`);
  console.log(`   Protein: ${result.nutrition?.protein}g`);
  console.log(`   Carbs: ${result.nutrition?.carbs}g`);
  console.log(`   Fat: ${result.nutrition?.fat}g`);
  console.log(`\n📦 Servings options: ${result.servings?.length}`);
  result.servings?.forEach((s, i) => {
    console.log(`   ${i + 1}. ${s.name} (${s.grams}g, ${s.calories} cal)`);
  });
  
  console.log('\n✅ Test passed!\n');
}

testLookup().catch(err => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});
