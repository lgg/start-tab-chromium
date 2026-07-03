(() => {
  const SETTINGS_KEY = "startPageSettings";
  const PROVIDERS = [
    provider("https://ipapi.co/json/", "ipapi.co", (payload) => ({ ip: payload.ip, country: payload.country_name || payload.country })),
    provider("https://ipwho.is/", "ipwho.is", (payload) => ({ ip: payload.ip, country: payload.country || payload.country_code })),
    provider("https://get.geojs.io/v1/ip/geo.json", "GeoJS", (payload) => ({ ip: payload.ip, country: payload.country || payload.country_code })),
    provider("https://api.ip.sb/geoip", "IP.SB", (payload) => ({ ip: payload.ip, country: payload.country || payload.country_code })),
    provider("https://ipinfo.io/json", "IPinfo", (payload) => ({ ip: payload.ip, country: payload.country })),
    provider("https://api.db-ip.com/v2/free/self", "DB-IP Free", (payload) => ({ ip: payload.ipAddress, country: payload.countryName || payload.countryCode })),
    provider("https://freeipapi.com/api/json", "FreeIPAPI", (payload) => ({ ip: payload.ipAddress, country: payload.countryName || payload.countryCode })),
    provider("https://ipwhois.app/json/", "IPWhois.app", (payload) => ({ ip: payload.ip, country: payload.country || payload.country_code })),
    provider("https://api.country.is/", "country.is", (payload) => ({ ip: payload.ip, country: payload.country })),
    textProvider("https://www.cloudflare.com/cdn-cgi/trace", "Cloudflare Trace", parseCloudflareTrace),
  ];

  function provider(endpoint, title, parse) {
    return { endpoint, title, parse, responseType: "json" };
  }

  function textProvider(endpoint, title, parseText) {
    return { endpoint, title, parseText, responseType: "text" };
  }

  function message(key, fallback) {
    return chrome.i18n?.getMessage(key) || fallback || key;
  }

  function fill(template, values) {
    return Object.entries(values).reduce(
      (result, [key, value]) => result.split(`{${key}}`).join(String(value)),
      template,
    );
  }

  function parseCloudflareTrace(text) {
    const values = Object.fromEntries(
      text.split("\n")
        .map((line) => line.split("="))
        .filter((parts) => parts.length === 2),
    );
    return { ip: values.ip, country: values.loc };
  }

  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }

  async function readEndpoint() {
    const items = await chrome.storage.local.get(SETTINGS_KEY);
    const settings = isRecord(items[SETTINGS_KEY]) ? items[SETTINGS_KEY] : {};
    const ip = isRecord(settings.ip) ? settings.ip : {};
    return typeof ip.endpoint === "string" && ip.endpoint ? ip.endpoint : PROVIDERS[0].endpoint;
  }

  function orderedProviders(endpoint) {
    const known = PROVIDERS.find((item) => item.endpoint === endpoint);
    if (known) return [known, ...PROVIDERS.filter((item) => item.endpoint !== endpoint)];
    return [provider(endpoint, "Custom", (payload) => ({ ip: payload.ip, country: payload.country_name || payload.country || payload.countryCode }))].concat(PROVIDERS);
  }

  async function lookupWith(providerValue) {
    const response = await fetch(providerValue.endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error(`${providerValue.title} failed: ${response.status}`);
    const result = providerValue.responseType === "text"
      ? providerValue.parseText(await response.text())
      : providerValue.parse(await response.json());
    const ip = typeof result.ip === "string" && result.ip ? result.ip : "";
    const country = typeof result.country === "string" && result.country ? result.country : "";
    if (!ip && !country) throw new Error(`${providerValue.title} returned no usable IP data`);
    return { ip, country, provider: providerValue.title };
  }

  function targets() {
    return Array.from(document.querySelectorAll(".card--ip .ip__detail, #ipDetail"));
  }

  function render(result) {
    const template = message("ipResult", "{ip} · {country}");
    const ip = result.ip || message("ipUnknown", "Unknown IP");
    const country = result.country || message("ipUnknownCountry", "Unknown country");
    for (const target of targets()) {
      target.textContent = fill(template, { ip, country, provider: result.provider });
    }
  }

  function renderUnavailable() {
    for (const target of targets()) target.textContent = message("ipUnavailable", "IP lookup is unavailable.");
  }

  async function loadIp() {
    const endpoint = await readEndpoint();
    for (const providerValue of orderedProviders(endpoint)) {
      try {
        render(await lookupWith(providerValue));
        return;
      } catch {
        // Try the next public provider. Public IP APIs can rate-limit or block CORS per browser.
      }
    }
    renderUnavailable();
  }

  function schedule() {
    window.setTimeout(() => void loadIp(), 0);
    window.setTimeout(() => void loadIp(), 600);
  }

  const observer = new MutationObserver(() => {
    if (targets().length > 0) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("DOMContentLoaded", schedule);
  schedule();
})();
