
import fetch from 'node-fetch';


export default async (req, res) => {

    const bot = req.query.bot || req.body.bot || 'journalist';
    const body = req.body || req.query;
    console.log({bot});
    console.log(JSON.stringify(body,null,2));
    const hostname = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || /localhost/.test(hostname) ? 'http' : 'https';
    const timePromise = new Promise(resolve => { setTimeout(() => resolve(), 1000) });

    const hooks = {
        'journalist': 'telegram_hook',
        'nutribot': 'foodlog_hook',
    };

    const botIds = {
        'journalist': 0,
        'nutribot': 0,
    };


    const hook = hooks[bot] || hooks['journalist'];
    const bot_id = botIds[bot] || botIds['journalist'];

    body.bot_id = bot_id;
    body.chat_id = body.chat_id || body.message?.chat?.id || body.callback_query?.message?.chat?.id;

    const upc = body.upc;

    if(!body.chat_id) return res.status(400).send('No chat id found');

    const httpPromise = fetch(`${protocol}://${hostname}/api/${hook}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    await Promise.race([timePromise,httpPromise])


    if(upc) return res.status(200).send(`📦 Barcode: ${upc}`);

    
    
    res.status(200).send(`Webhook received`);


};