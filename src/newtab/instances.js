(() => {
  const SETTINGS_KEY = "startPageSettings";
  const INSTANCE_STATE_KEY = "startTabInstanceState";
  const CLOCK_TYPES = new Set(["timer", "stopwatch", "pomodoro"]);
  const SINGLETON_TYPES = new Set(["recent", "browserPinned", "stats", "commands"]);
  const BLOCK_TYPES = [
    ["dateTime", "Date & Time"],
    ["search", "Search"],
    ["ip", "IP"],
    ["links", "Links"],
    ["timer", "Timer"],
    ["stopwatch", "Stopwatch"],
    ["pomodoro", "Pomodoro"],
    ["note", "Note"],
    ["localTasks", "Local Tasks"],
    ["googleCalendar", "Google Calendar"],
    ["weather", "Weather"],
    ["startPinned", "Start Tab Pinned"],
    ["recent", "Recent History"],
    ["browserPinned", "Browser Pinned"],
    ["stats", "Focus Stats"],
    ["commands", "Commands"],
  ];
  const DEFAULT_SIZE = {
    dateTime: [4, 2],
    search: [5, 2],
    ip: [3, 2],
    links: [6, 4],
    timer: [2, 2],
    stopwatch: [2, 2],
    pomodoro: [3, 2],
    note: [3, 3],
    localTasks: [3, 3],
    googleCalendar: [3, 3],
    weather: [3, 2],
    startPinned: [3, 2],
    recent: [3, 2],
    browserPinned: [3, 2],
    stats: [3, 2],
    commands: [3, 2],
  };
  const DEFAULT_BLOCKS = [
    { id: "dateTime", type: "dateTime", title: "Date & Time", enabled: true, column: 1, row: 1, width: 4, height: 2 },
    { id: "search", type: "search", title: "Search", enabled: true, column: 5, row: 1, width: 5, height: 2 },
    { id: "ip", type: "ip", title: "IP", enabled: true, column: 10, row: 1, width: 3, height: 2 },
    { id: "links", type: "links", title: "Links", enabled: true, column: 1, row: 3, width: 6, height: 4 },
    { id: "timer", type: "timer", title: "Timer", enabled: true, column: 7, row: 3, width: 2, height: 2 },
    { id: "stopwatch", type: "stopwatch", title: "Stopwatch", enabled: true, column: 9, row: 3, width: 2, height: 2 },
    { id: "pomodoro", type: "pomodoro", title: "Pomodoro", enabled: true, column: 11, row: 3, width: 2, height: 2 },
    { id: "note", type: "note", title: "Scratchpad", enabled: true, column: 7, row: 5, width: 3, height: 3 },
    { id: "localTasks", type: "localTasks", title: "Local Tasks", enabled: true, column: 10, row: 5, width: 3, height: 3 },
    { id: "startPinned", type: "startPinned", title: "Start Tab Pinned", enabled: true, column: 1, row: 7, width: 3, height: 2 },
    { id: "commands", type: "commands", title: "Commands", enabled: true, column: 4, row: 7, width: 3, height: 2 },
    { id: "recent", type: "recent", title: "Recent History", enabled: true, column: 7, row: 7, width: 3, height: 2 },
    { id: "stats", type: "stats", title: "Focus Stats", enabled: true, column: 10, row: 7, width: 3, height: 2 },
    { id: "browserPinned", type: "browserPinned", title: "Browser Pinned", enabled: false, column: 1, row: 9, width: 3, height: 2 },
    { id: "googleCalendar", type: "googleCalendar", title: "Google Calendar", enabled: false, column: 4, row: 9, width: 3, height: 2 },
    { id: "weather", type: "weather", title: "Weather", enabled: false, column: 7, row: 9, width: 3, height: 2 },
  ];
  const DEFAULT_SETTINGS = {
    layout: {
      columns: 12,
      profile: "work",
      mode: "grid",
      zone: "contained",
      showBlockTitles: true,
      blocks: DEFAULT_BLOCKS,
    },
    search: {
      provider: "google",
      providers: [{ id: "google", title: "Google", urlTemplate: "https://www.google.com/search?q={query}" }],
    },
    weather: {
      city: "Amsterdam",
      latitude: 52.3676,
      longitude: 4.9041,
      displayMode: "current",
      forecastEndpoint: "https://api.open-meteo.com/v1/forecast",
    },
    timers: {
      timerSeconds: 300,
      pomodoroWorkSeconds: 1500,
      pomodoroBreakSeconds: 300,
    },
  };

  let renderTimer = 0;
  let ticking = false;
  let applying = false;

  function isRecord(value) {
    return typeof value === "object" && value !== null;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeSettings(value) {
    const source = isRecord(value) ? value : {};
    const layout = isRecord(source.layout) ? source.layout : {};
    const search = isRecord(source.search) ? source.search : {};
    const weather = isRecord(source.weather) ? source.weather : {};
    const timers = isRecord(source.timers) ? source.timers : {};
    return {
      ...DEFAULT_SETTINGS,
      ...source,
      layout: {
        ...DEFAULT_SETTINGS.layout,
        ...layout,
        blocks: Array.isArray(layout.blocks) && layout.blocks.length > 0 ? layout.blocks : clone(DEFAULT_BLOCKS),
      },
      search: {
        ...DEFAULT_SETTINGS.search,
        ...search,
        providers: Array.isArray(search.providers) && search.providers.length > 0 ? search.providers : clone(DEFAULT_SETTINGS.search.providers),
      },
      weather: { ...DEFAULT_SETTINGS.weather, ...weather },
      timers: { ...DEFAULT_SETTINGS.timers, ...timers },
    };
  }

  async function readSettings() {
    const items = await chrome.storage.local.get(SETTINGS_KEY);
    return normalizeSettings(items[SETTINGS_KEY]);
  }

  async function writeSettings(settings) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: normalizeSettings(settings) });
  }

  async function readInstanceState() {
    const items = await chrome.storage.local.get(INSTANCE_STATE_KEY);
    const state = isRecord(items[INSTANCE_STATE_KEY]) ? items[INSTANCE_STATE_KEY] : {};
    return {
      clocks: isRecord(state.clocks) ? state.clocks : {},
      localTasks: isRecord(state.localTasks) ? state.localTasks : {},
      linkPages: isRecord(state.linkPages) ? state.linkPages : {},
    };
  }

  async function writeInstanceState(state) {
    await chrome.storage.local.set({ [INSTANCE_STATE_KEY]: state });
  }

  function enabledBlocks(settings) {
    return settings.layout.blocks.filter((block) => block.enabled);
  }

  function cards() {
    return Array.from(document.querySelectorAll(".grid > .card"));
  }

  function assignCards(settings) {
    const blocks = enabledBlocks(settings);
    cards().forEach((card, index) => {
      const block = blocks[index];
      if (!block) return;
      card.dataset.blockId = block.id;
      card.dataset.blockType = block.type;
    });
    return blocks;
  }

  function blockCard(block) {
    return document.querySelector(`.card[data-block-id="${CSS.escape(block.id)}"]`);
  }

  function maxRow(blocks) {
    return blocks.reduce((max, block) => Math.max(max, Number(block.row || 1) + Number(block.height || 1)), 1);
  }

  function makeBlock(type, row) {
    const [width, height] = DEFAULT_SIZE[type] || [3, 2];
    const id = `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    return {
      id,
      type,
      title: BLOCK_TYPES.find(([value]) => value === type)?.[1] || type,
      enabled: true,
      column: 1,
      row,
      width,
      height,
      config: {},
    };
  }

  async function addBlock(type) {
    const settings = await readSettings();
    const layout = settings.layout;
    const blocks = layout.blocks;
    if (SINGLETON_TYPES.has(type) && blocks.some((block) => block.type === type)) return;
    const next = makeBlock(type, maxRow(blocks) + 1);
    await writeSettings({ ...settings, layout: { ...layout, blocks: [...blocks, next], profile: "custom" } });
    location.reload();
  }

  async function updateBlock(id, updater) {
    const settings = await readSettings();
    const layout = settings.layout;
    const next = layout.blocks.map((block) => block.id === id ? updater(block) : block);
    await writeSettings({ ...settings, layout: { ...layout, blocks: next, profile: "custom" } });
  }

  async function removeBlock(id) {
    const settings = await readSettings();
    const layout = settings.layout;
    await writeSettings({ ...settings, layout: { ...layout, blocks: layout.blocks.filter((block) => block.id !== id), profile: "custom" } });
    location.reload();
  }

  async function duplicateBlock(block) {
    if (SINGLETON_TYPES.has(block.type)) return;
    const settings = await readSettings();
    const layout = settings.layout;
    const copy = {
      ...clone(block),
      id: `${block.type}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      title: `${block.title || block.type} copy`,
      row: Number(block.row || 1) + Number(block.height || 1),
    };
    await writeSettings({ ...settings, layout: { ...layout, blocks: [...layout.blocks, copy], profile: "custom" } });
    location.reload();
  }

  function promptString(label, current) {
    const value = window.prompt(label, current ?? "");
    return value === null ? undefined : value.trim();
  }

  function promptNumber(label, current) {
    const value = window.prompt(label, current === undefined ? "" : String(current));
    if (value === null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  async function configureBlock(block) {
    const config = isRecord(block.config) ? { ...block.config } : {};
    const title = promptString("Block title", block.title);
    if (title !== undefined && title) block.title = title;

    if (block.type === "dateTime") {
      const timeZone = promptString("Time zone, for example Europe/Amsterdam or Europe/Moscow. Empty = browser local.", String(config.timeZone || ""));
      const fontSize = promptNumber("Time font size in px. Empty = default.", config.fontSize);
      const mode = promptString("Mode: both, date, or time", String(config.mode || ""));
      config.timeZone = timeZone || "";
      if (fontSize !== undefined) config.fontSize = Math.max(12, Math.min(160, fontSize));
      if (["both", "date", "time"].includes(mode || "")) config.mode = mode;
    } else if (block.type === "weather") {
      const city = promptString("Weather city", String(config.city || ""));
      const latitude = promptNumber("Fallback latitude", config.latitude);
      const longitude = promptNumber("Fallback longitude", config.longitude);
      const displayMode = promptString("Display mode: current, day, or week", String(config.displayMode || ""));
      if (city !== undefined) config.city = city;
      if (latitude !== undefined) config.latitude = Math.max(-90, Math.min(90, latitude));
      if (longitude !== undefined) config.longitude = Math.max(-180, Math.min(180, longitude));
      if (["current", "day", "week"].includes(displayMode || "")) config.displayMode = displayMode;
    } else if (block.type === "search") {
      const provider = promptString("Search provider id, for example google, yandex, perplexity, duckduckgo", String(config.provider || ""));
      if (provider !== undefined) config.provider = provider;
    } else if (block.type === "googleCalendar") {
      const calendarId = promptString("Google Calendar ID", String(config.calendarId || "primary"));
      const maxResults = promptNumber("Max events", config.maxResults ?? 6);
      if (calendarId !== undefined) config.calendarId = calendarId || "primary";
      if (maxResults !== undefined) config.maxResults = Math.max(1, Math.min(25, Math.round(maxResults)));
    } else if (CLOCK_TYPES.has(block.type)) {
      const duration = promptNumber("Duration seconds for this block", config.durationSeconds);
      if (duration !== undefined) config.durationSeconds = Math.max(1, Math.min(86400, Math.round(duration)));
    } else if (block.type === "links" || block.type === "startPinned") {
      const columns = promptNumber("Columns", config.columns);
      const rows = promptNumber("Rows", config.rows);
      if (columns !== undefined) config.columns = Math.max(1, Math.min(12, Math.round(columns)));
      if (rows !== undefined) config.rows = Math.max(1, Math.min(8, Math.round(rows)));
    }

    await updateBlock(block.id, () => ({ ...block, config }));
    location.reload();
  }

  function optionSignature(settings) {
    const existing = enabledBlocks(settings).map((block) => block.type);
    return BLOCK_TYPES
      .filter(([type]) => !(SINGLETON_TYPES.has(type) && existing.includes(type)))
      .map(([type]) => type)
      .join("|");
  }

  function ensurePalette(settings) {
    const editing = document.body.classList.contains("layout-editing");
    let palette = document.getElementById("blockInstancePalette");
    if (!editing) {
      palette?.remove();
      return;
    }
    if (!palette) {
      palette = document.createElement("aside");
      palette.id = "blockInstancePalette";
      palette.className = "block-instance-palette";
      const label = document.createElement("label");
      label.textContent = "Add block";
      const select = document.createElement("select");
      select.id = "blockTypeToAdd";
      const add = document.createElement("button");
      add.type = "button";
      add.textContent = "+";
      add.addEventListener("click", () => void addBlock(select.value));
      label.append(select);
      palette.append(label, add);
      document.body.append(palette);
    }

    const select = palette.querySelector("select");
    if (!(select instanceof HTMLSelectElement)) return;
    const signature = optionSignature(settings);
    if (select.dataset.optionSignature === signature) return;
    select.dataset.optionSignature = signature;
    select.textContent = "";
    const existing = enabledBlocks(settings).map((block) => block.type);
    for (const [type, title] of BLOCK_TYPES) {
      if (SINGLETON_TYPES.has(type) && existing.includes(type)) continue;
      const option = document.createElement("option");
      option.value = type;
      option.textContent = title;
      select.append(option);
    }
  }

  function decorateCards(settings) {
    const editing = document.body.classList.contains("layout-editing");
    const blocks = assignCards(settings);
    ensurePalette(settings);
    cards().forEach((card, index) => {
      const block = blocks[index];
      const existing = card.querySelector(".block-instance-actions");
      if (!editing || !block) {
        existing?.remove();
        return;
      }
      if (existing instanceof HTMLElement && existing.dataset.blockId === block.id) return;
      existing?.remove();
      const actions = document.createElement("div");
      actions.className = "block-instance-actions";
      actions.dataset.blockId = block.id;
      const config = iconButton("⚙", "Configure block", () => void configureBlock(block));
      const duplicate = iconButton("⧉", "Duplicate block", () => void duplicateBlock(block));
      const remove = iconButton("×", "Remove block", () => void removeBlock(block.id));
      actions.append(config);
      if (!SINGLETON_TYPES.has(block.type)) actions.append(duplicate);
      actions.append(remove);
      card.append(actions);
    });
  }

  function iconButton(text, title, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      handler();
    });
    return button;
  }

  function blockConfig(block) {
    return isRecord(block.config) ? block.config : {};
  }

  function replaceBody(card, className) {
    const title = card.querySelector(".card__title")?.cloneNode(true);
    card.textContent = "";
    if (title) card.append(title);
    const body = document.createElement("div");
    body.className = className;
    card.append(body);
    return body;
  }

  function searchProvider(settings, block) {
    const config = blockConfig(block);
    const id = typeof config.provider === "string" && config.provider ? config.provider : settings.search.provider;
    const providers = Array.isArray(settings.search.providers) ? settings.search.providers : [];
    return providers.find((provider) => provider.id === id) || providers[0] || { urlTemplate: "https://www.google.com/search?q={query}" };
  }

  function patchSearch(settings, block, card) {
    if (card.dataset.instanceSearch === block.id) return;
    card.dataset.instanceSearch = block.id;
    const body = replaceBody(card, "search-instance");
    const form = document.createElement("form");
    form.className = "search";
    const input = document.createElement("input");
    input.className = "input";
    input.type = "search";
    input.placeholder = "Search";
    const button = document.createElement("button");
    button.className = "button";
    button.type = "submit";
    button.textContent = "Search";
    form.append(input, button);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = input.value.trim();
      if (!query) return;
      const provider = searchProvider(settings, block);
      location.href = provider.urlTemplate.replace("{query}", encodeURIComponent(query));
    });
    body.append(form);
  }

  function patchDateTime(settings, block, card) {
    const config = blockConfig(block);
    const time = card.querySelector(".date-time__time");
    const date = card.querySelector(".date-time__date");
    if (time) time.removeAttribute("id");
    if (date) date.removeAttribute("id");
    const mode = typeof config.mode === "string" ? config.mode : settings.dateTime?.mode || "both";
    const timeZone = typeof config.timeZone === "string" && config.timeZone ? config.timeZone : undefined;
    const fontSize = typeof config.fontSize === "number" ? config.fontSize : undefined;
    const now = new Date();
    if (time instanceof HTMLElement) {
      time.hidden = mode === "date";
      if (fontSize) time.style.fontSize = `${fontSize}px`;
      time.textContent = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone }).format(now);
    }
    if (date instanceof HTMLElement) {
      date.hidden = mode === "time";
      date.textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone }).format(now);
    }
  }

  function defaultClockDuration(settings, block) {
    const config = blockConfig(block);
    if (typeof config.durationSeconds === "number") return Math.max(1, config.durationSeconds) * 1000;
    if (block.type === "timer") return Math.max(1, settings.timers.timerSeconds || 300) * 1000;
    return Math.max(1, settings.timers.pomodoroWorkSeconds || 1500) * 1000;
  }

  async function patchClock(settings, block, card) {
    if (card.dataset.instanceClock === block.id) return;
    card.dataset.instanceClock = block.id;
    const body = replaceBody(card, "clock-instance");
    const value = document.createElement("div");
    value.className = "clock-value";
    value.dataset.clockBlockId = block.id;
    value.dataset.clockType = block.type;
    const actions = document.createElement("div");
    actions.className = "clock-actions";
    actions.append(
      clockButton("Start", () => startClock(settings, block)),
      clockButton("Pause", () => pauseClock(block)),
      clockButton("Reset", () => resetClock(settings, block)),
    );
    body.append(value, actions);
  }

  function clockButton(label, handler) {
    const button = document.createElement("button");
    button.className = "button";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => void handler());
    return button;
  }

  async function withState(mutator) {
    const state = await readInstanceState();
    await mutator(state);
    await writeInstanceState(state);
  }

  async function startClock(settings, block) {
    await withState((state) => {
      const clock = state.clocks[block.id] || { elapsedMs: 0, durationMs: defaultClockDuration(settings, block), phase: "work" };
      clock.running = true;
      clock.startedAt = Date.now();
      clock.durationMs = clock.durationMs || defaultClockDuration(settings, block);
      state.clocks[block.id] = clock;
    });
  }

  async function pauseClock(block) {
    await withState((state) => {
      const clock = state.clocks[block.id];
      if (!clock) return;
      clock.elapsedMs = elapsed(clock);
      clock.running = false;
      clock.startedAt = null;
    });
  }

  async function resetClock(settings, block) {
    await withState((state) => {
      state.clocks[block.id] = { running: false, startedAt: null, elapsedMs: 0, durationMs: defaultClockDuration(settings, block), phase: "work" };
    });
  }

  function elapsed(clock) {
    return clock.running && clock.startedAt ? Number(clock.elapsedMs || 0) + Date.now() - Number(clock.startedAt) : Number(clock.elapsedMs || 0);
  }

  function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  async function updateInstanceClocks(settings) {
    const state = await readInstanceState();
    let changed = false;
    for (const target of document.querySelectorAll("[data-clock-block-id]")) {
      const id = target.dataset.clockBlockId;
      const type = target.dataset.clockType;
      const block = enabledBlocks(settings).find((item) => item.id === id);
      if (!id || !block) continue;
      const clock = state.clocks[id] || { running: false, startedAt: null, elapsedMs: 0, durationMs: defaultClockDuration(settings, block), phase: "work" };
      const value = elapsed(clock);
      if (type === "stopwatch") {
        target.textContent = formatDuration(value);
        continue;
      }
      const remaining = Math.max(0, Number(clock.durationMs || defaultClockDuration(settings, block)) - value);
      target.textContent = type === "pomodoro" ? `${clock.phase === "break" ? "Break" : "Work"} ${formatDuration(remaining)}` : formatDuration(remaining);
      if (clock.running && remaining <= 0) {
        clock.running = false;
        clock.startedAt = null;
        clock.elapsedMs = type === "pomodoro" ? 0 : Number(clock.durationMs || 0);
        if (type === "pomodoro") {
          clock.phase = clock.phase === "break" ? "work" : "break";
          clock.durationMs = Math.max(1, clock.phase === "break" ? settings.timers.pomodoroBreakSeconds || 300 : settings.timers.pomodoroWorkSeconds || 1500) * 1000;
        }
        state.clocks[id] = clock;
        changed = true;
      }
    }
    if (changed) await writeInstanceState(state);
  }

  async function patchLocalTasks(block, card) {
    if (card.dataset.instanceTasks === block.id) return;
    card.dataset.instanceTasks = block.id;
    const body = replaceBody(card, "local-tasks-instance");
    const state = await readInstanceState();
    const tasks = Array.isArray(state.localTasks[block.id]) ? state.localTasks[block.id] : [];
    const form = document.createElement("form");
    form.className = "inline-form";
    const input = document.createElement("input");
    input.className = "input";
    input.placeholder = "Task";
    const add = document.createElement("button");
    add.className = "button";
    add.type = "submit";
    add.textContent = "+";
    form.append(input, add);
    const list = document.createElement("div");
    list.className = "task-list";
    for (const task of tasks.slice(0, 8)) {
      const label = document.createElement("label");
      label.className = "task-item";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = task.done === true;
      checkbox.addEventListener("change", () => void withState((next) => {
        const items = Array.isArray(next.localTasks[block.id]) ? next.localTasks[block.id] : [];
        const found = items.find((item) => item.id === task.id);
        if (found) found.done = checkbox.checked;
        next.localTasks[block.id] = items;
      }));
      label.append(checkbox, document.createTextNode(task.title));
      list.append(label);
    }
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      void withState((next) => {
        const items = Array.isArray(next.localTasks[block.id]) ? next.localTasks[block.id] : [];
        next.localTasks[block.id] = [{ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, title, done: false }, ...items];
      }).then(() => {
        card.dataset.instanceTasks = "";
        void patchLocalTasks(block, card);
      });
    });
    body.append(form, list);
  }

  async function patchWeather(settings, block, card) {
    const config = blockConfig(block);
    if (card.dataset.instanceWeather === block.id) return;
    card.dataset.instanceWeather = block.id;
    const body = replaceBody(card, "compact-list");
    body.textContent = "Weather loading";
    const city = typeof config.city === "string" && config.city ? config.city : settings.weather.city || "";
    const latitude = typeof config.latitude === "number" ? config.latitude : settings.weather.latitude;
    const longitude = typeof config.longitude === "number" ? config.longitude : settings.weather.longitude;
    const mode = typeof config.displayMode === "string" ? config.displayMode : settings.weather.displayMode || "current";
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      body.textContent = "Weather location is not configured";
      return;
    }
    try {
      const url = new URL(settings.weather.forecastEndpoint || "https://api.open-meteo.com/v1/forecast");
      url.searchParams.set("latitude", String(latitude));
      url.searchParams.set("longitude", String(longitude));
      url.searchParams.set("current", "temperature_2m,weather_code");
      url.searchParams.set("daily", "temperature_2m_max,temperature_2m_min");
      url.searchParams.set("timezone", "auto");
      url.searchParams.set("forecast_days", mode === "week" ? "7" : "1");
      const response = await fetch(url.toString(), { cache: "no-store" });
      if (!response.ok) throw new Error("weather failed");
      const data = await response.json();
      body.textContent = "";
      body.append(line(city));
      if (typeof data.current?.temperature_2m === "number") body.append(line(`${Math.round(data.current.temperature_2m)}°C`));
      if (mode !== "current") {
        const days = data.daily?.time || [];
        const max = data.daily?.temperature_2m_max || [];
        const min = data.daily?.temperature_2m_min || [];
        for (let index = 0; index < days.length; index += 1) body.append(line(`${days[index]} ${Math.round(max[index])}/${Math.round(min[index])}°C`));
      }
    } catch {
      body.textContent = "Weather unavailable";
    }
  }

  function line(text) {
    const element = document.createElement("div");
    element.className = "compact-list__item";
    element.textContent = text;
    return element;
  }

  async function applyRuntimeOverrides(settings) {
    const blocks = assignCards(settings);
    for (const block of blocks) {
      const card = blockCard(block);
      if (!card) continue;
      if (block.type === "dateTime") patchDateTime(settings, block, card);
      if (block.type === "search") patchSearch(settings, block, card);
      if (CLOCK_TYPES.has(block.type)) await patchClock(settings, block, card);
      if (block.type === "localTasks") await patchLocalTasks(block, card);
      if (block.type === "weather") await patchWeather(settings, block, card);
    }
    if (!ticking) {
      ticking = true;
      window.setInterval(() => void tick(), 1000);
    }
  }

  async function tick() {
    const settings = await readSettings();
    const blocks = assignCards(settings);
    for (const block of blocks) {
      const card = blockCard(block);
      if (card && block.type === "dateTime") patchDateTime(settings, block, card);
    }
    await updateInstanceClocks(settings);
  }

  function schedule() {
    if (applying) return;
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(async () => {
      if (applying) return;
      applying = true;
      try {
        const settings = await readSettings();
        decorateCards(settings);
        await applyRuntimeOverrides(settings);
      } finally {
        applying = false;
      }
    }, 80);
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  window.addEventListener("DOMContentLoaded", schedule);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes[SETTINGS_KEY]) schedule();
  });
  schedule();
})();
