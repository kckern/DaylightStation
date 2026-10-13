// frontend/src/Apps/LiveStreamApp.jsx
import React from 'react';
import useDocumentTitle from "../../../../frontend/src/hooks/useDocumentTitle.js";
import ChannelList from "./ChannelList.jsx";

const LiveStreamApp = () => {
  useDocumentTitle('Live');
  return (
    <div className="App livestream-app">
      <ChannelList />
    </div>
  );
};

export default LiveStreamApp;
