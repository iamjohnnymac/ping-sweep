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
}

function resetResults() {
  tableBody.innerHTML = "";
  summaryEl.textContent = "";
  progressBar.style.width = "0%";
  progressText.textContent = "";
  elapsedEl.textContent = "0.0s";
  currentHostEl.textContent = "";
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
  pill.textContent = "PENDING";
  cells[1].appendChild(pill);
  cells[2].textContent = "-";
  cells[3].textContent = "-";
  cells[4].textContent = "-";
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
modeSelect.addEventListener("change", () => {
  updateModeUI();
  resetResults();
  setStatus("Idle", "neutral");
});

updateModeUI();
