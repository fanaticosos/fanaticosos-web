CREATE TRIGGER accepted_artifact_content_is_immutable
BEFORE UPDATE ON artifacts
WHEN OLD.status = 'accepted' AND (
  NEW.id != OLD.id OR
  NEW.revision_id != OLD.revision_id OR
  NEW.type != OLD.type OR
  NEW.locale IS NOT OLD.locale OR
  NEW.dependency_hash != OLD.dependency_hash OR
  NEW.path IS NOT OLD.path OR
  NEW.checksum_sha256 IS NOT OLD.checksum_sha256 OR
  NEW.created_at != OLD.created_at OR
  NEW.accepted_at IS NOT OLD.accepted_at
)
BEGIN
  SELECT RAISE(ABORT, 'accepted artifact content is immutable');
END;

CREATE TRIGGER accepted_artifact_cannot_be_deleted
BEFORE DELETE ON artifacts
WHEN OLD.status = 'accepted'
BEGIN
  SELECT RAISE(ABORT, 'accepted artifact cannot be deleted');
END;
