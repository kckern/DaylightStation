/** Reproducible source-to-course assembly; no I/O or live learner writes. */
import { validateLexicon, expandLexiconDeck } from '../../backend/src/2_domains/school/cardLadder/lexicon.mjs';
import { validateUnit } from '../../backend/src/2_domains/school/curriculum/unitValidation.mjs';
import { publishDocument } from '../../backend/src/2_domains/school/documents/documentSource.mjs';
const fold = (text) => text.trim().toLocaleLowerCase();
const termKey = (term) => fold(term).replace(/[.!?。？！]+$/u, '');
const pad = (n) => String(n).padStart(2, '0');
const requireValid = (errors, context) => { if (errors?.length) throw new Error(`${context}: ${errors.join('; ')}`); };
const requiredText = (text, context) => { if (typeof text !== 'string' || !text.trim()) throw new Error(`${context}: text is required`); return text.trim(); };
const assertSource = (source, context) => { if (!['textbook','workbook'].includes(source?.book) || !Number.isInteger(source.page) || source.page < 1) throw new Error(`${context}: source page is required`); };

export function assembleKoreanCourse({ baseLexicon, baseUnit, lessons, requireComplete = true }) {
  const sorted = [...lessons].sort((a,b) => a.lesson-b.lesson);
  const roster = sorted.map((lesson) => lesson.lesson);
  if (requireComplete && JSON.stringify(roster) !== JSON.stringify(Array.from({length:15},(_,i)=>i+2))) throw new Error('Complete course requires exactly lessons 2 through 16.');
  if (new Set(roster).size !== roster.length || roster.some((n) => !Number.isInteger(n) || n<2 || n>16)) throw new Error('Lesson numbers must be unique, from 2 through 16.');
  const lexicon = structuredClone(baseLexicon);
  lexicon.program.title = 'Korean 3-2';
  const existing = new Set(lexicon.entries.map((entry)=>entry.id));
  const canonical = new Map(lexicon.entries.map((entry)=>[termKey(entry.term),entry]));
  const baseDeck = {schema:'school.flashcard-deck/v1',id:baseUnit.practice.deckId,title:baseUnit.title,revision:1,lexicon:'media:language/korean-3-2/lexicon.yml',words:[...baseUnit.practice.requiredCardIds]};
  const units=[structuredClone(baseUnit)],decks=[baseDeck],documents=[],published=[],inventory=[];
  const priorPatternCards=new Map();
  const addCard = (raw,lesson,isModel) => {
    requiredText(raw.term,'card term');requiredText(raw.gloss,'card gloss');assertSource(raw.source,`Lesson ${lesson} ${raw.id}`);
    const previous = canonical.get(termKey(raw.term));
    if(previous) return previous.id;
    const id=`l${pad(lesson)}-${raw.id}`;
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || existing.has(id)) throw new Error(`Invalid or duplicate card id: ${id}`);
    const kind=isModel || /\s/u.test(raw.term.trim()) ? 'phrase':'word';
    if(kind==='phrase')requiredText(raw.pronunciation,`${id} pronunciation`);
    const entry={id,group:`lesson-${pad(lesson)}`,kind,term:raw.term.trim(),gloss:raw.gloss.trim(),...(raw.pronunciation?{pronunciation:raw.pronunciation.trim()}:{}),source:structuredClone(raw.source),decoys:{term:[],gloss:[]}};
    lexicon.entries.push(entry);existing.add(id);canonical.set(termKey(entry.term),entry);return id;
  };
  for(const lesson of sorted){
    const n=lesson.lesson,group=`lesson-${pad(n)}`,unitId=`korean-3-2.${group}`,deckId=`language/korean-3-2/${group}`;
    const expectedKind=n===16?'final':[3,6,9,12,15].includes(n)?'review':'new';
    if(lesson.kind!==expectedKind)throw new Error(`Lesson ${n}: expected ${expectedKind}.`);
    if(requireComplete && lesson.patterns.length!==(expectedKind==='new'?2:expectedKind==='review'?4:20))throw new Error(`Lesson ${n}: grammar pattern coverage differs.`);
    const words=lesson.vocabulary.map((entry)=>addCard(entry,n,false));
    const questionCards={},questions=[],patterns=[];
    for(const pattern of lesson.patterns){
      assertSource(pattern.source,`${n} ${pattern.id}`);requiredText(pattern.explanation,`${n} pattern feedback`);
      const models=new Map();
      for(const model of pattern.models){
        if(models.has(model.id))throw new Error(`Duplicate model ${model.id}`);
        const prior=priorPatternCards.get(pattern.label);
        if(expectedKind==='final' && !prior?.length)throw new Error(`Final pattern was not previously taught: ${pattern.label}`);
        const exact=canonical.get(termKey(model.term));
        const cardId=expectedKind==='final' ? (prior.includes(exact?.id)?exact.id:prior[0]) : addCard(model,n,true);
        models.set(model.id,cardId);words.push(cardId);
      }
      if(expectedKind!=='final')priorPatternCards.set(pattern.label,[...new Set([...(priorPatternCards.get(pattern.label)??[]),...models.values()])]);
      patterns.push({id:pattern.id,label:pattern.label,explanation:pattern.explanation,source:pattern.source,cardIds:[...models.values()]});
      for(const question of pattern.questions){
        if(questionCards[question.id])throw new Error(`Duplicate question ${question.id}`);
        const cardId=models.get(question.modelId);if(!cardId)throw new Error(`Unknown model ${question.modelId} for ${question.id}`);
        for(const form of ['formA','formB']){
          const q=question[form];requiredText(q?.prompt,`${n} ${question.id} prompt`);
          if(!Array.isArray(q.choices)||q.choices.length!==4||!q.choices.every(c=>typeof c==='string'&&c.trim())||new Set(q.choices.map(fold)).size!==4)throw new Error(`${n} ${question.id} ${form}: four unique choices required.`);
          if(q.choices.filter(c=>c===q.answer).length!==1)throw new Error(`${n} ${question.id} ${form}: answer must match exactly one choice.`);
        }
        if(question.formA.prompt===question.formB.prompt)throw new Error(`${n} ${question.id}: alternate examples must differ.`);
        questionCards[question.id]={cardIds:[cardId],kind:'application',explanation:requiredText(question.explanation,`${n} ${question.id} feedback`)};
        questions.push(question);
      }
    }
    if(requireComplete && questions.length!==(expectedKind==='new'?6:expectedKind==='review'?8:20))throw new Error(`Lesson ${n}: wrong question count.`);
    // Final review owns no new vocabulary list and checks all acquired cards.
    const cardIds=[...new Set(expectedKind==='final'? [...decks.flatMap(d=>d.words),...words]:words)];
    const title=`Korean 3-2 · Lesson ${n}: ${lesson.title}`;
    const refs=[];
    for(const [variant,key] of ['formA','formB'].entries()){
      const letter=variant?'b':'a';
      const source={schema:'school.document-source/v1',id:`korean-3-2-${group}-${letter}`,seed:3200+n*10+variant,variant,target:['letter'],archetype:'quiz',title:`Korean 3-2 · Lesson ${n} · Form ${letter.toUpperCase()}`,blocks:[{type:'rich_text',md:'Choose the Korean expression that fits the English instruction. Mark ONE answer for each question. Leave uncertain answers blank and ask for help.'},...questions.map((question,index)=>({type:'question',itemId:question.id,number:index+1,blocks:[{type:'rich_text',md:question[key].prompt},{type:'omr_response',itemId:question.id,choices:4}],choices:question[key].choices,answer:question[key].answer}))]};
      const result=publishDocument(source);requireValid(result.errors,source.id);
      documents.push(source);published.push(result);refs.push(`print/${source.id}@${result.rev}`);
    }
    const unit={schema:'school.unit/v1',unitId,title,courseId:'korean-3-2',sequence:n,subject:'language',description:`${expectedKind==='new'?'Learn':expectedKind==='review'?'Review':'Integrate'} vocabulary and expression cards, then resolve ${questions.length} grammar targets on paper.`,reading:`Textbook pages ${lesson.textbookPages.join('–')}; workbook pages ${lesson.workbookPages.join('–')}.`,sourceTitle:'재외동포를 위한 한국어 3-2',objectives:lesson.objectives,document:refs[0],assessmentForms:refs,passing:{percent:100},retry:{variants:2},practice:{programId:'flashcards',deckId,requiredCardIds:cardIds,questionCards},provenance:{source:`Textbook pp. ${lesson.textbookPages.join('–')}; workbook pp. ${lesson.workbookPages.join('–')}. Quiz examples are authored applications of source grammar.`,reviewState:'approved'}};
    requireValid(validateUnit(unit).errors,unitId);
    decks.push({schema:'school.flashcard-deck/v1',id:deckId,title,revision:1,lexicon:baseDeck.lexicon,words:cardIds});units.push(unit);
    inventory.push({lesson:n,title:lesson.title,kind:expectedKind,vocabulary:lesson.vocabulary.length,cards:cardIds.length,questions:questions.length,patterns,textbookPages:lesson.textbookPages,workbookPages:lesson.workbookPages});
  }
  // Same-kind, distinct meanings on both sides. Existing Lesson 1 decoys are immutable.
  for(const entry of lexicon.entries.slice(baseLexicon.entries.length)){
    const pool=lexicon.entries.filter(other=>other.kind===entry.kind && termKey(other.term)!==termKey(entry.term) && fold(other.gloss)!==fold(entry.gloss))
      .sort((a,b)=>Number(b.group===entry.group)-Number(a.group===entry.group));
    for(const side of ['term','gloss'])entry.decoys[side]=[...new Set(pool.map(other=>other[side]))].slice(0,3);
  }
  const validation=validateLexicon(lexicon);requireValid(validation.errors,'lexicon');
  for(const deck of decks)requireValid(expandLexiconDeck(deck,validation.lexicon).errors,deck.id);
  return {lexicon,units,decks,documents,published,inventory};
}
