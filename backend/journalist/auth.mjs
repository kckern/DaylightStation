import { getNutriCursor, setNutriCursor } from "./lib/db.mjs";


export default async (req, res) => {

    const { FITSYNC_CLIENT_ID, FITSYNC_CLIENT_SECRET } = process.env;
    const redirect_uri = new URL(req.url, `https://${req.headers.host}`);
    const code = req.query.code;
    const chat_id = req.query.state;

    if(!code) return res.status(400).send(`<a href="https://api.fitnesssyncer.com/api/oauth/authorize?client_id=${FITSYNC_CLIENT_ID}&response_type=code&redirect_uri=${redirect_uri}&state=${chat_id}">Click here to authorize FitnessSyncer</a>`);

    try {
        // Step 1: Obtain access token (assuming a refresh token workflow)
        const tokenResponse = await fetch(token_url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: qs.stringify({
                grant_type: 'authorization_code',
                code: code,
                client_id: FITSYNC_CLIENT_ID,
                client_secret: FITSYNC_CLIENT_SECRET,
                redirect_uri: redirect_uri
            })
        });
        console.log('Token response:', tokenResponse);

        if (!tokenResponse.ok) throw new Error('Failed to get access token.');

        const tokenData = await tokenResponse.json();
        console.log('Token data:', tokenData);

        const returnMe = {};
        returnMe.tokenData = tokenData;
        returnMe.chat_id = chat_id;
        returnMe.redirect_uri = redirect_uri; 
        const { access_token, refresh_token } = tokenData;



        //TODO: SAVE REFRESH TOKEN
        const cursor = await getNutriCursor(chat_id);
        if(!cursor) return res.status(200).json({error: `No cursor found for chat_id: ${chat_id}`});
        cursor.fitnesssyncer = {access_token, refresh_token};
        await setNutriCursor(chat_id, cursor);




        return res.status(200).json(returnMe);




    } catch (error) {
        console.error(`Error fetching data from ${endpoint}:`, error);
        throw error;
    }
}