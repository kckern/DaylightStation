# SchoolCalc CLI case: 10-pokemon-quiz-result-qr

## Inputs

- Release: `caacecbbb8b6`
- ROM: `/private/tmp/schoolcalc-ti86a.rom`
- Transfer: complete manifest (23 variables)
- Screen mode: `hybrid`; captures: `each`
- Ordered interaction inputs: key ENTER, wait 600f, key DOWN, key DOWN, key DOWN, key ENTER, wait 900f, key F2, wait 300f, key F3, wait 300f, key F4, wait 300f, key F2, wait 300f, key F3, wait 300f, key F4, wait 500f, key F1, wait 300f

### Replay

```sh
node _extensions/ti86-app/ti86.cli.mjs --mame /opt/homebrew/bin/mame --rom /private/tmp/schoolcalc-ti86a.rom --bundle /Users/kckern/Documents/GitHub/DaylightStation/_extensions/ti86-app/dist/install-ti86a-caacecbbb8b6 --load ASCHL --key ENTER --wait 600 --keys DOWN,DOWN,DOWN,ENTER --wait 900 --key F2 --wait 300 --key F3 --wait 300 --key F4 --wait 300 --key F2 --wait 300 --key F3 --wait 300 --key F4 --wait 500 --key F1 --wait 300 --screens each --screen hybrid --case-id 10-pokemon-quiz-result-qr --output /Users/kckern/Documents/GitHub/DaylightStation/_extensions/ti86-app/testing/cli-cases/10-pokemon-quiz-result-qr.md
```

## Captured output

```text
SCHOOLCALC_SCREEN label=transfer-complete pc=71C9 executionWindow=false
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

SCHOOLCALC_SCREEN label=enter pc=EACD executionWindow=true
T (3,24)+/c:LOAD; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.




⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠁⠀⠁

SCHOOLCALC_SCREEN label=wait-600 pc=019A executionWindow=true
T (1,1)-/c:SUBJECTS | (106,1)-/c:SOREN | (10,10)+/c:MATH | (10,16)+/c:SCIENCE | (10,22)+/c:HISTORY | (10,28)+/c:ARTS & CULTURE | (4,58)-/c:OPEN | (30,58)-/c:BACK | (55,58)-/c:USER | (104,58)-/c:OFF; S (0,10)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⣶⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣶⡲⣲⢰⣶⠀⠐⠒⠒⠒⠒⠒⠒

SCHOOLCALC_SCREEN label=down pc=019A executionWindow=true
T (1,1)-/c:SUBJECTS | (106,1)-/c:SOREN | (10,10)+/c:MATH | (10,16)+/c:SCIENCE | (10,22)+/c:HISTORY | (10,28)+/c:ARTS & CULTURE | (4,58)-/c:OPEN | (30,58)-/c:BACK | (55,58)-/c:USER | (104,58)-/c:OFF; S (0,16)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⣶⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣶⡲⣲⢰⣶⠀⠐⠒⠒⠒⠒⠒⠒

SCHOOLCALC_SCREEN label=down pc=019A executionWindow=true
T (1,1)-/c:SUBJECTS | (106,1)-/c:SOREN | (10,10)+/c:MATH | (10,16)+/c:SCIENCE | (10,22)+/c:HISTORY | (10,28)+/c:ARTS & CULTURE | (4,58)-/c:OPEN | (30,58)-/c:BACK | (55,58)-/c:USER | (104,58)-/c:OFF; S (0,22)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⣶⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣶⡲⣲⢰⣶⠀⠐⠒⠒⠒⠒⠒⠒

SCHOOLCALC_SCREEN label=down pc=F51C executionWindow=true
T (1,1)-/c:SUBJECTS | (106,1)-/c:SOREN | (10,10)+/c:MATH | (10,16)+/c:SCIENCE | (10,22)+/c:HISTORY | (10,28)+/c:ARTS & CULTURE | (4,58)-/c:OPEN | (30,58)-/c:BACK | (55,58)-/c:USER | (104,58)-/c:OFF; S (0,28)+:❯
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⡆⣶⣶⠰⣶⢲⢲⡲⢶⢰⢴⣶⣶⣶⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣶⡲⣲⢰⣶⠀⠐⠒⠒⠒⠒⠒⠒

SCHOOLCALC_SCREEN label=enter pc=EB4B executionWindow=true
T (3,24)+/c:LOAD; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.




⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠁⠀⠁⠀⠁

SCHOOLCALC_SCREEN label=wait-900 pc=019A executionWindow=true
T (1,1)-/c:POKEMON IDENTIFICATION   Q1/6 | (2,11)+/c:WHICH POKEMON IS THE | (2,17)+/c:FINAL EVOLUTION OF | (2,23)+/c:PICHU? | (2,29)+/c:A) | (12,29)+/c:PIKACHU | (2,35)+/c:B) | (12,35)+/c:RAICHU | (2,41)+/c:C) | (12,41)+/c:PLUSLE | (2,47)+/c:D) | (12,47)+/c:EMOLGA | (4,57)-/c:F1=A | (30,57)-/c:F2=B | (56,57)-/c:F3=C | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠾⠯⠮⠇⠗⠇⠶⠇⠅⠯⠮⠇⠅⠿⠿⠷⠰⠇⠮⠇⠶⠇⠅⠷⠰⠷⠰⠇⠶⠷⠰⠯⠶⠏⠎⠷⠰⠷⠰⠯⠮⠇⠅⠒⠒⠒⠒⠒⠒⠂⠊⠿⠸⠟⠷⠯⠴⠿⠿⠿⠿⠿⠿






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠿⠿⠿⠰⠾⠶⠿⠿⠿⠵⠾⠿⠿⠿⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=f2 pc=E4FD executionWindow=true
T (1,1)-/c:POKEMON IDENTIFICATION   Q1/6 | (2,11)+/c:WHICH POKEMON IS THE | (2,17)+/c:FINAL EVOLUTION OF | (2,23)+/c:PICHU? | (2,29)+/c:A) | (12,29)+/c:PIKACHU | (2,35)+/c:B) | (12,35)+/c:RAICHU | (2,41)+/c:C) | (12,41)+/c:PLUSLE | (2,47)+/c:D) | (12,47)+/c:EMOLGA | (4,57)-/c:F1=A | (31,57)+/c:B OK     D | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠾⠯⠮⠇⠗⠇⠶⠇⠅⠯⠮⠇⠅⠿⠿⠷⠰⠇⠮⠇⠶⠇⠅⠷⠰⠷⠰⠇⠶⠷⠰⠯⠶⠏⠎⠷⠰⠷⠰⠯⠮⠇⠅⠒⠒⠒⠒⠒⠒⠂⠊⠿⠸⠟⠷⠯⠴⠿⠿⠿⠿⠿⠿






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠿⠿⠰⠾⠶⠿⠿⠇⠀⠾⠿⠿⠿⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=wait-300 pc=019A executionWindow=true
T (1,1)-/c:POKEMON IDENTIFICATION   Q2/6 | (2,11)+/c:WHICH POKEMON EVOLVES | (2,17)+/c:DIRECTLY FROM DRATINI? | (2,23)+/c:A) | (12,23)+/c:DRAGONITE | (2,29)+/c:B) | (12,29)+/c:BAGON | (2,35)+/c:C) | (12,35)+/c:DRAGONAIR | (2,41)+/c:D) | (12,41)+/c:GYARADOS | (4,57)-/c:F1=A | (30,57)-/c:F2=B | (56,57)-/c:F3=C | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠾⠯⠮⠇⠗⠇⠶⠇⠅⠯⠮⠇⠅⠿⠿⠷⠰⠇⠮⠇⠶⠇⠅⠷⠰⠷⠰⠇⠶⠷⠰⠯⠶⠏⠎⠷⠰⠷⠰⠯⠮⠇⠅⠒⠒⠒⠒⠒⠒⠂⠊⠗⠾⠟⠷⠯⠴⠿⠿⠿⠿⠿⠿






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠿⠿⠿⠰⠾⠶⠿⠿⠿⠵⠾⠿⠿⠿⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=f3 pc=E366 executionWindow=true
T (1,1)-/c:POKEMON IDENTIFICATION   Q2/6 | (2,11)+/c:WHICH POKEMON EVOLVES | (2,17)+/c:DIRECTLY FROM DRATINI? | (2,23)+/c:A) | (12,23)+/c:DRAGONITE | (2,29)+/c:B) | (12,29)+/c:BAGON | (2,35)+/c:C) | (12,35)+/c:DRAGONAIR | (2,41)+/c:D) | (12,41)+/c:GYARADOS | (4,57)-/c:F1=A | (30,57)-/c:F2=B | (56,57)+/c:C OK | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠾⠯⠮⠇⠗⠇⠶⠇⠅⠯⠮⠇⠅⠿⠿⠷⠰⠇⠮⠇⠶⠇⠅⠷⠰⠷⠰⠇⠶⠷⠰⠯⠶⠏⠎⠷⠰⠷⠰⠯⠮⠇⠅⠒⠒⠒⠒⠒⠒⠂⠊⠗⠾⠟⠷⠯⠴⠿⠿⠿⠿⠿⠿






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=wait-300 pc=019A executionWindow=true
T (1,1)-/c:POKEMON IDENTIFICATION   Q3/6 | (2,11)+/c:WHICH POKEMON HAS THE | (2,17)+/c:ICE AND GHOST TYPE | (2,23)+/c:PAIR? | (2,29)+/c:A) | (12,29)+/c:GLACEON | (2,35)+/c:B) | (12,35)+/c:WEAVILE | (2,41)+/c:C) | (12,41)+/c:MISMAGIUS | (2,47)+/c:D) | (12,47)+/c:FROSLASS | (4,57)-/c:F1=A | (30,57)-/c:F2=B | (56,57)-/c:F3=C | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠾⠯⠮⠇⠗⠇⠶⠇⠅⠯⠮⠇⠅⠿⠿⠷⠰⠇⠮⠇⠶⠇⠅⠷⠰⠷⠰⠇⠶⠷⠰⠯⠶⠏⠎⠷⠰⠷⠰⠯⠮⠇⠅⠒⠒⠒⠒⠒⠒⠂⠊⠷⠾⠟⠷⠯⠴⠿⠿⠿⠿⠿⠿






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠿⠿⠿⠰⠾⠶⠿⠿⠿⠵⠾⠿⠿⠿⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=f4 pc=536B executionWindow=true
T (1,1)-/c:POKEMON IDENTIFICATION   Q3/6 | (2,11)+/c:WHICH POKEMON HAS THE | (2,17)+/c:ICE AND GHOST TYPE | (2,23)+/c:PAIR? | (2,29)+/c:A) | (12,29)+/c:GLACEON | (2,35)+/c:B) | (12,35)+/c:WEAVILE | (2,41)+/c:C) | (12,41)+/c:MISMAGIUS | (2,47)+/c:D) | (12,47)+/c:FROSLASS | (4,57)-/c:F1=A | (30,57)-/c:F2=B | (56,57)-/c:F3=C | (82,57)+/c:D OK; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠾⠯⠮⠇⠗⠇⠶⠇⠅⠯⠮⠇⠅⠿⠿⠷⠰⠇⠮⠇⠶⠇⠅⠷⠰⠷⠰⠇⠶⠷⠰⠯⠶⠏⠎⠷⠰⠷⠰⠯⠮⠇⠅⠒⠒⠒⠒⠒⠒⠂⠊⠷⠾⠟⠷⠯⠴⠿⠿⠿⠿⠿⠿






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠿⠿⠿⠰⠾⠶⠿⠿⠿⠵⠾⠿⠿⠇

SCHOOLCALC_SCREEN label=wait-300 pc=019A executionWindow=true
T (1,1)-/c:POKEMON IDENTIFICATION   Q4/6 | (2,11)+/c:WHICH POKEMON IS | (2,17)+/c:POKEDEX NUMBER 133? | (2,23)+/c:A) | (12,23)+/c:DITTO | (2,29)+/c:B) | (12,29)+/c:EEVEE | (2,35)+/c:C) | (12,35)+/c:LAPRAS | (2,41)+/c:D) | (12,41)+/c:SNORLAX | (4,57)-/c:F1=A | (30,57)-/c:F2=B | (56,57)-/c:F3=C | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠾⠯⠮⠇⠗⠇⠶⠇⠅⠯⠮⠇⠅⠿⠿⠷⠰⠇⠮⠇⠶⠇⠅⠷⠰⠷⠰⠇⠶⠷⠰⠯⠶⠏⠎⠷⠰⠷⠰⠯⠮⠇⠅⠒⠒⠒⠒⠒⠒⠂⠊⠧⠇⠟⠷⠯⠴⠿⠿⠿⠿⠿⠿






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠿⠿⠿⠰⠾⠶⠿⠿⠿⠵⠾⠿⠿⠿⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=f2 pc=E361 executionWindow=true
T (1,1)-/c:POKEMON IDENTIFICATION   Q4/6 | (2,11)+/c:WHICH POKEMON IS | (2,17)+/c:POKEDEX NUMBER 133? | (2,23)+/c:A) | (12,23)+/c:DITTO | (2,29)+/c:B) | (12,29)+/c:EEVEE | (2,35)+/c:C) | (12,35)+/c:LAPRAS | (2,41)+/c:D) | (12,41)+/c:SNORLAX | (4,57)-/c:F1=A | (31,57)+/c:B OK     D | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠾⠯⠮⠇⠗⠇⠶⠇⠅⠯⠮⠇⠅⠿⠿⠷⠰⠇⠮⠇⠶⠇⠅⠷⠰⠷⠰⠇⠶⠷⠰⠯⠶⠏⠎⠷⠰⠷⠰⠯⠮⠇⠅⠒⠒⠒⠒⠒⠒⠂⠊⠧⠇⠟⠷⠯⠴⠿⠿⠿⠿⠿⠿






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠿⠿⠰⠾⠶⠿⠿⠇⠀⠾⠿⠿⠿⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=wait-300 pc=019A executionWindow=true
T (1,1)-/c:POKEMON IDENTIFICATION   Q5/6 | (2,11)+/c:WHAT IS LUDICOLO'S TYPE | (2,17)+/c:PAIR? | (2,23)+/c:A) | (12,23)+/c:WATER AND ICE | (2,29)+/c:B) | (12,29)+/c:BUG AND WATER | (2,35)+/c:C) | (12,35)+/c:WATER AND GRASS | (2,41)+/c:D) | (12,41)+/c:GRASS AND FAIRY | (4,57)-/c:F1=A | (30,57)-/c:F2=B | (56,57)-/c:F3=C | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠾⠯⠮⠇⠗⠇⠶⠇⠅⠯⠮⠇⠅⠿⠿⠷⠰⠇⠮⠇⠶⠇⠅⠷⠰⠷⠰⠇⠶⠷⠰⠯⠶⠏⠎⠷⠰⠷⠰⠯⠮⠇⠅⠒⠒⠒⠒⠒⠒⠂⠊⠧⠶⠟⠷⠯⠴⠿⠿⠿⠿⠿⠿






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠿⠿⠿⠰⠾⠶⠿⠿⠿⠵⠾⠿⠿⠿⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=f3 pc=E37B executionWindow=true
T (1,1)-/c:POKEMON IDENTIFICATION   Q5/6 | (2,11)+/c:WHAT IS LUDICOLO'S TYPE | (2,17)+/c:PAIR? | (2,23)+/c:A) | (12,23)+/c:WATER AND ICE | (2,29)+/c:B) | (12,29)+/c:BUG AND WATER | (2,35)+/c:C) | (12,35)+/c:WATER AND GRASS | (2,41)+/c:D) | (12,41)+/c:GRASS AND FAIRY | (4,57)-/c:F1=A | (30,57)-/c:F2=B | (56,57)+/c:C OK | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠾⠯⠮⠇⠗⠇⠶⠇⠅⠯⠮⠇⠅⠿⠿⠷⠰⠇⠮⠇⠶⠇⠅⠷⠰⠷⠰⠇⠶⠷⠰⠯⠶⠏⠎⠷⠰⠷⠰⠯⠮⠇⠅⠒⠒⠒⠒⠒⠒⠂⠊⠧⠶⠟⠷⠯⠴⠿⠿⠿⠿⠿⠿






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=wait-300 pc=019A executionWindow=true
T (1,1)-/c:POKEMON IDENTIFICATION   Q6/6 | (2,11)+/c:AT NIGHT, SNEASEL | (2,17)+/c:HOLDING WHICH ITEM CAN | (2,23)+/c:EVOLVE INTO WEAVILE? | (2,29)+/c:A) | (12,29)+/c:KING'S ROCK | (2,35)+/c:B) | (12,35)+/c:MOON STONE | (2,41)+/c:C) | (12,41)+/c:METAL COAT | (2,47)+/c:D) | (12,47)+/c:RAZOR CLAW | (4,57)-/c:F1=A | (30,57)-/c:F2=B | (56,57)-/c:F3=C | (81,57)-/c:F4=D; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠾⠯⠮⠇⠗⠇⠶⠇⠅⠯⠮⠇⠅⠿⠿⠷⠰⠇⠮⠇⠶⠇⠅⠷⠰⠷⠰⠇⠶⠷⠰⠯⠶⠏⠎⠷⠰⠷⠰⠯⠮⠇⠅⠒⠒⠒⠒⠒⠒⠂⠊⠯⠶⠟⠷⠯⠴⠿⠿⠿⠿⠿⠿






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠿⠿⠿⠰⠾⠶⠿⠿⠿⠵⠾⠿⠿⠿⠿⠇⠶⠧⠇⠿⠿⠇⠮⠿⠿⠿

SCHOOLCALC_SCREEN label=f4 pc=D979 executionWindow=true
T (1,1)-/c:POKEMON IDENTIFICATION   Q6/6 | (2,11)+/c:AT NIGHT, SNEASEL | (2,17)+/c:HOLDING WHICH ITEM CAN | (2,23)+/c:EVOLVE INTO WEAVILE? | (2,29)+/c:A) | (12,29)+/c:KING'S ROCK | (2,35)+/c:B) | (12,35)+/c:MOON STONE | (2,41)+/c:C) | (12,41)+/c:METAL COAT | (2,47)+/c:D) | (12,47)+/c:RAZOR CLAW | (4,57)-/c:F1=A | (30,57)-/c:F2=B | (56,57)-/c:F3=C | (82,57)+/c:D OK; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
⠇⠾⠯⠮⠇⠗⠇⠶⠇⠅⠯⠮⠇⠅⠿⠿⠷⠰⠇⠮⠇⠶⠇⠅⠷⠰⠷⠰⠇⠶⠷⠰⠯⠶⠏⠎⠷⠰⠷⠰⠯⠮⠇⠅⠒⠒⠒⠒⠒⠒⠂⠊⠯⠶⠟⠷⠯⠴⠿⠿⠿⠿⠿⠿






⠿⠿⠰⠾⠇⠿⠿⠿⠱⠹⠿⠿⠿⠿⠿⠰⠾⠲⠿⠿⠿⠰⠿⠿⠿⠿⠿⠿⠰⠾⠶⠿⠿⠿⠵⠾⠿⠿⠇

SCHOOLCALC_SCREEN label=wait-500 pc=019A executionWindow=true
T (1,1)-/c:RESULT | (98,1)-/c:OFFLINE | (2,13)+/c:SCORE 6/6 100% | (2,27)+/c:MASTERED: NEXT | (2,41)+/c:QR QUEUED / CABLE OFF | (5,58)-/c:QR | (30,58)-/c:OPEN | (81,58)-/c:USER | (107,58)-/c:CABLE; S [none]
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.







⣶⣶⣶⡖⡆⡆⣶⣶⣶⣶⣶⣶⡆⣶⣶⡲⣲⢰⣶⠰⢶⢐⢰⣶⣶⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢰⣶⣆⢆⡶⢶⡆⠶⡆⡶⣶⣶⡆⣶⣶⣖⠶⡖⡖⡆⢶⡆⠶⡆⠶⣶

SCHOOLCALC_SCREEN label=f1 pc=DDE9 executionWindow=true
T [none]; S (45,13)+:▦ QR V5/M 37×37
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.

SCHOOLCALC_SCREEN label=wait-300 pc=019A executionWindow=true
T (42,3)+/c:SCAN RESULT | (5,58)+/c:DONE | (104,58)+/c:LATER; S (45,13)+:▦ QR V5/M 37×37
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.

SCHOOLCALC_SCREEN label=final pc=019A executionWindow=true
T (42,3)+/c:SCAN RESULT | (5,58)+/c:DONE | (104,58)+/c:LATER; S (45,13)+:▦ QR V5/M 37×37
G 2×8→Braille; swept text and chrome removed. + dark-on-light, - light-on-dark; c/r/d = 3×5/4×6/5×7.
```
