/** Generic reader for authored notes and worked examples. */
export default function LearningContentReader({ module, onExit }) {
  const blocks = module.type === 'lecture_notes'
    ? (module.document?.blocks ?? [])
    : (module.examples ?? []).flatMap((example) => ([
      { blockId: `${example.exampleId}:prompt`, type: 'prose', text: example.prompt },
      ...example.steps.map((step, index) => ({ blockId: `${example.exampleId}:${index}`, type: 'step', text: step })),
    ]));
  return (
    <article className="school-learning-reader">
      <header><p>{module.type === 'examples' ? 'Worked examples' : 'Lesson notes'}</p><h2>{module.title ?? module.document?.title ?? 'Learn'}</h2></header>
      <div className="school-learning-reader__body">
        {blocks.map((block) => <LearningBlock key={block.blockId} block={block} />)}
      </div>
      <button type="button" className="school-runner__done" onClick={onExit}>Continue lesson</button>
    </article>
  );
}

function LearningBlock({ block }) {
  if (block.type === 'table') return (
    <table><thead><tr>{block.columns.map((value) => <th key={value}>{value}</th>)}</tr></thead>
      <tbody>{(block.rows ?? []).map((row, index) => <tr key={index}>{row.map((value, cell) => <td key={cell}>{value}</td>)}</tr>)}</tbody></table>
  );
  if (block.type === 'worked_example') return (
    <section><h3>{block.prompt}</h3><ol>{(block.steps ?? []).map((step) => <li key={step}>{step}</li>)}</ol>{block.answer && <p><strong>{block.answer}</strong></p>}</section>
  );
  if (block.type === 'formula') return <pre>{block.text}</pre>;
  if (block.type === 'tool_invitation' || block.type === 'scan_action') return <aside>{block.text ?? block.label ?? 'Continue with the linked activity.'}</aside>;
  return block.type === 'step' ? <p className="school-learning-reader__step">{block.text}</p> : <p>{block.text}</p>;
}

