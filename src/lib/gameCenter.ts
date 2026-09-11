import source from "../data/game-center.json";
import { gameCenterSchema } from "./gameCenterSchema.mjs";

export const gameCenter = gameCenterSchema.parse(source);
