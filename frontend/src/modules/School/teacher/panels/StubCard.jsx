/**
 * The honest placeholder (spec §4.2/§4.6): a titled card stating what will
 * live here and that it isn't built — never a disabled fake control, so it
 * renders NO buttons or inputs, ever. `data-todo` carries the registry id so
 * "list the TODOs" is answerable from the running app.
 */
import { STUB_COPY } from '../todoRegistry.js';

export default function StubCard({ todoId }) {
  const copy = STUB_COPY[todoId] ?? { title: todoId, body: '' };
  return (
    <section className="teacher-stub" data-todo={todoId}>
      <h3 className="teacher-stub__title">{copy.title}</h3>
      <p className="teacher-stub__body">{copy.body}</p>
      <p className="teacher-stub__badge">Planned — not built yet.</p>
    </section>
  );
}
