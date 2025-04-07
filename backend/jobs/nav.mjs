import { loadFile, saveFile } from '../lib/io.mjs';
import moment from 'moment';

//
// Keep the structure and variable names, but re-implement the internals.
//
const naveProcess = async (job_id) => {
    // Load data
    const data = await loadFile('nav');
    if (!data) return false;


}