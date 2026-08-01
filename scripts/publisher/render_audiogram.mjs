#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const [requestPath, jobsRoot, logoPath, outputRoot] = process.argv.slice(2);
if (![requestPath, jobsRoot, logoPath, outputRoot].every(Boolean)) throw new Error("usage: render_audiogram REQUEST JOBS_ROOT LOGO OUTPUT");
const request = JSON.parse(await readFile(requestPath, "utf8"));
if (request.schemaVersion !== 1 || !/^tts-es-[0-9a-f]{32}-r[1-9][0-9]*-[0-9a-f]{8}$/.test(request.audioJobId)) throw new Error("invalid audiogram request");
const audio = resolve(jobsRoot, request.audioJobId, "audio", basename(request.audioFile));
if (!audio.startsWith(`${resolve(jobsRoot)}/`)) throw new Error("invalid audio path");
await Promise.all([stat(audio), stat(logoPath)]);
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const titleFile = join(outputRoot, "title.txt");
const words = request.title.trim().split(/\s+/); const lines = []; let line = "";
for (const word of words) {
  if (`${line} ${word}`.trim().length > 39 && line) { lines.push(line); line = word; }
  else line = `${line} ${word}`.trim();
}
if (line) lines.push(line);
await writeFile(titleFile, lines.slice(0, 3).join("\n"), { mode: 0o600 });
const temporary = join(outputRoot, ".audiogram.mp4.rendering"); const target = join(outputRoot, "audiogram.mp4");
const escapedTitleFile = titleFile.replaceAll("'", "'\\''");
const boldFont = (process.env.AUDIOGRAM_BOLD_FONT ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf").replaceAll("'", "'\\''");
const filter = [
  "color=c=0x07142F:s=1920x1080:r=30[bg]",
  "[1:v]scale=120:120:force_original_aspect_ratio=decrease[logo]",
  "[0:a]showwaves=s=1760x110:mode=cline:scale=sqrt:draw=full:colors=0xFF7A1A:r=30[wave]",
  "[bg]drawbox=x=0:y=0:w=1920:h=6:color=0xFF7A1A:t=fill[top]",
  "[top][logo]overlay=80:54[branded]",
  `[branded]drawtext=fontfile='${boldFont}':text='FANATICOSOS BLOG':x=240:y=78:fontsize=30:fontcolor=0xFF7A1A:shadowcolor=black@0.35:shadowx=2:shadowy=2,drawtext=fontfile='${boldFont}':text='#DaBears · #BearDown':x=240:y=120:fontsize=20:fontcolor=0xAEB8CC,drawbox=x=80:y=300:w=1760:h=390:color=0x263150@0.78:t=fill,drawtext=fontfile='${boldFont}':textfile='${escapedTitleFile}':x=140:y=390:fontsize=70:line_spacing=24:fontcolor=white:shadowcolor=black@0.45:shadowx=3:shadowy=3,drawtext=fontfile='${boldFont}':text='fanaticosos.com':x=80:y=865:fontsize=28:fontcolor=white[layout]`,
  "[layout][wave]overlay=80:940[outv]",
].join(";");
const args = ["-y", "-i", audio, "-loop", "1", "-i", logoPath, "-filter_complex", filter, "-map", "[outv]", "-map", "0:a", "-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", "-f", "mp4", temporary];
await new Promise((ok, fail) => { const child = spawn(process.env.FFMPEG_PATH ?? "/usr/bin/ffmpeg", args, { stdio: "inherit" }); child.on("error", fail); child.on("exit", (code) => code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}`))); });
await rename(temporary, target); const body = await readFile(target); const metadata = await stat(target);
const youtubeTitle = `${request.title} | Fanaticosos Blog`;
const youtubeDescription = `${request.description}\n\nEscucha y lee el artículo completo: ${request.canonicalUrl}\n\nPor ${request.author}\n\n${request.tags.join(" ")}`;
await writeFile(join(outputRoot, "result.json"), `${JSON.stringify({ schemaVersion: 1, file: basename(target), sizeBytes: metadata.size, sha256: createHash("sha256").update(body).digest("hex"), generatedAt: new Date().toISOString(), youtubeTitle, youtubeDescription, canonicalUrl: request.canonicalUrl }, null, 2)}\n`, { mode: 0o600 });
