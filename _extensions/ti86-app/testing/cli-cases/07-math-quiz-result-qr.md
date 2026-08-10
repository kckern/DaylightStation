# SchoolCalc CLI case: 07-math-quiz-result-qr

## Inputs

- Release: `caacecbbb8b6`
- ROM: `/private/tmp/schoolcalc-ti86a.rom`
- Transfer: complete manifest (23 variables)
- Screen mode: `hybrid`; captures: `each`
- Ordered interaction inputs: key ENTER, wait 600f, key ENTER, wait 900f, key DOWN, key DOWN, key ENTER, wait 600f, key F2, wait 300f, key F1, wait 300f, key F3, wait 600f, key F1, wait 300f, key F1, wait 600f, key SECOND, key EXIT, wait 900f

### Replay

```sh
node _extensions/ti86-app/ti86.cli.mjs --mame /opt/homebrew/bin/mame --rom /private/tmp/schoolcalc-ti86a.rom --bundle /Users/kckern/Documents/GitHub/DaylightStation/_extensions/ti86-app/dist/install-ti86a-caacecbbb8b6 --load ASCHL --key ENTER --wait 600 --key ENTER --wait 900 --keys DOWN,DOWN,ENTER --wait 600 --key F2 --wait 300 --key F1 --wait 300 --key F3 --wait 600 --key F1 --wait 300 --key F1 --wait 600 --keys SECOND,EXIT --wait 900 --debug-receipt --screens each --screen hybrid --case-id 07-math-quiz-result-qr --output /Users/kckern/Documents/GitHub/DaylightStation/_extensions/ti86-app/testing/cli-cases/07-math-quiz-result-qr.md
```

## Captured output

```text
SCHOOLCALC_SCREEN label=transfer-complete pc=7742 executionWindow=false
T [none]; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.

SCHOOLCALC_SCREEN label=wake-after-transfer pc=019A executionWindow=false
T [none]; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.

SCHOOLCALC_SCREEN label=dismiss-transfer-receipt pc=019A executionWindow=false
T [none]; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⢸⣿⣿

SCHOOLCALC_SCREEN label=program-menu pc=0171 executionWindow=false
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

SCHOOLCALC_SCREEN label=enter pc=EACD executionWindow=true
T (3,24)+/c:LOAD; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.




⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠁⠀⠁

SCHOOLCALC_SCREEN label=wait-600 pc=019A executionWindow=true
T (1,1)-/c:SUBJECTS | (106,1)-/c:SOREN | (10,10)+/c:MATH | (10,16)+/c:SCIENCE | (10,22)+/c:HISTORY | (10,28)+/c:ARTS & CULTURE | (4,58)-/c:OPEN | (30,58)-/c:BACK | (55,58)-/c:USER | (104,58)-/c:OFF; S (0,10)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⣶⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣶⡲⣲⢰⣶⠀⠐⠒⠒⠒⠒⠒⠒

SCHOOLCALC_SCREEN label=enter pc=1783 executionWindow=true
T (3,24)+/c:LOAD; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.




⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠁⠀⠁

SCHOOLCALC_SCREEN label=wait-900 pc=019A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (106,1)-/c:SOREN | (10,10)+/c:NOTES | (10,16)+/c:EXAMPLES | (10,22)+/c:QUIZ | (4,58)-/c:OPEN | (30,58)-/c:BACK; S (0,10)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠴⠗⠐⠇⠅⠇⠪⠿⠿⠷⠰⠇⠐⠇⠅⠿⠿⠇⠼⠇⠐⠇⠜⠯⠒⠇⠐⠇⠅⠷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠾⠕⠽⠠⠻⠀⠺⠨⠸⠿






⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⡆

SCHOOLCALC_SCREEN label=down pc=019A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (106,1)-/c:SOREN | (10,10)+/c:NOTES | (10,16)+/c:EXAMPLES | (10,22)+/c:QUIZ | (4,58)-/c:OPEN | (30,58)-/c:BACK; S (0,16)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠴⠗⠐⠇⠅⠇⠪⠿⠿⠷⠰⠇⠐⠇⠅⠿⠿⠇⠼⠇⠐⠇⠜⠯⠒⠇⠐⠇⠅⠷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠾⠕⠽⠠⠻⠀⠺⠨⠸⠿






⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⡆

SCHOOLCALC_SCREEN label=down pc=019A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (106,1)-/c:SOREN | (10,10)+/c:NOTES | (10,16)+/c:EXAMPLES | (10,22)+/c:QUIZ | (4,58)-/c:OPEN | (30,58)-/c:BACK; S (0,22)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠴⠗⠐⠇⠅⠇⠪⠿⠿⠷⠰⠇⠐⠇⠅⠿⠿⠇⠼⠇⠐⠇⠜⠯⠒⠇⠐⠇⠅⠷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠾⠕⠽⠠⠻⠀⠺⠨⠸⠿






⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⡆

SCHOOLCALC_SCREEN label=enter pc=E30B executionWindow=true
T (3,24)+/c:LOAD; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.




⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠁⠀⠁

SCHOOLCALC_SCREEN label=wait-600 pc=019A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (101,1)-/c:Q1/3 | (2,11)+/c:WHAT IS TEN PERCENT OF | (2,17)+/c:70? | (2,23)+/c:A) | (12,23)+/c:5 | (2,29)+/c:B) | (12,29)+/c:7 | (2,35)+/c:C) | (12,35)+/c:10 | (2,41)+/c:D) | (12,41)+/c:17 | (4,57)-/c:F1=A | (30,57)-/c:F2=B | (56,57)-/c:F3=C | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠅⠤⠅⠀⠅⠅⠅⠨⠭⠭⠥⠠⠅⠀⠅⠅⠭⠭⠅⠬⠅⠀⠅⠌⠭⠀⠅⠀⠅⠅⠥⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠍⠈⠍⠥⠅⠨⠭⠭⠭⠭⠭⠭






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠿⠿⠿⠰⠾⠶⠿⠿⠿⠵⠾⠿⠿⠿⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=f2 pc=1792 executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (101,1)-/c:Q1/3 | (2,11)+/c:WHAT IS TEN PERCENT OF | (2,17)+/c:70? | (2,23)+/c:A) | (12,23)+/c:5 | (2,29)+/c:B) | (12,29)+/c:7 | (2,35)+/c:C) | (12,35)+/c:10 | (2,41)+/c:D) | (12,41)+/c:17 | (4,57)-/c:F1=A | (31,57)+/c:B OK     D | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠅⠤⠅⠀⠅⠅⠅⠨⠭⠭⠥⠠⠅⠀⠅⠅⠭⠭⠅⠬⠅⠀⠅⠌⠭⠀⠅⠀⠅⠅⠥⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠍⠈⠍⠥⠅⠨⠭⠭⠭⠭⠭⠭






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠿⠿⠰⠾⠶⠿⠿⠇⠀⠾⠿⠿⠿⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=wait-300 pc=019A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (101,1)-/c:Q2/3 | (2,11)+/c:WHAT IS TEN PERCENT OF | (2,17)+/c:250? | (2,23)+/c:A) | (12,23)+/c:2.5 | (2,29)+/c:B) | (12,29)+/c:25 | (2,35)+/c:C) | (12,35)+/c:50 | (2,41)+/c:D) | (12,41)+/c:100 | (4,57)-/c:F1=A | (30,57)-/c:F2=B | (56,57)-/c:F3=C | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠅⠤⠅⠀⠅⠅⠅⠨⠭⠭⠥⠠⠅⠀⠅⠅⠭⠭⠅⠬⠅⠀⠅⠌⠭⠀⠅⠀⠅⠅⠥⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠅⠈⠍⠥⠅⠨⠭⠭⠭⠭⠭⠭






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠿⠿⠿⠰⠾⠶⠿⠿⠿⠵⠾⠿⠿⠿⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=f1 pc=E34E executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (101,1)-/c:Q2/3 | (2,11)+/c:WHAT IS TEN PERCENT OF | (2,17)+/c:250? | (2,23)+/c:A) | (12,23)+/c:2.5 | (2,29)+/c:B) | (12,29)+/c:25 | (2,35)+/c:C) | (12,35)+/c:50 | (2,41)+/c:D) | (12,41)+/c:100 | (5,57)+/c:A OK | (30,57)-/c:F2=B | (56,57)-/c:F3=C | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠅⠤⠅⠀⠅⠅⠅⠨⠭⠭⠥⠠⠅⠀⠅⠅⠭⠭⠅⠬⠅⠀⠅⠌⠭⠀⠅⠀⠅⠅⠥⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠅⠈⠍⠥⠅⠨⠭⠭⠭⠭⠭⠭






⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠿⠿⠿⠰⠾⠶⠿⠿⠿⠵⠾⠿⠿⠿⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=wait-300 pc=019A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (101,1)-/c:Q3/3 | (2,11)+/c:IF TEN PERCENT IS 6, | (2,17)+/c:WHAT IS TWENTY PERCENT? | (2,23)+/c:A) | (12,23)+/c:3 | (2,29)+/c:B) | (12,29)+/c:6 | (2,35)+/c:C) | (12,35)+/c:12 | (2,41)+/c:D) | (12,41)+/c:60 | (4,57)-/c:F1=A | (30,57)-/c:F2=B | (56,57)-/c:F3=C | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠅⠤⠅⠀⠅⠅⠅⠨⠭⠭⠥⠠⠅⠀⠅⠅⠭⠭⠅⠬⠅⠀⠅⠌⠭⠀⠅⠀⠅⠅⠥⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠅⠨⠍⠥⠅⠨⠭⠭⠭⠭⠭⠭






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠿⠿⠿⠰⠾⠶⠿⠿⠿⠵⠾⠿⠿⠿⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=f3 pc=529A executionWindow=true
T (1,1)-/c:FIND TEN PERCENT | (101,1)-/c:Q3/3 | (2,11)+/c:IF TEN PERCENT IS 6, | (2,17)+/c:WHAT IS TWENTY PERCENT? | (2,23)+/c:A) | (12,23)+/c:3 | (2,29)+/c:B) | (12,29)+/c:6 | (2,35)+/c:C) | (12,35)+/c:12 | (2,41)+/c:D) | (12,41)+/c:60 | (4,57)-/c:F1=A | (30,57)-/c:F2=B | (56,57)+/c:C OK | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠅⠤⠅⠀⠅⠅⠅⠨⠭⠭⠥⠠⠅⠀⠅⠅⠭⠭⠅⠬⠅⠀⠅⠌⠭⠀⠅⠀⠅⠅⠥⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠅⠨⠍⠥⠅⠨⠭⠭⠭⠭⠭⠭






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=wait-600 pc=019A executionWindow=true
T (1,1)-/c:RESULT | (98,1)-/c:OFFLINE | (2,13)+/c:SCORE 2/3 67% | (2,27)+/c:REVIEW: RETRY QUIZ | (2,41)+/c:QR QUEUED / CABLE OFF | (5,58)-/c:QR | (30,58)-/c:OPEN | (81,58)-/c:USER | (107,58)-/c:CABLE; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⣶⡖⡆⡆⣶⣶⣶⣶⣶⣶⡆⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⡆⣶⣶⣖⠶⡖⡖⡆⢶⡆⠶⡆⠶⣶

SCHOOLCALC_SCREEN label=f1 pc=DE42 executionWindow=true
T [none]; S (45,13)+:▦ QR V5/M 37×37
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.

SCHOOLCALC_SCREEN label=wait-300 pc=019A executionWindow=true
T (42,3)+/c:SCAN RESULT | (5,58)+/c:DONE | (104,58)+/c:LATER; S (45,13)+:▦ QR V5/M 37×37
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.

SCHOOLCALC_SCREEN label=f1 pc=019A executionWindow=true
T (1,1)-/c:RESULT | (98,1)-/c:OFFLINE | (2,13)+/c:SCORE 2/3 67% | (2,27)+/c:REVIEW: RETRY QUIZ | (2,41)+/c:QR QUEUED / CABLE OFF | (5,58)-/c:QR | (30,58)-/c:OPEN | (81,58)-/c:USER | (107,58)-/c:CABLE; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⣶⡖⡆⡆⣶⣶⣶⣶⣶⣶⡆⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⡆⣶⣶⣖⠶⡖⡖⡆⢶⡆⠶⡆⠶⣶

SCHOOLCALC_SCREEN label=wait-600 pc=019A executionWindow=true
T (1,1)-/c:RESULT | (98,1)-/c:OFFLINE | (2,13)+/c:SCORE 2/3 67% | (2,27)+/c:REVIEW: RETRY QUIZ | (2,41)+/c:QR QUEUED / CABLE OFF | (5,58)-/c:QR | (30,58)-/c:OPEN | (81,58)-/c:USER | (107,58)-/c:CABLE; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⣶⡖⡆⡆⣶⣶⣶⣶⣶⣶⡆⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⡆⣶⣶⣖⠶⡖⡖⡆⢶⡆⠶⡆⠶⣶

SCHOOLCALC_SCREEN label=second pc=019A executionWindow=true
T (1,1)-/c:RESULT | (98,1)-/c:OFFLINE | (2,13)+/c:SCORE 2/3 67% | (2,27)+/c:REVIEW: RETRY QUIZ | (2,41)+/c:QR QUEUED / CABLE OFF | (5,58)-/c:QR | (30,58)-/c:OPEN | (81,58)-/c:USER | (107,58)-/c:CABLE; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⣶⡖⡆⡆⣶⣶⣶⣶⣶⣶⡆⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⡆⣶⣶⣖⠶⡖⡖⡆⢶⡆⠶⡆⠶⣶

SCHOOLCALC_SCREEN label=exit pc=019A executionWindow=true
T (1,0)+/d:AS HL; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠀⠀⠀⠀⠀⠀⠸⣉⡩
⢸⣿⣿

SCHOOLCALC_SCREEN label=wait-900 pc=019A executionWindow=true
T (1,0)+/d:AS HL; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠀⠀⠀⠀⠀⠀⠸⣉⡩
⢸⣿⣿

SCHOOLCALC_SCREEN label=final pc=019A executionWindow=true
T (1,0)+/d:AS HL; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠀⠀⠀⠀⠀⠀⠸⣉⡩
⢸⣿⣿

SCHOOLCALC_RECEIPT variable=DSQOUT magic=SCO1 valid=true baseSequence=0 markedIndexes=0
```
