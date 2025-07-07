import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { join } from 'path';
import path from 'path';
import moment from 'moment-timezone';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const configExists = existsSync(`${__dirname}/../../config.app.yml`);
const isDocker = existsSync('/.dockerenv');

if (configExists) {
    // Parse the YAML files
    const appConfig = parse(readFileSync(join(__dirname, '../../config.app.yml'), 'utf8'));
    const secretsConfig = parse(readFileSync(join(__dirname, '../../config.secrets.yml'), 'utf8'));
    const localConfig = !isDocker ? parse(readFileSync(join(__dirname, '../../config.app-local.yml'), 'utf8')) : {};

    // Construct the process.env object
    process.env = { ...process.env, isDocker, ...appConfig, ...secretsConfig, ...localConfig };
    
    console.log("Configuration loaded successfully");
    console.log("Has OPENAI_API_KEY:", !!process.env.OPENAI_API_KEY);
    console.log("Has journalist config:", !!process.env.journalist);
} else {
    console.log("Config files not found - using environment variables");
}

// Now import the modules after setting up environment
const { processButtonpress } = await import("./foodlog_hook.mjs");
const { getNutrilListByDate } = await import("./lib/db.mjs");
const { processImageUrl } = await import("./lib/food.mjs");

const chat_id = "b6898194425_u575596036";
const testImageFlow = async () => {
    try {
        // Use a different image that's less likely to be rate limited
        const imgUrl = `https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQj4sTiyVItX-EDzkweu3aFi7ri0I6dtUWZrA&s`;
        console.log("Starting test with image URL:", imgUrl);
        
        const message_id = await processImageUrl(imgUrl, chat_id);
        console.log("processImageUrl returned:", message_id);
        
        if(!message_id) {
            console.error("Failed to process image URL");
            process.exit(1);
        }
        
        console.log("Waiting 3 seconds before processing button press...");
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        const payload = { callback_query: { message: { message_id }, data: "✅ Accept" } };
        console.log("Processing button press with payload:", payload);
        
        await processButtonpress(payload, chat_id);
        
        //check nutrilist
        const nutrilist = await getNutrilListByDate(chat_id, moment().format("YYYY-MM-DD"));
        console.log("Nutrilist:", nutrilist);
        
    } catch (error) {
        console.error("Test failed with error:", error);
        process.exit(1);
    }
};

testImageFlow();