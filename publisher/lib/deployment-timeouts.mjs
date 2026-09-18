// A production deployment may legitimately spend up to 35 minutes uploading,
// waiting for Cloudflare aliases, validating every domain, and rolling back.
// Keep the publisher's running-job deadline beyond the systemd deadline so the
// UI never declares a deployment dead while systemd is still responsible for it.
export const QUEUED_DEPLOYMENT_TIMEOUT_MS = 15 * 60 * 1000;
export const RUNNING_DEPLOYMENT_TIMEOUT_MS = 40 * 60 * 1000;
