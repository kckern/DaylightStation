/** Fresh transfer items for each Elementary Math 2–3 module mastery bank. */

const q = (prompt, answer, decoys, feedback, concepts, figure = null) => ({
  prompt, answer, decoys, feedback, concepts, ...(figure ? { figure } : {}),
});

const dataFigure = (labels, values, style = 'bar') => ({
  kind: 'data_graph',
  alt: `${style === 'line_plot' ? 'A line plot' : style === 'pictograph' ? 'A pictograph' : 'A bar graph'} with ${labels.map((label, index) => `${label}: ${values[index]}`).join(', ')}.`,
  params: { labels, values, style },
});

const numberLineFigure = ({ min, max, step, value, label = 'A', labels = [min, max], fraction = false }) => ({
  kind: 'number_line',
  alt: `${fraction ? 'A fraction' : 'A'} number line from ${min} to ${max} with point ${label} at ${value}.`,
  params: { min, max, step, labels, marks: [{ value, label }] },
});

const baseTenFigure = (hundreds, tens, ones) => ({
  kind: 'base_ten',
  alt: `${hundreds} hundreds, ${tens} tens, and ${ones} ones shown with base-ten blocks.`,
  params: { hundreds, tens, ones },
});

const tenFrameFigure = (filled) => ({
  kind: 'ten_frame', alt: `Ten-frame model showing ${filled} filled counters.`,
  params: { filled, frames: filled > 10 ? 2 : 1 },
});

const arrayFigure = (rows, columns) => ({
  kind: 'array', alt: `An array with ${rows} rows and ${columns} columns.`, params: { rows, columns },
});

const fractionFigure = (numerator, denominator) => ({
  kind: 'fraction_model', alt: `A bar divided into ${denominator} equal parts with ${numerator} shaded.`,
  params: { numerator, denominator },
});

const shapeFigure = (type, description) => ({
  kind: 'shape_set', alt: `Shape A is ${description}.`, params: { shapes: [{ label: 'A', type }] },
});

const clockFigure = (hour, minute) => ({
  kind: 'clock', alt: `An analog clock showing ${hour}:${String(minute).padStart(2, '0')}.`, params: { hour, minute },
});

const BLUEPRINTS = Object.freeze({
  'number-sense': [
    q('In 681, what amount does the digit 6 represent?', 600, [6, 60, 6000, 681], 'The 6 is in the hundreds place, so it represents 6 hundreds, or 600.', ['place-value']),
    q('What number is shown by the base-ten blocks?', 307, [37, 370, 703, 10], 'Three hundreds, zero tens, and seven ones combine to make 307.', ['base-ten-models'], baseTenFigure(3, 0, 7)),
    q('Which number equals $700 + 40 + 2$?', 742, [724, 472, 7042, 746], 'Place 7 in hundreds, 4 in tens, and 2 in ones to form 742.', ['number-forms']),
    q('What comes next? $230, 240, 250, \_\_\_$', 260, [251, 255, 270, 350], 'The pattern increases by 10 each time; 250 + 10 = 260.', ['skip-counting']),
    q('Which digit is in the tens place in 904?', 0, [9, 4, 90, 900], 'The middle digit is the tens digit; zero holds that place in 904.', ['place-value']),
    q('What number is shown by the base-ten blocks?', 254, [245, 524, 11, 2054], 'Two hundreds, five tens, and four ones combine to make 254.', ['base-ten-models'], baseTenFigure(2, 5, 4)),
    q('Which expanded form names 608?', '$600 + 8$', ['$60 + 8$', '$600 + 80$', '$600 + 80 + 8$', '$6 + 8$'], 'The zero tens contribute nothing, so 608 is 600 + 8.', ['number-forms']),
    q('What number is missing? $45, 50, □, 60$', 55, [51, 54, 56, 65], 'Each term is 5 more than the previous term, so the missing number is 55.', ['skip-counting']),
    q('Which number has 5 hundreds, 2 tens, and 9 ones?', 529, [592, 259, 5209, 16], 'Combine 500 + 20 + 9 to get 529.', ['place-value', 'number-forms']),
    q('What number is shown by the base-ten blocks?', 419, [491, 149, 14, 4109], 'Four hundreds, one ten, and nine ones combine to make 419.', ['base-ten-models'], baseTenFigure(4, 1, 9)),
    q('What is the standard form of $300 + 70 + 5$?', 375, [357, 735, 3075, 378], 'The parts fill the hundreds, tens, and ones places: 375.', ['number-forms']),
    q('What comes next? $450, 550, 650, \_\_\_$', 750, [651, 700, 760, 1650], 'The pattern increases by 100; add 100 to 650.', ['skip-counting']),
  ],

  'compare-order-round': [
    q('Which number is greatest?', 914, [491, 419, 194, 904], 'Compare hundreds first; 914 has 9 hundreds, more than every other choice.', ['compare-numbers']),
    q('Which number is least?', 507, [570, 705, 750, 517], 'All choices are compared from hundreds to tens; 507 is least.', ['compare-numbers']),
    q('What number is marked by point A?', 37, [36, 38, 40, 47], 'Start at the labeled 30 and count seven equal one-unit spaces to 37.', ['number-lines'], numberLineFigure({ min: 30, max: 50, step: 1, value: 37, labels: [30, 40, 50] })),
    q('Round 76 to the nearest ten.', 80, [70, 76, 90, 60], 'The ones digit is 6, so 76 rounds up to 80.', ['rounding']),
    q('Which number is greatest?', 862, [682, 628, 826, 852], 'The hundreds digits tie for two choices, so compare tens; 862 is greater than 826.', ['compare-numbers']),
    q('Which number is least?', 390, [399, 409, 490, 400], 'Three hundreds makes 390 and 399 smaller than the 400s; 390 has fewer tens than 399.', ['compare-numbers']),
    q('What number is marked by point A?', 35, [30, 40, 5, 7], 'The ticks increase by 5; the mark after 30 is 35.', ['number-lines'], numberLineFigure({ min: 0, max: 50, step: 5, value: 35, labels: [0, 25, 50] })),
    q('Round 364 to the nearest hundred.', 400, [200, 300, 364, 500], 'The tens digit is 6, so round 3 hundreds up to 4 hundreds.', ['rounding']),
    q('Which list orders the numbers from greatest to least?', '721, 712, 271, 217', ['217, 271, 712, 721', '721, 271, 712, 217', '712, 721, 271, 217', '721, 712, 217, 271'], 'Compare hundreds first, then tens when hundreds match.', ['order-numbers']),
    q('Which number is closest to 500?', 497, [482, 516, 540, 451], '497 is only 3 away from 500, closer than the other choices.', ['number-lines', 'compare-distance']),
    q('What number is marked by point A?', 125, [100, 120, 150, 25], 'The line increases by 25; the marked tick is 125.', ['number-lines'], numberLineFigure({ min: 0, max: 200, step: 25, value: 125, labels: [0, 100, 200] })),
    q('Round 650 to the nearest hundred.', 700, [500, 600, 650, 800], 'Six hundred fifty is halfway, so the 5 in the tens place rounds the hundreds up to 700.', ['rounding']),
  ],

  'addition-facts': [
    q('What is $8 + 7$?', 15, [14, 16, 1, 56], 'Make 10 by moving 2 from 7 to 8; 10 + 5 = 15.', ['addition-facts']),
    q('How many counters are shown?', 13, [3, 7, 10, 17], 'Count one full frame as 10 and add the 3 counters in the second frame.', ['ten-frames'], tenFrameFigure(13)),
    q('What number makes $9 + □ = 17$ true?', 8, [9, 17, 26, 7], 'Subtract the known addend from the total: 17 − 9 = 8.', ['missing-addends']),
    q('Solve mentally: $39 + 21$.', 60, [50, 58, 61, 70], 'Add 20 to 39 to get 59, then add 1 more.', ['mental-addition']),
    q('Which expression has a sum of 16?', '$9 + 7$', ['$8 + 7$', '$9 + 6$', '$10 + 7$', '$8 + 6$'], 'Use make-ten or known facts; 9 + 7 is the only sum of 16.', ['addition-facts']),
    q('How many counters are shown?', 18, [8, 10, 12, 20], 'A full ten-frame and 8 more counters make 18.', ['ten-frames'], tenFrameFigure(18)),
    q('What number makes $□ + 6 = 14$ true?', 8, [6, 14, 20, 7], 'Undo the addition: 14 − 6 = 8.', ['missing-addends']),
    q('Solve mentally: $58 + 19$.', 77, [67, 78, 79, 87], 'Add 20 to get 78, then subtract 1 because 19 is one less than 20.', ['mental-addition']),
    q('Use a near-double to solve $6 + 7$.', 13, [12, 14, 1, 42], 'Double 6 is 12; one more makes 13.', ['addition-facts']),
    q('How many counters are shown?', 9, [1, 10, 11, 19], 'Count the 9 filled spaces, not the one empty space.', ['ten-frames'], tenFrameFigure(9)),
    q('What number makes $7 + □ = 20$ true?', 13, [7, 12, 20, 27], 'The missing part is 20 − 7 = 13.', ['missing-addends']),
    q('Solve mentally: $74 + 9$.', 83, [73, 82, 84, 93], 'Add 10 to reach 84, then subtract 1.', ['mental-addition']),
  ],

  'multi-digit-addition': [
    q('What is $42 + 35$?', 77, [67, 73, 87, 13], 'Add ones, 2 + 5 = 7, and tens, 4 tens + 3 tens = 7 tens.', ['two-digit-addition']),
    q('What is $56 + 38$?', 94, [84, 814, 104, 18], 'Six plus 8 makes 14 ones; write 4 and regroup one ten.', ['addition-regrouping']),
    q('What is $18 + 27 + 35$?', 80, [45, 53, 70, 90], 'Use all three addends: 18 + 27 = 45, then 45 + 35 = 80.', ['add-three-numbers']),
    q('What is $427 + 186$?', 613, [513, 603, 623, 241], 'Add by place and regroup from ones to tens and tens to hundreds.', ['three-digit-addition']),
    q('Which sum is correct?', '$63 + 24 = 87$', ['$63 + 24 = 77$', '$63 + 24 = 89$', '$63 + 24 = 97$', '$63 + 24 = 39$'], 'Add tens and ones by place value: 60 + 20 and 3 + 4 make 87.', ['two-digit-addition']),
    q('What is $47 + 29$?', 76, [66, 616, 86, 18], 'Seven plus 9 makes 16 ones; regroup the ten, then add the tens.', ['addition-regrouping']),
    q('Which expression shows a helpful first step for $26 + 34 + 17$?', '$(26 + 34) + 17 = 60 + 17$', ['$(26 + 17) + 34 = 33 + 34$', '$(34 − 26) + 17 = 8 + 17$', '$26 + (34 − 17)$', '$26 + 34 = 50$'], 'Pair 26 and 34 to make the friendly subtotal 60, then add 17.', ['add-three-numbers', 'mental-strategies']),
    q('What is $358 + 267$?', 625, [515, 615, 635, 5115], 'Regroup 15 ones, then regroup 12 tens to reach 625.', ['three-digit-addition']),
    q('A student adds $51 + 36$ and gets 717. What error is most likely?', 'The student wrote each place-value sum side by side.', ['The student subtracted instead of adding.', 'The student forgot a third addend.', 'The student rounded both numbers.', 'The student multiplied the ones.'], 'Five tens plus 3 tens is 8 tens, and 1 + 6 is 7 ones; the sum is 87, not 717.', ['two-digit-addition', 'error-analysis']),
    q('What is $68 + 27$?', 95, [85, 815, 105, 41], 'Eight plus 7 makes 15 ones; regroup one ten and finish with 9 tens.', ['addition-regrouping']),
    q('What is $49 + 16 + 25$?', 90, [65, 74, 80, 100], 'Combine 49 + 16 = 65, then add 25 to get 90.', ['add-three-numbers']),
    q('Which is the best estimate for $392 + 211$?', 600, [400, 500, 603, 700], 'Round 392 to 400 and 211 to 200; the estimated sum is 600.', ['three-digit-addition', 'estimation']),
  ],

  'subtraction-facts': [
    q('What is $15 − 8$?', 7, [8, 6, 23, 120], 'Use the related addition fact: 8 + 7 = 15.', ['subtraction-facts']),
    q('If $9 + 6 = 15$, what is $15 − 9$?', 6, [9, 15, 24, 5], 'Subtraction undoes addition and returns the other addend, 6.', ['fact-families']),
    q('What number makes $18 − □ = 11$ true?', 7, [11, 18, 29, 6], 'The removed part is 18 − 11 = 7.', ['missing-subtrahends']),
    q('Solve mentally: $54 − 19$.', 35, [34, 36, 45, 73], 'Subtract 20 to get 34, then add back 1 because only 19 was removed.', ['mental-subtraction']),
    q('Which expression has a difference of 8?', '$14 − 6$', ['$14 − 5$', '$15 − 6$', '$13 − 6$', '$16 − 6$'], 'Check each with addition; 6 + 8 = 14.', ['subtraction-facts']),
    q('Which equation belongs to the same fact family as $7 + 8 = 15$?', '$15 − 8 = 7$', ['$15 + 8 = 23$', '$8 − 7 = 15$', '$15 − 7 = 6$', '$7 − 8 = 15$'], 'A related subtraction begins with the total 15 and removes one addend to reveal the other.', ['fact-families']),
    q('What number makes $□ − 7 = 9$ true?', 16, [2, 7, 9, 63], 'The starting number is 9 + 7 = 16.', ['missing-minuend']),
    q('Solve mentally: $72 − 21$.', 51, [49, 50, 53, 93], 'Subtract 20 to get 52, then subtract 1 more.', ['mental-subtraction']),
    q('A basket held 17 apples. Nine were used. How many remain?', 8, [9, 17, 26, 7], 'Subtract the used part: 17 − 9 = 8.', ['subtraction-facts', 'word-problems']),
    q('A student says $17 − 9 = 9$. Which fact corrects the error?', '$9 + 8 = 17$', ['$9 + 9 = 17$', '$17 + 9 = 26$', '$17 − 8 = 10$', '$9 − 8 = 17$'], 'The difference plus 9 must return to 17; 8 passes that check.', ['fact-families', 'error-analysis']),
    q('What number makes $20 − □ = 12$ true?', 8, [12, 20, 32, 7], 'Find the difference between 20 and 12: 8.', ['missing-subtrahends']),
    q('Solve mentally: $83 − 9$.', 74, [73, 75, 82, 92], 'Subtract 10 to get 73, then add back 1.', ['mental-subtraction']),
  ],

  'multi-digit-subtraction': [
    q('What is $86 − 42$?', 44, [34, 42, 48, 128], 'Subtract ones and tens by place value: 6 − 2 and 8 tens − 4 tens.', ['two-digit-subtraction']),
    q('What is $73 − 48$?', 25, [35, 45, 121, 15], 'Regroup 73 as 6 tens and 13 ones, then subtract.', ['subtraction-regrouping']),
    q('What is $625 − 278$?', 347, [453, 357, 903, 247], 'Regroup by place, including across the tens, then check 347 + 278 = 625.', ['three-digit-subtraction']),
    q('Which addition equation checks $91 − 37 = 54$?', '$54 + 37 = 91$', ['$91 + 37 = 128$', '$91 + 54 = 145$', '$54 − 37 = 17$', '$37 + 91 = 54$'], 'Add the difference and subtrahend; the result must return to 91.', ['inverse-operations']),
    q('Which difference is correct?', '$95 − 53 = 42$', ['$95 − 53 = 32$', '$95 − 53 = 48$', '$95 − 53 = 52$', '$95 − 53 = 148$'], 'Subtract ones, 5 − 3 = 2, then tens, 9 − 5 = 4 tens.', ['two-digit-subtraction']),
    q('What is $84 − 29$?', 55, [45, 65, 113, 53], 'Regroup one ten so 14 − 9 = 5, then 7 tens − 2 tens = 5 tens.', ['subtraction-regrouping']),
    q('What is $700 − 356$?', 344, [456, 354, 1056, 444], 'Regroup across both zeros, then subtract each place; verify with addition.', ['three-digit-subtraction']),
    q('Which equation is true?', '$63 − 28 = 35$', ['$63 − 28 = 45$', '$63 − 28 = 41$', '$63 − 35 = 18$', '$28 − 63 = 35$'], 'Regroup to calculate 63 − 28, then check 35 + 28 = 63.', ['subtraction-regrouping']),
    q('A tank held 78 liters. After some water was used, 34 liters remained. How many liters were used?', 44, [112, 34, 78, 54], 'The used part is the difference between the start and remainder: 78 − 34 = 44.', ['two-digit-subtraction', 'change-unknown']),
    q('A student solves $82 − 47$ as 45 by subtracting each smaller digit from each larger digit. What was missed?', 'Regrouping one ten into 10 ones', ['Adding the two numbers', 'Rounding to the nearest ten', 'Multiplying the ones digits', 'Writing a zero in the answer'], 'Two ones cannot lose 7 ones without regrouping; 82 becomes 7 tens and 12 ones.', ['subtraction-regrouping', 'error-analysis']),
    q('Which is the best estimate for $612 − 289$?', 300, [200, 323, 400, 900], 'Round 612 to 600 and 289 to 300; 600 − 300 = 300.', ['three-digit-subtraction', 'estimation']),
    q('Which equation proves that $804 − 369 = 435$?', '$435 + 369 = 804$', ['$804 + 369 = 1173$', '$804 + 435 = 1239$', '$435 − 369 = 66$', '$369 − 435 = 66$'], 'The difference plus the amount subtracted must equal the starting amount.', ['inverse-operations']),
  ],

  'mixed-operations': [
    q('A jar has 46 red beads and 28 blue beads. Which operation finds the total number of beads?', 'addition', ['subtraction', 'multiplication', 'division', 'rounding'], 'Two parts are joined into one total, so use addition.', ['choose-operation']),
    q('A theater had 83 open seats. People filled 47 of them. How many seats remain open?', 36, [130, 46, 47, 83], 'Subtract filled seats from all open seats: 83 − 47 = 36.', ['one-step-problems']),
    q('Five bags hold 7 oranges each. Six oranges are eaten. How many remain?', 29, [35, 41, 13, 23], 'Find 5 × 7 = 35 oranges, then subtract 6.', ['two-step-problems']),
    q('What number makes $37 + □ = 82$ true?', 45, [37, 82, 119, 55], 'Undo the addition: 82 − 37 = 45.', ['missing-numbers']),
    q('A 64-inch board is 19 inches longer than another board. Which operation finds the shorter board’s length?', 'subtraction', ['addition', 'multiplication', 'division', 'rounding'], 'The shorter length is the greater length minus the difference.', ['choose-operation', 'comparison-problems']),
    q('Some tickets were sold. Adding 28 new tickets made 75 available. How many were available before?', 47, [103, 57, 28, 75], 'The starting part is unknown, so subtract 75 − 28 = 47.', ['one-step-problems', 'start-unknown']),
    q('A class reads 24 pages Monday and 31 Tuesday. The book has 80 pages. How many pages remain?', 25, [55, 49, 104, 27], 'Add pages read to get 55, then subtract 55 from 80.', ['two-step-problems']),
    q('What number makes $91 − □ = 56$ true?', 35, [56, 91, 147, 45], 'The missing subtrahend is 91 − 56 = 35.', ['missing-numbers']),
    q('Thirty-six counters are arranged in groups of 4. Which operation finds the number of groups?', 'division', ['addition', 'subtraction', 'multiplication', 'rounding'], 'The total is separated into groups of a known size, so divide.', ['choose-operation']),
    q('Priya has 58 cards, which is 16 more than Luis. How many cards does Luis have?', 42, [74, 16, 58, 32], 'Luis has the smaller amount, so calculate 58 − 16 = 42.', ['one-step-problems', 'comparison-problems']),
    q('Four shelves hold 9 books each. Seven more books sit on a desk. How many books are there?', 43, [36, 29, 63, 47], 'The shelves hold 4 × 9 = 36; add the 7 desk books.', ['two-step-problems']),
    q('Which value makes both $8 + □ = 19$ and $19 − □ = 8$ true?', 11, [8, 19, 27, 10], 'The same missing part is 19 − 8 = 11 and satisfies both inverse equations.', ['missing-numbers', 'inverse-operations']),
  ],

  'graphs-data': [
    q('Which color received the most votes?', 'Green', ['Red', 'Blue', 'Gold', 'They are tied'], 'Green has 9 votes, the greatest displayed count.', ['bar-graphs'], dataFigure(['Red', 'Blue', 'Green', 'Gold'], [6, 4, 9, 7])),
    q('How many votes are shown altogether?', 21, [15, 14, 8, 24], 'Add all categories: 5 + 8 + 3 + 5 = 21.', ['pictographs'], dataFigure(['Cats', 'Dogs', 'Birds', 'Fish'], [5, 8, 3, 5], 'pictograph')),
    q('Which value appears most often?', '4', ['2', '3', '5', '3 and 4 tie'], 'The tallest stack has 6 marks above 4.', ['line-plots'], dataFigure(['2', '3', '4', '5'], [2, 4, 6, 3], 'line_plot')),
    q('How many more apples than pears are shown?', 5, [13, 8, 3, 2], 'Compare the requested bars: 8 − 3 = 5.', ['compare-data'], dataFigure(['Apples', 'Pears', 'Plums'], [8, 3, 6])),
    q('Which category received the least votes?', 'Gold', ['Red', 'Blue', 'Green', 'They are tied'], 'Gold has 2 votes, the least displayed count.', ['bar-graphs'], dataFigure(['Red', 'Blue', 'Green', 'Gold'], [7, 5, 6, 2])),
    q('How many stars and circles are shown together?', 13, [8, 5, 18, 3], 'Use only the requested categories: 8 + 5 = 13.', ['pictographs'], dataFigure(['Stars', 'Circles', 'Squares'], [8, 5, 4], 'pictograph')),
    q('How many measurements are recorded?', 14, [5, 9, 12, 20], 'Each mark is one measurement; 3 + 2 + 5 + 4 = 14.', ['line-plots'], dataFigure(['1', '2', '3', '4'], [3, 2, 5, 4], 'line_plot')),
    q('How many fewer birds than dogs are shown?', 6, [14, 10, 4, 5], 'Dogs show 10 and Birds show 4; 10 − 4 = 6.', ['compare-data'], dataFigure(['Cats', 'Dogs', 'Birds'], [7, 10, 4])),
    q('How many more Blue votes are needed to tie Red?', 4, [5, 9, 14, 3], 'Find the gap between 9 and 5: 9 − 5 = 4.', ['bar-graphs', 'missing-data'], dataFigure(['Red', 'Blue', 'Green'], [9, 5, 7])),
    q('Which statement is true?', 'B and C total 12.', ['A and B total 10.', 'C exceeds B by 4.', 'A is the greatest category.', 'All categories total 18.'], 'Read B as 7 and C as 5; together they make 12.', ['pictographs', 'data-reasoning'], dataFigure(['A', 'B', 'C'], [4, 7, 5], 'pictograph')),
    q('How many measurements are greater than 3?', 7, [3, 4, 6, 11], 'Only values 4 and 5 are greater than 3; their stacks hold 4 + 3 = 7 marks.', ['line-plots', 'data-reasoning'], dataFigure(['2', '3', '4', '5'], [2, 5, 4, 3], 'line_plot')),
    q('How many more responses are in Walk and Bike together than Bus?', 6, [15, 9, 3, 24], 'Walk and Bike total 6 + 9 = 15; compare with Bus: 15 − 9 = 6.', ['compare-data', 'two-step-problems'], dataFigure(['Walk', 'Bike', 'Bus'], [6, 9, 9])),
  ],

  multiplication: [
    q('Six equal groups have 4 counters in each group. How many counters are there?', 24, [10, 20, 28, 64], 'Multiply the number of groups by the amount in each group: 6 × 4 = 24.', ['equal-groups']),
    q('How many dots are in the array?', 24, [11, 16, 21, 48], 'The array has 3 rows of 8, so 3 × 8 = 24.', ['arrays'], arrayFigure(3, 8)),
    q('Which fact has the same product as $4 × 7$?', '$7 × 4$', ['$4 + 7$', '$4 × 6$', '$7 − 4$', '$8 × 4$'], 'Switching factor order turns the array without changing its total.', ['commutative-property']),
    q('What is $5 × 9$?', 45, [14, 40, 50, 59], 'Five groups of 9 make 45; check by skip-counting by 5 or 9.', ['multiplication-facts']),
    q('Seven bags hold 3 apples each. How many apples are in all the bags?', 21, [10, 18, 24, 73], 'Seven equal groups of three are 7 × 3 = 21.', ['equal-groups', 'word-problems']),
    q('Which multiplication equation describes the array?', '$4 × 6 = 24$', ['$4 + 6 = 10$', '$6 − 4 = 2$', '$4 × 5 = 20$', '$6 × 6 = 36$'], 'Count 4 rows with 6 dots in each row.', ['arrays'], arrayFigure(4, 6)),
    q('Which expression can help solve $7 × 6$?', '$(5 × 6) + (2 × 6)$', ['$(5 × 6) − (2 × 6)$', '$7 + 6$', '$6 × 6$', '$(7 × 5) + 2$'], 'Split 7 groups into 5 groups and 2 groups; both parts still contain 6 each.', ['distributive-reasoning']),
    q('What is $10 × 8$?', 80, [18, 70, 90, 108], 'Ten groups of 8 make 80.', ['multiplication-facts']),
    q('A theater has 5 rows with 7 seats in each row. How many seats are there?', 35, [12, 30, 40, 57], 'Rows and seats per row form an array: 5 × 7 = 35.', ['equal-groups', 'arrays']),
    q('A student says $3 × 8 = 11$. What operation did the student use by mistake?', 'addition', ['subtraction', 'division', 'rounding', 'place value'], 'The incorrect result 11 comes from 3 + 8; multiplication means equal groups.', ['error-analysis', 'multiplication-facts']),
    q('Which expression has the greatest product?', '$5 × 8$', ['$4 × 9$', '$6 × 6$', '$3 × 10$', '$7 × 5$'], 'The products are 40, 36, 36, 30, and 35; 40 is greatest.', ['compare-products']),
    q('What number makes $7 × □ = 56$ true?', 8, [7, 49, 56, 63], 'Use the known fact 7 × 8 = 56.', ['multiplication-facts', 'missing-factor']),
  ],

  division: [
    q('Thirty-six counters are shared equally among 4 groups. How many are in each group?', 9, [4, 32, 40, 144], 'Divide the total by the number of equal groups: 36 ÷ 4 = 9.', ['equal-sharing'], { kind: 'counters', alt: 'Thirty-six counters arranged for counting.', params: { count: 36, columns: 9 } }),
    q('If $6 × 7 = 42$, what is $42 ÷ 6$?', 7, [6, 36, 42, 48], 'Division undoes multiplication and returns the other factor.', ['fact-families']),
    q('What is $32 ÷ 4$?', 8, [4, 28, 36, 128], 'Use the related fact 4 × 8 = 32.', ['division-facts']),
    q('Forty pencils are packed 5 to a box. How many boxes are filled?', 8, [5, 35, 45, 200], 'This asks how many groups of 5 fit in 40: 40 ÷ 5 = 8.', ['division-stories', 'quotative-division']),
    q('Twenty-four counters are shared among 3 equal groups. Which multiplication fact checks the share?', '$3 × 8 = 24$', ['$3 × 24 = 72$', '$24 × 8 = 192$', '$3 + 8 = 11$', '$24 − 3 = 21$'], 'The group count times the group size must return to all 24 counters.', ['equal-sharing', 'inverse-operations']),
    q('Which equation is in the same fact family as $8 × 5 = 40$?', '$40 ÷ 8 = 5$', ['$40 − 8 = 32$', '$40 + 5 = 45$', '$8 ÷ 40 = 5$', '$40 × 8 = 320$'], 'Use the same three values and reverse multiplication with division.', ['fact-families']),
    q('What is $45 ÷ 5$?', 9, [5, 40, 50, 225], 'Five groups of 9 make 45, so the quotient is 9.', ['division-facts']),
    q('A 56-inch ribbon is cut into 7 equal pieces. How long is each piece?', '8 inches', ['7 inches', '49 inches', '63 inches', '392 inches'], 'Equal pieces mean 56 ÷ 7 = 8 inches per piece.', ['division-stories', 'partitive-division']),
    q('Which question is answered by $27 ÷ 3$?', 'How many are in each of 3 equal groups made from 27?', ['How many are 3 groups of 27?', 'How many more is 27 than 3?', 'What is 27 increased by 3?', 'What is 27 rounded to 3?'], 'The expression divides a total of 27 into groups involving 3.', ['equal-sharing', 'equation-modeling']),
    q('Which two equations are both true?', '$4 × 9 = 36$ and $36 ÷ 4 = 9$', ['$4 × 8 = 36$ and $36 ÷ 4 = 8$', '$9 × 9 = 36$ and $36 ÷ 9 = 9$', '$4 + 9 = 36$ and $36 − 4 = 9$', '$36 × 4 = 9$ and $9 ÷ 4 = 36$'], 'Multiplication and division facts use the same total and factors.', ['fact-families']),
    q('What number makes $63 ÷ 7 = □$ true?', 9, [7, 56, 63, 70], 'Find the missing factor in 7 × □ = 63; it is 9.', ['division-facts', 'missing-factor']),
    q('Forty-eight photos are placed 6 on each page. How many pages are needed?', 8, [6, 42, 54, 288], 'Count groups of 6 in 48: 48 ÷ 6 = 8 pages.', ['division-stories', 'quotative-division']),
  ],

  fractions: [
    q('What fraction of the bar is shaded?', '4/7', ['3/7', '4/6', '4/11', '1/7'], 'Seven equal parts make the denominator; four shaded parts make the numerator.', ['fractions-of-a-whole'], fractionFigure(4, 7)),
    q('Three of 10 counters are shaded. What fraction of the set is shaded?', '3/10', ['7/10', '3/7', '3/13', '1/10'], 'Use all 10 counters as the denominator and the 3 shaded counters as the numerator.', ['fractions-of-a-set']),
    q('Which fraction is marked by point A?', '3/5', ['2/5', '3/4', '4/5', '1/5'], 'Five equal spaces make fifths; point A is three spaces from zero.', ['fraction-number-lines'], numberLineFigure({ min: 0, max: 1, step: 1 / 5, value: 3 / 5, labels: [0, 1], fraction: true })),
    q('Which fraction is equivalent to $2/5$?', '6/15', ['4/9', '4/7', '6/10', '2/15'], 'Multiply numerator and denominator by 3: 2/5 = 6/15.', ['equivalent-fractions']),
    q('What fraction of the bar is not shaded?', '3/8', ['5/8', '3/5', '1/8', '4/8'], 'Eight total parts minus five shaded parts leaves three unshaded eighths.', ['fractions-of-a-whole', 'fraction-complements'], fractionFigure(5, 8)),
    q('Seven of 12 counters are red. What fraction are not red?', '5/12', ['7/12', '5/7', '7/10', '1/12'], 'Twelve total minus seven red leaves five; 5/12 are not red.', ['fractions-of-a-set', 'fraction-complements']),
    q('Point B is at $7/8$. How far is point B from 1?', '1/8', ['7/8', '6/8', '1/7', '8/8'], 'One whole is 8/8; the distance from 7/8 to 8/8 is 1/8.', ['fraction-number-lines', 'fraction-complements'], numberLineFigure({ min: 0, max: 1, step: 1 / 8, value: 7 / 8, label: 'B', labels: [0, 1], fraction: true })),
    q('Which fraction is greater?', '5/6', ['4/6', 'They are equal', '3/6', '1/6'], 'With equal denominators, compare numerators; 5 is greater than 4.', ['compare-fractions']),
    q('What fraction of the bar is shaded?', '2/5', ['3/5', '2/3', '2/7', '1/5'], 'Five equal parts are in the whole and two are shaded.', ['fractions-of-a-whole'], fractionFigure(2, 5)),
    q('One fourth of 16 counters are blue. How many counters are blue?', 4, [3, 8, 12, 64], 'Divide 16 counters into 4 equal groups; one group contains 4.', ['fractions-of-a-set', 'fraction-of-a-set']),
    q('Which fraction is marked by point A?', '5/6', ['1/6', '4/6', '5/5', '5/7'], 'Six equal spaces make sixths; point A is five spaces from zero.', ['fraction-number-lines'], numberLineFigure({ min: 0, max: 1, step: 1 / 6, value: 5 / 6, labels: [0, 1], fraction: true })),
    q('Which comparison is true?', '$3/4 > 2/4$', ['$3/4 < 2/4$', '$3/4 = 2/4$', '$1/4 > 3/4$', '$4/4 < 3/4$'], 'The denominators match, and 3 shaded parts are more than 2 shaded parts.', ['compare-fractions']),
  ],

  measurement: [
    q('What is the value of 2 quarters, 2 dimes, and 3 pennies?', '73¢', ['53¢', '63¢', '75¢', '223¢'], 'Add coin values: 50¢ + 20¢ + 3¢ = 73¢.', ['money']),
    q('What time does the clock show?', '4:35', ['4:30', '4:40', '5:35', '7:20'], 'The short hand gives hour 4; the long hand at 7 gives 35 minutes.', ['tell-time'], clockFigure(4, 35)),
    q('Which is the most reasonable capacity of a kitchen sink?', '20 liters', ['20 milliliters', '2 milliliters', '200 liters', '20 kiloliters'], 'A sink holds many bottlefuls, so liters and a value around 20 are reasonable.', ['measurement-units']),
    q('A 48-centimeter ribbon loses a 19-centimeter piece. How much remains?', '29 centimeters', ['67 centimeters', '19 centimeters', '48 centimeters', '39 centimeters'], 'Subtract lengths in the same unit: 48 − 19 = 29 centimeters.', ['measurement-applications']),
    q('A snack costs 58¢. How much change comes from 3 quarters?', '17¢', ['13¢', '23¢', '33¢', '133¢'], 'Three quarters are 75¢; 75 − 58 = 17¢.', ['money', 'making-change']),
    q('What time does the clock show?', '9:50', ['9:45', '9:55', '10:50', '10:10'], 'The hour hand is near 10 but still in hour 9; the minute hand at 10 means 50 minutes.', ['tell-time'], clockFigure(9, 50)),
    q('Which is the most reasonable mass of a bicycle?', '12 kilograms', ['12 grams', '12 milligrams', '12 tonnes', '120 kilograms'], 'A bicycle is lifted by a person but much heavier than a small object, so kilograms fit.', ['measurement-units']),
    q('Four bottles each hold 2 liters. Three liters are poured out. How much remains?', '5 liters', ['8 liters', '6 liters', '11 liters', '1 liter'], 'The bottles hold 4 × 2 = 8 liters; subtract 3 liters to leave 5.', ['measurement-applications', 'two-step-problems']),
    q('Which collection is worth exactly 86¢?', '3 quarters, 1 dime, and 1 penny', ['2 quarters, 3 dimes, and 1 penny', '3 quarters and 6 pennies', '8 dimes and 5 pennies', '1 quarter, 5 dimes, and 1 penny'], 'Seventy-five cents plus 10 cents plus 1 cent is 86 cents.', ['money', 'coin-combinations']),
    q('A program begins at 1:25 and lasts 40 minutes. When does it end?', '2:05', ['1:65', '1:55', '2:15', '2:25'], 'Add 35 minutes to reach 2:00, then 5 more to reach 2:05.', ['tell-time', 'elapsed-time']),
    q('Which is the most reasonable distance between two cities?', '120 kilometers', ['120 centimeters', '120 millimeters', '120 meters', '12 centimeters'], 'Travel between cities is usually measured in kilometers.', ['measurement-units']),
    q('A 90-centimeter board is cut into three equal pieces. How long is each piece?', '30 centimeters', ['3 centimeters', '27 centimeters', '87 centimeters', '270 centimeters'], 'Divide the total length equally: 90 ÷ 3 = 30 centimeters.', ['measurement-applications', 'division']),
  ],

  geometry: [
    q('What is the most specific name for shape A?', 'triangle', ['quadrilateral', 'pentagon', 'hexagon', 'circle'], 'Shape A has three straight sides and three corners, so it is a triangle.', ['name-shapes'], shapeFigure('right-triangle', 'a right triangle turned sideways')),
    q('Which shape always has four equal sides and four right angles?', 'square', ['rectangle', 'rhombus', 'trapezoid', 'parallelogram'], 'A square is the quadrilateral that guarantees both properties.', ['classify-quadrilaterals']),
    q('What is the area of the array?', '28 square units', ['11 square units', '22 square units', '24 square units', '56 square units'], 'The array has 4 rows of 7 square units: 4 × 7 = 28.', ['area'], arrayFigure(4, 7)),
    q('A rectangle is 10 units long and 3 units wide. What is its perimeter?', '26 units', ['13 units', '30 units', '20 units', '23 units'], 'Add all outside sides: 10 + 3 + 10 + 3 = 26.', ['perimeter']),
    q('What is the most specific name for shape A?', 'pentagon', ['triangle', 'quadrilateral', 'hexagon', 'octagon'], 'Five straight sides make the shape a pentagon.', ['name-shapes'], shapeFigure('pentagon', 'a regular pentagon')),
    q('Which statement is true for every parallelogram?', 'Opposite sides are parallel.', ['All sides are equal.', 'All angles are right angles.', 'Exactly one pair of sides is parallel.', 'It has five sides.'], 'A parallelogram is defined by two pairs of parallel opposite sides.', ['classify-quadrilaterals']),
    q('A rectangle has area 36 square units and one side is 6 units. What is the other side?', '6 units', ['5 units', '12 units', '30 units', '42 units'], 'Find the missing factor in 6 × □ = 36; it is 6.', ['area', 'missing-factor']),
    q('A square has side length 8 centimeters. What is its perimeter?', '32 centimeters', ['16 centimeters', '24 centimeters', '64 centimeters', '40 centimeters'], 'A square has four equal sides: 4 × 8 = 32 centimeters.', ['perimeter']),
    q('What is the most specific name for shape A?', 'hexagon', ['pentagon', 'octagon', 'quadrilateral', 'triangle'], 'Count six straight sides; a six-sided polygon is a hexagon.', ['name-shapes'], shapeFigure('hexagon', 'a regular hexagon')),
    q('A square is always also which type of shape?', 'rectangle', ['triangle', 'pentagon', 'circle', 'trapezoid only'], 'A square has four right angles, so it meets the definition of a rectangle.', ['classify-quadrilaterals', 'shape-hierarchy']),
    q('A 5-by-8 rectangle gains one complete row of 8 tiles. What is its new area?', '48 square units', ['40 square units', '45 square units', '53 square units', '80 square units'], 'The new array has 6 rows of 8: 6 × 8 = 48.', ['area', 'arrays']),
    q('A rectangle has perimeter 34 units and width 5 units. What is its length?', '12 units', ['7 units', '17 units', '24 units', '29 units'], 'Two widths use 10 units; the remaining 24 units are two equal lengths of 12.', ['perimeter', 'missing-length']),
  ],

  cumulative: [
    q('Which number equals 6 hundreds, 3 tens, and 4 ones?', 634, [643, 364, 6034, 13], 'Combine 600 + 30 + 4 to get 634.', ['place-value', 'number-forms']),
    q('Round 472 to the nearest hundred.', 500, [300, 400, 472, 600], 'The tens digit is 7, so round 4 hundreds up to 5 hundreds.', ['rounding']),
    q('A shop had 86 balloons. It sold 29, then added 18. How many balloons does it have now?', 75, [57, 68, 115, 39], 'Follow the events: 86 − 29 = 57, then 57 + 18 = 75.', ['two-step-problems', 'addition', 'subtraction']),
    q('Which expression has a value of 48?', '$6 × 8$', ['$54 ÷ 6$', '$7 × 7$', '$40 + 7$', '$56 − 9$'], 'Six equal groups of 8 make 48; the other expressions do not.', ['multiplication-facts']),
    q('What number makes $54 ÷ □ = 6$ true?', 9, [6, 48, 54, 60], 'Use the related fact 6 × 9 = 54.', ['division-facts', 'missing-factor']),
    q('Which fraction is equivalent to $3/4$?', '9/12', ['6/10', '6/7', '9/10', '3/12'], 'Multiply numerator and denominator by 3: 3/4 = 9/12.', ['equivalent-fractions']),
    q('A graph shows 8 cats, 11 dogs, and 5 birds. How many more dogs than birds are shown?', 6, [16, 11, 5, 3], 'Compare Dogs and Birds: 11 − 5 = 6.', ['data-reasoning'], dataFigure(['Cats', 'Dogs', 'Birds'], [8, 11, 5])),
    q('A rectangle is 7 units by 5 units. What is its area?', '35 square units', ['12 square units', '24 square units', '28 square units', '70 square units'], 'Area counts 5 rows of 7: 7 × 5 = 35 square units.', ['area']),
    q('A rectangle is 7 units by 5 units. What is its perimeter?', '24 units', ['12 units', '35 units', '14 units', '70 units'], 'Perimeter is 7 + 5 + 7 + 5 = 24 units.', ['perimeter']),
    q('A class starts at 10:35 and lasts 45 minutes. When does it end?', '11:20', ['10:80', '11:10', '11:30', '10:20'], 'Add 25 minutes to reach 11:00, then 20 more to reach 11:20.', ['elapsed-time']),
    q('An item costs 67¢. How much change comes from 3 quarters?', '8¢', ['7¢', '12¢', '18¢', '142¢'], 'Three quarters are 75¢; subtract 67¢ to get 8¢ change.', ['money', 'making-change']),
    q('A 96-centimeter ribbon is cut into 3 equal pieces. One piece is used. How many centimeters remain?', '64 centimeters', ['32 centimeters', '63 centimeters', '93 centimeters', '288 centimeters'], 'Each piece is 96 ÷ 3 = 32 centimeters; two pieces remain, totaling 64.', ['measurement', 'division', 'two-step-problems']),
  ],
});

export function elementaryMathMasteryBlueprint(moduleId) {
  const blueprint = BLUEPRINTS[moduleId];
  if (!blueprint) throw new Error(`missing elementary math mastery blueprint for ${moduleId}`);
  if (blueprint.length !== 12) throw new Error(`${moduleId} mastery blueprint must contain exactly 12 questions`);
  return blueprint.map((entry) => structuredClone(entry));
}
