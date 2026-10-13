# Young People's Atlas of the United States — Decoy Audit

Date: 2026-08-13

Status: resolved on 2026-08-13; all hard flags below were corrected in the
source worksheets and the complete curriculum passes question-bank v2
validation.

Scope: all 58 `worksheet.yml` files and all 956 authored questions under the
`young-peoples-atlas-us` curriculum.

## Standard used

A decoy is flagged here only when it is obviously worthless: the prompt itself
rules it out without requiring the student to know the answer or recall the
lesson. This is intentionally narrower than merely being unlikely or
geographically remote.

The question-bank v2 schema has no supported per-decoy review or flag field, so
this audit preserves the original findings and their resolution separately.

## Hard flags

| Lesson | Item | Flagged decoy | Why it is worthless |
|---|---|---|---|
| New Hampshire | `new-hampshire-coast` | Gulf of Mexico | The prompt asks for an ocean; this is a gulf. |
| New Hampshire | `new-hampshire-coast` | Lake Superior | The prompt asks for an ocean; this is a lake. |
| New Hampshire | `new-hampshire-coast` | Chesapeake Bay | The prompt asks for an ocean; this is a bay. |
| New Hampshire | `new-hampshire-coast` | Long Island Sound | The prompt asks for an ocean; this is a sound. |
| New Hampshire | `new-hampshire-coast` | Delaware Bay | The prompt asks for an ocean; this is a bay. |
| Rocky Mountains | `rockies-western-drainage` | Gulf of Mexico | The prompt asks for an ocean; this is a gulf. |
| Rocky Mountains | `rockies-western-drainage` | Great Lakes | The prompt asks for an ocean; these are lakes. |
| Rocky Mountains | `rockies-western-drainage` | Bering Sea | The prompt asks for an ocean; this is a sea. |
| Rocky Mountains | `rockies-western-drainage` | Great Salt Lake | The prompt asks for an ocean; this is a lake. |
| Rocky Mountains | `rockies-western-drainage` | Lake Michigan | The prompt asks for an ocean; this is a lake. |
| Rocky Mountains | `rockies-western-drainage` | Gulf of California | The prompt asks for an ocean; this is a gulf. |
| Midwest | `midwest-chicago-lake` | Lake Champlain | The prompt asks for a Great Lake; this is not one of the Great Lakes. |
| Midwest | `midwest-chicago-lake` | Lake Okeechobee | The prompt asks for a Great Lake; this is not one of the Great Lakes. |
| Midwest | `midwest-chicago-lake` | Great Salt Lake | The prompt asks for a Great Lake; this is not one of the Great Lakes. |
| Midwest | `midwest-chicago-lake` | Lake Pontchartrain | The prompt asks for a Great Lake; this is not one of the Great Lakes. |
| Indiana | `indiana-lake` | Great Salt Lake | The prompt asks for a Great Lake; this is not one of the Great Lakes. |
| Indiana | `indiana-lake` | Lake Champlain | The prompt asks for a Great Lake; this is not one of the Great Lakes. |
| Indiana | `indiana-lake` | Lake Okeechobee | The prompt asks for a Great Lake; this is not one of the Great Lakes. |
| Indiana | `indiana-lake` | Lake Tahoe | The prompt asks for a Great Lake; this is not one of the Great Lakes. |
| Minnesota | `minnesota-great-lake` | Great Salt Lake | The prompt asks for a Great Lake; this is not one of the Great Lakes. |
| Minnesota | `minnesota-great-lake` | Lake Champlain | The prompt asks for a Great Lake; this is not one of the Great Lakes. |
| Minnesota | `minnesota-great-lake` | Lake Tahoe | The prompt asks for a Great Lake; this is not one of the Great Lakes. |
| Minnesota | `minnesota-great-lake` | Lake Okeechobee | The prompt asks for a Great Lake; this is not one of the Great Lakes. |
| Michigan | `michigan-great-lakes` | Great Salt Lake | The prompt asks which Great Lakes border Michigan; this is not a Great Lake. |
| Michigan | `michigan-great-lakes` | Lake Champlain | The prompt asks which Great Lakes border Michigan; this is not a Great Lake. |
| Michigan | `michigan-great-lakes` | Lake Tahoe | The prompt asks which Great Lakes border Michigan; this is not a Great Lake. |
| Michigan | `michigan-great-lakes` | Lake Okeechobee | The prompt asks which Great Lakes border Michigan; this is not a Great Lake. |
| United States | `us-rockies-separation` | Great Plains | The prompt asks for a mountain range; this is a plains region. |
| United States | `us-rockies-separation` | Aleutian Islands | The prompt asks for a mountain range; this is an island chain. |
| Illinois | `illinois-grain-crops` | Sugarcane | The prompt asks for grain crops; sugarcane is not a grain. |
| Illinois | `illinois-grain-crops` | Cotton | The prompt asks for grain crops; cotton is not a grain. |
| Illinois | `illinois-grain-crops` | Tobacco | The prompt asks for grain crops; tobacco is not a grain. |
| Rhode Island | `rhode-island-chicken` | Jersey cow | The prompt says the animal was bred for egg production; a cow cannot lay eggs. |
| Rhode Island | `rhode-island-chicken` | Berkshire pig | The prompt says the animal was bred for egg production; a pig cannot lay eggs. |
| Rhode Island | `rhode-island-chicken` | Merino sheep | The prompt says the animal was bred for egg production; a sheep cannot lay eggs. |
| Rhode Island | `rhode-island-chicken` | Morgan horse | The prompt says the animal was bred for egg production; a horse cannot lay eggs. |
| Rhode Island | `rhode-island-chicken` | Angora goat | The prompt says the animal was bred for egg production; a goat cannot lay eggs. |
| Oregon | `oregon-fisheries` | Lobster and shrimp | The prompt asks which fish are important; neither is a fish. |
| Oregon | `oregon-fisheries` | Oysters and clams | The prompt asks which fish are important; neither is a fish. |

## Summary

- 39 individual decoy options are hard-flagged.
- 10 question pools contain at least one hard-flagged option.
- The other 946 question pools had no decoy meeting this strict, wording-only
  threshold.
- All 39 flags are resolved. Six prompts were broadened to match their valid
  answer pools, and the remaining bad options were replaced with same-category
  alternatives.

Several other decoys are very unlikely, silly, or geographically distant, but
they remain the requested answer type and therefore were not flagged as
*obviously* worthless in this pass.
