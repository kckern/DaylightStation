
export const DaylightAPI = async (path, data = {}, method = 'GET') => {

    // Only auto-convert to POST if method is GET and data is provided
    if (method === 'GET' && Object.keys(data).length >= 1) {
        method = 'POST';
    }
    
    console.log("DaylightAPI called with path:", path, "data:", data, "method:", method);
    //remove leading and trailing slashes
    path = path.replace(/^\/|\/$/g,'');
    const isLocalhost = /localhost/.test(window.location.href);
    const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;

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
    
    console.log("Response status:", response.status, response.statusText);
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error("API Error Response:", errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }
    
    const response_data = await response.json();
    console.log("Response data:", response_data);
    return response_data;
};

export const DaylightWebsocketUnsubscribe = (path) => {
    const isLocalhost = /localhost/.test(window.location.href);
    const baseUrl = isLocalhost ? 'ws://localhost:3112' : `wss://${window.location.host}`;
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
        console.warn(`WebSocket for path "${path}" is already active.`);
        return activeWebsockets.get(path).unsubscribe;
    }

    const isLocalhost = /localhost/.test(window.location.href);
    const baseUrl = isLocalhost ? 'ws://localhost:3112' : `wss://${window.location.host}`;
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
    const isLocalhost = /localhost/.test(window.location.href);
    const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;
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
    const isLocalhost = /localhost/.test(window.location.href);
    const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;
    return `${baseUrl}/${path}`;
}
export const DaylightPlexPath = (key) => {
    const isLocalhost = /localhost/.test(window.location.href);
    const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;
    return `${baseUrl}/media/plex/${key}`;
}

export const DaylightHostPath = () => {
    const isLocalhost = /localhost/.test(window.location.href);
    const baseUrl = isLocalhost ? 'http://localhost:3112' : window.location.origin;
    return baseUrl;
}