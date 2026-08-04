# SchoolCalc CLI case: 06-math-examples-steps

## Inputs

- Release: `0dcf22799437`
- ROM: `/private/tmp/schoolcalc-ti86a.rom`
- Transfer: complete manifest (23 variables)
- Screen mode: `hybrid`; captures: `each`
- Ordered interaction inputs: key ENTER, wait 600f, key ENTER, wait 600f, key DOWN, wait 120f, key ENTER, wait 600f, key F5, wait 180f, key F5, wait 180f, key F2, wait 600f

### Replay

```sh
node _extensions/ti86-app/ti86.cli.mjs --case-id 06-math-examples-steps --mame /opt/homebrew/bin/mame --rom /private/tmp/schoolcalc-ti86a.rom --bundle _extensions/ti86-app/dist/install-ti86a-0dcf22799437 --load ASCHL --key ENTER --wait 600 --key ENTER --wait 600 --key DOWN --wait 120 --key ENTER --wait 600 --key F5 --wait 180 --key F5 --wait 180 --key F2 --wait 600 --screens each --screen hybrid --output _extensions/ti86-app/testing/cli-cases/06-math-examples-steps.md
```

## Captured output

```text
SCHOOLCALC_SCREEN label=transfer-complete pc=42BD executionWindow=false
T [none]; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.

SCHOOLCALC_SCREEN label=wake-after-transfer pc=019A executionWindow=false
T [none]; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.

SCHOOLCALC_SCREEN label=dismiss-transfer-receipt pc=019A executionWindow=false
T [none]; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⢸⣿⣿

SCHOOLCALC_SCREEN label=program-menu pc=019A executionWindow=false
T (24,57)+/r:T | (49,57)+/r:T | (74,57)+/r:T | (99,57)+/r:T | (8,59)+/c:A     ED | (21,59)+/c:S | (42,59)+/c:T; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⢸⣿⣿






⣶⢰⢤⡆⠀⠀⡦⠤⡆⣶⠀⠀⢀⡀⠀⠀⠀⠀⠀⠀⡆⠀⠀⠀⠀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⡆

SCHOOLCALC_SCREEN label=program-names pc=019A executionWindow=false
T (8,51)+/c:A | (21,51)+/c:S | (32,51)-/c:ED | (24,57)+/r:T | (49,57)+/r:T | (74,57)+/r:T | (99,57)+/r:T | (4,59)+/c:ASCHL | (29,59)+/c:SCCAT | (54,59)+/c:SCHLC | (79,59)+/c:SCLEA SC | (116,59)+/c:AT; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⢸⣿⣿






⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⢤⡆⠀⠀⠀⠀⢰⡤

SCHOOLCALC_SCREEN label=select-ASCHL pc=019A executionWindow=false
T (1,0)+/d:AS HL | (8,51)+/c:A | (21,51)+/c:S | (32,51)-/c:ED | (24,57)+/r:T | (49,57)+/r:T | (74,57)+/r:T | (99,57)+/r:T | (4,59)+/c:ASCHL | (29,59)+/c:SCCAT | (54,59)+/c:SCHLC | (79,59)+/c:SCLEA SC | (116,59)+/c:AT; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠀⠀⠀⠀⠀⠀⠸⣉⡩⠀⠀⠀⠀⠀⠀⢸⣿⣿






⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⢤⡆⠀⠀⠀⠀⢰⡤

SCHOOLCALC_SCREEN label=load-ASCHL pc=019A executionWindow=true
T (1,1)-/c:WHO IS STUDYING | (102,1)-/c:CHOOSE | (9,10)+/c:SOREN | (9,16)+/c:ALAN | (9,22)+/c:MILO | (9,28)+/c:FELIX | (9,34)+/c:GUEST | (1,57)-/c:SELECT | (105,57)-/c:GUEST; S (61,1)-:◌ (0,10)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠅⠇⠅⠯⠪⠿⠿⠗⠐⠟⠰⠿⠿⠟⠰⠷⠰⠧⠣⠇⠪⠷⠱⠗⠐⠇⠅⠯⠂⠷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠐⠺⠨⠸⠕⠽⠕⠽⠃⠾⠀⠺⠿
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⡇
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠁




⠿⠶⠇⠶⠇⠿⠇⠶⠯⠶⠷⠰⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⠯⠖⠧⠧⠇⠶⠿⠶⠷⠰⠿⠇

SCHOOLCALC_SCREEN label=enter pc=EB28 executionWindow=true
T (3,24)+/c:LOAD; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.




⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠁⠀⠁

SCHOOLCALC_SCREEN label=wait-600 pc=019A executionWindow=true
T (1,1)-/c:SUBJECTS | (106,1)-/c:SOREN | (10,10)+/c:MATH | (10,16)+/c:SCIENCE | (10,22)+/c:HISTORY | (10,28)+/c:ARTS & CULTURE | (4,58)-/c:OPEN | (30,58)-/c:BACK | (55,58)-/c:USER | (104,58)-/c:OFF; S (0,10)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⣶⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣶⡲⣲⢰⣶⠀⠐⠒⠒⠒⠒⠒⠒

SCHOOLCALC_SCREEN label=enter pc=5298 executionWindow=true
T (3,24)+/c:LOAD; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.




⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠁⠀⠁

SCHOOLCALC_SCREEN label=wait-600 pc=019A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (106,1)-/c:SOREN | (10,10)+/c:NOTES | (10,16)+/c:EXAMPLES | (10,22)+/c:QUIZ | (4,58)-/c:OPEN | (30,58)-/c:BACK; S (0,10)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠴⠗⠐⠇⠅⠇⠪⠿⠿⠷⠰⠇⠐⠇⠅⠿⠿⠇⠼⠇⠐⠇⠜⠯⠒⠇⠐⠇⠅⠷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠾⠕⠽⠠⠻⠀⠺⠨⠸⠿






⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⡆

SCHOOLCALC_SCREEN label=down pc=019A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (106,1)-/c:SOREN | (10,10)+/c:NOTES | (10,16)+/c:EXAMPLES | (10,22)+/c:QUIZ | (4,58)-/c:OPEN | (30,58)-/c:BACK; S (0,16)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠴⠗⠐⠇⠅⠇⠪⠿⠿⠷⠰⠇⠐⠇⠅⠿⠿⠇⠼⠇⠐⠇⠜⠯⠒⠇⠐⠇⠅⠷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠾⠕⠽⠠⠻⠀⠺⠨⠸⠿






⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⡆

SCHOOLCALC_SCREEN label=wait-120 pc=019A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (106,1)-/c:SOREN | (10,10)+/c:NOTES | (10,16)+/c:EXAMPLES | (10,22)+/c:QUIZ | (4,58)-/c:OPEN | (30,58)-/c:BACK; S (0,16)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠴⠗⠐⠇⠅⠇⠪⠿⠿⠷⠰⠇⠐⠇⠅⠿⠿⠇⠼⠇⠐⠇⠜⠯⠒⠇⠐⠇⠅⠷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠾⠕⠽⠠⠻⠀⠺⠨⠸⠿






⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⡆

SCHOOLCALC_SCREEN label=enter pc=E3CB executionWindow=true
T (3,24)+/c:LOAD; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.




⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠁⠀⠁

SCHOOLCALC_SCREEN label=wait-600 pc=019A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (2,11)+/c:EXAMPLES | (2,20)+/c:EXAMPLE | (2,26)+/c:FIND TEN PERCENT OF 80. | (5,57)-/c:TOP | (30,57)-/c:BACK | (79,57)-/c:PGUP | (104,57)-/c:NEXT; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠁⠀⠁⠀⠁⠁⠁⠈⠉⠉⠁⠀⠁⠀⠁⠁⠉⠉⠁⠈⠁⠀⠁⠈⠉⠀⠁⠀⠁⠁⠁
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈





⠿⠿⠷⠰⠯⠮⠇⠾⠿⠿⠿⠿⠇⠿⠿⠰⠿⠱⠹⠵⠾⠸⠺⠿⠿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠇⠾⠯⠖⠧⠧⠇⠾⠿⠿⠿⠇⠿⠨⠸⠰⠾⠺⠺⠆⠾⠿⠿⠿⠇

SCHOOLCALC_SCREEN label=f5 pc=529A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (2,11)+/c:EXAMPLES | (2,20)+/c:EXAMPLE | (2,26)+/c:FIND TEN PERCENT OF 80. | (5,57)-/c:TOP | (30,57)-/c:BACK | (79,57)-/c:PGUP | (104,57)-/c:NEXT; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠁⠀⠁⠀⠁⠁⠁⠈⠉⠉⠁⠀⠁⠀⠁⠁⠉⠉⠁⠈⠁⠀⠁⠈⠉⠀⠁⠀⠁⠁⠁
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈





⠿⠿⠷⠰⠯⠮⠇⠾⠿⠿⠿⠿⠇⠿⠿⠰⠿⠱⠹⠵⠾⠸⠺⠿⠿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠇⠾⠯⠖⠧⠧⠇⠾⠿⠿⠿⠇⠿⠨⠸⠰⠾⠺⠺⠆⠾⠿⠿⠿⠇

SCHOOLCALC_SCREEN label=wait-180 pc=019A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (2,11)+/c:EXAMPLES | (2,20)+/c:STEP 1 | (2,26)+/c:DIVIDE 80 BY 10. | (5,57)-/c:TOP | (30,57)-/c:BACK | (79,57)-/c:PGUP | (104,57)-/c:NEXT; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠁⠀⠁⠀⠁⠁⠁⠈⠉⠉⠁⠀⠁⠀⠁⠁⠉⠉⠁⠈⠁⠀⠁⠈⠉⠀⠁⠀⠁⠁⠁
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘





⠿⠿⠷⠰⠯⠮⠇⠾⠿⠿⠿⠿⠇⠿⠿⠰⠿⠱⠹⠵⠾⠸⠺⠿⠿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠇⠾⠯⠖⠧⠧⠇⠾⠿⠿⠿⠇⠿⠨⠸⠰⠾⠺⠺⠆⠾⠿⠿⠿⠇

SCHOOLCALC_SCREEN label=f5 pc=E367 executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (2,11)+/c:EXAMPLES | (2,20)+/c:STEP 1 | (2,26)+/c:DIVIDE 80 BY 10. | (5,57)-/c:TOP | (30,57)-/c:BACK | (79,57)-/c:PGUP | (104,57)-/c:NEXT; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠁⠀⠁⠀⠁⠁⠁⠈⠉⠉⠁⠀⠁⠀⠁⠁⠉⠉⠁⠈⠁⠀⠁⠈⠉⠀⠁⠀⠁⠁⠁
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘





⠿⠿⠷⠰⠯⠮⠇⠾⠿⠿⠿⠿⠇⠿⠿⠰⠿⠱⠹⠵⠾⠸⠺⠿⠿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠇⠾⠯⠖⠧⠧⠇⠾⠿⠿⠿⠇⠿⠨⠸⠰⠾⠺⠺⠆⠾⠿⠿⠿⠇

SCHOOLCALC_SCREEN label=wait-180 pc=019A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (2,11)+/c:EXAMPLES | (2,20)+/c:STEP 2 | (2,26)+/c:TEN PERCENT OF 80 IS 8. | (5,57)-/c:TOP | (30,57)-/c:BACK | (79,57)-/c:PGUP | (104,57)-/c:END; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠁⠀⠁⠀⠁⠁⠁⠈⠉⠉⠁⠀⠁⠀⠁⠁⠉⠉⠁⠈⠁⠀⠁⠈⠉⠀⠁⠀⠁⠁⠁
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘





⠿⠿⠷⠰⠯⠮⠇⠾⠿⠿⠿⠿⠇⠿⠿⠰⠿⠱⠹⠵⠾⠸⠺⠿⠿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠇⠾⠯⠖⠧⠧⠇⠾⠿⠿⠿⠇⠿⠰⠾⠨⠸⠰⠰⠶⠶⠶⠶⠶⠆

SCHOOLCALC_SCREEN label=f2 pc=E3C0 executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (2,11)+/c:EXAMPLES | (2,20)+/c:STEP 2 | (2,26)+/c:TEN PERCENT OF 80 IS 8. | (5,57)-/c:TOP | (30,57)-/c:BACK | (79,57)-/c:PGUP | (104,57)-/c:END; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠁⠀⠁⠀⠁⠁⠁⠈⠉⠉⠁⠀⠁⠀⠁⠁⠉⠉⠁⠈⠁⠀⠁⠈⠉⠀⠁⠀⠁⠁⠁
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘





⠿⠿⠷⠰⠯⠮⠇⠾⠿⠿⠿⠿⠇⠿⠿⠰⠿⠱⠹⠵⠾⠸⠺⠿⠿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠇⠾⠯⠖⠧⠧⠇⠾⠿⠿⠿⠇⠿⠰⠾⠨⠸⠰⠰⠶⠶⠶⠶⠶⠆

SCHOOLCALC_SCREEN label=wait-600 pc=019A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (106,1)-/c:SOREN | (10,10)+/c:NOTES | (10,16)+/c:EXAMPLES | (10,22)+/c:QUIZ | (4,58)-/c:OPEN | (30,58)-/c:BACK; S (0,16)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠴⠗⠐⠇⠅⠇⠪⠿⠿⠷⠰⠇⠐⠇⠅⠿⠿⠇⠼⠇⠐⠇⠜⠯⠒⠇⠐⠇⠅⠷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠾⠕⠽⠠⠻⠀⠺⠨⠸⠿






⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⡆

SCHOOLCALC_SCREEN label=final pc=019A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (106,1)-/c:SOREN | (10,10)+/c:NOTES | (10,16)+/c:EXAMPLES | (10,22)+/c:QUIZ | (4,58)-/c:OPEN | (30,58)-/c:BACK; S (0,16)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠴⠗⠐⠇⠅⠇⠪⠿⠿⠷⠰⠇⠐⠇⠅⠿⠿⠇⠼⠇⠐⠇⠜⠯⠒⠇⠐⠇⠅⠷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠾⠕⠽⠠⠻⠀⠺⠨⠸⠿






⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⡆
```
