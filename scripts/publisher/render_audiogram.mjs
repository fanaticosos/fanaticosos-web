#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const [requestPath, jobsRoot, publisherRoot, logoPath, outputRoot] = process.argv.slice(2);
if (![requestPath, jobsRoot, publisherRoot, logoPath, outputRoot].every(Boolean)) throw new Error("usage: render_audiogram REQUEST JOBS_ROOT PUBLISHER_ROOT LOGO OUTPUT");
const request = JSON.parse(await readFile(requestPath, "utf8"));
if (request.schemaVersion !== 1 || !/^tts-es-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/.test(request.audioJobId)) throw new Error("invalid audiogram request");
const audio = resolve(jobsRoot, request.audioJobId, "audio", basename(request.audioFile));
if (!audio.startsWith(`${resolve(jobsRoot)}/`)) throw new Error("invalid audio path");
const image = request.featuredImage ? resolve(publisherRoot, request.featuredImage.replace(/^\//, "")) : logoPath;
if (!image.startsWith(`${resolve(publisherRoot)}/`) && resolve(image) !== resolve(logoPath)) throw new Error("invalid featured image path");
await Promise.all([stat(audio), stat(image), stat(logoPath)]);
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const titleFile = join(outputRoot, "title.txt");
const words = request.title.split(/\s+/); const lines = []; let line = "";
for (const word of words) { if (`${line} ${word}`.trim().length > 34) { lines.push(line); line = word; } else line = `${line} ${word}`.trim(); } lines.push(line);
await writeFile(titleFile, lines.slice(0, 3).join("\n"), { mode: 0o600 });
const temporary = join(outputRoot, ".audiogram.mp4.rendering"); const target = join(outputRoot, "audiogram.mp4");
const filter = `[1:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=20:10,eq=brightness=-0.45[bg];[2:v]scale=330:330:force_original_aspect_ratio=decrease[logo];[0:a]showwaves=s=1640x150:mode=line:colors=0xFF6B00:r=30,format=rgba[wave];[bg][logo]overlay=90:70[tmp1];[tmp1][wave]overlay=140:850[tmp2];[tmp2]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='FANATICOSOS BLOG':x=470:y=115:fontsize=42:fontcolor=0xFF6B00,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:textfile='${titleFile.replaceAll("'", "'\\''")}':x=470:y=190:fontsize=66:line_spacing=18:fontcolor=white:shadowcolor=black@0.7:shadowx=3:shadowy=3,drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='fanaticosos.com':x=470:y=690:fontsize=34:fontcolor=white[outv]`;
const args = ["-y", "-i", audio, "-loop", "1", "-i", image, "-loop", "1", "-i", logoPath, "-filter_complex", filter, "-map", "[outv]", "-map", "0:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", "-f", "mp4", temporary];
await new Promise((ok, fail) => { const child = spawn(process.env.FFMPEG_PATH ?? "/usr/bin/ffmpeg", args, { stdio: "inherit" }); child.on("error", fail); child.on("exit", (code) => code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}`))); });
await rename(temporary, target); const body = await readFile(target); const metadata = await stat(target);
const youtubeTitle = `${request.title} | Fanaticosos Blog`;
const youtubeDescription = `${request.description}\n\nEscucha y lee el artículo completo: ${request.canonicalUrl}\n\nPor ${request.author}\n\n${request.tags.join(" ")}`;
await writeFile(join(outputRoot, "result.json"), `${JSON.stringify({ schemaVersion: 1, file: basename(target), sizeBytes: metadata.size, sha256: createHash("sha256").update(body).digest("hex"), generatedAt: new Date().toISOString(), youtubeTitle, youtubeDescription, canonicalUrl: request.canonicalUrl }, null, 2)}\n`, { mode: 0o600 });
