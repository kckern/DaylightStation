import ProgressRing from './ProgressRing.jsx';

export default function PianoContextRail({ poster, program, ancestors = [], ring, continue: cont, onContinue }) {
  return (
    <aside className="psc-rail">
      {poster && <img className="psc-rail__cover" src={poster} alt="" />}
      <div className="psc-rail__ctx">
        {ancestors.map((a) => (
          <button type="button" key={a.label} className="psc-rail__anc" onClick={a.onClick}>▸ {a.label}</button>
        ))}
        <div className="psc-rail__cur">{program}</div>
      </div>
      {ring && (
        <div className="psc-rail__progress">
          <ProgressRing percent={ring.percent} label={ring.label} done={ring.done} />
        </div>
      )}
      {cont && (
        <button type="button" className="psc-rail__continue" onClick={onContinue}>
          <span className="psc-rail__continue-k">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>{cont.kicker}
          </span>
          <span className="psc-rail__continue-v">{cont.title}</span>
          {cont.sub && <span className="psc-rail__continue-s">{cont.sub}</span>}
        </button>
      )}
    </aside>
  );
}
