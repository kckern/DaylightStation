import { useState, useEffect } from 'react';
import moment from 'moment';
import ConnectionStatus from '../../components/ConnectionStatus/ConnectionStatus';

export default function StatusBar() {
  const [date, setDate] = useState(moment().format('dddd, MMMM Do, YYYY'));

  useEffect(() => {
    const interval = setInterval(() => {
      setDate(moment().format('dddd, MMMM Do, YYYY'));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
      gap: '0.5rem',
    }}>
      <span style={{
        color: '#FFFFFF88',
        fontWeight: 'bold',
        fontSize: '1.2rem',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {date}
      </span>
      <ConnectionStatus size={16} />
    </div>
  );
}
