// frontend/src/Apps/LiveStreamApp.jsx
import React from 'react';
import ChannelList from '../modules/Media/LiveStream/ChannelList.jsx';

const LiveStreamApp = () => {
  return (
    <div className="App livestream-app">
      <ChannelList />
    </div>
  );
};

export default LiveStreamApp;
