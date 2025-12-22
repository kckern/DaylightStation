import { useEffect, useMemo } from "react";
import "./AppContainer.scss";
import Gratitude from "./Apps/Gratitude/Gratitude.jsx";
import WebSocketApp from "./Apps/WebSocket/WebSocket.jsx";
import GlympseApp from "./Apps/Glympse/Glympse.jsx";
import KeyTestApp from "./Apps/KeyTest/KeyTest.jsx";
import ArtApp from "./Apps/Art/Art.jsx";
import WebcamApp from "./Apps/Webcam/Webcam.jsx";
import WrapUp from "./Apps/WrapUp/WrapUp.jsx";
import OfficeOff from "./Apps/OfficeOff/OfficeOff.jsx";
import { getChildLogger } from "../../lib/logging/singleton.js";

export default function AppContainer({ open, clear }) {
  // Parse app string - may contain param after slash (e.g., "art/nativity")
  const rawApp = open?.app || open?.open || open;
  const [app, paramFromApp] = typeof rawApp === 'string' ? rawApp.split('/') : [rawApp, null];
  const param = paramFromApp || open?.param || null;
  const logger = useMemo(() => getChildLogger({ app: 'app-container' }), []);
  useEffect(() => {
    logger.info('app-container-open', { app, param });
  }, [app, param, logger]);
  useEffect(
    () => {
      const handleKeyDown = event => {
        if (event.key === "Escape") {
          clear();
        }
      };

      window.addEventListener("keydown", handleKeyDown);
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    },
    [clear]
  );

  if (app === "websocket") return <WebSocketApp path={param} />;
  if (app === "glympse") return <GlympseApp id={param} />;
  if (app === "keycode") return <KeyTestApp />;
  if (app === "art") return <ArtApp path={param} />;
  if (app === "webcam") return <WebcamApp />;
  if (app === "wrapup") return <WrapUp clear={clear} />;
  if (app === "office_off") return <OfficeOff clear={clear} />;
  if( app === "gratitude" ) return <Gratitude clear={clear} />;
  return (
    <div>
      <h2>App Container</h2>
      <pre>
        {JSON.stringify({ app, param, open }, null, 2)}
      </pre>
    </div>
  );
}




