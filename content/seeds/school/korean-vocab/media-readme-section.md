<!-- content/seeds/school/korean-vocab/media-readme-section.md -->

## Generated-media word packages

`media/school/language/korean-vocab/` (and any future word package) is an
exception to the placement contract above. Its images and TTS audio are
generated separately by the household, so the package may hold **0-byte
placeholders** (`words/<id>/image.jpg`, `ko.mp3`, `en.mp3`) outside `_inbox`.
`school certify` reports each placeholder (a warning; `--strict-media` makes
it an error), and the School player renders a card without any empty file. A
word package is not a course: no `poster.jpg` is required. Replace a
placeholder by overwriting the file in place; never rename a word folder —
learner status is keyed by the word id.
