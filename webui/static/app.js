const runButton = document.getElementById("run");
const targetsInput = document.getElementById("targets");
const modeSelect = document.getElementById("mode");
const statusEl = document.getElementById("status");
const elapsedEl = document.getElementById("elapsed");
const currentHostEl = document.getElementById("current-host");
const cancelButton = document.getElementById("cancel");
const summaryEl = document.getElementById("summary");
const tableBody = document.querySelector("#results-table tbody");
const colTarget = document.getElementById("col-target");
const colStatus = document.getElementById("col-status");
const colCode = document.getElementById("col-code");
const colLatency = document.getElementById("col-latency");
const colError = document.getElementById("col-error");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");
const overviewEmpty = document.getElementById("overview-empty");
const overviewGrid = document.getElementById("overview-grid");
const overviewPanel = document.getElementById("overview-panel");
const historyEmpty = document.getElementById("history-empty");
const sweepList = document.getElementById("sweep-list");
const healthList = document.getElementById("health-list");
const lastLoadedEl = document.getElementById("last-loaded");
const defaultHintEl = document.getElementById("default-hint");
const copyReportButton = document.getElementById("copy-report");

let activeSource = null;
let timerId = null;
let runId = null;

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = `status-pill ${kind}`.trim();
}

function renderSummary(summary) {
  if (modeSelect.value === "http") {
    summaryEl.textContent = `Checked ${summary.checked} | Up ${summary.reachable} | Down ${summary.failed}`;
  } else {
    summaryEl.textContent = `Checked ${summary.checked} | Reachable ${summary.reachable} | Failed ${summary.failed}`;
  }
}

function updateModeUI() {
  if (modeSelect.value === "http") {
    targetsInput.placeholder = "https://example.com\nstatus.example.com";
    colTarget.textContent = "URL";
    colStatus.textContent = "Status";
    colCode.textContent = "Code";
    colLatency.textContent = "Latency";
    colError.textContent = "Error";
  } else {
    targetsInput.placeholder = "1.1.1.1\nexample.com";
    colTarget.textContent = "Host";
    colStatus.textContent = "Status";
    colCode.textContent = "Loss";
    colLatency.textContent = "Avg ms";
    colError.textContent = "Error";
  }
  overviewPanel.classList.toggle("hidden", modeSelect.value !== "http");
}

function formatRelativeTime(isoString) {
  const time = Date.parse(isoString);
  if (Number.isNaN(time)) {
    return "unknown";
  }
  const delta = Math.max(0, Date.now() - time);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function resetResults() {
  tableBody.innerHTML = "";
  summaryEl.textContent = "";
  progressBar.style.width = "0%";
  progressText.textContent = "";
  elapsedEl.textContent = "0.0s";
  currentHostEl.textContent = "";
}

function renderDashboardEmpty() {
  historyEmpty.textContent = "Run a sweep to populate history.";
  sweepList.innerHTML = "";
  healthList.innerHTML = "";
}

function renderOverviewEmpty(message) {
  overviewEmpty.textContent = message;
  overviewEmpty.classList.remove("hidden");
  overviewGrid.innerHTML = "";
}

function overviewStatusClass(status) {
  if (status === "UP") return "ok";
  if (status === "DOWN") return "loss";
  if (status === "DEGRADED") return "pending";
  return "pending";
}

function buildSparkline(latencies, statusClass) {
  const width = 160;
  const height = 44;
  const padding = 4;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", `sparkline ${statusClass}`);
  svg.setAttribute("aria-hidden", "true");

  const values = latencies.filter((value) => typeof value === "number" && Number.isFinite(value));
  const hasValues = values.length > 0;
  const min = hasValues ? Math.min(...values) : 0;
  const max = hasValues ? Math.max(...values) : 0;
  const flatLine = !hasValues || min === max;
  const baseline = Math.round(height / 2);

  const scaleY = (value) => {
    if (flatLine) return baseline;
    const ratio = (value - min) / (max - min);
    return Math.round(height - padding - ratio * (height - padding * 2));
  };

  const pointsTotal = latencies.length;
  const step = pointsTotal > 1 ? width / (pointsTotal - 1) : 0;
  const segments = [];
  let current = [];

  latencies.forEach((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      if (current.length) {
        segments.push(current);
        current = [];
      }
      return;
    }
    const x = pointsTotal > 1 ? index * step : width / 2;
    const y = scaleY(value);
    current.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  });

  if (current.length) {
    segments.push(current);
  }

  if (segments.length === 0) {
    segments.push([`0,${baseline}`, `${width},${baseline}`]);
  }

  segments.forEach((points) => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", points.join(" "));
    svg.appendChild(line);
  });

  return svg;
}

function renderOverview(services) {
  overviewGrid.innerHTML = "";
  services.forEach((service) => {
    const card = document.createElement("div");
    card.className = "overview-card";

    const header = document.createElement("div");
    header.className = "overview-header-row";

    const name = document.createElement("div");
    name.className = "overview-service";
    name.textContent = service.service;

    const statusWrap = document.createElement("div");
    statusWrap.className = "overview-status";
    const statusLabel = service.latest_status || "UNKNOWN";
    const statusClass = overviewStatusClass(statusLabel);

    const dot = document.createElement("span");
    dot.className = `status-dot ${statusClass}`;

    const pill = document.createElement("span");
    pill.className = `pill ${statusClass} tiny`;
    pill.textContent = statusLabel;

    statusWrap.appendChild(dot);
    statusWrap.appendChild(pill);
    header.appendChild(name);
    header.appendChild(statusWrap);

    const latencies = Array.isArray(service.latencies) ? service.latencies : [];
    const sparkline = buildSparkline(latencies, statusClass);

    const avgLatency = service.avg_latency_ms === null || service.avg_latency_ms === undefined
      ? "NA"
      : String(service.avg_latency_ms);
    const meta = document.createElement("div");
    meta.className = "overview-meta";
    meta.textContent = `${service.uptime_pct}% uptime • avg ${avgLatency} ms`;

    const time = document.createElement("div");
    time.className = "overview-time";
    if (service.last_checked_at) {
      time.textContent = `Last checked ${formatRelativeTime(service.last_checked_at)} ago`;
    } else {
      time.textContent = "Last checked unknown";
    }

    card.appendChild(header);
    card.appendChild(sparkline);
    card.appendChild(meta);
    card.appendChild(time);
    overviewGrid.appendChild(card);
  });
}

function formatLoss(loss) {
  if (loss === null || loss === undefined) {
    return "NA";
  }
  return `${loss}%`;
}

function formatAvg(avg) {
  if (avg === null || avg === undefined) {
    return "NA";
  }
  return String(avg);
}

function updateRow(row) {
  const mode = modeSelect.value;
  let target = "";
  let statusLabel = "";
  let statusClass = "";
  let code = "-";
  let latency = "-";
  let error = "-";

  if (mode === "http") {
    target = row.url;
    const latencyMs = row.latency_ms ?? null;
    const isOk = Boolean(row.ok);
    if (isOk && latencyMs !== null && latencyMs >= 1000) {
      statusLabel = "DEGRADED";
      statusClass = "pending";
    } else if (isOk) {
      statusLabel = "UP";
      statusClass = "ok";
    } else {
      statusLabel = "DOWN";
      statusClass = "loss";
    }
    code = row.status_code === null || row.status_code === undefined ? "-" : String(row.status_code);
    latency = row.latency_ms === null || row.latency_ms === undefined ? "-" : `${row.latency_ms} ms`;
    error = row.error || "-";
  } else {
    target = row.host;
    const loss = formatLoss(row.loss);
    latency = `${formatAvg(row.avg_ms)} ms`;
    code = loss;
    error = "-";
    if (row.status === "OK") {
      statusLabel = "OK";
      statusClass = "ok";
    } else {
      statusLabel = "LOSS";
      statusClass = "loss";
    }
  }

  let tr = tableBody.querySelector(`tr[data-target="${CSS.escape(target)}"]`);
  if (!tr) {
    tr = document.createElement("tr");
    tr.dataset.target = target;
    ["target", "status", "code", "latency", "error"].forEach(() => {
      tr.appendChild(document.createElement("td"));
    });
    tableBody.appendChild(tr);
  }

  const cells = tr.querySelectorAll("td");
  cells[0].textContent = target;
  cells[1].innerHTML = "";
  const pill = document.createElement("span");
  pill.className = `pill ${statusClass}`;
  pill.textContent = statusLabel;
  if (statusLabel === "UP") pill.textContent = "✓ UP";
  if (statusLabel === "DOWN") pill.textContent = "✕ DOWN";
  if (statusLabel === "DEGRADED") pill.textContent = "△ DEGRADED";
  cells[1].appendChild(pill);
  cells[2].textContent = code;
  cells[3].textContent = latency;
  cells[4].textContent = error;

  tr.classList.toggle("ok", statusClass === "ok");
  tr.classList.toggle("loss", statusClass === "loss");
}

function updatePendingRow(target) {
  let tr = tableBody.querySelector(`tr[data-target="${CSS.escape(target)}"]`);
  if (!tr) {
    tr = document.createElement("tr");
    tr.dataset.target = target;
    ["target", "status", "code", "latency", "error"].forEach(() => {
      tr.appendChild(document.createElement("td"));
    });
    tableBody.appendChild(tr);
  }

  const cells = tr.querySelectorAll("td");
  cells[0].textContent = target;
  cells[1].innerHTML = "";
  const pill = document.createElement("span");
  pill.className = "pill pending";
  pill.textContent = "… PENDING";
  cells[1].appendChild(pill);
  cells[2].textContent = "-";
  cells[3].textContent = "-";
  cells[4].textContent = "-";
}

function renderSweeps(sweeps) {
  sweepList.innerHTML = "";
  if (!sweeps.length) {
    const item = document.createElement("div");
    item.className = "history-meta";
    item.textContent = "No sweeps yet.";
    sweepList.appendChild(item);
    return;
  }
  sweeps.forEach((sweep) => {
    const item = document.createElement("div");
    item.className = "history-item";
    const title = document.createElement("h4");
    title.textContent = `${formatRelativeTime(sweep.ts)} · ${sweep.checked} checked`;
    const meta = document.createElement("div");
    meta.className = "history-meta";
    meta.textContent = `Up ${sweep.up} · Down ${sweep.down} · ${sweep.duration_ms} ms`;
    item.appendChild(title);
    item.appendChild(meta);
    sweepList.appendChild(item);
  });
}

function renderHealth(services) {
  healthList.innerHTML = "";
  if (!services.length) {
    const item = document.createElement("div");
    item.className = "history-meta";
    item.textContent = "No services yet.";
    healthList.appendChild(item);
    return;
  }
  services.forEach((service) => {
    const item = document.createElement("div");
    item.className = "history-item health-card";

    const header = document.createElement("div");
    header.className = "health-header";

    const title = document.createElement("h4");
    title.className = "health-title";
    title.textContent = service.url;

    const status = document.createElement("span");
    const statusLabel = service.last_status || "UNKNOWN";
    let statusClass = "pill pending";
    if (statusLabel === "UP") statusClass = "pill ok";
    if (statusLabel === "DOWN") statusClass = "pill loss";
    status.className = `${statusClass} health-status`;
    status.textContent = statusLabel;

    header.appendChild(title);
    header.appendChild(status);

    const meta = document.createElement("div");
    meta.className = "history-meta health-meta";
    const avgLatency = service.avg_latency_ms === null ? "NA" : `${service.avg_latency_ms} ms`;
    meta.textContent = `${service.uptime_pct}% uptime · Avg ${avgLatency}`;

    item.appendChild(header);
    item.appendChild(meta);

    if (service.last_statuses && service.last_statuses.length) {
      const row = document.createElement("div");
      row.className = "history-status-row";
      service.last_statuses.forEach((statusValue) => {
        const pill = document.createElement("span");
        let className = "pill loss tiny";
        if (statusValue === "UP") className = "pill ok tiny";
        if (statusValue === "DEGRADED") className = "pill pending tiny";
        pill.className = className;
        pill.textContent = statusValue;
        row.appendChild(pill);
      });
      item.appendChild(row);
    }

    healthList.appendChild(item);
  });
}

async function refreshOverview() {
  if (modeSelect.value !== "http") {
    renderOverviewEmpty("Switch to HTTP mode to view overview.");
    return;
  }
  try {
    const response = await fetch("/api/http/overview?limit=10");
    const data = await response.json();
    if (!response.ok) {
      throw new Error("Failed to load overview");
    }
    const services = data.services || [];
    if (!services.length) {
      renderOverviewEmpty("Run a sweep to populate overview.");
      return;
    }
    overviewEmpty.textContent = "";
    overviewEmpty.classList.add("hidden");
    renderOverview(services);
  } catch (error) {
    renderOverviewEmpty("Overview unavailable.");
  }
}

async function refreshDashboard() {
  if (modeSelect.value !== "http") {
    renderDashboardEmpty();
    renderOverviewEmpty("Switch to HTTP mode to view overview.");
    return;
  }
  refreshOverview();
  try {
    const [sweepsResponse, healthResponse] = await Promise.all([
      fetch("/api/http/sweeps?limit=10"),
      fetch("/api/http/health?limit_sweeps=10"),
    ]);
    const sweepsData = await sweepsResponse.json();
    const healthData = await healthResponse.json();
    if (!sweepsResponse.ok || !healthResponse.ok) {
      throw new Error("Failed to load dashboard");
    }
    const sweeps = sweepsData.sweeps || [];
    const services = healthData.services || [];
    if (!sweeps.length && !services.length) {
      renderDashboardEmpty();
      return;
    }
    historyEmpty.textContent = "";
    renderSweeps(sweeps);
    renderHealth(services);
  } catch (error) {
    renderDashboardEmpty();
  }
}

async function loadLastInputs() {
  try {
    const response = await fetch("/api/last-inputs");
    const data = await response.json();
    if (!response.ok) {
      throw new Error("Failed to load last inputs");
    }
    if (data.mode) {
      modeSelect.value = data.mode;
      updateModeUI();
    }
    if (typeof data.targets === "string") {
      targetsInput.value = data.targets;
    }
    if (data.targets && data.ts) {
      lastLoadedEl.textContent = `Loaded last targets from ${formatRelativeTime(data.ts)}.`;
      defaultHintEl.textContent = "";
    } else {
      lastLoadedEl.textContent = "";
    }
  } catch (error) {
    lastLoadedEl.textContent = "";
  }
}

async function loadDefaultServices() {
  try {
    const response = await fetch("/api/services?limit=10");
    const data = await response.json();
    if (!response.ok) {
      throw new Error("Failed to load services");
    }
    if (targetsInput.value.trim().length > 0) {
      return;
    }
    const services = data.services || [];
    if (services.length === 0) {
      return;
    }
    const urls = services.map((service) => service.url).filter(Boolean);
    if (urls.length) {
      modeSelect.value = "http";
      updateModeUI();
      targetsInput.value = urls.join("\n");
      defaultHintEl.textContent = "Default top sites loaded — edit this list anytime.";
    }
  } catch (error) {
    defaultHintEl.textContent = "";
  }
}

async function initializeInputs() {
  await loadLastInputs();
  await loadDefaultServices();
}

function buildReportText() {
  const rows = Array.from(tableBody.querySelectorAll("tr"));
  if (!rows.length) {
    return "";
  }
  const header = modeSelect.value === "http"
    ? "URL\tSTATUS\tCODE\tLATENCY\tERROR"
    : "HOST\tSTATUS\tLOSS\tLATENCY\tERROR";
  const lines = rows.map((row) => {
    const cells = Array.from(row.querySelectorAll("td")).map((cell) =>
      cell.textContent.trim().replace(/\s+/g, " ")
    );
    return cells.join("\t");
  });
  return [header, ...lines].join("\n");
}

async function copyReport() {
  const report = buildReportText();
  if (!report) {
    setStatus("Nothing to copy", "neutral");
    return;
  }
  try {
    await navigator.clipboard.writeText(report);
    setStatus("Report copied", "ok");
  } catch (error) {
    setStatus("Copy failed", "error");
  }
}

function closeActiveSource() {
  if (activeSource) {
    activeSource.close();
    activeSource = null;
  }
}

function stopTimer() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
}

function startTimer(startTime) {
  stopTimer();
  timerId = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    elapsedEl.textContent = `${elapsed.toFixed(1)}s`;
  }, 100);
}

function runSweep() {
  const targets = targetsInput.value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (targets.length === 0) {
    setStatus("Enter at least one target.", "error");
    return;
  }

  closeActiveSource();
  stopTimer();
  resetResults();
  runId = null;

  const totalTargets = targets.length;
  let received = 0;
  let reachable = 0;
  let failed = 0;

  setStatus("Running...", "busy");
  runButton.disabled = true;
  cancelButton.classList.remove("hidden");
  progressText.textContent = `0 / ${totalTargets} completed`;

  const params = new URLSearchParams({
    [modeSelect.value === "http" ? "urls" : "targets"]: targets.join("\n"),
  });
  const endpoint = modeSelect.value === "http" ? "/api/http/run" : "/api/run/stream";
  const source = new EventSource(`${endpoint}?${params.toString()}`);
  activeSource = source;
  startTimer(Date.now());

  source.addEventListener("progress", (event) => {
    const payload = JSON.parse(event.data);
    if (!runId && payload.run_id) {
      runId = payload.run_id;
    }
    currentHostEl.textContent = payload.current ? `Now: ${payload.current}` : "";
    updatePendingRow(payload.current);
    progressText.textContent = `${received} / ${payload.total} completed`;
  });

  source.addEventListener("result", (event) => {
    const payload = JSON.parse(event.data);
    updateRow(payload);

    received += 1;
    if (modeSelect.value === "http") {
      if (payload.ok) {
        reachable += 1;
      } else {
        failed += 1;
      }
    } else if (payload.status === "OK") {
      reachable += 1;
    } else {
      failed += 1;
    }

    const percent = Math.round((received / totalTargets) * 100);
    progressBar.style.width = `${percent}%`;
    progressText.textContent = `${received} / ${totalTargets} completed`;
    renderSummary({ checked: received, reachable, failed });
  });

  source.addEventListener("done", (event) => {
    const payload = JSON.parse(event.data);
    renderSummary(payload);
    progressBar.style.width = "100%";
    progressText.textContent = `${payload.checked} / ${payload.checked} completed`;
    setStatus("Done", "ok");
    currentHostEl.textContent = "";
    closeActiveSource();
    stopTimer();
    runButton.disabled = false;
    cancelButton.classList.add("hidden");
    refreshDashboard();
  });

  source.addEventListener("error", (event) => {
    let message = "Streaming error";
    if (event.data) {
      try {
        const payload = JSON.parse(event.data);
        message = payload.message || message;
      } catch (err) {
        message = event.data;
      }
    }
    if (message === "Cancelled") {
      setStatus("Cancelled", "cancelled");
    } else {
      setStatus("Error", "error");
    }
    currentHostEl.textContent = "";
    closeActiveSource();
    stopTimer();
    runButton.disabled = false;
    cancelButton.classList.add("hidden");
  });
}

async function cancelRun() {
  if (!runId) {
    setStatus("Error", "error");
    return;
  }
  try {
    await fetch("/api/run/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: runId }),
    });
  } catch (error) {
    setStatus("Error", "error");
  }
}

runButton.addEventListener("click", runSweep);
cancelButton.addEventListener("click", cancelRun);
copyReportButton.addEventListener("click", copyReport);
modeSelect.addEventListener("change", () => {
  updateModeUI();
  resetResults();
  setStatus("Idle", "neutral");
  refreshDashboard();
});

updateModeUI();
refreshDashboard();
initializeInputs();
