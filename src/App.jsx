import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

const BackgroundGeolocation = registerPlugin("BackgroundGeolocation");
const NATIVE = Capacitor.isNativePlatform();

const FETCH_RADIUS = 5000; // Umkreis für Marker (m)
const REFETCH_M = 2000; // neu laden nach so viel Bewegung (m)
const REPEAT_MS = 10 * 60 * 1000; // gleiche Warnung frühestens nach 10 Min wieder
const KEY = "pfa-settings";
const KEY_OWN = "pfa-own";
const DEFAULTS = { warnM: 500, voice: true, notify: true, onlyAhead: true };

const readJSON = (k, d) => {
  try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; }
};
const rad = Math.PI / 180;

function dist(a, b) {
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const dLon = (b.lon - a.lon) * rad;
  const y = Math.sin(dLon) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
    Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLon);
  return (Math.atan2(y, x) / rad + 360) % 360;
}
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

let STATIC = null; // Offline-Daten aus cameras.json
async function loadCameras(p) {
  if (STATIC === null) {
    try {
      const j = await (await fetch("cameras.json")).json();
      STATIC = Array.isArray(j) ? j.map(([id, lat, lon, maxspeed]) => ({ id, lat, lon, maxspeed })) : [];
    } catch { STATIC = []; }
  }
  if (STATIC.length) return STATIC.filter((c) => dist(p, c) < FETCH_RADIUS);
  // Fallback: online von OpenStreetMap
  const q = `[out:json][timeout:20];node["highway"="speed_camera"](around:${FETCH_RADIUS},${p.lat},${p.lon});out;`;
  const r = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: "data=" + encodeURIComponent(q) });
  const j = await r.json();
  return j.elements.map((e) => ({ id: e.id, lat: e.lat, lon: e.lon, maxspeed: e.tags?.maxspeed ?? null }));
}

export default function App() {
  const mapEl = useRef(null), map = useRef(null), me = useRef(null), layer = useRef(null);
  const lastFetch = useRef(null), spoken = useRef({});
  const [settings, setSettings] = useState(() => ({ ...DEFAULTS, ...readJSON(KEY, {}) }));
  const [own, setOwn] = useState(() => { const o = readJSON(KEY_OWN, []); return Array.isArray(o) ? o : []; });
  const [pos, setPos] = useState(null);
  const [cams, setCams] = useState([]);
  const [status, setStatus] = useState("Warte auf GPS …");
  const [follow, setFollow] = useState(true);
  const [panel, setPanel] = useState(false);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {} }, [settings]);
  useEffect(() => { try { localStorage.setItem(KEY_OWN, JSON.stringify(own)); } catch {} }, [own]);
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  // Karte
  useEffect(() => {
    const m = L.map(mapEl.current, { zoomControl: false }).setView([51.16, 10.45], 6);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap-Mitwirkende", maxZoom: 19,
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on("dragstart", () => setFollow(false));
    map.current = m;
    return () => { m.remove(); map.current = null; me.current = null; };
  }, []);

  // GPS: nativ mit Hintergrunddienst, im Browser normal
  useEffect(() => {
    let stop = () => {}, dead = false;
    if (NATIVE) {
      LocalNotifications.requestPermissions().catch(() => {});
      BackgroundGeolocation.addWatcher(
        { backgroundTitle: "Peters Foto App", backgroundMessage: "Warnung ist aktiv", requestPermissions: true, stale: false, distanceFilter: 10 },
        (loc, err) => {
          if (err) return setStatus(err.code === "NOT_AUTHORIZED" ? "Standortrechte fehlen" : "GPS-Fehler");
          setPos({ lat: loc.latitude, lon: loc.longitude, speed: loc.speed, heading: loc.bearing });
          setStatus("GPS aktiv");
        }
      ).then((id) => {
        if (dead) BackgroundGeolocation.removeWatcher({ id });
        else stop = () => BackgroundGeolocation.removeWatcher({ id });
      });
    } else if (navigator.geolocation) {
      const id = navigator.geolocation.watchPosition(
        (g) => {
          setPos({ lat: g.coords.latitude, lon: g.coords.longitude, speed: g.coords.speed, heading: g.coords.heading });
          setStatus("GPS aktiv");
        },
        (e) => setStatus("GPS-Fehler: " + e.message),
        { enableHighAccuracy: true, maximumAge: 1000 }
      );
      stop = () => navigator.geolocation.clearWatch(id);
    } else setStatus("Kein GPS verfügbar");
    return () => { dead = true; stop(); };
  }, []);

  // Position anzeigen, Daten nachladen
  useEffect(() => {
    if (!pos || !map.current) return;
    const ll = [pos.lat, pos.lon];
    if (!me.current) {
      me.current = L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: "#2b7fff", fillOpacity: 1 }).addTo(map.current);
      map.current.setView(ll, 16);
    } else me.current.setLatLng(ll);
    if (follow) map.current.panTo(ll, { animate: false });
    if (!lastFetch.current || dist(lastFetch.current, pos) > REFETCH_M) {
      lastFetch.current = pos;
      loadCameras(pos)
        .then((c) => { setCams(c); setStatus(`${c.length} Blitzer im Umkreis`); })
        .catch(() => setStatus("Daten konnten nicht geladen werden"));
    }
  }, [pos, follow]);

  const all = useMemo(() => [...cams, ...own], [cams, own]);

  // Marker
  useEffect(() => {
    if (!layer.current) return;
    layer.current.clearLayers();
    all.forEach((c) =>
      L.circleMarker([c.lat, c.lon], {
        radius: 8, color: "#fff", weight: 2,
        fillColor: String(c.id).startsWith("own-") ? "#ffb000" : "#e5372b", fillOpacity: 1,
      }).bindTooltip(c.maxspeed ? `Blitzer · ${c.maxspeed} km/h` : "Blitzer").addTo(layer.current)
    );
  }, [all]);

  // Nächster Blitzer und aktive Warnung
  const { warn, nearD } = useMemo(() => {
    if (!pos || !all.length) return { warn: null, nearD: null };
    const moving = pos.speed > 2 && pos.heading != null;
    const list = all.map((c) => ({ ...c, d: dist(pos, c) })).sort((a, b) => a.d - b.d);
    const w = list.find(
      (c) => c.d < settings.warnM && (!settings.onlyAhead || !moving || angDiff(pos.heading, bearing(pos, c)) < 100)
    );
    return { warn: w ?? null, nearD: list[0].d };
  }, [pos, all, settings.warnM, settings.onlyAhead]);

  // Ansage und Benachrichtigung (je Blitzer einmal pro 10 Minuten)
  useEffect(() => {
    if (!warn) return;
    const last = spoken.current[warn.id];
    if (last && Date.now() - last < REPEAT_MS) return;
    spoken.current[warn.id] = Date.now();
    const m = Math.round(warn.d / 10) * 10;
    if (settings.voice && "speechSynthesis" in window) {
      const u = new SpeechSynthesisUtterance(`Blitzer in ${m} Metern`);
      u.lang = "de-DE";
      speechSynthesis.speak(u);
    }
    if (NATIVE && settings.notify) {
      LocalNotifications.schedule({
        notifications: [{ id: Date.now() % 2147483647, title: "Blitzer voraus", body: `${m} m` }],
      }).catch(() => {});
    }
  }, [warn?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const report = () => {
    if (!pos) return;
    setOwn((o) => [...o, { id: "own-" + Date.now(), lat: pos.lat, lon: pos.lon, maxspeed: null }]);
  };
  const kmh = pos?.speed != null ? Math.round(pos.speed * 3.6) : null;

  return (
    <div className="app">
      <div ref={mapEl} className="map" />

      <div className={"banner" + (warn ? " alert" : "")}>
        {warn ? (
          <>
            <strong>{Math.round(warn.d)} m</strong>
            <span>Blitzer voraus{warn.maxspeed ? ` · Tempo ${warn.maxspeed}` : ""}</span>
          </>
        ) : (
          <span>{status}{nearD != null ? ` · nächster: ${(nearD / 1000).toFixed(1)} km` : ""}</span>
        )}
      </div>

      <div className="speed">{kmh ?? "–"}<small>km/h</small></div>

      <div className="bar">
        <button className={settings.voice ? "" : "off"} onClick={() => set("voice", !settings.voice)}>
          {settings.voice ? "Ton an" : "Ton aus"}
        </button>
        <button onClick={() => { setFollow(true); pos && map.current.setView([pos.lat, pos.lon], 16); }}>Zentrieren</button>
        <button onClick={report}>Melden</button>
        <button onClick={() => setPanel(true)}>Optionen</button>
      </div>

      {panel && (
        <div className="sheet" role="dialog" aria-label="Einstellungen">
          <h2>Einstellungen</h2>
          <label className="row">Warnabstand
            <select value={settings.warnM} onChange={(e) => set("warnM", Number(e.target.value))}>
              {[300, 500, 800, 1200].map((m) => <option key={m} value={m}>{m} m</option>)}
            </select>
          </label>
          <label className="row">Sprachansage
            <input type="checkbox" checked={settings.voice} onChange={(e) => set("voice", e.target.checked)} />
          </label>
          <label className="row">Benachrichtigung
            <input type="checkbox" checked={settings.notify} onChange={(e) => set("notify", e.target.checked)} />
          </label>
          <label className="row">Nur Blitzer in Fahrtrichtung
            <input type="checkbox" checked={settings.onlyAhead} onChange={(e) => set("onlyAhead", e.target.checked)} />
          </label>
          <button className="act sec" onClick={() => { if (own.length && confirm(`${own.length} eigene Punkte löschen?`)) setOwn([]); }}>
            Eigene Punkte löschen ({own.length})
          </button>
          <button className="act" onClick={() => setPanel(false)}>Schließen</button>
          <p className="note">
            Hinweis: In Deutschland darf der Fahrer während der Fahrt keine Blitzer-Warn-App nutzen (§ 23 Abs. 1c StVO).
            Kartendaten © OpenStreetMap-Mitwirkende; die Standorte sind unvollständig und ohne Gewähr.
          </p>
        </div>
      )}
    </div>
  );
}
