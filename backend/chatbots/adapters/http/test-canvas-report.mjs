/**
 * Test script for CanvasReportRenderer
 * Generates a PNG report from existing nutrilist.json data
 * 
 * Run: node backend/chatbots/adapters/http/test-canvas-report.mjs
 */

import fs from 'fs/promises';
import path from 'path';
import { CanvasReportRenderer } from './CanvasReportRenderer.mjs';
import { DEFAULT_NUTRITION_GOALS } from '../../bots/nutribot/config/NutriBotConfig.mjs';

async function main() {
  // Load nutrilist data
  const nutrilistPath = '/tmp/nutribot-cli/nutrilist.json';
  let data;
  try {
    data = JSON.parse(await fs.readFile(nutrilistPath, 'utf-8'));
  } catch (e) {
    // Use sample data with icons if nutrilist doesn't exist
    data = [
      {
        name: 'grilled chicken breast',
        icon: 'chicken',
        noom_color: 'green',
        quantity: 150,
        unit: 'g',
        grams: 150,
        calories: 249,
        protein: 53,
        carbs: 0,
        fat: 3.6,
        fiber: 0,
        sugar: 0,
        sodium: 74,
        cholesterol: 130,
      },
      {
        name: 'brown rice',
        icon: 'rice',
        noom_color: 'yellow',
        quantity: 1,
        unit: 'cup',
        grams: 185,
        calories: 215,
        protein: 5,
        carbs: 45,
        fat: 1.8,
        fiber: 3.5,
        sugar: 0,
        sodium: 10,
        cholesterol: 0,
      },
      {
        name: 'mixed vegetables',
        icon: 'vegetable',
        noom_color: 'green',
        quantity: 1,
        unit: 'cup',
        grams: 130,
        calories: 65,
        protein: 3,
        carbs: 13,
        fat: 0.5,
        fiber: 4,
        sugar: 5,
        sodium: 45,
        cholesterol: 0,
      },
      {
        name: 'olive oil',
        icon: 'oil',
        noom_color: 'orange',
        quantity: 1,
        unit: 'tbsp',
        grams: 14,
        calories: 120,
        protein: 0,
        carbs: 0,
        fat: 14,
        fiber: 0,
        sugar: 0,
        sodium: 0,
        cholesterol: 0,
      },
    ];
  }

  // Add icons if missing
  const iconMap = {
    'mixed vegetables': 'vegetable',
    'grilled chicken breast': 'chicken',
    'brown rice': 'rice',
    'chicken': 'chicken',
    'rice': 'rice',
    'salad': 'salad',
    'beef': 'beef',
    'pork': 'pork',
    'fish': 'fish',
    'egg': 'egg',
    'pasta': 'pasta',
    'bread': 'white_bread',
    'apple': 'apple',
    'banana': 'banana',
    'orange': 'orange',
  };
  
  for (const item of data) {
    if (!item.icon) {
      const nameLower = (item.name || '').toLowerCase();
      for (const [key, icon] of Object.entries(iconMap)) {
        if (nameLower.includes(key)) {
          item.icon = icon;
          break;
        }
      }
      if (!item.icon) {
        item.icon = 'dish'; // default icon
      }
    }
  }
  
  console.log('📊 Loaded', data.length, 'items');
  console.log('🖼️  Icons:', data.map(d => d.icon).join(', '));
  
  // Calculate totals
  const totals = data.reduce((acc, item) => {
    acc.calories += item.calories || 0;
    acc.protein += item.protein || 0;
    acc.carbs += item.carbs || 0;
    acc.fat += item.fat || 0;
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  
  console.log('📈 Totals:', totals);
  
  // Build report data
  const today = new Date().toISOString().split('T')[0];
  const reportData = {
    date: today,
    totals,
    goals: { ...DEFAULT_NUTRITION_GOALS },
    items: data,
    history: [
      // Mock 7-day history for bar chart
      { date: '2025-12-08', calories: 1850, protein: 95, carbs: 180, fat: 70 },
      { date: '2025-12-09', calories: 2100, protein: 110, carbs: 200, fat: 80 },
      { date: '2025-12-10', calories: 1650, protein: 85, carbs: 160, fat: 60 },
      { date: '2025-12-11', calories: 1920, protein: 100, carbs: 190, fat: 75 },
      { date: '2025-12-12', calories: 2250, protein: 120, carbs: 210, fat: 85 },
      { date: '2025-12-13', calories: 1780, protein: 90, carbs: 175, fat: 68 },
    ],
  };
  
  // Generate PNG
  const renderer = new CanvasReportRenderer();
  const pngBuffer = await renderer.renderDailyReport(reportData);
  
  // Save to file
  const outputPath = '/tmp/nutribot-cli/test-report-' + Date.now() + '.png';
  await fs.writeFile(outputPath, pngBuffer);
  
  console.log('');
  console.log('✅ PNG generated successfully!');
  console.log('📁 Path:', outputPath);
  console.log('📐 Size:', Math.round(pngBuffer.length / 1024), 'KB');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
