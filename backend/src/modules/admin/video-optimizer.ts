import { Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const logger = new Logger('VideoOptimizer');

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v']);
const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;
const TEMP_SUFFIX = '.optimizing.mp4';

// שמירה על מראה חד במובייל: אנכי עד 720 רוחב, לרוחב עד 1280, ו-~2Mbps מספיקים לסרטון קצר.
const FULL_MAX_BITRATE = 2_500_000;
const REOPTIMIZE_ABOVE_BITRATE = 3_000_000;
const PORTRAIT_MAX_WIDTH = 720;
const LANDSCAPE_MAX_WIDTH = 1280;

let ffmpegAvailable: boolean | null = null;

export async function isFfmpegAvailable(): Promise<boolean> {
    if (ffmpegAvailable !== null) return ffmpegAvailable;
    try {
        await execFileAsync('ffmpeg', ['-version']);
        await execFileAsync('ffprobe', ['-version']);
        ffmpegAvailable = true;
    } catch {
        ffmpegAvailable = false;
    }
    return ffmpegAvailable;
}

/** גרסה קלה לניגון בכל מכשיר: H.264, עד 720p, ~2Mbps, faststart כדי שהניגון יתחיל לפני שהקובץ ירד במלואו. */
export async function transcodeFullVideo(input: string, output: string): Promise<void> {
    await execFileAsync('ffmpeg', [
        '-v', 'error',
        '-y',
        '-i', input,
        '-vf', `scale='if(gt(iw,ih),min(${LANDSCAPE_MAX_WIDTH},iw),min(${PORTRAIT_MAX_WIDTH},iw))':-2`,
        '-c:v', 'libx264',
        '-profile:v', 'high',
        '-pix_fmt', 'yuv420p',
        '-preset', 'veryfast',
        '-crf', '25',
        '-maxrate', String(FULL_MAX_BITRATE),
        '-bufsize', String(FULL_MAX_BITRATE * 2),
        '-c:a', 'aac',
        '-b:a', '96k',
        '-movflags', '+faststart',
        '-threads', '2',
        '-f', 'mp4',
        output,
    ], { timeout: FFMPEG_TIMEOUT_MS });
}

/** תצוגה מקדימה קטנה לסטוריז (~128px ברוחב במסך, 360px מספיק גם ל-3x DPR). */
export async function transcodePreviewVideo(input: string, output: string): Promise<void> {
    await execFileAsync('ffmpeg', [
        '-v', 'error',
        '-y',
        '-i', input,
        '-vf', 'scale=360:-2,fps=15',
        '-c:v', 'libx264',
        '-profile:v', 'baseline',
        '-pix_fmt', 'yuv420p',
        '-preset', 'veryfast',
        '-crf', '30',
        '-maxrate', '400k',
        '-bufsize', '800k',
        '-movflags', '+faststart',
        '-an',
        '-threads', '1',
        '-f', 'mp4',
        output,
    ], { timeout: FFMPEG_TIMEOUT_MS });
}

async function probeVideo(file: string): Promise<{ width: number; height: number; bitRate: number } | null> {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=width,height,bit_rate:format=bit_rate',
            '-of', 'json',
            file,
        ]);
        const data = JSON.parse(stdout);
        const stream = data?.streams?.[0];
        if (!stream) return null;
        const bitRate = Number(stream.bit_rate) || Number(data?.format?.bit_rate) || 0;
        return { width: Number(stream.width) || 0, height: Number(stream.height) || 0, bitRate };
    } catch {
        return null;
    }
}

function needsOptimization(info: { width: number; height: number; bitRate: number }): boolean {
    const maxWidth = info.width > info.height ? LANDSCAPE_MAX_WIDTH : PORTRAIT_MAX_WIDTH;
    return info.width > maxWidth || info.bitRate > REOPTIMIZE_ABOVE_BITRATE;
}

/**
 * מכווץ סרטונים ישנים שכבר הועלו כמו שהם (ישר מהאייפון, ~16Mbps) — באותו שם קובץ, כך שהכתובות ב-DB לא משתנות.
 * הקובץ המקורי נשמר ב-uploads/.originals (נקודה בהתחלה => לא מוגש ב-/uploads) למקרה שצריך לחזור אחורה.
 * אידמפוטנטי: קובץ שכבר קל מדלג.
 */
export async function optimizeExistingUploads(uploadDir: string): Promise<void> {
    if (!(await isFfmpegAvailable())) {
        logger.warn('ffmpeg/ffprobe not available - skipping existing uploads optimization');
        return;
    }

    const fullDir = path.join(uploadDir, 'full');
    const backupDir = path.join(uploadDir, '.originals');
    if (!fs.existsSync(fullDir)) return;

    for (const name of fs.readdirSync(fullDir)) {
        if (name.endsWith(TEMP_SUFFIX)) {
            fs.rmSync(path.join(fullDir, name), { force: true });
        }
    }

    let optimized = 0;
    let savedBytes = 0;
    for (const name of fs.readdirSync(fullDir)) {
        if (!VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
        const filePath = path.join(fullDir, name);
        const tempPath = `${filePath}${TEMP_SUFFIX}`;
        try {
            const info = await probeVideo(filePath);
            if (!info || !needsOptimization(info)) continue;

            await transcodeFullVideo(filePath, tempPath);

            const before = fs.statSync(filePath).size;
            const after = fs.statSync(tempPath).size;
            if (after >= before * 0.9) {
                fs.rmSync(tempPath, { force: true });
                continue;
            }

            fs.mkdirSync(backupDir, { recursive: true });
            const backupPath = path.join(backupDir, name);
            if (!fs.existsSync(backupPath)) {
                fs.copyFileSync(filePath, backupPath);
            }
            fs.renameSync(tempPath, filePath);
            optimized += 1;
            savedBytes += before - after;
            logger.log(`Optimized ${name}: ${(before / 1e6).toFixed(1)}MB -> ${(after / 1e6).toFixed(1)}MB`);
        } catch (error) {
            fs.rmSync(tempPath, { force: true });
            logger.warn(`Failed optimizing ${name}: ${error instanceof Error ? error.message : 'unknown'}`);
        }
    }

    if (optimized > 0) {
        logger.log(`Existing uploads optimized: ${optimized} files, saved ${(savedBytes / 1e6).toFixed(1)}MB`);
    }
}
