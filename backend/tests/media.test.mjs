import { findFileFromMediaKey } from '../routers/media.mjs';
import fs from 'fs';
import path from 'path';
import { jest } from '@jest/globals';

describe('findFileFromMediaKey', () => {
    const mockMediaPath = '/mock/media/path';
    const mockNotFoundPath = '/mock/media/notfound.mp3';

    beforeAll(() => {
        process.env.path = { media: mockMediaPath, media_error: mockNotFoundPath };
        jest.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
            return filePath === `${mockMediaPath}/audio.mp3`;
        });
        jest.spyOn(fs, 'statSync').mockImplementation((filePath) => {
            return { size: filePath === mockNotFoundPath ? 0 : 1024 };
        });
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    it('should return the correct file details when the file exists', () => {
        const result = findFileFromMediaKey('audio.mp3');
        expect(result).toEqual({
            found: true,
            path: `${mockMediaPath}/audio.mp3`,
            fileSize: 1024,
            extention: 'mp3',
            mimeType: 'audio/mpeg',
        });
    });

    it('should return not found details when the file does not exist', () => {
        const result = findFileFromMediaKey('nonexistent.mp3');
        expect(result).toEqual({
            found: false,
            path: mockNotFoundPath,
            fileSize: 0,
            mimeType: 'audio/mpeg',
        });
    });

    it('should handle files without extensions', () => {
        const result = findFileFromMediaKey('audio');
        expect(result).toEqual({
            found: true,
            path: `${mockMediaPath}/audio.mp3`,
            fileSize: 1024,
            extention: 'mp3',
            mimeType: 'audio/mpeg',
        });
    });

    it('should handle unsupported file extensions', () => {
        const result = findFileFromMediaKey('unsupported.xyz');
        expect(result).toEqual({
            found: false,
            path: mockNotFoundPath,
            fileSize: 0,
            mimeType: 'audio/mpeg',
        });
    });
});
