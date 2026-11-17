const BEGIN='KB_QUESTIONS_BEGIN',END='KB_QUESTIONS_END';
const INTERROGATIVE=/[?？]|\b(why|what drove|how did you feel|what does that say|either|crowded out|swallowed|dominated|marathon|deep into the night)\b/i;
const COMMON=new Set(['A','An','The','You','Your','It','This','That','There','Morning','Midday','Afternoon','Evening','Other','Commentary','Facts','Recorded']);
function ungroundedNames(text,grounding){
 const known=new Set(grounding.match(/[\p{L}\p{N}_'-]+/gu)??[]);
 return (text.match(/\b\p{Lu}[\p{L}\p{N}_'-]*/gu)??[]).some(word=>!COMMON.has(word)&&!known.has(word));
}
export function knowledgeQuestionPrompt(selection){
 if(selection?.mode!=='knowledge')return '';
 return `\nKB QUESTION AUTHORITY overrides all earlier hook/question instructions. Use a statement hook with no question. Do not invent questions or names. Output exactly one block between ${BEGIN} and ${END}, containing only these selected questions (empty means no questions):\n${selection.questions.slice(0,2).map(q=>q.text).join('\n')}\nOutside this block write facts/commentary only, with no interrogatives, either/or, motive or displacement framing. Never add another question block.`;
}
/** Model prose may never add to the deterministic question budget. */
export function presentKnowledgeQuestions({summary,headline,selection,fallbackFacts,grounding=''}){
 if(selection?.mode!=='knowledge')return {summary,headline};
 const raw=typeof summary==='string'?summary:'',start=raw.indexOf(BEGIN),end=raw.indexOf(END);
 const validBlock=start>=0&&end>start&&raw.indexOf(BEGIN,start+BEGIN.length)===-1&&raw.indexOf(END,end+END.length)===-1;
 let facts=validBlock?(raw.slice(0,start)+raw.slice(end+END.length)).trim():null;
 if(facts===null||INTERROGATIVE.test(facts)||ungroundedNames(facts,grounding))facts=fallbackFacts;
 const questions=selection.questions.slice(0,2).map(q=>q.text);
 const cleanHeadline=typeof headline==='string'&&!INTERROGATIVE.test(headline)&&!ungroundedNames(headline,grounding)?headline:null;
 return {knowledgeFacts:facts,summary:[facts,questions.map(text=>'• '+text).join('\n')].filter(Boolean).join('\n\n'),headline:cleanHeadline};
}
