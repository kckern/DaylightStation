
export const DaylightAPI = async (path, data = {}, method = 'GET') => {
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
    const response_data = await response.json();
    return response_data;
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