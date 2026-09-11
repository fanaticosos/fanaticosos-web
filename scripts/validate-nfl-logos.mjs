import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const logoRoot = join(process.cwd(), "public", "assets", "nfl-logos");
const expected = [
  "ari", "atl", "bal", "buf", "car", "chi", "cin", "cle",
  "dal", "den", "det", "gb", "hou", "ind", "jax", "kc",
  "lac", "lar", "lv", "mia", "min", "ne", "no", "nyg",
  "nyj", "phi", "pit", "sea", "sf", "tb", "ten", "wsh",
].map((team) => `${team}.png`);

const actual = (await readdir(logoRoot)).filter((name) => name.endsWith(".png")).sort();
if (actual.length !== 32 || expected.some((name) => !actual.includes(name)) || actual.some((name) => !expected.includes(name))) {
  throw new Error(`NFL logo inventory mismatch: expected 32, found ${actual.length}`);
}

for (const name of expected) {
  const file = await readFile(join(logoRoot, name));
  const isPng = file.length >= 24 && file.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (!isPng) throw new Error(`${name} is not a valid PNG file`);
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  if (width < 128 || height < 128 || width > 512 || height > 512) {
    throw new Error(`${name} has unexpected dimensions ${width}x${height}`);
  }
}

console.log("Validated 32 locally stored NFL team logos.");
