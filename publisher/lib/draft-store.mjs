import { listDrafts, newDraft, readDraft, updateDraft, writeDraft } from "./drafts.mjs";
import {
  createDatabaseDraft,
  listDatabaseDrafts,
  readDatabaseDraft,
  updateDatabaseDraft,
} from "./database-drafts.mjs";

export function filesystemDraftStore(root) {
  return {
    list: () => listDrafts(root),
    read: (articleId) => readDraft(root, articleId),
    async create(ownerFields) {
      const draft = newDraft(ownerFields);
      await writeDraft(root, draft);
      return draft;
    },
    update: (articleId, expectedRevision, ownerFields) => (
      updateDraft(root, articleId, expectedRevision, ownerFields)
    ),
  };
}

export function databaseDraftStore(database) {
  return {
    list: async () => listDatabaseDrafts(database),
    read: async (articleId) => readDatabaseDraft(database, articleId),
    create: async (ownerFields) => createDatabaseDraft(database, ownerFields),
    update: async (articleId, expectedRevision, ownerFields) => (
      updateDatabaseDraft(database, articleId, expectedRevision, ownerFields)
    ),
  };
}
