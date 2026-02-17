import { useState, useEffect } from 'react';
import { Routes, Route, NavLink, Navigate, Outlet, useParams, useLocation } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import Headlines from '../modules/Feed/Headlines/Headlines.jsx';
import Scroll from '../modules/Feed/Scroll/Scroll.jsx';
import Reader from '../modules/Feed/Reader/Reader.jsx';
import { DaylightAPI } from '../lib/api.mjs';
import './FeedApp.scss';

function HeadlinesPage() {
  const { pageId } = useParams();
  return <Headlines pageId={pageId} />;
}

function FeedLayout() {
  const [headlinePages, setHeadlinePages] = useState([]);
  const location = useLocation();
  const isScroll = location.pathname.startsWith('/feed/scroll');

  useEffect(() => {
    DaylightAPI('/api/v1/feed/headlines/pages')
      .then(pages => setHeadlinePages(pages || []))
      .catch(() => setHeadlinePages([]));
  }, []);

  return (
    <div className="feed-app">
      {!isScroll && (
        <nav className="feed-tabs">
          <NavLink to="/feed/reader" className={({ isActive }) => isActive ? 'active' : ''}>
            Reader
          </NavLink>
          {headlinePages.map(page => (
            <NavLink
              key={page.id}
              to={`/feed/headlines/${page.id}`}
              className={({ isActive }) => isActive ? 'active' : ''}
            >
              {page.label}
            </NavLink>
          ))}
          <NavLink to="/feed/scroll" className={({ isActive }) => isActive ? 'active' : ''}>
            Scroll
          </NavLink>
        </nav>
      )}
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
          <Route path="headlines/:pageId" element={<HeadlinesPage />} />
          <Route path="headlines" element={<Navigate to="/feed/headlines/mainstream" replace />} />
          <Route path="scroll" element={<Scroll />} />
          <Route path="scroll/:itemId" element={<Scroll />} />
        </Route>
      </Routes>
    </MantineProvider>
  );
};

export default FeedApp;
