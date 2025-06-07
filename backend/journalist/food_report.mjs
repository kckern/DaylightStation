import fs from 'fs';
import path from 'path';
import stringSimilarity from 'string-similarity';
import moment from 'moment-timezone';
import { loadNutrilogsNeedingListing, loadRecentNutriList } from './lib/db.mjs';
import { handlePendingNutrilogs } from './lib/food.mjs';
import { createCanvas, loadImage, registerFont } from 'canvas';
import axios from 'axios';
import { saveFile } from '../lib/io.mjs';

/**
 * REGISTER FONTS
 * --------------------------------------------------
 * You can use registerFont to load your .ttf or .otf
 * fonts. If you only have .fnt (bitmap fonts for jimp),
 * convert them to TTF or choose an equivalent TTF font.
 *
 * Example:
 *    registerFont('./api/fonts/OpenSans-Regular.ttf', {
 *      family: 'Open Sans'
 *    });
 * Make sure the path and family name match your setup.
 */
// For demo purposes, using built-in system fonts:
//console.log(process.env);
const fontDir = process.env.path?.font || './backend/journalist/fonts/roboto-condensed';
const fontPath =fontDir + '/roboto-condensed/RobotoCondensed-Regular.ttf';

console.log('Registering font:', fontPath);

//register font ./fonts/RobotoCondensed-Regular.ttf
registerFont(fontPath, {  family: 'Roboto Condensed', });


const DEFAULT_FONT = '32px "Roboto Condensed"';
const TITLE_FONT = '64px "Roboto Condensed"';
const PIE_LABEL_FONT = '48px "Roboto Condensed"';
const SUBTITLE_FONT = '36px "Roboto Condensed"';

/**
 * Helper functions for measuring text.
 * Canvas measureText returns an object that can be used
 * for exact text width and approximate text height (via
 * the bounding box).
 */
function getTextWidth(ctx, text) {
  return ctx.measureText(text).width;
}

function getTextHeight(ctx, text) {
  const metrics = ctx.measureText(text);
  // approximate text height
  return metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
}

/**
 * Draw a filled rectangle with optional label in the center.
 */
function drawRect(ctx, x, y, w, h, color, label, font, pos) {
  if (!w || !h) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);

  if (label) {
    ctx.font = font || DEFAULT_FONT;
    ctx.fillStyle = '#000';

    // measure label
    const labelWidth = getTextWidth(ctx, label);
    const labelHeight = getTextHeight(ctx, label);

    // default to 'center-middle'
    let labelX = x + w / 2 - labelWidth / 2;
    let labelY = y + h / 2 + labelHeight / 4; // because fillText draws from baseline

    if (pos) {
      // horizontal position
      if (/left/.test(pos)) {
        labelX = x;
      } else if (/right/.test(pos)) {
        labelX = x + w - labelWidth;
      }
      // vertical position
      if (/top/.test(pos)) {
        labelY = y + labelHeight;
      } else if (/bottom/.test(pos)) {
        labelY = y + h;
      }
    }
    ctx.fillText(label, labelX, labelY);
  }
  ctx.restore();
}

/**
 * Create a simple pie chart with Canvas.
 * We approximate the jimp logic by drawing arcs for each slice.
 * The wedge label is drawn near its center.
 */
async function makePieChart(pieChartData, pieChartHeight) {
  // default example usage if data is not provided
  pieChartData = pieChartData || [
    { color: '#f4a259', value: 45 },
    { color: '#8cb369', value: 20 },
    { color: '#f4e285', value: 30 },
  ];
  const pieChartWidth = pieChartHeight;
  const pieCanvas = createCanvas(pieChartWidth, pieChartHeight);
  const ctx = pieCanvas.getContext('2d');

  const pieChartTotal = pieChartData.reduce((acc, slice) => acc + slice.value, 0);
  // compute each slice’s percentage
  pieChartData.forEach((slice) => {
    slice.percentage = slice.value / pieChartTotal;
  });

  let startAngle = 0;
  const radius = pieChartWidth / 2;
  const centerX = pieChartWidth / 2;
  const centerY = pieChartHeight / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // We'll use TITLE_FONT for big wedge labels and SUBTITLE_FONT for sub-labels:
  for (const slice of pieChartData) {
    const endAngle = startAngle + slice.percentage * 2 * Math.PI;
    // Draw the wedge
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();

    // Now place the label in the middle of the wedge
    const midAngle = startAngle + (endAngle - startAngle) / 2;
    const labelRadius = radius * 0.6;
    const wedgeCenterX = centerX + Math.cos(midAngle) * labelRadius;
    const wedgeCenterY = centerY + Math.sin(midAngle) * labelRadius;

    const label = slice.label || String(slice.value);
    const subLabel = slice.subLabel || slice.sublabel || '';

    // Draw the main label
    ctx.save();
    ctx.font = PIE_LABEL_FONT;
    const labelWidth = getTextWidth(ctx, label);
    ctx.fillStyle = '#000';
    // Because fillText is baseline-left, shift upward a bit
    ctx.fillText(label, wedgeCenterX, wedgeCenterY - 10);

    // Draw the sub-label under it
    if (subLabel) {
      ctx.font = SUBTITLE_FONT;
      ctx.fillText(subLabel, wedgeCenterX, wedgeCenterY + 30);
    }
    ctx.restore();

    startAngle = endAngle;
  }
  return pieCanvas;
}

/**
 * Create a list of food items visually, sorted by calories.
 */
async function makeFoodList(food, width, height) {
  const listCanvas = createCanvas(width, height);
  const ctx = listCanvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  // sort descending by calories
  food = food.sort((b, a) => a.calories - b.calories);

  // figure line spacing
  const fontSize = 32;
  ctx.font = `${fontSize}px sans-serif`;

  const lineHeight = fontSize + 4; // minimal padding
  let foodItemCount = food.length;
  let lineSpacing = height / foodItemCount - lineHeight - 1;
  // reduce item count until it fits
  while (lineSpacing < 0 && foodItemCount > 0) {
    foodItemCount--;
    lineSpacing = height / foodItemCount - lineHeight - 1;
  }
  food = food.slice(0, foodItemCount);

  // measure text width for a column or two
  const maxCalories = food.reduce((acc, item) => Math.max(acc, item.calories), 0);
  const calColumnStr = String(maxCalories);
  const calColumnWidth = ctx.measureText(calColumnStr).width + 30; // padding

  let y = 0;
  for (const foodItem of food) {
    const { item, amount, unit } = foodItem;
    const rowY = y;
    // print amount
    ctx.fillStyle = '#000';
    ctx.font = '16px sans-serif';
    const amountStr = `${amount}${unit}`;
    ctx.fillText(amountStr, calColumnWidth + 200, rowY + fontSize / 1.5);

    y += lineHeight + lineSpacing;
  }

  // example fill effect
  ctx.save();
  ctx.globalCompositeOperation = 'xor';
  ctx.fillStyle = '#CCC';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();

  // reset y to actually draw details
  y = 0;
  for (const foodItem of food) {
    const rowY = y;
    const { item, calories, icon, carbs, protein, fat } = foodItem;

    // Attempt to load the best matching icon from local images
    let loadedIcon;
    try {
      const basePath = path.resolve(process.cwd(), './api/data/food_icons/');
      const allIcons = fs
        .readdirSync(basePath)
        .filter((file) => file.endsWith('.png'))
        .map((file) => file.replace('.png', ''));
      const matches = stringSimilarity.findBestMatch(icon, allIcons);
      const iconImgPath = path.join(basePath, `${matches.bestMatch.target}.png`);
      loadedIcon = await loadImage(iconImgPath);
    } catch (e) {
      // fallback if icon not found
      loadedIcon = null;
    }

    // print calories in left column
    ctx.font = '32px sans-serif';
    const calStr = String(calories);
    const calStrWidth = getTextWidth(ctx, calStr);
    const calX = calColumnWidth - calStrWidth - 10;
    ctx.fillStyle = '#000';
    ctx.fillText(calStr, calX, rowY + fontSize);

    // place icon next to the calories
    if (loadedIcon) {
      ctx.drawImage(loadedIcon, calColumnWidth, rowY, 32, 32);
    }

    // print item name
    ctx.fillText(item, calColumnWidth + 40, rowY + fontSize);

    // macros on right side
    // rect area ~ 36x37 each
    const rectWidth = 36;
    const rectHeight = 37;
    const colors = { carbs: '#a3b18a', protein: '#fe938c', fat: '#f6bd60' };
    const macroKeys = Object.keys(colors);
    const rightSideX = width - rectWidth;

    macroKeys.forEach((macro, index) => {
      const macroValue = foodItem[macro];
      if (!Math.round(macroValue)) return;
      const macroX = rightSideX - 50 - rectWidth * index;
      drawRect(
        ctx,
        macroX,
        rowY,
        rectWidth,
        rectHeight,
        colors[macro],
        `${Math.round(macroValue)}g`,
        '16px sans-serif',
        'center-middle'
      );
    });

    y += lineHeight + lineSpacing;
  }

  return listCanvas;
}

/**
 * Generate either a placeholder or actual report for the user
 */
const placeholderImage = async (width, height) => {
  const placeholderCanvas = createCanvas(width, height);
  const ctx = placeholderCanvas.getContext('2d');

  // Set background color
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(0, 0, width, height);

  const now = moment().format('YYYY-MM-DD HH:mm:ss');

  ctx.font = '48px "Roboto Condensed"';
  ctx.fillStyle = '#333';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(now, width / 2, height / 2);

  // Add border
  ctx.strokeStyle = '#999';
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, width, height);

  return placeholderCanvas.toBuffer();
};

/**
 * The main function that compiles the day’s nutritional data
 * into one image: a pie chart, a list of foods, a bar chart, etc.
 */
export const generateImage = async (chat_id) => {
  const timezone = 'America/Los_Angeles';
  if (!chat_id) {
    console.error('No chat_id provided');
    return null;
  }
  await handlePendingNutrilogs(chat_id);

  // get data from supabase
  const data = loadRecentNutriList(chat_id) || [];
  if (!data || !data.length) {
    console.error('No data found');
    //return placeholderImage(1080, 1400);
    return null;
  }

  //save tmp data to a file for debugging
  saveFile(`nutrichart`, data);

  let daysAgo = 0;
  let todaysFood;
  while (true) {
    const dateToCheck = moment().tz(timezone).subtract(daysAgo, 'days').format('YYYY-MM-DD');
    todaysFood = data.filter((item) => item.date === dateToCheck);
    if (todaysFood.length) break;
    daysAgo++;
    if (daysAgo > 365) {
      // safety valve
      console.error('Unable to find data within 1 year.');
      break;
    }
  }

  const width = 1080;
  const height = 1400;
  const mainCanvas = createCanvas(width, height);
  const ctx = mainCanvas.getContext('2d');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  const macroGrams = todaysFood.reduce(
    (acc, item) => {
      acc.protein += item.protein;
      acc.carbs += item.carbs;
      acc.fat += item.fat;
      return acc;
    },
    { protein: 0, carbs: 0, fat: 0 }
  );

  const foodListWidth = width * 0.6;
  const leftSideWidth = width - foodListWidth;
  const pieChartWidth = leftSideWidth * 0.8;
  const midPoint = (leftSideWidth - pieChartWidth) / 2 + pieChartWidth / 2;

  /**
 * Generate the title section of the report.
 */
async function generateTitle(ctx, todaysFood, width) {
  const totalCals = Math.round(todaysFood.reduce((acc, item) => acc + item.calories, 0));
  const todaysFoodDateFormatted = moment(todaysFood[0].date).format('ddd, D MMM YYYY');
  const title = `${todaysFoodDateFormatted} | Calories: ${totalCals}`;

  ctx.font = TITLE_FONT;
  ctx.fillStyle = '#000';
  const titleWidth = getTextWidth(ctx, title);
  ctx.fillText(title, width / 2 - titleWidth / 2, 70);
}

/**
 * Generate the pie chart section.
 */
async function generatePieChart(ctx, macroGrams, leftSideWidth, pieChartWidth) {
  const sortedPieData = [
    {
      color: '#fe938c',
      value: Math.round(macroGrams.protein * 4),
      subLabel: 'Protein',
      label: `${Math.round(macroGrams.protein)}g`,
    },
    {
      color: '#a3b18a',
      value: Math.round(macroGrams.carbs * 4),
      subLabel: 'Carbs',
      label: `${Math.round(macroGrams.carbs)}g`,
    },
    {
      color: '#f6bd60',
      value: Math.round(macroGrams.fat * 9),
      subLabel: 'Fat',
      label: `${Math.round(macroGrams.fat)}g`,
    },
  ].sort((a, b) => a.value - b.value);

  const pieCanvas = await makePieChart(sortedPieData, pieChartWidth);
  const chartX = (leftSideWidth - pieChartWidth) / 2;
  ctx.drawImage(pieCanvas, chartX, 130);
}

/**
 * Generate the food list section.
 */
async function generateFoodList(ctx, todaysFood, foodListWidth, height, leftSideWidth) {
  const foodListCanvas = await makeFoodList(todaysFood, foodListWidth, height / 2 - 100);
  ctx.drawImage(foodListCanvas, leftSideWidth, 130);
}

/**
 * Generate the macro stats section.
 */
async function generateMicroStats(ctx, todaysFood, pieChartWidth, midPoint) {
  const stats = [
    {
      label: 'Sodium',
      unit: 'mg',
      icon: 'salt',
      value: Math.round(todaysFood.reduce((acc, item) => acc + item.sodium, 0)),
    },
    {
      label: 'Fiber',
      unit: 'g',
      icon: 'kale',
      value: Math.round(todaysFood.reduce((acc, item) => acc + item.fiber, 0)),
    },
    {
      label: 'Sugar',
      unit: 'g',
      icon: 'white_sugar',
      value: Math.round(todaysFood.reduce((acc, item) => acc + item.sugar, 0)),
    },
    {
      label: 'Cholesterol',
      unit: 'mg',
      icon: 'butter',
      value: Math.round(todaysFood.reduce((acc, item) => acc + item.cholesterol, 0)),
    },
  ];

  ctx.font = SUBTITLE_FONT;
  for (let i = 0; i < stats.length; i++) {
    const stat = stats[i];
    const iconY = 130 + pieChartWidth + 50 + i * 50;

    const amount = `${stat.value}${stat.unit}`;
    const textW = getTextWidth(ctx, amount);
    const labelW = getTextWidth(ctx, stat.label);

    const labelX = midPoint - 16 - labelW - 10;
    ctx.fillStyle = '#000';
    ctx.fillText(stat.label, labelX, iconY + 24);

    const amountX = midPoint + 16 + 10;
    ctx.fillText(amount, amountX, iconY + 24);

    const iconX = midPoint - 16;
    try {
      const iconPath = path.join(process.cwd(), './api/data/food_icons/', `${stat.icon}.png`);
      const loadedIcon = await loadImage(iconPath);
      ctx.drawImage(loadedIcon, iconX, iconY, 32, 32);
    } catch (err) {
      // Ignore missing icons
    }
  }
}

/**
 * Generate the daily chart section.
 */

async function generateDailyChart(
  ctx,
  data,
  barChartWidth,
  barChartHeight,
  barChartX,
  barChartY,
  bmr,
  calGoal,
  barMaxVal,
  timezone
) {
  // EXAMPLE COLORS (change as you like)
  timezone = timezone || 'America/Los_Angeles';
  const BG_COLOR = '#FAF3ED';
  const MACRO_COLORS = {
    carbs: '#a3b18a',
    protein: '#fe938c',
    fat: '#f6bd60',
  };
  const BMR_LINE_COLOR = '#AAA';
  const GOAL_LINE_COLOR = '#AAA';
  const BAR_BASE_COLOR = '#CCC';
  const TEXT_COLOR = '#000';

  // EXAMPLE FONTS
  const DEFAULT_FONT = '12px Arial';
  const SUBTITLE_FONT = '10px Arial';

  // 1. Background rectangle for the chart area
  drawRect(ctx, barChartX, barChartY, barChartWidth, barChartHeight, BG_COLOR);

  // 2. Draw horizontal lines for BMR and Goal
  const bmrY = barChartY + barChartHeight - (bmr / barMaxVal) * barChartHeight;
  drawRect(ctx, barChartX, bmrY, barChartWidth, 2, BMR_LINE_COLOR);

  const goalY = barChartY + barChartHeight - (calGoal / barMaxVal) * barChartHeight;
  drawRect(ctx, barChartX, goalY, barChartWidth, 2, GOAL_LINE_COLOR);

  // 3. Determine how many days to plot and set up spacing
  const barCount = 7; // Example: last 7 days
  const barAreaWidth = barChartWidth / barCount;
  const barWidth = barAreaWidth * 0.6; // space between bars

  // 4. Loop through each day (from oldest to most recent)
  for (let i = barCount - 1; i >= 0; i--) {
    const dateToCheck = moment()
      .tz(timezone)
      .subtract(i, 'days')
      .format('YYYY-MM-DD');

    // 4b. Filter log entries for that date
    const dayFood = data.filter((item) => item.date === dateToCheck);
    if (dayFood.length === 0) {
      // If no data, you could continue or draw an empty bar
      continue;
    }

    // 4c. Summarize daily totals
    const todaysData = dayFood.reduce(
      (acc, item) => {
        acc.calories += item.calories;
        acc.protein += item.protein;
        acc.carbs += item.carbs;
        acc.fat += item.fat;
        return acc;
      },
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );

    // 4d. Calculate stacked macro parts
    const totalMacroCals = 
      todaysData.carbs * 4 + todaysData.protein * 4 + todaysData.fat * 9;
    // Handle zero‑calorie edge case
    const carbsRatio = totalMacroCals ? (todaysData.carbs * 4) / totalMacroCals : 0;
    const proteinRatio = totalMacroCals ? (todaysData.protein * 4) / totalMacroCals : 0;
    const fatRatio = totalMacroCals ? (todaysData.fat * 9) / totalMacroCals : 0;

    // 4e. Compute bar dimensions
    const barX = barChartX + (barCount - 1 - i) * barAreaWidth + (barAreaWidth - barWidth) / 2;
    const barH = Math.min((todaysData.calories / barMaxVal) * barChartHeight, barChartHeight);
    const barBottom = barChartY + barChartHeight;

    // 4f. Label for day of week
    const dayLabel = moment().tz(timezone).subtract(i, 'days').format('ddd');
    ctx.save();
    ctx.font = SUBTITLE_FONT;
    ctx.fillStyle = TEXT_COLOR;
    const dayLabelWidth = getTextWidth(ctx, dayLabel);
    ctx.fillText(
      dayLabel,
      barX + barWidth / 2 - dayLabelWidth / 2,
      barBottom + 15 // slightly below the chart
    );
    ctx.restore();

    // 4g. Label for total calories at the top of the bar
    ctx.save();
    ctx.font = DEFAULT_FONT;
    const calsLabel = String(Math.round(todaysData.calories));
    const labelWidth = getTextWidth(ctx, calsLabel);
    const labelHeight = getTextHeight(ctx, calsLabel);
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(
      calsLabel,
      barX + barWidth / 2 - labelWidth / 2,
      barBottom - barH - labelHeight - 2
    );
    ctx.restore();

    // 4h. Draw the base bar (light gray)
    drawRect(ctx, barX, barBottom - barH, barWidth, barH, BAR_BASE_COLOR);

    // 4i. Draw stacked macros: start from the bottom of the bar
    let currentStackTop = barBottom;
    const macroStacks = [
      { ratio: carbsRatio, color: MACRO_COLORS.carbs, label: `${Math.round(todaysData.carbs)}g` },
      { ratio: proteinRatio, color: MACRO_COLORS.protein, label: `${Math.round(todaysData.protein)}g` },
      { ratio: fatRatio, color: MACRO_COLORS.fat, label: `${Math.round(todaysData.fat)}g` },
    ];

    macroStacks.forEach((macro) => {
      if (macro.ratio === 0) return;
      const macroH = barH * macro.ratio;
      drawRect(
        ctx,
        barX,
        currentStackTop - macroH,
        barWidth,
        macroH,
        macro.color,
        macro.label,
        DEFAULT_FONT,
        null
      );
      currentStackTop -= macroH;
    });
  }
}
/**
 * Generate the summary section.
 */
async function generateSummary(ctx, counter, width, height) {
  const lbsPerWeek = Math.round(((counter.def / counter.days) * 7) / 3500 * 10) / 10;
  const plusMinus = lbsPerWeek < 0 ? '+' : '-';
  ctx.font = SUBTITLE_FONT;
  const finalStr = `${plusMinus}${Math.abs(lbsPerWeek)} lbs/week`;
  const finalStrW = getTextWidth(ctx, finalStr);
  ctx.fillStyle = '#000';
  ctx.fillText(finalStr, width / 2 - finalStrW / 2, height - 50);
}

  await generateTitle(ctx, todaysFood, width);
  await generateFoodList(ctx, todaysFood, foodListWidth, height, leftSideWidth);
  await generatePieChart(ctx, macroGrams, leftSideWidth, pieChartWidth);
  await generateMicroStats(ctx, todaysFood, pieChartWidth, midPoint);

  const barChartWidth = width * 0.9;
  const barChartHeight = height / 3 - 150;
  const barChartX = (width - barChartWidth) / 2;
  const barChartY = height / 2 + 50;
  const barMaxVal = 2200;
  const bmr = 2000;
  const defGoal = 500;
  const calGoal = bmr - defGoal;

  await generateDailyChart(ctx, data, barChartWidth, barChartHeight, barChartX, barChartY, bmr, calGoal, barMaxVal);

  const counter = { days: 0, def: 0 };
  await generateSummary(ctx, counter, width, height);

  const scaledWidth = Math.round(width * 1.2);
  const scaledHeight = Math.round(height * 1.2);
  const scaledCanvas = createCanvas(scaledWidth, scaledHeight);
  const scaledCtx = scaledCanvas.getContext('2d');
  scaledCtx.drawImage(mainCanvas, 0, 0, scaledWidth, scaledHeight);

  return scaledCanvas;
};

/**
 * Exported default route handler (Next.js, for example)
 */
export const foodReport = async (req, res) => {
  const chat_id = req.query.chat_id || 'b6898194425_u575596036';

  const { uuid } = req.query;

  await handlePendingNutrilogs(chat_id); // Ensure all pending nutrilogs are processed

  const nutridata = loadRecentNutriList(chat_id); // Load the data for the given chat_id

  //console.log('Loaded nutridata:', nutridata); // For debugging

  // If you want the real report image, call generateImage:
   const mainCanvas = await generateImage(chat_id);
  if (!mainCanvas) {
    console.error('No mainCanvas generated');
    res.status(500).send('Failed to generate report image');
    return;
  } 
  // Set headers for PNG response
  res.set('Content-Type', 'image/png');
  res.set('Content-Disposition', `inline; filename="${uuid || 'food_report'}.png"`);
  // Send the generated image as a response
  return res.send(mainCanvas.toBuffer('image/png'));
  
};


export const scanBarcode = async (req, res) => {
  const { barcode } = req.query;
  try {
    const response = await axios.get(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
    res.set('Content-Type', 'application/json');
    res.set('Content-Disposition', `inline; filename="${barcode}.json"`);
    const whitelist = [
      'brands',
      'product_name',
      'serving_quantity',
      'serving_quantity_unit',
      'product_quantity',
      'product_quantity_unit',
      'selected_images',
    ];

    const result = whitelist.reduce((acc, key) => {
      const normalizedKey = key.replace(/-/g, '_');
      acc[normalizedKey] = response.data.product[key];
      return acc;
    }, {});

    // Extract serving-related items from nutriments
    const servingKeys = [
      'energy-kcal_serving',
      'carbohydrates_serving',
      'fat_serving',
      'proteins_serving',
      'sodium_serving',
      'sugars_serving',
    ];

    if (response.data.product.nutriments) {
      servingKeys.forEach((key) => {
      const normalizedKey = key.replace(/-/g, '_');
      result[normalizedKey] = response.data.product.nutriments[key];
      });
    }
    //"selected_images": { "front": { "display": { "en": "https://images.openfoodfacts.org/images/products/001/380/014/4072/front_en.3.400.jpg" }, "small": { "en": "https://images.openfoodfacts.org/images/products/001/380/014/4072/front_en.3.200.jpg" }, "thumb": { "en": "https://images.openfoodfacts.org/images/products/001/380/014/4072/front_en.3.100.jpg" } } },

    //loop through keys of selected_images to get the first image url
    const img = Object.keys(result.selected_images).reduce((acc, key) => {
      const imageUrl = result.selected_images[key].display.en;
      if (imageUrl) {
        acc.push(imageUrl);
      }
      return acc;
    }, []);
    delete result.selected_images;
    result.image = img[0];

    return res.json(result);
  } catch (error) {
    console.error('Error fetching barcode data:', error);
    res.status(500).json({ error: 'Failed to fetch barcode data' });
  }
};