import { useState, useEffect, useRef } from "react";
import {
  DaylightWebsocketSubscribe,
  DaylightWebsocketUnsubscribe
} from "../lib/api.mjs";

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
  if (app === "glympse") return <GlympseApp id={param} />;
  return (
    <div>
      <h2>App Container</h2>
      <pre>
        {JSON.stringify({ app, param }, null, 2)}
      </pre>
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
