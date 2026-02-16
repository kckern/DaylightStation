import { Routes, Route, NavLink, Navigate, Outlet } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import Headlines from '../modules/Feed/Headlines/Headlines.jsx';
import Scroll from '../modules/Feed/Scroll/Scroll.jsx';
import Reader from '../modules/Feed/Reader/Reader.jsx';
import './FeedApp.scss';

function FeedLayout() {
  return (
    <div className="feed-app">
      <nav className="feed-tabs">
        <NavLink to="/feed/reader" className={({ isActive }) => isActive ? 'active' : ''}>
          Reader
        </NavLink>
        <NavLink to="/feed/headlines" className={({ isActive }) => isActive ? 'active' : ''}>
          Headlines
        </NavLink>
        <NavLink to="/feed/scroll" className={({ isActive }) => isActive ? 'active' : ''}>
          Scroll
        </NavLink>
      </nav>
      <div className="feed-content">
        <Outlet />
      </div>
    </div>
  );
}

const FeedApp = () => {
  return (
    <MantineProvider>
      <Routes>
        <Route element={<FeedLayout />}>
          <Route index element={<Navigate to="/feed/scroll" replace />} />
          <Route path="reader" element={<Reader />} />
          <Route path="headlines" element={<Headlines />} />
          <Route path="scroll" element={<Scroll />} />
        </Route>
      </Routes>
    </MantineProvider>
  );
};

export default FeedApp;
