/**
 * Mock UPC Gateway Tests
 * @module cli/__tests__/MockUPCGateway.test
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { MockUPCGateway } from '../mocks/MockUPCGateway.mjs';

describe('MockUPCGateway', () => {
  let gateway;

  beforeEach(() => {
    gateway = new MockUPCGateway({ responseDelay: 0 }); // No delay for tests
  });

  describe('lookup', () => {
    it('should find Coca-Cola by UPC', async () => {
      const product = await gateway.lookup('049000042566');
      
      expect(product).toBeDefined();
      expect(product.name).toBe('Coca-Cola Classic');
      expect(product.brand).toBe('Coca-Cola');
      expect(product.servings.length).toBeGreaterThan(0);
    });

    it('should find Lays chips by UPC', async () => {
      const product = await gateway.lookup('028400090865');
      
      expect(product).toBeDefined();
      expect(product.name).toContain("Lay's");
    });

    it('should find Quest bar by UPC', async () => {
      const product = await gateway.lookup('850251004032');
      
      expect(product).toBeDefined();
      expect(product.name).toContain('Quest');
    });

    it('should return null for unknown UPC', async () => {
      const product = await gateway.lookup('000000000000');
      
      expect(product).toBeNull();
    });

    it('should normalize UPC with leading zeros', async () => {
      const product = await gateway.lookup('49000042566'); // Missing leading zero
      
      expect(product).toBeDefined();
      expect(product.name).toBe('Coca-Cola Classic');
    });

    it('should include color in servings', async () => {
      const product = await gateway.lookup('049000042566');
      
      expect(product.servings[0].color).toBeDefined();
      expect(['green', 'yellow', 'orange']).toContain(product.servings[0].color);
    });
  });

  describe('addProduct', () => {
    it('should add custom product', async () => {
      gateway.addProduct('123456789012', {
        name: 'Test Product',
        brand: 'Test Brand',
        servings: [
          { name: '1 serving', grams: 100, calories: 200, protein: 10, carbs: 20, fat: 8 },
        ],
      });

      const product = await gateway.lookup('123456789012');
      
      expect(product).toBeDefined();
      expect(product.name).toBe('Test Product');
    });
  });

  describe('removeProduct', () => {
    it('should remove product', async () => {
      // Verify it exists first
      let product = await gateway.lookup('049000042566');
      expect(product).toBeDefined();

      gateway.removeProduct('049000042566');

      product = await gateway.lookup('049000042566');
      expect(product).toBeNull();
    });
  });

  describe('getAllProducts', () => {
    it('should return all products', () => {
      const products = gateway.getAllProducts();
      
      expect(Object.keys(products).length).toBeGreaterThan(10);
    });
  });

  describe('productCount', () => {
    it('should return product count', () => {
      expect(gateway.productCount).toBeGreaterThan(10);
    });
  });

  describe('built-in products', () => {
    const productCases = [
      ['049000042566', 'Coca-Cola Classic'],
      ['012000001536', 'Pepsi'],
      ['028400090865', "Lay's Classic Potato Chips"],
      ['040000495796', "M&M's Peanut"],
      ['030000311103', 'Quaker Oats Old Fashioned'],
      ['070470496443', 'Chobani Greek Yogurt Vanilla'],
      ['041220576074', 'Fairlife 2% Milk'],
      ['722252100900', 'RXBAR Chocolate Sea Salt'],
      ['613008739591', 'Cliff Bar Chocolate Chip'],
      ['072250013727', "Dave's Killer Bread 21 Whole Grains"],
      ['013000006408', 'Heinz Tomato Ketchup'],
      ['054100710000', 'Hidden Valley Ranch'],
      ['013120004315', "Amy's Cheese Pizza"],
    ];

    it.each(productCases)('should find %s as %s', async (upc, expectedName) => {
      const product = await gateway.lookup(upc);
      
      expect(product).toBeDefined();
      expect(product.name).toBe(expectedName);
    });
  });

  describe('serving nutritional data', () => {
    it('should include all nutritional fields', async () => {
      const product = await gateway.lookup('722252100900'); // RXBAR
      const serving = product.servings[0];
      
      expect(serving.grams).toBeDefined();
      expect(serving.calories).toBeDefined();
      expect(serving.protein).toBeDefined();
      expect(serving.carbs).toBeDefined();
      expect(serving.fat).toBeDefined();
      expect(serving.name).toBeDefined();
    });

    it('should have reasonable nutritional values', async () => {
      const product = await gateway.lookup('722252100900'); // RXBAR
      const serving = product.servings[0];
      
      expect(serving.calories).toBeGreaterThan(0);
      expect(serving.grams).toBeGreaterThan(0);
      // Protein + carbs + fat calories should roughly match total calories
      const macroCalories = (serving.protein * 4) + (serving.carbs * 4) + (serving.fat * 9);
      expect(Math.abs(macroCalories - serving.calories)).toBeLessThan(50);
    });
  });
});
