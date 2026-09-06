import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
const read = relative => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');

describe('receipt ownership architecture', () => {
  it('keeps the polling trigger free of rendering and transport', () => {
    const source = read('./NutritionSurfaceSync.mjs');
    expect(source).toContain('publisher.publish');
    expect(source).not.toMatch(/updateMessage|sendMessage|renderer|caption|choices|Food log updated/);
  });
  it('capture and confirmation use cases hand off to the one publisher', () => {
    for (const name of ['LogFoodFromImage', 'LogFoodFromText', 'LogFoodFromUPC', 'AcceptFoodLog',
      'DiscardFoodLog', 'ReviseFoodLog', 'ProcessRevisionInput', 'SelectUPCPortion', 'SelectScaleDensity', 'LogScaleFoodFromText']) {
      const source = read(`../nutribot/usecases/${name}.mjs`);
      expect(source, name).toContain('#receipts');
      expect(source, name).not.toMatch(/formatFoodList|formatFoodCaption|formatConfirmation|buildActionButtons|buildConfirmButtons|buildProductCaption|withCommittedChoices|Food log updated|Logged ✓/);
    }
    expect(fs.existsSync(new URL('../nutribot/lib/committedChoices.mjs', import.meta.url))).toBe(false);
  });
  it('composition shares the publisher while Mastra remains behind the repair boundary', () => {
    const composition = read('../../5_composition/modules/nutritionSurfaceSync.mjs');
    expect(composition).toContain('container.setReceiptPublisher(publisher)');
    expect(composition).toContain('new NutritionReceiptRenderer()');
    for (const source of [read('./NutritionRepairService.mjs'), read('../agents/nutrition-auditor/NutritionAuditor.mjs')]) {
      expect(source).not.toMatch(/NutritionReceiptRenderer|sendMessage|updateMessage/);
    }
  });
});
