import source from "../src/data/participation-slots.json" with { type: "json" };
import { participationSlotsSchema } from "../src/lib/participationSlotsSchema.mjs";

const value = participationSlotsSchema.parse(source);
console.log(`Validated ${value.slots.length} participation slots for the ${value.season} season.`);
