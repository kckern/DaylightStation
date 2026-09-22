<!-- content/seeds/school/korean-vocab/media-readme-section.md -->

## Generated-media word packages

`media/school/language/<package>/` (one per word package, e.g. `korean-vocab`)
is an exception to the placement contract above. Its images and TTS audio are
generated separately by the household, so the package may hold **0-byte
placeholders** (`words/<group>/<id>/image.jpg`, `term.mp3`, `gloss.mp3`)
outside `_inbox`. `<group>` is the course unit that first introduced the word
(its lexicon `group`); a new week is a new group folder. `school certify`
reports each placeholder (a warning; `--strict-media` makes it an error), and
the School player renders a card without any empty file. A word package is
not a course: no `poster.jpg` is required. Replace a placeholder by
overwriting the file in place. Never rename a word id — learner status is
keyed by it; moving a word to another group means moving its folder AND
changing its `group` in the lexicon, and loses no progress.
