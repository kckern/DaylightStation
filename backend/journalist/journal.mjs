import moment from "moment";
import { loadJournalMessages } from "./lib/db.mjs";

export default async (req, res) => {

    const chat_id = req.query.chat_id || req.body.chat_id;
    const entries = await  loadJournalMessages(chat_id, "2024-01-01");
    const markdown = entries.map(entry => {
        const [date, lines] = entry;
        const friendlyDate = moment(date).format('dddd, Do MMMM YYYY');
        return `## ${friendlyDate}\n * ${lines.join('\n * ')}`;
    }
    ).reverse().join('\n\n');
    res.setHeader('Content-Type', 'text/markdown');
    res.status(200).send(markdown);
};