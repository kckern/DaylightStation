import axios from 'axios';
import { saveFile, loadFile } from './io.mjs';
import processWeight from '../jobs/weight.mjs';

const getWeightData = async (job_id) => {
    const { WITHINGS_CLIENT, WITHINGS_SECRET,WITHINGS_REDIRECT } = process.env;
    const {refresh} = loadFile('_tmp/withings');
    //return {refresh};
    const params_auth = {
        action: 'requesttoken',
        grant_type: 'refresh_token',
        client_id: WITHINGS_CLIENT,
        client_secret: WITHINGS_SECRET,
        refresh_token: refresh,
        redirect_uri:  WITHINGS_REDIRECT
    };
    const response = await axios.post('https://wbsapi.withings.net/v2/oauth2',params_auth);
    let {body:auth_data} =response?.data || {};

    const {access_token, refresh_token} = auth_data || {};

    if(refresh_token) saveFile('_tmp/withings', {refresh: refresh_token});

    if(!access_token) return {error: `No access token.  Refresh token may have expired.`, refresh_token,r:response.data, params_auth, path:process.env.path};


    const params = {
        access_token,
        startdate: Math.floor(new Date().setFullYear(new Date().getFullYear() - 15) / 1000),
        enddate: Math.floor(new Date().setDate(new Date().getDate() + 1) / 1000)
    };


    const url = 'https://wbsapi.withings.net/measure?action=getmeas';
    const getme = `${url}&${new URLSearchParams(params).toString()}`;

    let data = await axios.get(getme);
    data = data.data;

    let measurements = {};

    data['body']['measuregrps'].forEach(measure => {
        const date = new Date(measure['date'] * 1000).toISOString().split('T')[0];
        const time = measure['date'];
        measurements[time] = { time, date };

        measure['measures'].forEach(measure => {
            let type = measure['type'];
            let val = round(measure['value'] * Math.pow(10, measure['unit']), 1);
            if(type === 1) { type = 'lbs'; val = round(2.20462 * val, 1); }
            if(type === 5) { type = 'lean_lbs'; val = round(2.20462 * val, 1); }
            if(type === 8) { type = 'fat_lbs'; val = round(2.20462 * val, 1); }
            if(type === 6) { type = 'fat_percent'; val = round(val, 1); }
            measurements[time][type] = val;
        });
    });

    measurements = Object.values(measurements).sort((a, b) => b.time - a.time);
    measurements = measurements.filter(m => m['lbs']);

    if(measurements.length === 0) return;

    saveFile('withings', measurements);
    processWeight(job_id);
    return measurements;
};

export default getWeightData;

function round(value, decimals) {
    return Number(Math.round(value+'e'+decimals)+'e-'+decimals);
}