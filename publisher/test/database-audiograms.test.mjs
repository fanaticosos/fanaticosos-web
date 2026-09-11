import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { audiogramRequestForDraft } from "../lib/audiogram-jobs.mjs";
import { completeDatabaseAudiogram, queueDatabaseAudiogram, readDatabaseAudiogramState, startDatabaseAudiogram } from "../lib/database-audiograms.mjs";
import { createDatabaseDraft } from "../lib/database-drafts.mjs";
import { closeDatabase, openDatabase } from "../lib/database.mjs";

test("SQLite audiogram lifecycle accepts one immutable verified video", async()=>{const root=await mkdtemp(join(tmpdir(),"database-audiogram-"));const database=await openDatabase(join(root,"publisher.sqlite"));try{const draft=createDatabaseDraft(database,{title:"Título",description:"Resumen",body:"Artículo",category:"Bears",season:2026,tags:[],status:"draft",featuredImage:{}});const revision=database.prepare("SELECT current_revision_id FROM articles WHERE id=?").get(draft.articleId).current_revision_id;const sha="a".repeat(64);database.prepare(`INSERT INTO artifacts(id,revision_id,type,locale,dependency_hash,status,path,checksum_sha256,created_at,updated_at,accepted_at) VALUES('audio',?,'audio','es',?,'accepted','/audio.mp3',?,'2026-09-09T00:00:00Z','2026-09-09T00:00:00Z','2026-09-09T00:00:00Z')`).run(revision,sha,sha);const audio={status:"completed",draftRevision:1,jobs:{es:{status:"completed",jobId:`tts-es-${draft.articleId.replaceAll("-","")}-r1-1234abcd`,result:{file:"es.mp3",sha256:sha}}}};const request=audiogramRequestForDraft(draft,audio);const jobId=`audiogram-es-${draft.articleId.replaceAll("-","")}-r1-abcdef12`;assert.equal(queueDatabaseAudiogram(database,{draft,request,jobId}).status,"queued");startDatabaseAudiogram(database,jobId);const result={file:"audiogram.mp4",sizeBytes:5,sha256:"b".repeat(64),generatedAt:"2026-09-09T01:00:00Z"};assert.equal(completeDatabaseAudiogram(database,{jobId,result,artifactPath:join(root,"video.mp4")}).status,"completed");assert.equal(readDatabaseAudiogramState(database,draft.articleId).artifact.sha256,result.sha256);}finally{closeDatabase(database);}});
