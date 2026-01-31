/**
 * Generates household-demo test data
 *
 * Usage: node tests/_infrastructure/generators/setup-household-demo.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.resolve(__dirname, '../household-demo');

// Public domain characters
const USERS = [
  { id: 'popeye', name: 'Popeye', persona: 'fitness' },
  { id: 'olive', name: 'Olive Oyl', persona: 'planner' },
  { id: 'mickey', name: 'Mickey Mouse', persona: 'media' },
  { id: 'betty', name: 'Betty Boop', persona: 'music' },
  { id: 'tintin', name: 'Tintin', persona: 'guest' },
];

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function generateHouseholdConfig() {
  return {
    id: 'demo',
    name: 'Demo Household',
    timezone: 'America/Los_Angeles',
    head_of_household: 'popeye',
    members: USERS.map(u => u.id),
  };
}

function generateUserData(user) {
  const today = new Date();

  return {
    profile: {
      id: user.id,
      name: user.name,
      persona: user.persona,
    },
    // Add more user-specific data based on persona
  };
}

async function main() {
  console.log('Generating household-demo...');

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Generate household config
  const householdConfig = generateHouseholdConfig();
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'household.yml'),
    JSON.stringify(householdConfig, null, 2) // TODO: Use yaml
  );

  // Generate user data
  fs.mkdirSync(path.join(OUTPUT_DIR, 'users'), { recursive: true });
  for (const user of USERS) {
    const userData = generateUserData(user);
    fs.mkdirSync(path.join(OUTPUT_DIR, 'users', user.id), { recursive: true });
    fs.writeFileSync(
      path.join(OUTPUT_DIR, 'users', user.id, 'profile.yml'),
      JSON.stringify(userData.profile, null, 2) // TODO: Use yaml
    );
  }

  console.log(`Generated household-demo at ${OUTPUT_DIR}`);
  console.log(`Users: ${USERS.map(u => u.name).join(', ')}`);
}

main().catch(console.error);
