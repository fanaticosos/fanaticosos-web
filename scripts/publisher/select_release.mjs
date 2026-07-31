#!/usr/bin/env node

import { selectRelease } from "../../publisher/lib/release-selection.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
}

const selected = await selectRelease({
  releasesRoot: argument("--releases-root"),
  jobId: argument("--job-id"),
});
console.log(`PASS: Selected local release ${selected.jobId}.`);
