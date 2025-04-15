import { useState, useEffect, useRef } from "react";
import {
  DaylightWebsocketSubscribe,
  DaylightWebsocketUnsubscribe
} from "../lib/api.mjs";

export default function AppContainer({ open, clear }) {
  const app = open?.app || open.open || open;
  const param = open?.param || open.param || open;
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
  return (
    <div>
      <h2>App Container</h2>
      <pre>
        {JSON.stringify({ app, param, open }, null, 2)}
      </pre>
    </div>
  );
}

function KeyTestApp() {
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
    const newWindow = window.open("https://www.toptal.com/developers/keycode", "_blank");
    if (newWindow) {
      newWindow.focus();
    } else {
      alert("Please allow popups for this website");
    }
  };

  return (
    <div>
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


function GlympseApp({id}){
  if(!id) return <div>Invalid Glympse ID</div>;
  const iframeRef = useRef(null);
  useEffect(() => {
    if (iframeRef.current) {
      iframeRef.current.src = `https://glympse.com/${id}`;
    }
  }, [id]);
  return (
    <div style={{ width: "100%", height: "100%" }}>
      <iframe
        style={{ 
          marginTop: "-50px", 
          marginLeft: "-50px", 
          width: "calc(100% + 100px)", 
          height: "calc(100% + 90px)" }}
        ref={iframeRef}
        title="Glympse"
        frameBorder="0"
        scrolling="no"
      />
    </div>
  );
}

function WebSocketApp({ path }) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const handleNewMessage = message => {
      setMessages(prevMessages => [...prevMessages, message]);
    };

    DaylightWebsocketSubscribe(path, handleNewMessage);

    return () => {
      DaylightWebsocketUnsubscribe(path);
    };
  }, []);

  return (
    <div>
      <h3>WebSocket Messages</h3>
      {messages.length > 0
        ? messages.map((message, index) =>
            <div key={index}>
              {JSON.stringify(message)}
            </div>
          )
        : <p>No messages received yet.</p>}
    </div>
  );
}
