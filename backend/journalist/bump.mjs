import { postItemizeFood } from "./lib/food.mjs"



export default async (req, res) => {
    process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_NUTRIBOT_TOKEN;

    const chat_id = req.body?.chat_id || req.query?.chat_id;
    const hostname = req.headers?.host;
    await postItemizeFood(chat_id, hostname);
    return res.status(200).send(`Bump request received`);

}