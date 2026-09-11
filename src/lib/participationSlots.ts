import source from "../data/participation-slots.json";
import { participationSlotsSchema } from "./participationSlotsSchema.mjs";

export const participationSchedule = participationSlotsSchema.parse(source);
