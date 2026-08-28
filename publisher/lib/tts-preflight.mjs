const ROMAN = /^(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/;
// A period ends an entity. It must never join “Paycor Stadium.” to the
// capitalized first word of the next sentence or paragraph.
const CAPITALIZED_SEQUENCE = /\b[\p{Lu}][\p{L}'’-]+(?:[ \t]+(?:[\p{Lu}][\p{L}'’-]+|(?:Jr|Sr)\.|II|III|IV)){1,5}\b/gu;
const ACRONYM = /\b[A-Z]{2,6}\b/g;
const LEGACY_NFL_NAMES = ["Jay Cutler"];

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function articleText(draft) {
  return [draft.title, draft.description, draft.body].filter(Boolean).join("\n")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[#*_`~>[\]()]/g, " ");
}

function addEntity(target, seen, entity) {
  const written = entity.written?.trim();
  if (!written || seen.has(entity.casefold)) return;
  seen.add(entity.casefold);
  target.push(entity);
}

function inventory(database, azureEntities, spanishTerms = {}) {
  const values = [];
  const seen = new Set();
  const push = (written, category, source, language = "en-US", caseSensitive = false) => {
    const casefold = `${written.toLocaleLowerCase("en-US")}:${caseSensitive}`;
    addEntity(values, seen, { written, casefold, category, source, language, caseSensitive });
  };
  for (const team of database.teams ?? []) {
    push(team.canonical, "team", team.rosterSource);
    push(team.market, "city", team.rosterSource);
    push(team.nickname, "team", team.rosterSource, "es-MX");
    for (const player of team.players ?? []) {
      push(player.name, "player", team.rosterSource, "en-US", true);
      for (const form of player.writtenForms ?? []) push(form, "player", team.rosterSource, "en-US", true);
    }
  }
  for (const place of database.places ?? []) push(place.grapheme, place.category, "operational-database", place.language ?? "en-US");
  for (const entity of azureEntities.entities ?? []) {
    push(entity.grapheme, entity.category, "reviewed-override", entity.language ?? "es-MX");
    for (const form of entity.writtenForms ?? []) push(form, entity.category, "reviewed-override", entity.language ?? "es-MX");
    if (entity.grapheme.toLocaleLowerCase("es-MX") === "fanaticosos") {
      for (const form of ["FanaticOSOS", "Fanatic-OSOS", "Fanatic OSOS"]) push(form, "brand", "approved-brand-variant", "es-MX");
    }
  }
  for (const term of spanishTerms.terms ?? []) {
    push(term.canonical, "football-term", "approved-terminology", "en-US");
    for (const form of term.acceptedSpanish ?? []) push(form, "football-term", "approved-terminology", "es-MX");
  }
  for (const name of LEGACY_NFL_NAMES) push(name, "player", "legacy-nfl-name", "en-US", true);
  return values.sort((left, right) => right.written.length - left.written.length);
}

export function ttsPreflight(draft, database, azureEntities, spanishTerms = {}) {
  if (database?.schemaVersion !== 1 || database?.teams?.length !== 32) throw new Error("NFL entity database is invalid");
  const entities = inventory(database, azureEntities, spanishTerms);
  const original = articleText(draft);
  let masked = original;
  const detected = [];
  for (const entity of entities) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapePattern(entity.written)}(?![\\p{L}\\p{N}])`, entity.caseSensitive ? "gu" : "giu");
    let found = false;
    masked = masked.replace(pattern, (match) => {
      found = true;
      return " ".repeat(match.length);
    });
    if (found) detected.push(entity);
  }
  const unresolved = new Set();
  for (const match of masked.matchAll(CAPITALIZED_SEQUENCE)) {
    const candidate = match[0].trim();
    if (!/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X)\.\s/.test(candidate)) unresolved.add(candidate);
  }
  for (const match of masked.matchAll(ACRONYM)) {
    if (!ROMAN.test(match[0])) unresolved.add(match[0]);
  }
  const unknown = [...unresolved].sort((a, b) => a.localeCompare(b));
  return {
    schemaVersion: 1,
    status: unknown.length ? "blocked" : "ready",
    databaseVersion: database.version,
    season: database.season,
    rosterPlayers: database.teams.reduce((total, team) => total + team.players.length, 0),
    detected: detected.map(({ casefold, ...entity }) => entity),
    unresolved: unknown,
  };
}

export function requireTtsPreflight(draft, database, azureEntities) {
  const result = ttsPreflight(draft, database, azureEntities);
  if (result.status !== "ready") {
    throw new Error(`TTS blocked: unresolved people or places: ${result.unresolved.join(", ")}`);
  }
  return result;
}
