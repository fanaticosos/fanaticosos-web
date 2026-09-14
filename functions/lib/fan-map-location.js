const DEFAULT_GEOCODER = "https://nominatim.openstreetmap.org";

export const roundMapCoordinates = (lat, lng) => ({
  lat: Math.round(Number(lat) * 10) / 10,
  lng: Math.round(Number(lng) * 10) / 10,
});

const stripMarks = (value) => String(value ?? "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const COUNTRY_ALIASES = new Map([
  ["usa", "united states"], ["us", "united states"], ["u s a", "united states"],
  ["estados unidos", "united states"], ["estados unidos de america", "united states"], ["ee uu", "united states"],
  ["uk", "united kingdom"], ["u k", "united kingdom"], ["gran bretana", "united kingdom"],
  ["mexico", "mexico"],
]);

const normalizeCountry = (value) => {
  const normalized = stripMarks(value);
  return COUNTRY_ALIASES.get(normalized) ?? normalized;
};

const CITY_ALIASES = new Map([
  ["cdmx", "ciudad de mexico"], ["df", "ciudad de mexico"], ["d f", "ciudad de mexico"],
]);

const normalizeCity = (value) => {
  const normalized = stripMarks(value).split(",", 1)[0].trim();
  return CITY_ALIASES.get(normalized) ?? normalized;
};

const GENERIC_CITY_TOKENS = new Set(["san", "santa", "santo", "saint", "city", "ciudad", "municipio", "municipality"]);
const significantTokens = (value) => new Set(stripMarks(value).split(" ").filter((token) => token.length >= 3 && !GENERIC_CITY_TOKENS.has(token)));

function namesApproximatelyMatch(expected, candidates) {
  const normalizedExpected = normalizeCity(expected).replace(/\b(city|ciudad|municipio|municipality)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!normalizedExpected) return false;
  const expectedTokens = significantTokens(normalizedExpected);
  return candidates.some((candidate) => {
    const normalizedCandidate = stripMarks(candidate).replace(/\b(city|ciudad|municipio|municipality)\b/g, " ").replace(/\s+/g, " ").trim();
    if (!normalizedCandidate) return false;
    if (normalizedCandidate.includes(normalizedExpected) || normalizedExpected.includes(normalizedCandidate)) return true;
    const candidateTokens = significantTokens(normalizedCandidate);
    return [...expectedTokens].some((token) => candidateTokens.has(token));
  });
}

export async function validateMapLocation({ city, country, lat, lng, locale = "es", geocoderUrl = DEFAULT_GEOCODER, fetchImplementation = fetch }) {
  const rounded = roundMapCoordinates(lat, lng);
  const endpoint = new URL("/reverse", geocoderUrl);
  endpoint.search = new URLSearchParams({
    format: "geocodejson", lat: String(rounded.lat), lon: String(rounded.lng), zoom: "10", addressdetails: "1",
    "accept-language": locale === "en" ? "en,es" : "es,en",
  }).toString();

  let response;
  try {
    response = await fetchImplementation(endpoint, {
      headers: {
        Accept: "application/json",
        "User-Agent": "FanaticOSOS fan-map-validator/1.0 (https://fanaticosos.com/contacto/)",
      },
      cf: { cacheEverything: true, cacheTtl: 86_400 },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return { valid: false, reason: "validation_unavailable" };
  }
  if (!response.ok) {
    if (response.status === 404) return { valid: false, reason: "not_on_land" };
    return { valid: false, reason: "validation_unavailable" };
  }

  let payload;
  try { payload = await response.json(); } catch { return { valid: false, reason: "validation_unavailable" }; }
  const geocoding = payload?.features?.[0]?.properties?.geocoding;
  if (!geocoding?.country) return { valid: false, reason: "not_on_land" };
  if (normalizeCountry(country) !== normalizeCountry(geocoding.country)) {
    return { valid: false, reason: "country_mismatch" };
  }

  const admin = geocoding.admin ?? {};
  const cityCandidates = [
    geocoding.name, geocoding.city, geocoding.locality, geocoding.district,
    geocoding.municipality, admin.level8, admin.level7,
  ].filter(Boolean);
  if (!namesApproximatelyMatch(city, cityCandidates)) return { valid: false, reason: "city_mismatch" };
  return { valid: true };
}

export const fanMapLocationInternals = { normalizeCountry, normalizeCity, namesApproximatelyMatch };
