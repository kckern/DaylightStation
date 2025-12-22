import { useEffect } from "react";
import { DaylightAPI } from "../../../../lib/api.mjs";
import "./WrapUp.scss";

export default function WrapUp({ clear }) {
  useEffect(() => {
    DaylightAPI("exe/tv/off").then(() => {
      const event = new KeyboardEvent("keydown", { key: "Escape" });
      window.dispatchEvent(event);
      clear();
    });
  }, [clear]);

  return null;
}
