import "./Art.scss";
import { DaylightMediaPath } from "../../../../lib/api.mjs";

export default function ArtApp({ path }) {
  const resolvedUrl = path
    ? path.startsWith("http")
      ? path
      : DaylightMediaPath(`/static/img/art/${path}`)
    : DaylightMediaPath("/static/img/art/art");

  return (
    <div className="art-app">
      <div className="art-frame">
        <div className="art-matte">
          <div className="art-inner-frame">
            <img src={resolvedUrl} alt="Daylight Art" />
          </div>
        </div>
      </div>
    </div>
  );
}
