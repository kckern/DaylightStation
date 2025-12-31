#!/usr/bin/env node
/**
 * Test Morning Debrief Endpoint
 * 
 * Usage:
 *   node test-morning-debrief.mjs [username] [date]
 * 
 * Examples:
 *   node test-morning-debrief.mjs                  # Use default user, yesterday
 *   node test-morning-debrief.mjs kckern           # Specific user, yesterday
 *   node test-morning-debrief.mjs kckern 2025-12-29  # Specific user and date
 */

const args = process.argv.slice(2);
const username = args[0] || 'default';
const date = args[1] || '';

const baseUrl = process.env.TEST_API_URL || 'http://localhost:3112';
const endpoint = `/journalist/morning?user=${username}${date ? `&date=${date}` : ''}`;

console.log(`\n🧪 Testing Morning Debrief`);
console.log(`📍 Endpoint: ${baseUrl}${endpoint}`);
console.log(`👤 User: ${username}`);
console.log(`📅 Date: ${date || 'yesterday (auto)'}\n`);

async function test() {
  try {
    const response = await fetch(`${baseUrl}${endpoint}`);
    const data = await response.json();
    
    console.log(`✅ Status: ${response.status} ${response.statusText}\n`);
    console.log('📦 Response:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.success) {
      console.log(`\n🎉 Morning debrief sent successfully!`);
      console.log(`   Message ID: ${data.messageId}`);
      console.log(`   Fallback: ${data.fallback ? 'Yes (insufficient data)' : 'No (full debrief)'}`);
    } else {
      console.log(`\n❌ Morning debrief failed`);
      console.log(`   Error: ${data.error}`);
    }
    
  } catch (error) {
    console.error(`\n❌ Request failed:`, error.message);
    process.exit(1);
  }
}

test();
