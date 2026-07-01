const stateColors = {
  ACC: "#38d6c4",
  ADD: "#70e06f",
  REPAIR: "#66a8ff",
  WATCH: "#f1b84b",
  TRIM: "#ff667a",
  "NO ADD": "#a8b0b9",
  WAIT: "#9facb7"
};

const severityOrder = {
  ADD: 0,
  REPAIR: 1,
  ACC: 2,
  TRIM: 3,
  "NO ADD": 4,
  WATCH: 5,
  WAIT: 6
};

const app = {
  data: null,
  activeFilter: "ALL",
  activeSectorFilter: "ALL",
  alertIndex: 0,
  popupEvents: [],
  autoRefreshHandle: null
};

const $ = (id) => document.getElementById(id);

function isStaticMode() {
  return Boolean(window.AI_MOONSHOT_STATIC_DATA);
}

function fmt(value, digits = 1) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? "n/a" : Number(value).toFixed(digits);
}

function pct(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? "n/a" : `${Number(value).toFixed(1)}%`;
}

function stateClass(state) {
  return `state-${state.replaceAll(" ", "-")}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function tradingViewUrl(ticker) {
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(String(ticker ?? "").trim())}`;
}

function tickerLink(ticker, className = "ticker-link") {
  const safeTicker = escapeHtml(ticker);
  return `<a class="${className}" href="${tradingViewUrl(ticker)}" target="_blank" rel="noopener noreferrer" title="Open ${safeTicker} in TradingView">${safeTicker}</a>`;
}

async function runScan(force = false) {
  if (isStaticMode()) {
    showToast("Static dashboard", "Run update_static_dashboard.bat to refresh the report, then reload this file.", "WATCH");
    return;
  }
  setLoading(true);
  try {
    const response = await fetch(`/api/scan${force ? "?force=1" : ""}`, { cache: "no-store" });
    const payload = await response.json();
    if (payload.scan_status === "scan_in_progress" && !(payload.daily_states || []).length) {
      showToast("Scan already running", "The dashboard will keep showing the latest cached report while the current scan finishes.", "WATCH");
      return;
    }
    if (!response.ok || (payload.error && !(payload.daily_states || []).length)) {
      throw new Error(payload.error || `Scan failed with HTTP ${response.status}`);
    }
    app.data = payload;
    render(payload);
    handlePopups(payload.all_events || []);
  } catch (error) {
    showToast("Scan failed", error.message, "TRIM");
  } finally {
    setLoading(false);
  }
}

async function loadLastReport() {
  if (isStaticMode()) {
    const payload = window.AI_MOONSHOT_STATIC_DATA;
    if (!(payload?.daily_states || []).length) {
      return false;
    }
    app.data = payload;
    render(payload);
    handlePopups(payload.all_events || []);
    return true;
  }
  try {
    const response = await fetch("/api/last-report", { cache: "no-store" });
    if (!response.ok) {
      return false;
    }
    const payload = await response.json();
    if (!(payload.daily_states || []).length) {
      return false;
    }
    app.data = payload;
    render(payload);
    handlePopups(payload.all_events || []);
    return true;
  } catch {
    return false;
  }
}

function setLoading(isLoading) {
  const button = $("refreshButton");
  button.disabled = isLoading;
  if (isStaticMode()) {
    button.disabled = false;
    button.textContent = "Static Report";
    return;
  }
  button.textContent = isLoading ? "Scanning..." : "Run Scan";
}

function render(data) {
  const source = isStaticMode() ? "Static report" : data.scan_status === "cached" ? "Cached report" : data.scan_status === "scan_in_progress" ? "Scan running; showing cache" : "Updated";
  $("lastUpdated").textContent = `${source} ${new Date(data.generated_at).toLocaleString()}`;
  $("marketStatus").textContent = `${data.total_action_events} action signal${data.total_action_events === 1 ? "" : "s"} ready`;
  $("heroTitle").textContent = data.total_action_events ? "Fresh signals on deck." : "No action alerts. Let the winners breathe.";
  $("heroText").textContent = data.total_action_events
    ? "Review the alert cards, confirm the chart manually, then decide whether a tranche, trim, or thesis review is warranted."
    : "The scanner found no fresh ACC, ADD, REPAIR, major TRIM, or major NO ADD events. WATCH states stay visible in the table without yelling.";
  renderMetrics(data);
  renderAlerts(data.all_events || []);
  renderLegend(data.explanations || {});
  renderTables(data);
  renderFilters(data.daily_states || []);
  renderSectorFilters(data.daily_states || []);
  renderSectorSummary(data);
  renderRiskMap(data.daily_states || []);
  renderSector(data.daily_states || []);
  scheduleAutoRefresh(data.dashboard_settings?.auto_refresh_minutes || 60);
}

function scheduleAutoRefresh(minutes) {
  if (isStaticMode()) {
    return;
  }
  const intervalMinutes = Math.max(15, Number(minutes) || 60);
  if (app.autoRefreshHandle) {
    clearInterval(app.autoRefreshHandle);
  }
  app.autoRefreshHandle = setInterval(() => runScan(false), intervalMinutes * 60 * 1000);
}

function renderMetrics(data) {
  const counts = data.state_counts || {};
  const metrics = [
    ["Action Alerts", data.total_action_events, "ACC, ADD, REPAIR, major TRIM, major NO ADD"],
    ["Universe", data.daily_states?.length || 0, "Daily tickers scanned across all priority sectors"],
    ["Sectors", Object.keys(data.sector_counts || {}).length, "Personal priority buckets tracked"],
    ["ACC / ADD", (counts.ACC || 0) + (counts.ADD || 0), "Daily entry or add candidates"],
  ];
  $("metricGrid").innerHTML = metrics.map(([label, value, detail]) => `
    <div class="metric">
      <strong>${value}</strong>
      <span>${label}</span>
      <p class="small-muted">${detail}</p>
    </div>
  `).join("");
}

function renderAlerts(events) {
  const container = $("alerts");
  if (!events.length) {
    container.innerHTML = `<div class="empty-state">No action-worthy alerts right now. The dashboard is still watching daily and weekly states in the tables below.</div>`;
    return;
  }
  container.innerHTML = events.map((event, index) => `
    <article class="alert-card" style="border-left-color:${stateColors[event.signal] || stateColors.WAIT}">
      <div>
        <h3><span class="${stateClass(event.signal)}">${tickerLink(event.ticker, "ticker-link alert-ticker")} ${event.signal}</span> <span class="small-muted">${event.timeframe} | ${event.signal_date}</span></h3>
        <p>${event.sector} | ${event.asset_type}</p>
        <p>${event.reason}</p>
      </div>
      <button class="ghost-button" type="button" data-alert-index="${index}">Open Details</button>
    </article>
  `).join("");
  container.querySelectorAll("[data-alert-index]").forEach((button) => {
    button.addEventListener("click", () => openDialog(Number(button.dataset.alertIndex)));
  });
}

function renderLegend(explanations) {
  const order = ["ACC", "ADD", "REPAIR", "WATCH", "TRIM", "NO ADD", "WAIT"];
  $("signalLegend").innerHTML = order.map((signal) => `
    <div class="legend-item">
      <strong class="${stateClass(signal)}">${signal}</strong>
      <p>${explanations[signal] || ""}</p>
    </div>
  `).join("");
}

function renderFilters(states) {
  const counts = states.reduce((acc, item) => {
    acc[item.state] = (acc[item.state] || 0) + 1;
    return acc;
  }, {});
  const filters = ["ALL", "ACC", "ADD", "REPAIR", "WATCH", "TRIM", "NO ADD", "WAIT"];
  $("filters").innerHTML = filters.map((filter) => {
    const count = filter === "ALL" ? states.length : (counts[filter] || 0);
    const active = app.activeFilter === filter ? "border-color:rgba(255,255,255,0.42);background:rgba(255,255,255,0.12)" : "";
    return `<button class="filter-button" style="${active}" type="button" data-filter="${filter}">${filter} ${count}</button>`;
  }).join("");
  $("filters").querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      app.activeFilter = button.dataset.filter;
      renderTables(app.data);
      renderFilters(app.data.daily_states || []);
    });
  });
}

function renderSectorFilters(states) {
  const sectors = states.reduce((acc, item) => {
    acc[item.sector] = (acc[item.sector] || 0) + 1;
    return acc;
  }, {});
  const filters = ["ALL", ...Object.keys(sectors).sort()];
  $("sectorFilters").innerHTML = filters.map((filter) => {
    const count = filter === "ALL" ? states.length : sectors[filter];
    const active = app.activeSectorFilter === filter ? "border-color:rgba(255,255,255,0.42);background:rgba(255,255,255,0.12)" : "";
    return `<button class="filter-button sector-chip" style="${active}" type="button" data-sector-filter="${filter}">${filter} ${count}</button>`;
  }).join("");
  $("sectorFilters").querySelectorAll("[data-sector-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      app.activeSectorFilter = button.dataset.sectorFilter;
      renderTables(app.data);
      renderSectorFilters(app.data.daily_states || []);
    });
  });
}

function renderSectorSummary(data) {
  const sectorCounts = data.sector_counts || {};
  const sectorStateCounts = data.sector_state_counts || {};
  $("sectorSummary").innerHTML = Object.keys(sectorCounts).sort().map((sector) => {
    const states = sectorStateCounts[sector] || {};
    const actionish = (states.ACC || 0) + (states.ADD || 0) + (states.REPAIR || 0);
    const heat = states.TRIM || 0;
    return `
      <div class="sector-card">
        <strong>${sector}</strong>
        <span>${sectorCounts[sector]} tickers</span>
        <p><b>${actionish}</b> accumulation/add candidates | <b>${heat}</b> overheated</p>
      </div>
    `;
  }).join("");
}

function sortedStates(states) {
  return [...states].sort((a, b) => {
    const rank = (severityOrder[a.state] ?? 9) - (severityOrder[b.state] ?? 9);
    return rank || a.ticker.localeCompare(b.ticker);
  });
}

function renderTables(data) {
  let daily = sortedStates(data.daily_states || []);
  if (app.activeFilter !== "ALL") {
    daily = daily.filter((item) => item.state === app.activeFilter);
  }
  if (app.activeSectorFilter !== "ALL") {
    daily = daily.filter((item) => item.sector === app.activeSectorFilter);
  }
  renderTable("dailyTable", daily);
  let weekly = sortedStates(data.weekly_states || []);
  if (app.activeSectorFilter !== "ALL") {
    weekly = weekly.filter((item) => item.sector === app.activeSectorFilter);
  }
  renderTable("weeklyTable", weekly);
}

function renderTable(id, rows) {
  const target = $(id);
  target.innerHTML = rows.map((row) => `
    <tr>
      <td><strong>${tickerLink(row.ticker)}</strong></td>
      <td>${row.sector}</td>
      <td>${row.asset_type}</td>
      <td><span class="state-pill ${stateClass(row.state)}" style="border-color:${stateColors[row.state] || stateColors.WAIT}">${row.state}</span></td>
      <td>${fmt(row.close, 2)}</td>
      <td>${fmt(row.rsi)}</td>
      <td>${pct(row.pullback_pct)}</td>
      <td>${pct(row.extension_50_pct)}</td>
      <td>${row.sector_context}</td>
    </tr>
  `).join("");
}

function renderSector(states) {
  const sector = states[0]?.sector_context || "--";
  $("sectorTitle").textContent = sector;
  $("sectorText").textContent = sector === "Supportive"
    ? "SMH and QQQM context are constructive. Entry-style alerts are allowed through the context gate."
    : "Sector context is mixed or unavailable. Treat entry signals with extra scrutiny and confirm on the chart.";
}

function renderRiskMap(states) {
  const svg = $("riskMap");
  const width = 720;
  const height = 320;
  const pad = 42;
  const maxPullback = 70;
  const minExt = -30;
  const maxExt = 90;
  const plotX = (pullback) => pad + Math.max(0, Math.min(maxPullback, pullback || 0)) / maxPullback * (width - pad * 2);
  const plotY = (ext) => height - pad - (Math.max(minExt, Math.min(maxExt, ext || 0)) - minExt) / (maxExt - minExt) * (height - pad * 2);
  const grid = [0, 25, 50, 70].map((x) => `<line x1="${plotX(x)}" y1="${pad}" x2="${plotX(x)}" y2="${height - pad}" stroke="rgba(255,255,255,0.09)" />`).join("")
    + [-30, 0, 30, 60, 90].map((y) => `<line x1="${pad}" y1="${plotY(y)}" x2="${width - pad}" y2="${plotY(y)}" stroke="rgba(255,255,255,0.09)" />`).join("");
  const dots = states.map((item) => {
    const x = plotX(item.pullback_pct);
    const y = plotY(item.extension_50_pct);
    const color = stateColors[item.state] || stateColors.WAIT;
    const title = escapeHtml(`${item.ticker} ${item.state}: ${item.sector}, pullback ${pct(item.pullback_pct)}, ext50 ${pct(item.extension_50_pct)}`);
    const ticker = escapeHtml(item.ticker);
    return `<a class="map-ticker-link" href="${tradingViewUrl(item.ticker)}" target="_blank" rel="noopener noreferrer"><g tabindex="0"><circle cx="${x}" cy="${y}" r="7" fill="${color}" opacity="0.86"><title>${title}</title></circle><text x="${x + 10}" y="${y + 4}" fill="#eef4f8" font-size="11">${ticker}</text></g></a>`;
  }).join("");
  svg.innerHTML = `
    <rect x="0" y="0" width="${width}" height="${height}" fill="transparent" />
    ${grid}
    <text x="${pad}" y="24" fill="#9facb7" font-size="12">Extension vs 50 SMA</text>
    <text x="${width - 180}" y="${height - 12}" fill="#9facb7" font-size="12">Pullback from high</text>
    ${dots}
  `;
}

function handlePopups(events) {
  const seen = new Set(JSON.parse(localStorage.getItem("aiMoonshotSeenEvents") || "[]"));
  const fresh = events.filter((event) => !seen.has(event.event_id));
  app.popupEvents = events;
  if (!fresh.length) {
    return;
  }
  fresh.forEach((event) => {
    showToast(`${event.ticker} ${event.signal}`, event.suggested_action, event.signal);
    maybeNotify(event);
  });
  app.alertIndex = events.findIndex((event) => event.event_id === fresh[0].event_id);
  openDialog(app.alertIndex);
}

function showToast(title, detail, signal = "ACC") {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.style.borderLeftColor = stateColors[signal] || stateColors.WAIT;
  toast.innerHTML = `<strong>${title}</strong><p class="small-muted">${detail}</p>`;
  $("toastStack").appendChild(toast);
  setTimeout(() => toast.remove(), 9000);
}

function maybeNotify(event) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  new Notification(`AI Moonshot Alert: ${event.ticker} ${event.signal}`, {
    body: `${event.timeframe} | ${event.suggested_action}`,
    tag: event.event_id
  });
}

function openDialog(index) {
  const events = app.data?.all_events || [];
  if (!events.length || index < 0) {
    return;
  }
  app.alertIndex = index % events.length;
  const event = events[app.alertIndex];
  $("dialogTitle").textContent = `${event.ticker} ${event.signal}`;
  $("dialogBody").innerHTML = [
    ["Ticker", tickerLink(event.ticker, "ticker-link detail-ticker")],
    ["Priority sector", event.sector],
    ["Type", event.asset_type],
    ["Signal", event.signal],
    ["Timeframe", event.timeframe],
    ["Signal date", event.signal_date],
    ["Close", fmt(event.close, 2)],
    ["RSI", fmt(event.rsi)],
    ["Pullback", pct(event.pullback_pct)],
    ["Ext vs 50 SMA", pct(event.extension_50_pct)],
    ["Market context", event.sector_context],
    ["Reason", event.reason],
    ["Suggested action", event.suggested_action],
    ["Reminder", "Decision support only. Verify the chart manually before placing any order."]
  ].map(([label, value]) => `<div class="detail-line"><span>${label}</span><strong>${value}</strong></div>`).join("");
  const dialog = $("alertDialog");
  if (!dialog.open) {
    dialog.showModal();
  }
}

function markCurrentReviewed() {
  const events = app.data?.all_events || [];
  const event = events[app.alertIndex];
  if (!event) {
    return;
  }
  const seen = new Set(JSON.parse(localStorage.getItem("aiMoonshotSeenEvents") || "[]"));
  seen.add(event.event_id);
  localStorage.setItem("aiMoonshotSeenEvents", JSON.stringify([...seen]));
  showToast("Reviewed", `${event.ticker} ${event.signal} will not auto-popup again.`, event.signal);
}

function setupEvents() {
  $("refreshButton").addEventListener("click", () => runScan(true));
  $("notifyButton").addEventListener("click", async () => {
    if (!("Notification" in window)) {
      showToast("Browser popups unavailable", "This browser does not support desktop notifications.", "WATCH");
      return;
    }
    const permission = await Notification.requestPermission();
    showToast("Popup permission", permission, permission === "granted" ? "ADD" : "WATCH");
  });
  $("closeDialog").addEventListener("click", () => $("alertDialog").close());
  $("reviewedButton").addEventListener("click", markCurrentReviewed);
  $("nextAlertButton").addEventListener("click", () => openDialog(app.alertIndex + 1));
}

function startStarfield() {
  const canvas = $("starfield");
  const ctx = canvas.getContext("2d");
  let stars = [];
  let animationFrame = null;
  let lastFrame = 0;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function resize() {
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
    canvas.width = Math.floor(window.innerWidth * pixelRatio);
    canvas.height = Math.floor(window.innerHeight * pixelRatio);
    stars = Array.from({ length: reduceMotion ? 36 : 72 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      z: 0.4 + Math.random() * 1.6,
      a: 0.25 + Math.random() * 0.65
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const star of stars) {
      if (!reduceMotion) {
        star.x += star.z * 0.12;
      }
      if (star.x > canvas.width) star.x = 0;
      ctx.fillStyle = `rgba(238,244,248,${star.a})`;
      ctx.fillRect(star.x, star.y, star.z, star.z);
    }
  }

  function frame(timestamp) {
    if (document.hidden) {
      animationFrame = requestAnimationFrame(frame);
      return;
    }
    if (timestamp - lastFrame >= 33) {
      draw();
      lastFrame = timestamp;
    }
    animationFrame = requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  resize();
  draw();
  if (!reduceMotion) {
    animationFrame = requestAnimationFrame(frame);
  }
  window.addEventListener("beforeunload", () => {
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
    }
  });
}

async function boot() {
  const loaded = await loadLastReport();
  if (isStaticMode()) {
    if (!loaded) {
      showToast("No static report", "Run update_static_dashboard.bat to generate report-data.js.", "TRIM");
    }
    setLoading(false);
    return;
  }
  if (!loaded) {
    await runScan(false);
    return;
  }
  runScan(false);
}

setupEvents();
startStarfield();
boot();
