# SchoolCalc CLI case: 04-profile-progress-switch

## Inputs

- Release: `caacecbbb8b6`
- ROM: `/private/tmp/schoolcalc-ti86a.rom`
- Transfer: complete manifest (23 variables)
- Screen mode: `hybrid`; captures: `each`
- Ordered interaction inputs: key ENTER, wait 600f, key F3, wait 600f, key F2, wait 300f, key F3, wait 600f, key F5, wait 300f, key ENTER, wait 600f

### Replay

```sh
node _extensions/ti86-app/ti86.cli.mjs --mame /opt/homebrew/bin/mame --rom /private/tmp/schoolcalc-ti86a.rom --bundle /Users/kckern/Documents/GitHub/DaylightStation/_extensions/ti86-app/dist/install-ti86a-caacecbbb8b6 --load ASCHL --key ENTER --wait 600 --key F3 --wait 600 --key F2 --wait 300 --key F3 --wait 600 --key F5 --wait 300 --key ENTER --wait 600 --screens each --screen hybrid --case-id 04-profile-progress-switch --output /Users/kckern/Documents/GitHub/DaylightStation/_extensions/ti86-app/testing/cli-cases/04-profile-progress-switch.md
```

## Captured output

```text
SCHOOLCALC_SCREEN label=transfer-complete pc=7229 executionWindow=false
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
T (1,1)-/c:WHO IS STUDYING | (102,1)-/c:CHOOSE | (9,10)+/c:LEARNER1 | (9,16)+/c:LEARNER2 | (9,22)+/c:LEARNER3 | (9,28)+/c:LEARNER4 | (9,34)+/c:GUEST | (1,57)-/c:SELECT | (105,57)-/c:GUEST; S (61,1)-:◌ (0,10)+:❯
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
T (1,1)-/c:SUBJECTS | (106,1)-/c:LEARNER1 | (10,10)+/c:MATH | (10,16)+/c:SCIENCE | (10,22)+/c:HISTORY | (10,28)+/c:ARTS & CULTURE | (4,58)-/c:OPEN | (30,58)-/c:BACK | (55,58)-/c:USER | (104,58)-/c:OFF; S (0,10)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⣶⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣶⡲⣲⢰⣶⠀⠐⠒⠒⠒⠒⠒⠒

SCHOOLCALC_SCREEN label=f3 pc=019A executionWindow=true
T (1,1)-/c:MY PROGRESS | (106,1)-/c:LEARNER1 | (2,10)+/c:RECENT FIND TEN PERCENT | (2,21)+/c:SCORE | (114,21)+/c:80% | (2,31)+/c:DONE   1 | (70,31)+/c:QUEUED | (96,31)+/c:0 | (2,41)+/c:CABLE: OFFLINE | (30,57)-/c:BACK | (104,57)-/c:SWITCH; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⠿⠰⠿⠱⠹⠵⠾⠸⠺⠿⠿⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⠷⠾⠸⠸⠆⠾⠆⠾⠵⠾⠸⠸

SCHOOLCALC_SCREEN label=wait-600 pc=019A executionWindow=true
T (1,1)-/c:MY PROGRESS | (106,1)-/c:LEARNER1 | (2,10)+/c:RECENT FIND TEN PERCENT | (2,21)+/c:SCORE | (114,21)+/c:80% | (2,31)+/c:DONE   1 | (70,31)+/c:QUEUED | (96,31)+/c:0 | (2,41)+/c:CABLE: OFFLINE | (30,57)-/c:BACK | (104,57)-/c:SWITCH; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⠿⠰⠿⠱⠹⠵⠾⠸⠺⠿⠿⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⠷⠾⠸⠸⠆⠾⠆⠾⠵⠾⠸⠸

SCHOOLCALC_SCREEN label=f2 pc=EB46 executionWindow=true
T (3,24)+/c:LOAD; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.




⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠁⠀⠁

SCHOOLCALC_SCREEN label=wait-300 pc=019A executionWindow=true
T (1,1)-/c:SUBJECTS | (106,1)-/c:LEARNER1 | (10,10)+/c:MATH | (10,16)+/c:SCIENCE | (10,22)+/c:HISTORY | (10,28)+/c:ARTS & CULTURE | (4,58)-/c:OPEN | (30,58)-/c:BACK | (55,58)-/c:USER | (104,58)-/c:OFF; S (0,10)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⣶⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣶⡲⣲⢰⣶⠀⠐⠒⠒⠒⠒⠒⠒

SCHOOLCALC_SCREEN label=f3 pc=F51E executionWindow=true
T (1,1)-/c:MY PROGRESS | (106,1)-/c:LEARNER1 | (2,10)+/c:RECENT FIND TEN PERCENT | (2,21)+/c:SCORE | (114,21)+/c:80% | (2,31)+/c:DONE   1 | (70,31)+/c:QUEUED | (96,31)+/c:0 | (2,41)+/c:CABLE: OFFLINE | (30,57)-/c:BACK | (104,57)-/c:SWITCH; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⠿⠰⠿⠱⠹⠵⠾⠸⠺⠿⠿⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⠷⠾⠸⠸⠆⠾⠆⠾⠵⠾⠸⠸

SCHOOLCALC_SCREEN label=wait-600 pc=F51E executionWindow=true
T (1,1)-/c:MY PROGRESS | (106,1)-/c:LEARNER1 | (2,10)+/c:RECENT FIND TEN PERCENT | (2,21)+/c:SCORE | (114,21)+/c:80% | (2,31)+/c:DONE   1 | (70,31)+/c:QUEUED | (96,31)+/c:0 | (2,41)+/c:CABLE: OFFLINE | (30,57)-/c:BACK | (104,57)-/c:SWITCH; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⠿⠰⠿⠱⠹⠵⠾⠸⠺⠿⠿⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⠷⠾⠸⠸⠆⠾⠆⠾⠵⠾⠸⠸

SCHOOLCALC_SCREEN label=f5 pc=019A executionWindow=true
T (1,1)-/c:WHO IS STUDYING | (106,1)-/c:LEARNER1 | (9,10)+/c:LEARNER1 | (9,16)+/c:LEARNER2 | (9,22)+/c:LEARNER3 | (9,28)+/c:LEARNER4 | (9,34)+/c:GUEST | (1,57)-/c:SELECT | (31,57)-/c:PROG | (105,57)-/c:GUEST; S (61,1)-:◌ (0,10)+:❯ (4,10)+:●
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠅⠇⠅⠯⠪⠿⠿⠗⠐⠟⠰⠿⠿⠟⠰⠷⠰⠧⠣⠇⠪⠷⠱⠗⠐⠇⠅⠯⠂⠷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠾⠕⠽⠠⠻⠀⠺⠨⠸⠿
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⡇
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠁




⠿⠶⠇⠶⠇⠿⠇⠶⠯⠶⠷⠰⠇⠿⠿⠇⠾⠇⠞⠯⠮⠯⠖⠿⠿⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⠯⠖⠧⠧⠇⠶⠿⠶⠷⠰⠿⠇

SCHOOLCALC_SCREEN label=wait-300 pc=019A executionWindow=true
T (1,1)-/c:WHO IS STUDYING | (106,1)-/c:LEARNER1 | (9,10)+/c:LEARNER1 | (9,16)+/c:LEARNER2 | (9,22)+/c:LEARNER3 | (9,28)+/c:LEARNER4 | (9,34)+/c:GUEST | (1,57)-/c:SELECT | (31,57)-/c:PROG | (105,57)-/c:GUEST; S (61,1)-:◌ (0,10)+:❯ (4,10)+:●
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠅⠇⠅⠯⠪⠿⠿⠗⠐⠟⠰⠿⠿⠟⠰⠷⠰⠧⠣⠇⠪⠷⠱⠗⠐⠇⠅⠯⠂⠷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠾⠕⠽⠠⠻⠀⠺⠨⠸⠿
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⡇
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠁




⠿⠶⠇⠶⠇⠿⠇⠶⠯⠶⠷⠰⠇⠿⠿⠇⠾⠇⠞⠯⠮⠯⠖⠿⠿⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠿⠯⠖⠧⠧⠇⠶⠿⠶⠷⠰⠿⠇

SCHOOLCALC_SCREEN label=enter pc=EB3B executionWindow=true
T (3,24)+/c:LOAD; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.




⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠁⠀⠁

SCHOOLCALC_SCREEN label=wait-600 pc=019A executionWindow=true
T (1,1)-/c:SUBJECTS | (106,1)-/c:LEARNER1 | (10,10)+/c:MATH | (10,16)+/c:SCIENCE | (10,22)+/c:HISTORY | (10,28)+/c:ARTS & CULTURE | (4,58)-/c:OPEN | (30,58)-/c:BACK | (55,58)-/c:USER | (104,58)-/c:OFF; S (0,10)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⣶⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣶⡲⣲⢰⣶⠀⠐⠒⠒⠒⠒⠒⠒

SCHOOLCALC_SCREEN label=final pc=019A executionWindow=true
T (1,1)-/c:SUBJECTS | (106,1)-/c:LEARNER1 | (10,10)+/c:MATH | (10,16)+/c:SCIENCE | (10,22)+/c:HISTORY | (10,28)+/c:ARTS & CULTURE | (4,58)-/c:OPEN | (30,58)-/c:BACK | (55,58)-/c:USER | (104,58)-/c:OFF; S (0,10)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⣶⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣶⡲⣲⢰⣶⠀⠐⠒⠒⠒⠒⠒⠒
```
