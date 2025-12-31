import React, { useState, useEffect } from 'react';
import './SessionBrowserApp.scss';

const Calendar = ({ year, month, selectedDate, activeDates, onSelectDate, onMonthChange }) => {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay(); // 0 = Sunday
  
  const days = [];
  for (let i = 0; i < firstDay; i++) {
    days.push(<div key={`empty-${i}`} className="calendar-day empty"></div>);
  }
  
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isSelected = dateStr === selectedDate;
    const hasData = activeDates.includes(dateStr);
    
    days.push(
      <div 
        key={d} 
        className={`calendar-day ${isSelected ? 'selected' : ''} ${hasData ? 'has-data' : ''}`}
        onClick={() => onSelectDate(dateStr)}
      >
        {d}
        {hasData && <div className="dot"></div>}
      </div>
    );
  }

  const handlePrev = () => {
    if (month === 0) onMonthChange(year - 1, 11);
    else onMonthChange(year, month - 1);
  };

  const handleNext = () => {
    if (month === 11) onMonthChange(year + 1, 0);
    else onMonthChange(year, month + 1);
  };

  return (
    <div className="calendar">
      <div className="calendar-header">
        <button onClick={handlePrev}>&lt;</button>
        <span>{new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
        <button onClick={handleNext}>&gt;</button>
      </div>
      <div className="calendar-grid">
        <div className="day-label">Sun</div>
        <div className="day-label">Mon</div>
        <div className="day-label">Tue</div>
        <div className="day-label">Wed</div>
        <div className="day-label">Thu</div>
        <div className="day-label">Fri</div>
        <div className="day-label">Sat</div>
        {days}
      </div>
    </div>
  );
};

const SessionBrowserApp = () => {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate, setSelectedDate] = useState(today.toISOString().split('T')[0]);
  
  const [activeDates, setActiveDates] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [sessionDetail, setSessionDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetchActiveDates();
  }, []);

  useEffect(() => {
    if (selectedDate) {
      fetchSessions(selectedDate);
    }
  }, [selectedDate]);

  useEffect(() => {
    if (selectedSessionId) {
      fetchSessionDetail(selectedSessionId);
    } else {
      setSessionDetail(null);
    }
  }, [selectedSessionId]);

  const fetchActiveDates = async () => {
    try {
      const res = await fetch('/api/fitness/sessions/dates');
      if (res.ok) {
        const data = await res.json();
        setActiveDates(data.dates || []);
      }
    } catch (err) {
      console.error('Failed to fetch active dates', err);
    }
  };

  const fetchSessions = async (date) => {
    setLoading(true);
    setSessions([]);
    setSelectedSessionId(null);
    try {
      const res = await fetch(`/api/fitness/sessions?date=${date}`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Failed to fetch sessions', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSessionDetail = async (sessionId) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/fitness/sessions/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        setSessionDetail(data.session);
      }
    } catch (err) {
      console.error('Failed to fetch session detail', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const formatDuration = (ms) => {
    if (!ms) return '0m';
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="session-browser-app">
      <div className="browser-layout">
        <div className="sidebar">
          <Calendar 
            year={viewYear} 
            month={viewMonth} 
            selectedDate={selectedDate}
            activeDates={activeDates}
            onSelectDate={setSelectedDate}
            onMonthChange={(y, m) => { setViewYear(y); setViewMonth(m); }}
          />
          
          <div className="session-list-container">
            <h3>Sessions for {selectedDate}</h3>
            {loading && <div className="loading">Loading...</div>}
            {!loading && sessions.length === 0 && (
              <div className="empty-state">No sessions</div>
            )}
            <div className="session-list">
              {sessions.map((session) => (
                <div 
                  key={session.sessionId} 
                  className={`session-card ${selectedSessionId === session.sessionId ? 'selected' : ''}`}
                  onClick={() => setSelectedSessionId(session.sessionId === selectedSessionId ? null : session.sessionId)}
                >
                  <div className="meta">
                    <span>{formatTime(session.startTime)}</span>
                    <span>{formatDuration(session.durationMs)}</span>
                  </div>
                  <div className="participants">
                    👥 {session.rosterCount}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="main-content">
          {selectedSessionId ? (
            <div className="session-detail">
              {detailLoading ? (
                <div className="loading">Loading details...</div>
              ) : sessionDetail ? (
                <div>
                  <header className="detail-header">
                    <h2>Session Details</h2>
                    <span className="session-id">{sessionDetail.sessionId}</span>
                  </header>
                  
                  <div className="detail-grid">
                      <div className="detail-item">
                          <label>Start Time</label>
                          <div className="value">{new Date(sessionDetail.startTime).toLocaleString()}</div>
                      </div>
                      <div className="detail-item">
                          <label>Duration</label>
                          <div className="value">{formatDuration(sessionDetail.durationMs)}</div>
                      </div>
                      <div className="detail-item">
                          <label>Participants</label>
                          <div className="value">{sessionDetail.roster?.length || 0}</div>
                      </div>
                      <div className="detail-item">
                          <label>Total Ticks</label>
                          <div className="value">{sessionDetail.timeline?.timebase?.tickCount || 0}</div>
                      </div>
                  </div>

                  <h4>Raw Data Preview</h4>
                  <pre>{JSON.stringify(sessionDetail, null, 2)}</pre>
                </div>
              ) : (
                <div className="error">Failed to load details</div>
              )}
            </div>
          ) : (
            <div className="placeholder">
              Select a session to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SessionBrowserApp;
