import { loadFile, saveFile } from './io.mjs';
import child_process from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import moment from 'moment';
 

const getYoutube = async () => {
    const youtubeData = loadFile('config/youtube');
    const commands = [];
    const shortcodes = [];
    const mediaPath = `${process.env.path.media}/news`;
    const tenDaysAgo = moment().subtract(10, 'days').format('YYYYMMDD');
    const deleted = [];
    const clearOld = () => {
        const dirs = fs.readdirSync(mediaPath);
        for (const dir of dirs) {
            const dirPath = path.join(mediaPath, dir);
            if (fs.statSync(dirPath).isDirectory()) {
                const files = fs.readdirSync(dirPath);
                for (const file of files) {
                    const filePath = path.join(dirPath, file);
                    const fileNameYYYYMMDD = file.split('.')[0];
                    if (fileNameYYYYMMDD < tenDaysAgo) {
                        fs.unlinkSync(filePath);
                        deleted.push(filePath);
                        console.log(`Deleted old file: ${filePath}`);
                    }
                }
            }
        }
    };

    clearOld();

    // Clean up all existing invalid files in all folders
    const cleanupAllDirectories = () => {
        const validPattern = /^\d{8}\.mp4$/;
        const dirs = fs.readdirSync(mediaPath);
        let totalCleaned = 0;
        
        for (const dir of dirs) {
            const dirPath = path.join(mediaPath, dir);
            if (fs.statSync(dirPath).isDirectory()) {
                const files = fs.readdirSync(dirPath);
                const invalidFiles = files.filter(f => !validPattern.test(f));
                
                invalidFiles.forEach(file => {
                    const filePath = path.join(dirPath, file);
                    try {
                        fs.unlinkSync(filePath);
                        console.log(`Cleaned up invalid file: ${filePath}`);
                        totalCleaned++;
                    } catch (err) {
                        console.error(`Failed to delete invalid file ${filePath}:`, err.message);
                    }
                });
            }
        }
        
        if (totalCleaned > 0) {
            console.log(`🧹 Cleaned up ${totalCleaned} invalid files from all directories`);
        }
    };

    cleanupAllDirectories();

    // Helper function to validate and clean up files
    const validateAndCleanup = (shortcode) => {
        const shortcodePath = path.join(mediaPath, shortcode);
        if (!fs.existsSync(shortcodePath)) return { valid: false, files: [] };
        
        const files = fs.readdirSync(shortcodePath);
        const validPattern = /^\d{8}\.mp4$/; // Only YYYYMMDD.mp4 files are valid
        const validFiles = files.filter(f => validPattern.test(f));
        const invalidFiles = files.filter(f => !validPattern.test(f));
        
        // Remove all invalid files
        invalidFiles.forEach(file => {
            const filePath = path.join(shortcodePath, file);
            try {
                fs.unlinkSync(filePath);
                console.log(`Removed invalid file: ${filePath}`);
            } catch (err) {
                console.error(`Failed to delete invalid file ${filePath}:`, err.message);
            }
        });
        
        // Validate we have exactly one valid file
        const valid = validFiles.length === 1;
        return { valid, files: validFiles, removed: invalidFiles.length };
    };

    // Process each item with retry logic
    for(const item of youtubeData) {
        const { type, shortcode, playlist, volume, sort, uid, folder} = item;
        const input = type === 'Channel' ? `'https://www.youtube.com/channel/${playlist}'` : `'${playlist}'`;
        
        // Check if today's file already exists
        const today = moment().format('YYYYMMDD');
        const todayFile = `${today}.mp4`;
        const todayPath = path.join(process.env.path.media, 'news', shortcode, todayFile);
        
        if (fs.existsSync(todayPath)) {
            console.log(`✓ ${shortcode} already has today's file: ${todayFile}`);
            commands.push(`# ${shortcode}: ALREADY EXISTS`);
            shortcodes.push(`${shortcode}`);
            continue;
        }
        
        let success = false;
        let attempt = 0;
        const maxAttempts = 5;
        
        while (!success && attempt < maxAttempts) {
            attempt++;
            console.log(`Downloading ${shortcode} from ${playlist} (attempt ${attempt}/${maxAttempts})`);
            
            const ytdlp = `yt-dlp -f "bestvideo[vcodec^=hevc][height<=720]+bestaudio[ext=m4a]/bestvideo[vcodec^=avc][height<=720]+bestaudio[ext=m4a]/best[height<=720]" --remux-video mp4 -o '${process.env.path.media}/news/${shortcode}/%(upload_date)s.%(ext)s' --max-downloads 1 --playlist-items 1 ${input}`;
            
            try {
                const exec = promisify(child_process.exec);
                await exec(ytdlp);
                
                // Wait a moment for file system to settle
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Check if target file exists (success condition)
                if (fs.existsSync(todayPath)) {
                    console.log(`✓ Successfully downloaded ${shortcode} (${todayFile})`);
                    success = true;
                } else {
                    // Clean up any invalid files
                    validateAndCleanup(shortcode);
                    console.log(`✗ Target file not found for ${shortcode}`);
                    if (attempt < maxAttempts) {
                        console.log(`Retrying ${shortcode} in 2 seconds...`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            } catch (error) {
                console.error(`Error downloading ${shortcode} (attempt ${attempt}):`, error.message);
                
                // Even if command failed, check if target file exists
                if (fs.existsSync(todayPath)) {
                    console.log(`✓ Target file exists despite error for ${shortcode} (${todayFile})`);
                    success = true;
                } else if (attempt < maxAttempts) {
                    console.log(`Retrying ${shortcode} in 2 seconds...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }
        
        if (!success) {
            console.error(`❌ Failed to download ${shortcode} after ${maxAttempts} attempts`);
        }
        
        commands.push(`# ${shortcode}: ${success ? 'SUCCESS' : 'FAILED'}`);
        shortcodes.push(`${shortcode}`);
    }

    //scan the news folder and get the list of files, recursive
    const folders = fs.readdirSync(mediaPath);
    const files = [];
    for (const folder of folders) {
        const folderPath = path.join(mediaPath, folder);
        if (fs.statSync(folderPath).isDirectory()) {
            const folderFiles = fs.readdirSync(folderPath);
            for (const file of folderFiles) {
                if (file.endsWith('.mp4')) { // Only include valid mp4 files
                    const filePath = path.join(folderPath, file);
                    const stats = fs.statSync(filePath);
                    const fileDate = file.split('.')[0]; // Extract YYYYMMDD from filename
                    if (fileDate >= tenDaysAgo) {
                        files.push(filePath);
                        console.log(`Found file: ${filePath}`);
                    }
                }
            }
        }
    }

    
    return {deleted,shortcodes,files};


}

export default getYoutube;