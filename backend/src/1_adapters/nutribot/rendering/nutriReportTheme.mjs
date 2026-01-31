/**
 * NutriReport Theme
 * @module 2_adapters/nutribot/rendering/nutriReportTheme
 *
 * Presentation factors for nutrition report rendering.
 * Contains all sizes, fonts, colors, and layout constants.
 */

export const nutriReportTheme = {
  // Canvas dimensions
  canvas: {
    width: 1080,
    height: 1400,
    scale: 1.2,
  },

  // Layout
  layout: {
    topMargin: 100,
    sideMargin: 54, // (width * 0.05)
    foodListWidthRatio: 0.6,
    barChartWidthRatio: 0.9,
    barChartHeight: 460,
    progressBarHeight: 48,
    pieChartPadding: 10,
    sectionGap: 30,
    statRowHeight: 45,
    lineHeight: 44,
    iconSize: 32,
    macroRectWidth: 46,
    macroRectHeight: 30,
    barWidthRatio: 0.7,
  },

  // Fonts
  fonts: {
    family: 'Roboto Condensed',
    title: '64px "Roboto Condensed"',
    subtitle: '36px "Roboto Condensed"',
    pieLabel: '48px "Roboto Condensed"',
    default: '32px "Roboto Condensed"',
    small: '20px "Roboto Condensed"',
    foodItem: '32px "Roboto Condensed"',
    macroLabel: '18px "Roboto Condensed"',
  },

  // Colors
  colors: {
    background: '#ffffff',
    text: '#000000',
    protein: '#fe938c',    // Pink/salmon
    carbs: '#a3b18a',      // Sage green
    fat: '#f6bd60',        // Golden yellow
    chartBg: '#FAF3ED',    // Light cream
    barBase: '#CCC',       // Gray base for bars
    gridLine: '#AAA',      // Grid lines
    overGoal: '#b00020',   // Red - over budget
    underGoal: '#7da87a',  // Green - under minimum
    caution: '#f6bd60',    // Yellow - approaching goal
    brand: '#666',         // Secondary text
  },

  // Nutrition constants
  nutrition: {
    defaultGoalCalories: 2000,
    minRecommendedCalories: 1200,
    caloriesPerGramProtein: 4,
    caloriesPerGramCarbs: 4,
    caloriesPerGramFat: 9,
  },

  // Chart settings
  chart: {
    barCount: 7,
    headroomMultiplier: 1.1,
  },
};

export default nutriReportTheme;
