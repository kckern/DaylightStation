import React from 'react';
import "./Blank.scss"; // Step 1: Import the CSS file

export default function Blank() {
    return (
      <div className='blank'>
        {/* Show host, path, parameters */}
        <pre style={{display: 'none'}}>
          {JSON.stringify({
            url: window.location.href,
            host: window.location.host,
            path: window.location.pathname,
            searchParams: Object.fromEntries(new URLSearchParams(window.location.search))
          }, null, 2)}
        </pre>
      </div>
    );
  }