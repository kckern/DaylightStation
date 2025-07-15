import {  generateFamilyCard } from "../lib/graphics.mjs";
import fs from "fs";
import path from "path";
import os from "os";



const code = process.argv[2] || "KWCF-2MD";

generateFamilyCard(code,{}).then(canvas => {
    const buffer = canvas.toBuffer("image/png");
    const outputPath = path.join(os.homedir(), 'Desktop', 'familycard.png');
    fs.writeFileSync(outputPath, buffer);
    console.log(`Family card image saved to ${outputPath}`);
}).catch(error => {
    console.error("Error generating family card:", error);
});