// frontend/src/Apps/LiveStreamApp.jsx
import React from 'react';
import useDocumentTitle from '../hooks/useDocumentTitle.js';
import ChannelList from '../modules/Media/LiveStream/ChannelList.jsx';

const LiveStreamApp = () => {
  useDocumentTitle('Live');
  return (
    <div className="App livestream-app">
      <ChannelList />
    </div>
  );
};

export default LiveStreamApp;
