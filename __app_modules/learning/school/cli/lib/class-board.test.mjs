import { describe, expect, it } from 'vitest';
import { classDateOf, classDeck, classNotes, compileParse, fill, homeworkOf, htmlToText, lessonOpenings, lessonsOf, localInstant, pick, postRecord, prepLine } from './class-board.mjs';

// A made-up board: everything board-specific comes from config, as in production.
const PARSE = {
  classDate: '(\\d{4})\\s*년\\s*(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일',
  homeworkStart: '^숙제\\s*[:：]?\\s*',
  sectionEnd: '^(주제|수업\\s*활동|준비물|\\d\\s*교시)',
  extraLines: '미션',
  noHomework: '숙제는?\\s*없습니다',
  lesson: '교재\\s*(\\d+)\\s*과',
};
const RULES = compileParse(PARSE);
const FIELDS = {
  id: 'id', title: 'title', html: 'content', pinned: 'is_pin', updatedSeconds: 'update_at._seconds',
  attachments: 'file_list', attachmentName: 'name', attachmentUrl: 'url',
};
const TEMPLATES = {
  when: '토요일({date})',
  prep: '{when} 준비: 교과서 {lesson}과 {pages}쪽 읽고 듣기.',
  exam: '{when} {exam}: {review} 복습하기.',
  noClass: '{when}은 수업이 없어요 ({noClass}).',
  homework: '숙제({date}): {homework}',
  homeworkMissing: '숙제({date}): 아직 안내가 없어요.',
};
const NOTES = { templates: TEMPLATES, days: [1, 3, 5], idPrefix: 'class-kid', maxChars: 110 };

const POST = {
  id: 'board_9', title: '[반] 2030년 3월 9일 - 수업내용 및 숙제 안내', is_pin: false,
  update_at: { _seconds: 1899999999 },
  file_list: [{ name: 'plan.pdf', url: 'https://example.test/plan.pdf' }],
  content: '<p><strong>준비물</strong>: 연필</p><p><strong>숙제</strong>:</p><p>워크북 3과 12쪽 풀어오기</p>'
    + '<p>활동지: 문장 1개 써오기</p><p>&nbsp;</p><p>주제: 이유 말하기</p><p>1교시</p><ul><li><p>교재 3과: -느라고</p></li></ul>'
    + '<p>2교시</p><p>교재 4과 듣기</p><p><strong>** 비밀 미션:</strong> 그림 그려오기</p>',
};
const record = (post) => postRecord(post, { fields: FIELDS, rules: RULES });

describe('class board posts', () => {
  it('flattens rich text to lines and decodes entities', () => {
    expect(htmlToText('<p>a&nbsp;&amp; b</p><ul><li><p>c</p></li></ul>')).toBe('a & b\nc');
  });
  it('reads dotted field paths', () => {
    expect(pick({ a: { b: [{ c: 1 }] } }, 'a.b.0.c')).toBe(1);
    expect(pick({ a: null }, 'a.b')).toBeUndefined();
  });
  it('refuses a config missing a required pattern', () => {
    expect(() => compileParse({ ...PARSE, lesson: undefined })).toThrow(/parse.lesson is required/);
  });
  it('reads the class date with the configured pattern', () => {
    expect(classDateOf(POST.title, RULES)).toBe('2030-03-09');
    expect(classDateOf('학기 계획표', RULES)).toBeNull();
  });
  it('takes the homework section until the next section, plus an extra (mission) line', () => {
    expect(homeworkOf(htmlToText(POST.content), RULES)).toBe('워크북 3과 12쪽 풀어오기 / 활동지: 문장 1개 써오기 / 비밀 미션: 그림 그려오기');
  });
  it('a no-homework post is empty; a post without the section is null', () => {
    expect(homeworkOf('숙제:\n이번 주 숙제는 없습니다.\n주제: 편지', RULES)).toBe('');
    expect(homeworkOf('주제: 편지', RULES)).toBeNull();
  });
  it('lists the lessons a post mentions', () => {
    expect(lessonsOf(htmlToText(POST.content), RULES)).toEqual([3, 4]);
  });
  it('archives a post through the configured fields', () => {
    expect(record(POST)).toMatchObject({
      postId: 'board_9', classDate: '2030-03-09', pinned: false, lessons: [3, 4],
      updatedAt: new Date(1899999999000).toISOString(), attachments: [{ name: 'plan.pdf', url: 'https://example.test/plan.pdf' }],
    });
  });
});

const CALENDAR = {
  lessons: { 3: '30–39', 4: '40–49', 5: '50–59' },
  classes: [
    { date: '2030-03-09', lesson: 3 },
    { date: '2030-03-16', lesson: 5 },
    { date: '2030-03-23', exam: '중간고사', review: '1–4과' },
    { date: '2030-03-30', noClass: '봄방학' },
  ],
};
const notesFor = (records, from, to = from, calendar = CALENDAR) => classNotes({ notes: NOTES, calendar, records, learnerId: 'kid', from, to, timeZone: 'UTC' });

describe('notes', () => {
  it('fills templates and refuses a missing one', () => {
    expect(fill('{a}-{b}', { a: 1 })).toBe('1-');
    expect(() => fill(undefined, {})).toThrow(/template is missing/);
  });
  it('pins a wall-clock time to the zone offset, across daylight saving', () => {
    expect(localInstant('2030-01-07', '07:00', 'America/Los_Angeles')).toBe('2030-01-07T07:00:00-08:00');
    expect(localInstant('2030-07-08', '07:00', 'America/Los_Angeles')).toBe('2030-07-08T07:00:00-07:00');
  });
  it('prep never runs more than one lesson past what the posts say was taught', () => {
    expect(prepLine(CALENDAR, TEMPLATES, CALENDAR.classes[1], 3)).toBe('토요일(3/16) 준비: 교과서 4과 40–49쪽 읽고 듣기.');
    expect(prepLine(CALENDAR, TEMPLATES, CALENDAR.classes[1], 0)).toBe('토요일(3/16) 준비: 교과서 5과 50–59쪽 읽고 듣기.');
    expect(prepLine(CALENDAR, TEMPLATES, CALENDAR.classes[2], 4)).toBe('토요일(3/23) 중간고사: 1–4과 복습하기.');
    expect(prepLine(CALENDAR, TEMPLATES, CALENDAR.classes[3], 4)).toBe('토요일(3/30)은 수업이 없어요 (봄방학).');
  });
  it('writes prep then homework on the configured days after a class, with deterministic ids', () => {
    const notes = notesFor([record(POST)], '2030-03-10', '2030-03-15');
    expect(notes.map((n) => n.id)).toEqual([
      'class-kid-2030-03-11-prep', 'class-kid-2030-03-11-hw',
      'class-kid-2030-03-13-prep', 'class-kid-2030-03-13-hw',
      'class-kid-2030-03-15-prep', 'class-kid-2030-03-15-hw',
    ]);
    expect(notes[1]).toMatchObject({ learnerId: 'kid', at: '2030-03-11T07:01:00+00:00', note: '숙제(3/9): 워크북 3과 12쪽 풀어오기 / 활동지: 문장 1개 써오기 / 비밀 미션: 그림 그려오기' });
    // The post reached 교재 4과, so lesson 5 is within one lesson of it.
    expect(notes[0].note).toBe('토요일(3/16) 준비: 교과서 5과 50–59쪽 읽고 듣기.');
  });
  it('a same-day notice post never hides the homework post', () => {
    const notice = { ...record({ ...POST, id: 'board_10', content: '<p>행사 안내</p>' }), updatedAt: '2099-01-01T00:00:00.000Z' };
    expect(notesFor([record(POST), notice], '2030-03-11').find((n) => n.id.endsWith('-hw')).note).toMatch(/^숙제\(3\/9\): 워크북 3과/);
  });
  it('a class with no post yet says so; a week after no class has no homework line', () => {
    expect(notesFor([], '2030-03-18').find((n) => n.id.endsWith('-hw')).note).toBe('숙제(3/16): 아직 안내가 없어요.');
    const later = { ...CALENDAR, classes: [...CALENDAR.classes, { date: '2030-04-06', lesson: 5 }] };
    expect(notesFor([], '2030-04-01', '2030-04-01', later).map((n) => n.id)).toEqual(['class-kid-2030-04-01-prep']);
  });
  it('keeps every note inside the configured length', () => {
    const long = record({ ...POST, content: `<p>숙제: ${'가'.repeat(300)}</p>` });
    const hw = notesFor([long], '2030-03-11').find((n) => n.id.endsWith('-hw'));
    expect(hw.note.length).toBe(110);
    expect(hw.note.endsWith('…')).toBe(true);
  });
});

describe('class deck', () => {
  const calendar = {
    classes: [
      { date: '2030-03-09', lesson: 3 },
      { date: '2030-03-16', lesson: 3 },
      { date: '2030-03-23', exam: '중간고사' },
      { date: '2030-03-30', lesson: 4 },
    ],
    projectedLessons: { 5: '2030-04-20', 3: '2031-01-01' },
  };
  const deck = { id: 'language/x/class', title: 'Class', lexicon: 'media:language/x/lexicon.yml', leadDays: 6 };
  const lessonWords = (n) => ({ 3: ['a', 'b'], 4: ['b', 'c'], 5: ['d'] })[n];
  it('opens each lesson leadDays before its first class; the calendar beats a projection', () => {
    expect(lessonOpenings(calendar, 6)).toEqual([
      { lesson: 3, opensOn: '2030-03-03' }, { lesson: 4, opensOn: '2030-03-24' }, { lesson: 5, opensOn: '2030-04-14' },
    ]);
  });
  it('holds only opened lessons, in lesson order, each word once, with a release per lesson', () => {
    expect(classDeck({ deck, calendar, lessonWords, day: '2030-03-23' })).toMatchObject({ words: ['a', 'b'], releases: [{ opensOn: '2030-03-03', words: ['a', 'b'] }], revision: 1 });
    expect(classDeck({ deck, calendar, lessonWords, day: '2030-03-24' })).toMatchObject({
      id: 'language/x/class', words: ['a', 'b', 'c'],
      releases: [{ opensOn: '2030-03-03', words: ['a', 'b'] }, { opensOn: '2030-03-24', words: ['c'] }], revision: 2,
    });
  });
});
