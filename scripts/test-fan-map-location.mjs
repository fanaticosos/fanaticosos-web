import assert from "node:assert/strict";
import { validateMapLocation } from "../functions/lib/fan-map-location.js";

const response = (geocoding, status = 200) => new Response(
  JSON.stringify(geocoding ? { features: [{ properties: { geocoding } }] } : { error: "Unable to geocode" }),
  { status, headers: { "content-type": "application/json" } },
);

const validate = (overrides = {}) => validateMapLocation({
  city: "Monterrey, NL", country: "México", lat: 25.7, lng: -100.3,
  fetchImplementation: async () => response({ name: "Monterrey", country: "México", label: "Monterrey, Nuevo León, México" }),
  ...overrides,
});

assert.deepEqual(await validate(), { valid: true });
assert.deepEqual(await validate({ country: "Estados Unidos" }), { valid: false, reason: "country_mismatch" });
assert.deepEqual(await validate({ city: "Guadalajara" }), { valid: false, reason: "city_mismatch" });
assert.deepEqual(await validate({
  city: "San José", country: "Estados Unidos", lat: 32.7, lng: -117.2,
  fetchImplementation: async () => response({ name: "San Diego", country: "Estados Unidos" }),
}), { valid: false, reason: "city_mismatch" });
assert.deepEqual(await validate({ fetchImplementation: async () => response(null, 404) }), { valid: false, reason: "not_on_land" });
assert.deepEqual(await validate({ fetchImplementation: async () => { throw new Error("offline"); } }), { valid: false, reason: "validation_unavailable" });
assert.deepEqual(await validate({
  city: "Chicago", country: "USA", lat: 41.9, lng: -87.6,
  fetchImplementation: async () => response({ name: "Chicago", city: "South Chicago Township", country: "Estados Unidos de América" }),
}), { valid: true });
assert.deepEqual(await validate({
  city: "CDMX", country: "Mexico", lat: 19.4, lng: -99.1,
  fetchImplementation: async () => response({ name: "Ciudad de México", district: "Cuauhtémoc", country: "México" }),
}), { valid: true });

console.log("Passed fan map geographic validation tests.");
