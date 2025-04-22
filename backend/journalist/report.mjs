
import fs from 'fs';
import * as jimp from 'jimp';
import path from 'path';
import stringSimilarity from 'string-similarity';
import { loadNutrilogsNeedingListing, loadRecentNutriList } from './lib/db.mjs';
import moment from 'moment-timezone';
import { handlePendingNutrilogs, postItemizeFood } from './lib/food.mjs';
const fontsDir = path.resolve(process.cwd(), './api/fonts');
const fontDir = path.resolve(fontsDir, './open-sans');
const black16 = path.resolve(fontDir, './open-sans-16-black/open-sans-16-black.fnt');
const black32 = path.resolve(fontDir, './open-sans-32-black/open-sans-32-black.fnt');
const black64 = path.resolve(fontDir, './open-sans-64-black/open-sans-64-black.fnt');
const fonts = {};

const makePieChart = async (pieChartData, pieChartHeight, wedgeLabelFont, wedgeLabelSubFont) => {



  wedgeLabelFont = wedgeLabelFont || await jimp.loadFont(black64);
  wedgeLabelSubFont = wedgeLabelSubFont || await jimp.loadFont(black32);
  pieChartData = pieChartData || [{color: '#f4a259', value: 45}, {color: '#8cb369', value: 20}, {color: '#f4e285', value: 30}];
  const pieChartTotal = pieChartData.reduce((acc, slice) => acc + slice.value, 0);
  pieChartData.forEach(slice => slice.percentage = slice.value / pieChartTotal);
  const pieChartWidth = pieChartHeight;
  const pieChart = new jimp(pieChartWidth, pieChartHeight);
  const pieChartRadius = pieChartWidth/2;
  const pieChartCenterX = pieChartWidth / 2;
  const pieChartCenterY = pieChartHeight / 2;
  let startAngle = 0;
  let endAngle = 0;
  const labels = [];
  const subLabels = [];
  for (const slice of pieChartData) {
    endAngle = startAngle + (slice.percentage) * Math.PI * 2;
    const label = `${slice.label || slice.value}`;
    const subLabel = slice.subLabel ||slice.sublabel || '';
    for(let y = -pieChartRadius; y <= pieChartRadius; y++) {
      for(let x = -pieChartRadius; x <= pieChartRadius; x++) {
        if(x*x + y*y <= pieChartRadius*pieChartRadius) {
          let angle = Math.atan2(y, x) - Math.PI / 2; // subtract π/2 to rotate 90 degrees
          if (angle < 0) angle += Math.PI * 2; // adjust the angle to 0 to 2π
          if(startAngle <= angle && angle <= endAngle) {
            pieChart.setPixelColor(jimp.cssColorToHex(slice.color), x + pieChartCenterX, y + pieChartCenterY);
          }
        }
      }
    }
const [wedgeCenterX, wedgeCenterY] = [
  pieChartCenterX + Math.cos(((startAngle + Math.PI / 2) + (endAngle + Math.PI / 2)) / 2) * (pieChartRadius * 0.6),
  pieChartCenterY + Math.sin(((startAngle + Math.PI / 2) + (endAngle + Math.PI / 2)) / 2) * (pieChartRadius * 0.6)
];

    const wedgeLabelWidth = jimp.measureText(wedgeLabelFont, label);
    const wedgeLabelHeight = jimp.measureTextHeight(wedgeLabelFont, label);
    labels.push({label, wedgeCenterX, wedgeCenterY, wedgeLabelWidth, wedgeLabelHeight});

    const [wedgeSublabelWidth, wedgeSublabelHeight] = [
      jimp.measureText(wedgeLabelSubFont, subLabel),
      jimp.measureTextHeight(wedgeLabelSubFont, subLabel)
    ];
    subLabels.push({subLabel, wedgeCenterX, wedgeCenterY, wedgeSublabelWidth, wedgeSublabelHeight});
  

    startAngle = endAngle;
  }
  for (const l of labels) {
    pieChart.print(wedgeLabelFont, 
      l.wedgeCenterX - l.wedgeLabelWidth / 2, 
      l.wedgeCenterY - l.wedgeLabelHeight / 4, 
      l.label);
  }
  for (const l of subLabels) {
    pieChart.print(wedgeLabelSubFont, 
      l.wedgeCenterX - l.wedgeSublabelWidth / 2, 
      l.wedgeCenterY + (l.wedgeSublabelHeight / 4) + 10,
      l.subLabel);
  }
  
  return pieChart;
}

const drawRect = (image, x, y, w, h, color, label, font, pos) => {
  if(!h || !w) return ;
  font = font || fonts['chartLabelFont'];
  label = label || '';
  image.scan(x, y, w, h, (x, y, idx) =>  image.setPixelColor( jimp.cssColorToHex(color), x, y));

  pos = pos || 'center-middle';
  const [labelWidth, labelHeight] = [jimp.measureText(font, label), font?.info?.size || jimp.measureTextHeight(font, label)];
  const labelX = /center/.test(pos) ? x + w / 2 - labelWidth / 2 : 
                  /right/.test(pos) ? x + w - labelWidth : 
                  /left/.test(pos) ? x : x;
  const labelY = /top/.test(pos) ? y - labelHeight : 
                 /middle/.test(pos) ? y + (h / 2) - (labelHeight / 2) : 
                 /bottom/.test(pos) ? y + h : y;

  image.print(font, labelX, labelY, label);
}


const makeFoodList = async (food, width, height) => {

  food = food.sort((b,a) => a.calories - b.calories);
  const font = await jimp.loadFont(black32);
  const lineHeight = 36;
  let foodItemCount = food.length;
  let lineSpacing = (height / foodItemCount) - lineHeight -1;
  while (lineSpacing < 0) {
    foodItemCount--;
    lineSpacing =  (height / foodItemCount) - lineHeight -1;
  }
  food = food.slice(0, foodItemCount);

  const maxCalories = food.reduce((acc, food_item) => Math.max(acc, food_item.calories), 0);
  const fontSm = await jimp.loadFont(black16);
  const calColumnWidth = jimp.measureText(font, `${maxCalories}`) + 10;
  const foodListCanvas = new jimp(width, height);
  let y = 0;
  for(const food_item of food) {
    const {item, amount, unit,icon} = food_item;
    const itemWidth = jimp.measureText(font, item);
    const itemHeight = jimp.measureTextHeight(font, item);
    foodListCanvas.print(fontSm, calColumnWidth + itemWidth + 50, y + 12  , `${amount}${unit}`);
    y += lineHeight + lineSpacing;
  }
  foodListCanvas.color([{ apply: 'xor', params: ['#CCC'] }]);
  y = 0; // Reset y to start from the beginning
  for(const food_item of food) {
    const {item, calories, icon} = food_item;
    const basePath = path.resolve(process.cwd(), './api/data/food_icons/');
    const allIcons = fs.readdirSync(basePath).filter(file => file.endsWith('.png')).map(file => file.replace('.png', ''));
    const matches = stringSimilarity.findBestMatch(icon, allIcons);
    const iconImgPath = `${basePath}/${matches.bestMatch.target}.png`
    const iconImg = await jimp.read(iconImgPath);
    const iconImgWithHeight = iconImg.resize(32, 32);

    const calWidth = jimp.measureText(font, `${calories}`);
    const calX = calColumnWidth - calWidth - 10;
    foodListCanvas.print(font, calX, y, `${calories} `);

    foodListCanvas.composite(iconImgWithHeight, calColumnWidth, y);


    foodListCanvas.print(font, calColumnWidth + 40, y, item);

    //print macros on right side
    const rectWidth = 36;
    const smallFont = fonts['chartLabelFont'];
    const rectHeight = 37;
    const colors = {carbs: '#a3b18a', protein: '#fe938c', fat: '#f6bd60'};
    const rightSideX = width - rectWidth;
    //loop through macros
    const macroKeys = Object.keys(colors);
    for(const macro of macroKeys) {
      const index = macroKeys.indexOf(macro);
      //draw a rect for each macro aligned to the right, stacked horizontally
      const color = colors[macro];
      const macroValue = food_item[macro];
      const macroX = rightSideX - 50 - (rectWidth * (index));
      if(!Math.round(macroValue)) continue;
      drawRect(foodListCanvas, macroX, y, rectWidth, rectHeight, color, `${Math.round(macroValue)}g`, smallFont, 'center-middle');
    }

    y += lineHeight + lineSpacing;
  }

  // Set color back to black
  return foodListCanvas;  
}


export const generateImage = async (chat_id) => {

  const timezone = 'America/Los_Angeles';
  chat_id = chat_id || `b6898194425_u575596036`;
  await handlePendingNutrilogs(chat_id);

  //get data from supabase
  const data = await loadRecentNutriList(chat_id);
  if(!data) return console.error('No data found');

  let daysAgo = 0;
  let todaysFood;
  while (true) {
    const dateToCheck = moment().tz(timezone).subtract(daysAgo, 'days').format('YYYY-MM-DD');
    todaysFood = data.filter(item => item.date === dateToCheck);
    if (todaysFood.length)  break;
    daysAgo++;
  }

  const [width,height] = [1080,1400];
  const image = await jimp.read(width, height, "white");


  //title
  const totalCals = Math.round(todaysFood.reduce((acc, item) => acc + item.calories, 0));
  const macroGrams = todaysFood.reduce((acc, item) => {
    acc.protein += item.protein;
    acc.carbs += item.carbs;
    acc.fat += item.fat;
    return acc;
  }, {protein: 0, carbs: 0, fat: 0});

  const todaysFoodDateFormatted = moment(todaysFood[0].date).format('ddd, D MMM YYYY');

  const title = `${todaysFoodDateFormatted} | Calories: ${totalCals}`;
  const titleFont = await jimp.loadFont(black64);
  const listFont = await jimp.loadFont(black32);
  const chartLabelFont = await jimp.loadFont(black16);
  fonts['chartLabelFont'] = chartLabelFont;
  const titleWidth = jimp.measureText(titleFont, title);
  image.print(titleFont, width/2 - titleWidth/2, 10, title);


  const foodListWidth = width * 0.6;
  const leftSideWidth = width - foodListWidth;
  const foodList = await makeFoodList(todaysFood, foodListWidth, (height/2) - 100);
  image.composite(foodList, width - foodListWidth,(64*2));

  const pieChartWidth = leftSideWidth * 0.8;
  const pieChart = await makePieChart([
    {color: '#fe938c', value: Math.round(macroGrams.protein*4), sublabel: 'Protein', label: `${Math.round(macroGrams.protein)}g`},
    {color: '#a3b18a', value: Math.round(macroGrams.carbs*4), sublabel: 'Carbs', label: `${Math.round(macroGrams.carbs)}g`},
    {color: '#f6bd60', value: Math.round(macroGrams.fat*9), sublabel: 'Fat', label: `${Math.round(macroGrams.fat)}g`}].sort((b,a) => b.value - a.value),
    pieChartWidth);

  const pieChartMargin = (leftSideWidth - pieChartWidth) / 2;
  const [chartX, chartY] = [pieChartMargin,(64*2)];
  image.composite(pieChart, chartX, chartY);


    //TODO: Add more day stats with food icons
    // - sodium
    const midPoint = chartX + pieChartWidth / 2;
    const stats = [
    {label: 'Sodium',unit: 'mg', icon: 'salt',  value: Math.round(todaysFood.reduce((acc, item) => acc + item.sodium, 0))},
    {label: 'Fiber', unit: 'g', icon: 'kale', value: Math.round(todaysFood.reduce((acc, item) => acc + item.fiber, 0))},
    {label: 'Sugar',unit: 'g', icon: 'white_sugar', value: Math.round(todaysFood.reduce((acc, item) => acc + item.sugar, 0))},
    {label: 'Cholesterol',unit: 'mg', icon: 'butter', value: Math.round(todaysFood.reduce((acc, item) => acc + item.cholesterol, 0))},
  ];

  for (let i = 0; i < stats.length; i++) {
    const stat = stats[i];
    const iconX = midPoint - 16;
    const iconY = chartY + pieChartWidth + 50 + (i * 50);

    // print the amount and unit to the right of the icon
    const amount = `${stat.value}${stat.unit}`;
    const amountWidth = jimp.measureText(listFont, amount);
    const amountX = midPoint + 16;
    const amountY = iconY;
    image.print(listFont, amountX + 10, amountY, amount);

    // print the label to the left of the icon, aligned right
    const labelWidth = jimp.measureText(listFont, stat.label);
    const labelX = midPoint - 16 - labelWidth;
    const labelY = iconY;
    image.print(listFont, labelX -10, labelY, stat.label);
    //32x32 box
    //image.scan(iconX, iconY, 32, 32, (x, y, idx) =>  image.setPixelColor( jimp.cssColorToHex('#f00'), x, y));
    //now place the icon in the box
    const iconImgPath = `./api/data/food_icons/${stat.icon}.png`;
    const iconImg = await jimp.read(iconImgPath);
    const resizedIconImg = iconImg.resize(32, 32);
    image.composite(resizedIconImg, iconX, iconY);
  }
    

    //TODO: Add a daily meter
    // - calories with macro breakdown
    // - excercise

    //loop through the last 10 days
    const barChartWidth = width * 0.9;
    const barChartHeight = (height / 3) - 150;
    const barChartX = (width - barChartWidth) / 2;
    const barChartY = height /2  + 50;
    const barCount = 13;
    const barAreaWidth = barChartWidth / (barCount - 1);
    const barWidth = barAreaWidth * 0.8;
    const barMaxVal = 2200;
    const bmr = 2000;
    const defGoal = 500;
    const calGoal = bmr - defGoal;

    //draw the bar chart area rect in cream
    drawRect(image, barChartX, barChartY, barChartWidth, barChartHeight, '#FAF3ED');

    drawRect(image, barChartX, barChartY + barChartHeight - (bmr / barMaxVal * barChartHeight), barChartWidth, 2, '#AAA', `BMR: ${bmr}`,null,'left-bottom');
    drawRect(image, barChartX, barChartY + barChartHeight - (calGoal / barMaxVal * barChartHeight), barChartWidth, 2, '#AAA', `Goal: ${calGoal}`,null,'left-bottom');
  

const counter = {days:0,def:0};    
for(let i = barCount - 1; i >= 1; i--) {
  const dateToCheck = moment().tz(timezone).subtract(i, 'days').format('YYYY-MM-DD');
  const food = data.filter(item => item.date === dateToCheck);
  const todaysData = food.reduce((today, item) => {
    today.date = dateToCheck; 
    today.calories = today.calories || 0;
    today.protein = today.protein || 0;
    today.carbs = today.carbs || 0;
    today.fat = today.fat || 0;
    today.calories += item.calories;
    today.protein += item.protein;
    today.carbs += item.carbs;
    today.fat += item.fat;
    return today;
  },{});

  const steps = 3000;
  const calsPerStep = 0.04;
  const stepCals = steps * calsPerStep;
  //rand between 0 and 250
  const excerciseCals = Math.floor(Math.random() * 10);
  todaysData['burned'] = bmr + stepCals + excerciseCals;
  todaysData['deficit'] = todaysData.burned - todaysData.calories;
  const totalWeight = todaysData.protein * 4 + todaysData.carbs * 4 + todaysData.fat * 9;
  todaysData.protein_percent = (todaysData.protein * 4) / totalWeight;
  todaysData.carbs_percent = (todaysData.carbs * 4) / totalWeight;
  todaysData.fat_percent = (todaysData.fat * 9) / totalWeight;

  const {calories, protein_percent, carbs_percent, fat_percent} = todaysData;
  const barX = barChartX + ((barCount - 1 - i) * barAreaWidth) + ((barAreaWidth - barWidth) / 2);
  const barY = barChartY;
  const barW = barWidth;
  const barH = Math.min((calories / barMaxVal) * barChartHeight, barChartHeight);

  //draw bar based on calories, JIMP
  // Replace the line with image.drawRect with the following code:

  // Calculate the start and end points of the rectangle
  const proteinHeight = barH * (protein_percent );
  const carbsHeight = barH * (carbs_percent );
  const fatHeight = barH * (fat_percent );


  const dayOfWeek = moment().tz(timezone).subtract(i, 'days').format('ddd');
  const dayOfWeekWidth = jimp.measureText(listFont, dayOfWeek);
  const dayOfWeekX = barX + barWidth / 2 - dayOfWeekWidth / 2;
  const dayOfWeekY = barChartY + barChartHeight + 10;
  image.print(listFont, dayOfWeekX, dayOfWeekY, dayOfWeek);

  //print deficit under the day of the week
  const negative = todaysData.deficit > 0 ? false : true;
  counter.days++;
  counter.def += todaysData.deficit;
  const deficit = Math.abs(Math.round(todaysData.deficit));
  const deficitWidth = jimp.measureText(listFont, `${deficit}`);
  const deficitX = barX + barWidth / 2 - deficitWidth / 2;
  const deficitY = dayOfWeekY + 40;
  const color = negative ? '#FFD5D4' : '#BDE7BD';
  //draw colored box behind text
  drawRect(image, deficitX - 5, deficitY, deficitWidth + 10, 40, color, `${deficit}`, listFont, 'center-middle');



  let currentY = barY + barChartHeight;
  //print total calls on top of the bar, centered
  const totalCaloriesWidth = jimp.measureText(chartLabelFont, `${calories}`);
  const fontHeight = chartLabelFont.info.size;
  const totalCaloriesX = barX - (totalCaloriesWidth / 2) + (barW / 2);
  const totalCaloriesY = currentY - barH - fontHeight - 2;
  image.print(chartLabelFont, totalCaloriesX, totalCaloriesY, `${Math.round(calories || 0)}`);
  //draw black recatable over label
  //drawRect(image, totalCaloriesX, totalCaloriesY , totalCaloriesWidth, fontHeight , '#000');

  //draw a grey rect for the whole bar, H is totalHeight, barY should factor in the height of the bar to it touches the bottom
  drawRect(image, barX, barY + barChartHeight - barH, barW, barH, '#CCC');


  drawRect(image, barX, currentY - carbsHeight, barW, carbsHeight, '#a3b18a', `${Math.round(todaysData.carbs)}g`);
  currentY -= carbsHeight;
  drawRect(image, barX, currentY - proteinHeight, barW, proteinHeight, '#fe938c', `${Math.round(todaysData.protein)}g`);
  currentY -= proteinHeight;
  drawRect(image, barX, currentY - fatHeight, barW, fatHeight, '#f6bd60', `${Math.round(todaysData.fat)}g`);}


  const lbsPerWeek = Math.round((((counter.def / counter.days) * 7 ) / 3500) * 10) / 10;
  const plusMinus = lbsPerWeek < 0 ? '+' : '-';

  //print lbs per week, bottom center
  const lbsPerWeekWidth = jimp.measureText(listFont, `${plusMinus}${lbsPerWeek} lbs/week`);
  const lbsPerWeekX = width / 2 - lbsPerWeekWidth / 2;
  const lbsPerWeekY = height - 100;
  image.print(listFont, lbsPerWeekX, lbsPerWeekY, `${plusMinus}${lbsPerWeek} lbs/week`);


  image.scale(1.2);
    
  return image;
}


export default async (req, res) => {
  const chat_id = req.query.chat_id || `b6898194425_u575596036`;
  const image = await generateImage(chat_id);
  const path = `/tmp/report_${chat_id}.png`;
  image.write(path, () => {
    res.setHeader('Content-Type', 'image/png');
    res.send(fs.readFileSync(path));
  });

}

