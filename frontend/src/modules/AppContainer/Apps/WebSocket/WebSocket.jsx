import { useEffect, useState } from "react";
import { wsService } from '../../../../services/WebSocketService.js';
import "./WebSocket.scss";

export default function WebSocketApp({ topic }) {
  return <TopicMessages key={topic} topic={topic} />;
}

function TopicMessages({ topic }) {
  const [messages, setMessages] = useState([]);

  useEffect(() => wsService.subscribeTopic(topic, message => {
    setMessages(previous => [...previous, message]);
  }), [topic]);

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
