import { useEffect, useState } from "react";
import "./KeyTest.scss";

export default function KeyTestApp() {
  const [keyCode, setKeyCode] = useState(null);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === "Enter") {
        openKeyCodeTest();
      }
      setKeyCode(event.keyCode);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const openKeyCodeTest = () => {
    const newWindow = window.open(
      "https://www.toptal.com/developers/keycode",
      "_blank"
    );
    if (newWindow) {
      newWindow.focus();
    } else {
      alert("Please allow popups for this website");
    }
  };

  return (
    <div className="keytest-app">
      <h2>Key Test App</h2>
      <p>
        This is a test app to check the key codes of the keyboard.
        <br />
        <span>Press any key to see the key code</span>
        <br />
        {keyCode && <span>Key Code: {keyCode}</span>}
      </p>
    </div>
  );
}
