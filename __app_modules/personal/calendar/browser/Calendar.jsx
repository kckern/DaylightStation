import { useState } from 'react';
import { DaylightAPI } from "../../../../frontend/src/lib/api.mjs";

export default function Calendar(){

    const [data, setData] = useState('Loading...');
    DaylightAPI('/api/v1/home/calendar').then((response) => {
        setData(JSON.stringify(response));
    }
    );

    return <div><h2>
        Calendar
    </h2>
    <div>
        {data}
    </div>
    </div>
}