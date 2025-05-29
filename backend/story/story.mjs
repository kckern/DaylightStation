import {  askGPTWithJSONOutput } from "../lib/gpt.js";

import { loadFile, saveFile } from "../lib/io.mjs";


export const storyTeller = async ({ prompt, storybook }) => {
    if (!storybook) {
        const { storybook: loaded } = loadFile(`/gpt/story_gpt`, 'utf8');
        storybook = loaded;
        storybook.push({
            role: 'user',
            content: prompt
        });
    }
    const { story, choices } = await askGPTWithJSONOutput(storybook);
    return { 
        story,
        choices,
        storybook: [...storybook, { role: 'assistant', content: JSON.stringify({ story, choices }) }]
    };
};