
import axios from 'axios';
import { saveFile, loadFile } from './io.mjs';
 

const getTickets = async () => {

    const { CLICKUP_PK } = process.env

    const params = {
        archived: false,
        include_markdown_description: true,
        page: 0,
        order_by: 'string',
        reverse: true,
        subtasks: true,
        statuses: 'string',
        include_closed: true,
        assignees: 'string',
        tags: 'string',
        due_date_gt: 0,
        due_date_lt: 0,
        date_created_gt: 0,
        date_created_lt: 0,
        date_updated_gt: 0,
        date_updated_lt: 0,
        date_done_gt: 0,
        date_done_lt: 0,
        custom_fields: 'string',
        custom_items: 0
    }

    const lists = [30979948];
    let tickets = [];

    for(let list of lists) {
        const url = `https://api.clickup.com/api/v2/list/${list}/task?${new URLSearchParams(params)}`;
        console.log({url, CLICKUP_PK});
        const list_tickets = await axios.get(url , { headers: { Authorization: CLICKUP_PK } });
        tickets = [...tickets, ...list_tickets.data.tasks];
    }

        saveFile('clickup', tickets);
        return weatherdata;
}

export default getTickets