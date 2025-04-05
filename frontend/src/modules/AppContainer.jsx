import { useState, useEffect, useRef } from "react";
import { DaylightWebsocketSubscribe, DaylightWebsocketUnsubscribe } from "../lib/api.mjs";

export default function AppContainer({ open, clear }) {
  const { app, param } = open;
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
  return (
    <div>
      <h2>App Container</h2>
      <pre>
        {JSON.stringify({ app, param }, null, 2)}
      </pre>
    </div>
  );
}

function WebSocketApp({ path }) {
  const [messages, setMessages] = useState([]);

useEffect(() => {
    const handleNewMessage = (message) => {
        setMessages((prevMessages) => [...prevMessages, message]);
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
