import getLogger from './logging/Logger.js';

// In dev mode, Vite proxy handles forwarding to backend (see vite.config.js)
// In production, frontend and backend are served from same origin
const getBaseUrl = () => window.location.origin;
const getWsBaseUrl = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}`;
};

export const DaylightAPI = async (path, data = {}, method = 'GET') => {

    // Only auto-convert to POST if method is GET and data is provided
    if (method === 'GET' && Object.keys(data).length >= 1) {
        method = 'POST';
    }
    
   // console.log("DaylightAPI called with path:", path, "data:", data, "method:", method);
    //remove leading and trailing slashes
    path = path.replace(/^\/|\/$/g,'');
    const baseUrl = getBaseUrl();

    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
        },
    };

    if (method !== 'GET') {
        options.body = JSON.stringify(data);
    }

    const response = await fetch(`${baseUrl}/${path}`, options);
    
  //  console.log("Response status:", response.status, response.statusText);
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error("API Error Response:", errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }
    
    const response_data = await response.json();
 //   console.log("Response data:", response_data);
    return response_data;
};

export const DaylightWebsocketUnsubscribe = (path) => {
    const baseUrl = getWsBaseUrl();
    const ws = new WebSocket(`${baseUrl}/ws/${path}`);

    return () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
            console.log("WebSocket connection closed for path:", path);
        }
    };
};
const activeWebsockets = new Map();

export const DaylightWebsocketSubscribe = (path, callback) => {
    if (activeWebsockets.has(path)) {
        getLogger().warn('api.websocket.already_active', { path });
        return activeWebsockets.get(path).unsubscribe;
    }

    const baseUrl = getWsBaseUrl();
    const ws = new WebSocket(`${baseUrl}/ws/${path}`);

    ws.onopen = () => console.log("WebSocket connection opened for path:", path);
    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            callback(message);
        } catch (error) {
            console.error("Error parsing WebSocket message:", error);
        }
    };
    ws.onclose = () => {
        console.log("WebSocket connection closed for path:", path);
        activeWebsockets.delete(path);
    };
    ws.onerror = (error) => console.error("WebSocket error for path:", path, error);

    const unsubscribe = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
        activeWebsockets.delete(path);
    };

    activeWebsockets.set(path, { ws, unsubscribe });
    return unsubscribe;
};



export const DaylightStatusCheck = async (path, data = {}, method = 'GET') => {
    //remove leading and trailing slashes
    path = path.replace(/^\/|\/$/g, '');
    const baseUrl = getBaseUrl();
    //same as DaylightAPI but only returns the status code
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
        },
    };
    if (method !== 'GET') {
        options.body = JSON.stringify(data);
    }
    let response = await fetch(`${baseUrl}/${path}`, options);
    while (response.redirected) {
        response = await fetch(response.url, options);
    }
    const status = response.status;
    return status;
};

export const DaylightMediaPath = (path) => {
    path = path.toString().replace(/^\/|\/$/g,'');
    // Rewrite legacy /media/img/* paths to new API endpoint
    if (path.startsWith('media/img/')) {
        path = path.replace('media/img/', 'api/v1/static/img/');
    }
    // Rewrite /static/img/* to use new API endpoint
    if (path.startsWith('static/img/')) {
        path = `api/v1/${path}`;
    }
    return `${getBaseUrl()}/${path}`;
}

// Normalize image URLs from API responses - ensures relative paths work correctly
// With Vite proxy in dev, relative URLs like /api/v1/proxy/plex/... are proxied to backend
export const normalizeImageUrl = (url) => {
    if (!url) return url;
    // Relative URLs work fine with Vite proxy - just return as-is
    // Absolute URLs are returned unchanged
    return url;
}

export const DaylightImagePath = (key) => {
    return `${getBaseUrl()}/api/v1/static/img/${key}`;
}

export const DaylightPlexPath = (key) => {
    return `${getBaseUrl()}/media/plex/${key}`;
}

export const DaylightHostPath = () => {
    return getBaseUrl();
}