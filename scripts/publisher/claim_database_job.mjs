#!/usr/bin/env node
import { closeDatabase, openDatabase } from "../../publisher/lib/database.mjs";
import { claimDatabaseJob } from "../../publisher/lib/database-dispatch.mjs";

const [databasePath, jobId] = process.argv.slice(2);
if (!databasePath || !jobId) throw new Error("Usage: claim_database_job.mjs DATABASE JOB_ID");
const database = await openDatabase(databasePath);
try {
  process.stdout.write(`${JSON.stringify(claimDatabaseJob(database, jobId))}\n`);
} finally { closeDatabase(database); }
