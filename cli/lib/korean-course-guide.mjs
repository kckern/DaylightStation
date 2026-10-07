/** Teacher-facing guide rendered from validated course inventory. */
export function renderKoreanCourseGuide(manifest) {
const rows=[{lesson:1,title:'Helping others',kind:'new',cards:19,questions:6,textbookPages:[14,23],workbookPages:[4,8]},...manifest.inventory];
return `# Korean 3-2 · complete sixteen-unit course

The course follows 재외동포를 위한 한국어 3-2 and its workbook: ten grammar-introduction units, five review units (3, 6, 9, 12, 15), and a cumulative final (16). The source book is designed for one unit per week; the app advances by demonstrated learning, with no forced weekly deadline. Introduce a few cards each weekday using four-new-card, five-per-round and fifteen-minute sitting defaults. Existing lessons and evidence are retained.

There are ${manifest.cards} unique bilingual cards, 32 pinned print forms, and ${manifest.questions} cumulative grammar targets. The primary vocabulary list of every source unit is represented, including the themed vocabulary introduced in review units. Repeated words and model expressions share card identity and learning history across decks. Review units use earlier grammar in fresh contexts; Unit 16 reuses the complete acquired card pool and introduces no new cards.

| Unit | Topic | Role | Cards in deck | Quiz targets | Textbook | Workbook |
|---|---|---|---:|---:|---|---|
${rows.map(r=>`| ${r.lesson} | ${r.title} | ${r.kind} | ${r.cards} | ${r.questions} | ${r.textbookPages.join('–')} | ${r.workbookPages.join('–')} |`).join('\n')}

## How to use each lesson

Read the textbook dialogue and explain the two grammar patterns before expecting paper application. Work through the workbook exercises alongside the app. Vocabulary cards give dictionary forms; model-expression cards give short sentences or meaningful clauses. English cue images represent meaning without revealing Korean. Romanization is a reading aid; Hangul recognition and listening remain the goals.

Only the current lesson is a required daily card program. Future decks remain locked until preceding paper targets are resolved; completed decks are available for optional practice and their results remain in history. A day's card goal is independent of finishing the whole lesson. Old words still receive spaced review when later decks open.

Every required card must pass recognition in both directions and matching before **Print quiz** unlocks. Simply viewing a card, sorting it into “know,” elapsed time, typing, or saying the word does not establish this paper readiness. Printing is always explicit. An outstanding quiz is reprinted as the same attempt, not replaced with a new attempt.

All learning targets must eventually be correct. After scanning, previously correct targets remain credited. Misses identify model cards and give English grammar feedback. **Review these cards** shows the model and requires fresh correct recognition in both directions after the miss. Explain the grammatical distinction when the expression is recognized but the rule is still unclear. Then print a retry that asks only unresolved targets, using the alternate form. Forms A and B alternate; they are two authored examples per target, not unlimited new examples.

The final quiz has twenty targets, one for each grammar pattern taught in the book. It is a cumulative sampling assessment; it does not claim to test every verb, every vocabulary item, or every source exercise. Its focused reviews point to previously learned model cards. All quiz targets in this course assess application, so paper misses preserve vocabulary mastery. A later ordinary spaced-review miss does not revoke paper completion.

Teacher review handles uncertain scans, blanks, and ambiguous marks. Voided targets remain unresolved. Corrections can reopen a specific target without erasing unrelated later passes. Existing teacher attestations and curriculum exceptions continue to control progression.

## Grammar, register and teaching notes

### Unit 1: Helping others

- **-아/어도 돼요?** — Ask permission to do an action; use the stem's -아/어 form before 도 돼요. The polite question fits asking a parent or teacher. Source: textbook p. 18; workbook p. 7.
- **-(으)ㄹ 테니까** — State the speaker's intended action before a request or suggestion. These model cards are clauses: the listener needs the following action to complete the meaning. Use -을 after a consonant and -ㄹ after a vowel or ㄹ stem. Source: textbook p. 19; workbook p. 7.

${manifest.inventory.map(row=>`### Unit ${row.lesson}: ${row.title}\n\n${row.patterns.map(p=>`- **${p.label}** — ${p.explanation} Source: ${p.source.book} p. ${p.source.page}.`).join('\n')}\n`).join('\n')}

## Audio and source scope

The original nineteen pilot cards retain their existing synthesized audio. New audio is generated entirely locally with installed Korean Yuna and English Samantha voices. It is a listening model, not a pronunciation assessment. Dictionary endings, casual quotations, and polite requests follow the source's register; explain who is speaking and to whom. Clause fragments have a continuation in their English cue and need a following request, suggestion or result.

Card words and grammar models are grounded in cited textbook/workbook pages. Quiz contexts are authored applications rather than quotations. Source transcripts are evidence aids; use the PDFs for illustrations and layout. The book's listening, conversation, longer reading, open writing, games, and cultural activities are not replaced by multiple choice. Do those together or with a teacher. The course includes source references so these activities remain part of the learner's work.
`;
}
