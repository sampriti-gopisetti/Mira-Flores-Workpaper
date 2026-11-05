// Generates data/packet-rerun.json (the pipeline re-run demo packet) from data/packet.json.
import { readFileSync, writeFileSync } from "node:fs";
import { makeRerunPacket } from "../src/domain/rerun";

const out = makeRerunPacket(readFileSync("data/packet.json", "utf8"));
writeFileSync("data/packet-rerun.json", out);
console.log(`wrote data/packet-rerun.json (${(out.length / 1e6).toFixed(1)} MB)`);
