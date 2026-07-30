import source from "../data/site-settings.json";
import { siteSettingsSchema } from "./siteSettingsSchema.mjs";

export const siteSettings = siteSettingsSchema.parse(source);
