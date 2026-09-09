#!/usr/bin/env node

import { backupDatabase, databaseStatus, initializeDatabase, restoreDatabaseDrill } from "../../publisher/lib/database-admin.mjs";
import { applyDraftImport, previewDraftImport } from "../../publisher/lib/draft-import.mjs";
import { applyTranslationImport, previewTranslationImport } from "../../publisher/lib/translation-import.mjs";
import { previewAudioImport } from "../../publisher/lib/audio-import.mjs";

function options(values) {
  const parsed = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || !value) throw new Error("database command options are invalid");
    if (parsed.has(name)) throw new Error(`duplicate database option: ${name}`);
    parsed.set(name, value);
  }
  return parsed;
}

function required(parsed, name) {
  const value = parsed.get(name);
  if (!value) throw new Error(`missing required option: ${name}`);
  return value;
}

async function main(argv) {
  const [command, ...values] = argv;
  const parsed = options(values);
  let result;
  if (command === "initialize") {
    result = await initializeDatabase(required(parsed, "--database"));
  } else if (command === "status") {
    result = databaseStatus(required(parsed, "--database"));
  } else if (command === "backup") {
    result = await backupDatabase(
      required(parsed, "--database"),
      required(parsed, "--backup-root"),
      required(parsed, "--backup-id"),
    );
  } else if (command === "restore-drill") {
    result = await restoreDatabaseDrill(
      required(parsed, "--backup-root"),
      required(parsed, "--backup-id"),
    );
  } else if (command === "draft-import-preview") {
    result = await previewDraftImport({
      databasePath: required(parsed, "--database"),
      draftsRoot: required(parsed, "--drafts-root"),
    });
  } else if (command === "draft-import-apply") {
    result = await applyDraftImport({
      databasePath: required(parsed, "--database"),
      draftsRoot: required(parsed, "--drafts-root"),
    });
  } else if (command === "translation-import-preview") {
    result = await previewTranslationImport({
      databasePath: required(parsed, "--database"),
      statesRoot: required(parsed, "--states-root"),
    });
  } else if (command === "translation-import-apply") {
    result = await applyTranslationImport({
      databasePath: required(parsed, "--database"),
      statesRoot: required(parsed, "--states-root"),
      artifactsRoot: required(parsed, "--artifacts-root"),
    });
  } else if (command === "audio-import-preview") {
    result = await previewAudioImport({
      databasePath: required(parsed, "--database"),
      statesRoot: required(parsed, "--states-root"),
      jobsRoot: required(parsed, "--jobs-root"),
    });
  } else {
    throw new Error("unknown database command");
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`Database operation failed: ${error.message}\n`);
  process.exitCode = 1;
});
