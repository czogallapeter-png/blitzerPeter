// Lädt alle festen Blitzer in Deutschland aus OpenStreetMap nach public/cameras.json
// Aufruf: npm run cameras   (Node 18+)
import { writeFile, mkdir } from "node:fs/promises";

const query = `[out:json][timeout:180];
area["ISO3166-1"="DE"][admin_level=2]->.de;
node["highway"="speed_camera"](area.de);
out;`;

console.log("Lade Daten von Overpass …");
const res = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  body: "data=" + encodeURIComponent(query),
});
if (!res.ok) throw new Error("Overpass-Fehler: " + res.status);

const { elements } = await res.json();
const out = elements.map((e) => [e.id, e.lat, e.lon, e.tags?.maxspeed ?? null]);
await mkdir("public", { recursive: true });
await writeFile("public/cameras.json", JSON.stringify(out));
console.log(`${out.length} Standorte gespeichert.`);
