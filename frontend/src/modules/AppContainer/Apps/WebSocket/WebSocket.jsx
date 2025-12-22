import { useEffect, useState } from "react";
import {
  DaylightWebsocketSubscribe,
  DaylightWebsocketUnsubscribe
} from "../../../../lib/api.mjs";
import "./WebSocket.scss";

export default function WebSocketApp({ path }) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const handleNewMessage = (message) => {
      setMessages((prevMessages) => [...prevMessages, message]);
    };

    DaylightWebsocketSubscribe(path, handleNewMessage);

    return () => {
      DaylightWebsocketUnsubscribe(path);
    };
  }, [path]);

  return (
    <div className="websocket-app">
      <h3>WebSocket Messages</h3>
      {messages.length > 0 ? (
        messages.map((message, index) => (
          <div key={index}>{JSON.stringify(message)}</div>
        ))
      ) : (
        <p>No messages received yet.</p>
      )}
    </div>
  );
}
