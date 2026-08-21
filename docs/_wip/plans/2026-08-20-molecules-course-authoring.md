# Molecules course authoring map

Source: *Molecules: The Elements and the Architecture of Everything* (Theodore Gray, 2014), EPUB in the authorized curriculum inbox.

## Scope decision

The EPUB has 121 XHTML presentation fragments, but its table of contents has 14 thematic chapters. The course should have 14 lessons—one per thematic chapter—rather than treating page fragments as lessons.

Proposed live course: `science/molecules-ted-gray`.

## Modules and lesson map

| Module | Lesson | Source entry point |
|---|---|---|
| Foundations | A House Built of Elements | `preface004.xhtml` |
| Foundations | The Power of Names | `chapter006.xhtml` |
| Foundations | Dead or Alive | `chapter025.xhtml` |
| Materials | Oil and Water | `chapter030.xhtml` |
| Materials | Mineral and Vegetable | `chapter035.xhtml` |
| Materials | Rock and Ore | `chapter049.xhtml` |
| Materials | Rope and Fiber | `chapter059.xhtml` |
| Molecules in experience | Pain and Pleasure | `chapter075.xhtml` |
| Molecules in experience | Sweet and Double Sweet | `chapter081.xhtml` |
| Molecules in experience | Natural and Artificial | `chapter085.xhtml` |
| Molecules in experience | Rose and Skunk | `chapter093.xhtml` |
| Molecules in life | Color Me Chemical | `chapter099.xhtml` |
| Molecules in life | I Hate That Molecule | `chapter111.xhtml` |
| Molecules in life | Machines of Life | `chapter121.xhtml` |

## Authoring sequence

1. Build the staged course skeleton from this map; do not place incomplete work in live `content/school`.
2. Author the first four lessons as complete production banks, with 12 shared multiple-choice, 3 lower-only multiple-choice, 1 upper-only multiple-choice, and 2 upper multi-select items each.
3. Run `bfn-author-preflight.py` and both profile validators before independent review.
4. Independently review the four completed banks, then promote them as one batch.
5. Continue in four-lesson batches: lessons 5–8, 9–12, and 13–14. Finish with course-wide profile and runtime audits.
