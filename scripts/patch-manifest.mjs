// Trägt die nötigen Berechtigungen nach "cap add android" ins Manifest ein.
import { readFile, writeFile } from "node:fs/promises";

const file = "android/app/src/main/AndroidManifest.xml";
let xml = await readFile(file, "utf8");
if (xml.includes("ACCESS_FINE_LOCATION")) {
  console.log("Berechtigungen schon vorhanden.");
} else {
  const perms = [
    "ACCESS_COARSE_LOCATION",
    "ACCESS_FINE_LOCATION",
    "ACCESS_BACKGROUND_LOCATION",
    "FOREGROUND_SERVICE",
    "FOREGROUND_SERVICE_LOCATION",
    "POST_NOTIFICATIONS",
  ].map((p) => `    <uses-permission android:name="android.permission.${p}" />\n`).join("");
  xml = xml.replace("<application", perms + "\n    <application");
  await writeFile(file, xml);
  console.log("Berechtigungen eingetragen.");
}
