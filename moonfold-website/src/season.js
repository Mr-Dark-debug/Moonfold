/**
 * Moonfold Website — Seasonal control
 * Decides whether the homepage dresses for winter (snow) or autumn (leaves),
 * from the visitor's rough location and the live weather there. The header
 * snowflake button and ?season=snow|leaves|off override the automatic choice.
 */
(function () {
  "use strict";

  const OVERRIDE_KEY = "moonfold:seasonal-override:v1";
  const DECISION_KEY = "moonfold:seasonal-decision:v1";
  const WEEK_MS = 7 * 86400000;
  const DECISION_TTL = 12 * 3600000;
  // Anonymous IP geolocation; no keys, no accounts, no tracking.
  const GEO_ENDPOINTS = ["https://get.geojs.io/v1/ip/geo.json", "https://ipwho.is/"];
  const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
  // WMO weather codes that mean snow is falling.
  const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86]);
  // Regions that run roughly half a year ahead of the northern calendar.
  const SOUTHERN_REGIONS = new Set(["AU", "NZ", "AR", "CL", "UY", "PY", "ZA", "FJ", "PG"]);
  const MODE_ORDER = ["auto", "snow", "leaves", "off"];
  const MODE_LABELS = { auto: "Automatic", snow: "Snow", leaves: "Leaves", off: "Off" };

  function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
  }

  /**
   * Pure season logic: from the month at the visitor's location, hemisphere
   * clues and the live weather there, choose a mode. Weather may be missing;
   * the calendar then carries the decision on its own.
   */
  function decideSeason({ month, lat = null, region = null, weather = null }) {
    const southern = lat != null ? lat < 0 : region != null && SOUTHERN_REGIONS.has(region);
    const tropical = lat != null && Math.abs(lat) < 23.5;
    const snowing = weather != null && (SNOW_CODES.has(weather.code) || weather.snowfall > 0.05);
    const wind = weather ? clamp(weather.wind || 0, 0, 14) : 0;
    const winterMonths = southern ? [5, 6, 7] : [11, 0, 1];
    const autumnMonths = southern ? [2, 3, 4] : [8, 9, 10];

    if (winterMonths.includes(month)) {
      const temp = weather ? weather.temp : null;
      let intensity = 0.55;
      if (snowing) intensity = 0.95;
      else if (temp != null && temp <= -8) intensity = 0.8;
      else if (temp != null && temp <= 3) intensity = 0.65;
      else if (temp != null && temp > 12) intensity = 0.35;
      return { mode: "snow", intensity, wind, reason: "winter" };
    }
    if (autumnMonths.includes(month)) {
      const peak = month === autumnMonths[1];
      return { mode: "leaves", intensity: peak ? 0.8 : 0.55, wind, reason: "autumn" };
    }
    // The tropics skip the calendar, but a live snow report still wins.
    if (snowing) return { mode: "snow", intensity: 0.85, wind, reason: "snowing" };
    return { mode: "off", intensity: 0, wind: 0, reason: "season" };
  }

  // Outside a browser there is nothing to wire; expose the pure logic for tests.
  if (typeof document !== "object") {
    if (typeof module === "object" && module.exports) {
      module.exports = { decideSeason, SOUTHERN_REGIONS };
    } else {
      globalThis.__moonfoldSeasonTest = { decideSeason };
    }
    return;
  }

  function readOverride() {
    try {
      const param = new URLSearchParams(location.search).get("season");
      if (param && MODE_ORDER.includes(param)) return param;
    } catch {
      // A broken query string is not a reason to skip the stored choice.
    }
    try {
      const stored = localStorage.getItem(OVERRIDE_KEY);
      if (stored && MODE_ORDER.includes(stored)) return stored;
    } catch {
      // Storage can be unavailable (private modes); auto is a fine default.
    }
    return "auto";
  }

  function writeOverride(mode) {
    try {
      localStorage.setItem(OVERRIDE_KEY, mode);
    } catch {
      // The override then only lasts this visit.
    }
  }

  function readDecisionCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(DECISION_KEY));
      if (!cached || !MODE_ORDER.includes(cached.mode) || cached.mode === "auto") return null;
      if (cached.bucket !== Math.floor(Date.now() / WEEK_MS)) return null;
      if (Date.now() - cached.at > DECISION_TTL) return null;
      if (typeof cached.intensity !== "number" || typeof cached.wind !== "number") return null;
      return cached;
    } catch {
      return null;
    }
  }

  function writeDecisionCache(decision, place) {
    try {
      localStorage.setItem(
        DECISION_KEY,
        JSON.stringify({
          bucket: Math.floor(Date.now() / WEEK_MS),
          at: Date.now(),
          mode: decision.mode,
          intensity: decision.intensity,
          wind: decision.wind,
          lat: place ? Math.round(place.lat * 10) / 10 : null,
          lon: place ? Math.round(place.lon * 10) / 10 : null,
        }),
      );
    } catch {
      // Deciding again on the next visit is fine.
    }
  }

  function monthInZone(timezone) {
    const fallback = new Date().getMonth();
    if (!timezone) return fallback;
    try {
      const label = new Intl.DateTimeFormat("en-US", {
        month: "numeric",
        timeZone: timezone,
      }).format(new Date());
      const month = Number(label) - 1;
      return month >= 0 && month <= 11 ? month : fallback;
    } catch {
      return fallback;
    }
  }

  function guessRegion() {
    for (const tag of navigator.languages || []) {
      const region = (tag.split("-")[1] || "").toUpperCase();
      if (region && region.length === 2) return region;
    }
    return null;
  }

  async function fetchJSON(url, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function locate() {
    for (const endpoint of GEO_ENDPOINTS) {
      const data = await fetchJSON(endpoint);
      if (!data) continue;
      const lat = Number(data.latitude);
      const lon = Number(data.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const timezone =
        typeof data.timezone === "string" ? data.timezone : data.timezone && data.timezone.id;
      return {
        lat,
        lon,
        region: (data.country_code || "").toUpperCase() || null,
        timezone: timezone || null,
      };
    }
    return null;
  }

  async function readWeather(lat, lon) {
    const query = new URLSearchParams({
      latitude: lat.toFixed(3),
      longitude: lon.toFixed(3),
      current: "temperature_2m,snowfall,weather_code,wind_speed_10m",
      wind_speed_unit: "ms",
    });
    const data = await fetchJSON(`${WEATHER_URL}?${query}`);
    const current = data && data.current;
    if (!current) return null;
    return {
      temp: typeof current.temperature_2m === "number" ? current.temperature_2m : null,
      snowfall: typeof current.snowfall === "number" ? current.snowfall : 0,
      code: current.weather_code,
      wind: typeof current.wind_speed_10m === "number" ? current.wind_speed_10m : 0,
    };
  }

  const bus = (window.MoonfoldSeasonal = {
    engines: {},
    override: readOverride(),
    decision: null,
    active: null,
    register(mode, api) {
      this.engines[mode] = api;
      this._apply();
    },
    setOverride(mode) {
      this.override = MODE_ORDER.includes(mode) ? mode : "auto";
      writeOverride(this.override);
      syncToggle();
      this._apply();
    },
    setDecision(decision, place) {
      this.decision = decision;
      writeDecisionCache(decision, place);
      this._apply();
    },
    _apply() {
      const wanted =
        this.override !== "auto" ? this.override : this.decision ? this.decision.mode : null;
      const current = this.active ? this.active.mode : null;
      if (wanted === current) {
        // A refreshed forecast only restarts the scene when it differs meaningfully.
        if (current && this.override === "auto" && this.decision) {
          const p = this.active.params;
          const d = this.decision;
          if (Math.abs(p.intensity - d.intensity) > 0.15 || Math.abs(p.wind - d.wind) > 2) {
            this.engines[current].start({ intensity: d.intensity, wind: d.wind });
            this.active = { mode: current, params: { intensity: d.intensity, wind: d.wind } };
          }
        }
        return;
      }
      if (current) this.engines[current].stop();
      this.active = null;
      if (wanted && this.engines[wanted]) {
        const params =
          this.override !== "auto"
            ? { intensity: 0.75, wind: 3 }
            : { intensity: this.decision.intensity, wind: this.decision.wind };
        this.engines[wanted].start(params);
        this.active = { mode: wanted, params };
      }
    },
  });

  const toggle = document.getElementById("seasonal-toggle");

  function effectiveLabel() {
    if (bus.override !== "auto") return MODE_LABELS[bus.override];
    if (bus.decision) return `Automatic (${MODE_LABELS[bus.decision.mode] || "off"})`;
    return "Automatic";
  }

  function syncToggle() {
    if (!toggle) return;
    const label = `Seasonal effect: ${effectiveLabel()}`;
    toggle.setAttribute("aria-label", label);
    toggle.title = `${label} — click to change`;
  }

  toggle?.addEventListener("click", () => {
    const at = Math.max(0, MODE_ORDER.indexOf(bus.override));
    bus.setOverride(MODE_ORDER[(at + 1) % MODE_ORDER.length]);
  });
  syncToggle();

  let detectionToken = 0;
  async function detect() {
    const mine = ++detectionToken;
    const place = await locate();
    const weather = place ? await readWeather(place.lat, place.lon) : null;
    if (mine !== detectionToken) return;
    const decision = decideSeason({
      month: monthInZone(place && place.timezone),
      lat: place ? place.lat : null,
      region: place ? place.region : guessRegion(),
      weather,
    });
    bus.setDecision(decision, place);
  }

  // Cache-then-network, like the release resolution in main.js: the stored
  // decision (same week) applies immediately, a fresh one follows quietly.
  const cached = readDecisionCache();
  if (cached) {
    bus.decision = { mode: cached.mode, intensity: cached.intensity, wind: cached.wind };
    bus._apply();
  }
  detect();
})();
