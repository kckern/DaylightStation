# Class board → home notes

For a learner who also attends an outside weekly class (a weekend language
school, say), `cli/class-board.cli.mjs` turns the class's own board posts into
home work: the homework the teacher assigned last class, and the read-ahead
for the next one. Practice cards pair with it through a deck release calendar
([card ladder → Release calendar](./card-ladder.md#release-calendar-releases)).

Nothing about a particular board is in code. One config file
(`school.class-board/v1`, kept with the household data) names the source, how
to read a post, and the wording of the notes.

## Commands

```bash
node cli/class-board.cli.mjs sync  --config <file>                   # archive posts
node cli/class-board.cli.mjs notes --config <file> [--from D --to D]  # dated notes (default: next 7 days)
node cli/class-board.cli.mjs run   --config <file> [--day D]          # sync, then that day's notes
```

Every command is a dry run until `--apply`. `--base` (default
`DAYLIGHT_BASE_PATH`) is the data root; the config's paths are relative to it.
Run `run --apply` once a day: notes are written for the day only, so they
always reflect the latest posts (a homework post that appears on Monday is in
Wednesday's note).

## Config

```yaml
schema: school.class-board/v1
learner: {learnerId}
by: {adultId}                     # the notes' `from`
timezone: {tz}
calendar: {path to class calendar}
archive: {dir for archived posts}
source:
  url: {endpoint returning the post list}
  method: POST                    # default POST
  headers: {}                     # optional
  body: { … }                     # optional JSON body
  ok: {path}                      # optional truthy flag in the response
  posts: {path to the post array}
  fields:                         # dotted paths inside one post
    id: …
    title: …
    html: …                       # rich-text body
    pinned: …
    updatedSeconds: …             # epoch seconds; an unchanged value skips the rewrite
    attachments: …
    attachmentName: …
    attachmentUrl: …
parse:                            # regular expressions over the post
  classDate: …                    # against the title; groups = year, month, day
  homeworkStart: …                # the homework line (its match is stripped)
  sectionEnd: …                   # the first line after the homework section
  extraLines: …                   # optional: later lines that ride with the homework
  noHomework: …                   # optional: the post says there is none
  lesson: …                       # group 1 = a lesson number the post says was taught
notes:
  days: [1, 3, 5]                 # ISO weekdays
  idPrefix: …                     # ids are <idPrefix>-<day>-prep|hw; re-runs skip existing
  maxChars: 110
  times: { prep: '07:00', homework: '07:01' }
  templates:                      # {placeholders}
    when: …                       # {date}
    prep: …                       # {when} {lesson} {pages}
    exam: …                       # {when} {exam} {review}
    noClass: …                    # {when} {noClass}
    homework: …                   # {date} {homework}
    homeworkMissing: …            # {date}
```

The class calendar (`school.class-calendar/v1`) lists `lessons: {n: pages}`
and `classes: [{date, lesson | exam + review | noClass}]`.

## Behaviour

- **Archive.** One YAML per post, `<classDate|undated>-<postId>.yml`, with the
  plain text, the homework section, the lessons mentioned and attachments.
- **Homework.** The last class's post with a homework section wins over a
  same-day notice. No post yet gives the `homeworkMissing` line; an explicit
  "none" gives no line; a no-class week gives none.
- **Read-ahead.** The calendar's lesson for the next class, capped at one
  lesson past the furthest lesson any earlier post mentions, so a slow week
  does not race ahead. Exam and no-class weeks use their own templates.
- **Delivery.** Notes are teacher notes (`school/records/teacher-notes.yml`),
  shown by the agenda's "Notes for you" on their day and the next, at most
  three, each printed as `Note: …` cut at 120 characters. They record no
  completion: the class teacher checks the homework.
- **Failure.** A failed fetch exits non-zero before writing anything; the
  notes step still works from the existing archive.
