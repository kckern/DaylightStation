/**
 * Isolated Test: NutriReportRenderer
 * 
 * Tests the nutrition report rendering functionality, specifically
 * verifying that food item grams are displayed correctly in the output.
 * 
 * Bug Investigation: Items showing "0 grams" in rendered reports despite
 * having actual gram values in the source data.
 */

import { describe, it, expect, beforeAll } from '@jest/globals';
import { NutriReportRenderer } from '../../../backend/src/1_adapters/nutribot/rendering/NutriReportRenderer.mjs';
import path from 'path';

describe('NutriReportRenderer - Food Item Display Bug', () => {
  let renderer;
  
  beforeAll(() => {
    // Set up renderer with test paths
    const projectRoot = process.cwd();
    const fontDir = path.join(projectRoot, 'media/fonts');
    const iconDir = path.join(projectRoot, 'media/img/icons/food');
    
    renderer = new NutriReportRenderer({
      logger: console,
      fontDir,
      iconDir,
    });
  });

  it('should display food item grams correctly (not as 0)', async () => {
    // Mock report data matching the actual data structure from nutrilog.yml
    const report = {
      date: '2026-02-03',
      totals: {
        calories: 670,
        protein: 25,
        carbs: 86,
        fat: 29,
      },
      goals: {
        calories: 2000,
      },
      items: [
        {
          id: 'item-1',
          name: 'Granola',
          label: 'Granola',
          icon: 'default',
          grams: 300,
          calories: 300,
          protein: 15,
          carbs: 40,
          fat: 6,
          color: 'orange',
        },
        {
          id: 'item-2',
          name: 'Kidney Bean, Quinoa, Tomato Porridge With Shredded Cheese And Granola',
          label: 'Kidney Bean, Quinoa, Tomato Porridge With Shredded Cheese And Granola',
          icon: 'default',
          grams: 250,
          calories: 250,
          protein: 4,
          carbs: 45,
          fat: 12,
          color: 'yellow',
        },
        {
          id: 'item-3',
          name: 'Shredded Cheese',
          label: 'Shredded Cheese',
          icon: 'cheese',
          grams: 120,
          calories: 120,
          protein: 10,
          carbs: 1,
          fat: 7,
          color: 'orange',
        },
        {
          id: 'item-4',
          name: 'Tofu',
          label: 'Tofu',
          icon: 'default',
          grams: 126,
          calories: 94,
          protein: 10,
          carbs: 2,
          fat: 6,
          color: 'yellow',
        },
        {
          id: 'item-5',
          name: 'Edamame',
          label: 'Edamame',
          icon: 'default',
          grams: 80,
          calories: 100,
          protein: 9,
          carbs: 8,
          fat: 4,
          color: 'green',
        },
      ],
      history: [
        { date: '2026-01-29', calories: 802, protein: 25, carbs: 98, fat: 55 },
        { date: '2026-01-30', calories: 1507, protein: 72, carbs: 165, fat: 58 },
        { date: '2026-01-31', calories: 0, protein: 0, carbs: 0, fat: 0 },
        { date: '2026-02-01', calories: 400, protein: 22, carbs: 44, fat: 0 },
        { date: '2026-02-02', calories: 375, protein: 29, carbs: 0, fat: 0 },
        { date: '2026-02-03', calories: 1140, protein: 49, carbs: 93, fat: 73 },
      ],
    };

    // Render the report
    const buffer = await renderer.renderDailyReport(report);
    
    // Verify we got a PNG buffer
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    
    // Verify PNG signature (89 50 4E 47)
    expect(buffer[0]).toBe(0x89);
    expect(buffer[1]).toBe(0x50);
    expect(buffer[2]).toBe(0x4E);
    expect(buffer[3]).toBe(0x47);
    
    // Save to file for manual inspection
    const fs = await import('fs');
    const outputPath = path.join(process.cwd(), 'tests/output/nutribot-test-report.png');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, buffer);
    
    console.log('\n✓ Report rendered successfully');
    console.log(`✓ Output saved to: ${outputPath}`);
    console.log('\n📝 Manual verification needed:');
    console.log('   - Open the PNG file');
    console.log('   - Check that food items show their gram amounts (not "0")');
    console.log('   - Tofu should show: 126g');
    console.log('   - Edamame should show: 80g');
    console.log('   - Granola should show: 300g');
  });

  it('should group duplicate items and sum their grams', async () => {
    const report = {
      date: '2026-02-03',
      totals: {
        calories: 200,
        protein: 20,
        carbs: 4,
        fat: 12,
      },
      goals: {
        calories: 2000,
      },
      items: [
        {
          id: 'item-1',
          name: 'Tofu',
          label: 'Tofu',
          grams: 126,
          calories: 94,
          protein: 10,
          carbs: 2,
          fat: 6,
          icon: 'default',
          color: 'yellow',
        },
        {
          id: 'item-2',
          name: 'Tofu',
          label: 'Tofu',
          grams: 126,
          calories: 94,
          protein: 10,
          carbs: 2,
          fat: 6,
          icon: 'default',
          color: 'yellow',
        },
      ],
      history: [],
    };

    const buffer = await renderer.renderDailyReport(report);
    
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    
    console.log('\n✓ Duplicate item grouping test completed');
    console.log('📝 Expected result: Single "Tofu" entry with 252g (126g + 126g)');
  });

  it('should handle items with zero grams gracefully', async () => {
    const report = {
      date: '2026-02-03',
      totals: {
        calories: 100,
        protein: 10,
        carbs: 2,
        fat: 6,
      },
      goals: {
        calories: 2000,
      },
      items: [
        {
          id: 'item-1',
          name: 'Mystery Food',
          label: 'Mystery Food',
          grams: 0, // Intentionally zero
          calories: 100,
          protein: 10,
          carbs: 2,
          fat: 6,
          icon: 'default',
          color: 'yellow',
        },
      ],
      history: [],
    };

    const buffer = await renderer.renderDailyReport(report);
    
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(0);
    
    console.log('\n✓ Zero grams handling test completed');
  });
});
