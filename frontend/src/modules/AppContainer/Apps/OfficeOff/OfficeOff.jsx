import { useEffect } from "react";
import { DaylightAPI } from "../../../../lib/api.mjs";
import "./OfficeOff.scss";

export default function OfficeOff({ clear }) {
  useEffect(() => {
    DaylightAPI("exe/office_tv/off").then(() => {
      const event = new KeyboardEvent("keydown", { key: "Escape" });
      window.dispatchEvent(event);
      clear();
    });
  }, [clear]);

  return null;
}
