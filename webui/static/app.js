const runButton = document.getElementById("run");
const targetsInput = document.getElementById("targets");
const statusEl = document.getElementById("status");
const summaryEl = document.getElementById("summary");
const tableBody = document.querySelector("#results-table tbody");
const progressBar = document.getElementById("progress-bar");
const progressText = document.getElementById("progress-text");

let activeSource = null;

function setStatus(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`.trim();
}

function renderSummary(summary) {
  summaryEl.textContent = `Checked ${summary.checked} | Reachable ${summary.reachable} | Failed ${summary.failed}`;
}

function resetResults() {
  tableBody.innerHTML = "";
  summaryEl.textContent = "";
  progressBar.style.width = "0%";
  progressText.textContent = "";
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
  const host = row.host;
  const loss = formatLoss(row.loss);
  const avg = formatAvg(row.avg_ms);
  const status = row.status === "OK" ? "OK" : "LOSS";

  let tr = tableBody.querySelector(`tr[data-host="${CSS.escape(host)}"]`);
  if (!tr) {
    tr = document.createElement("tr");
    tr.dataset.host = host;
    ["host", "loss", "avg", "status"].forEach(() => {
      tr.appendChild(document.createElement("td"));
    });
    tableBody.appendChild(tr);
  }

  const cells = tr.querySelectorAll("td");
  cells[0].textContent = host;
  cells[1].textContent = loss;
  cells[2].textContent = avg;
  cells[3].textContent = status;

  tr.classList.toggle("ok", status === "OK");
  tr.classList.toggle("loss", status !== "OK");
}

function closeActiveSource() {
  if (activeSource) {
    activeSource.close();
    activeSource = null;
  }
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
  resetResults();

  const totalTargets = targets.length;
  let received = 0;
  let reachable = 0;
  let failed = 0;

  setStatus("Running...", "busy");
  runButton.disabled = true;
  progressText.textContent = `0 / ${totalTargets} completed`;

  const params = new URLSearchParams({ targets: targets.join("\n") });
  const source = new EventSource(`/api/run/stream?${params.toString()}`);
  activeSource = source;

  source.addEventListener("result", (event) => {
    const payload = JSON.parse(event.data);
    updateRow(payload);

    received += 1;
    if (payload.status === "OK") {
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
    closeActiveSource();
    runButton.disabled = false;
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
    setStatus(message, "error");
    closeActiveSource();
    runButton.disabled = false;
  });
}

runButton.addEventListener("click", runSweep);
