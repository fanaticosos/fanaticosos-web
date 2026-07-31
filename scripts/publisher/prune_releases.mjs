#!/usr/bin/env node

import { applyRetention, retentionPlan } from "../../publisher/lib/release-retention.mjs";

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

const releasesRoot = argument("--releases-root");
if (!releasesRoot) throw new Error("--releases-root is required");
const plan = await retentionPlan({
  releasesRoot,
  keepSuccessful: Number(argument("--keep-successful", "10")),
  failedDays: Number(argument("--failed-days", "30")),
});
const removed = process.argv.includes("--apply") ? await applyRetention({ releasesRoot, plan }) : [];
console.log(JSON.stringify({ ...plan, applied: process.argv.includes("--apply"), removed }, null, 2));
