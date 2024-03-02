const axios = require('axios');

class Todoist {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseURL = 'https://api.todoist.com/rest/v1';
    }

    async getTasks() {
        const response = await axios.get(`${this.baseURL}/tasks`, {
            headers: {
                'Authorization': `Bearer ${this.apiKey}`
            }
        });
        return response.data;
    }

    // Add more methods as needed
}

module.exports = Todoist;
