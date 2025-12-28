from __future__ import annotations

import json
import os
import subprocess
import tempfile
from typing import List
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
SCRIPT_PATH = os.path.abspath(os.path.join(BASE_DIR, "..", "ping_sweep.sh"))

app = FastAPI()
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

RUN_PROCESSES: dict[str, subprocess.Popen[str]] = {}
RUN_CANCELLED: dict[str, bool] = {}


class RunRequest(BaseModel):
    targets: List[str]
    json_output: bool = True


class CancelRequest(BaseModel):
    run_id: str


def _clean_targets(raw_targets: List[str]) -> List[str]:
    cleaned: List[str] = []
    for item in raw_targets:
        if item is None:
            continue
        target = item.strip()
        if not target:
            continue
        if any(ch.isspace() for ch in target):
            raise HTTPException(status_code=400, detail=f"Invalid target: '{item}'")
        if len(target) > 255:
            raise HTTPException(status_code=400, detail=f"Target too long: '{item}'")
        cleaned.append(target)
    if not cleaned:
        raise HTTPException(status_code=400, detail="Provide at least one valid target")
    if len(cleaned) > 200:
        raise HTTPException(status_code=400, detail="Too many targets (max 200)")
    return cleaned


def _loss_is_ok(loss: str) -> bool:
    if not loss:
        return False
    value = loss.strip().rstrip("%")
    try:
        return float(value) == 0.0
    except ValueError:
        return False


def _sse(event: str, data: str) -> str:
    return f"event: {event}\ndata: {data}\n\n"


@app.get("/")
def index() -> FileResponse:
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.post("/api/run")
def run_sweep(payload: RunRequest):
    if not payload.json_output:
        raise HTTPException(status_code=400, detail="JSON output must be enabled")

    targets = _clean_targets(payload.targets)

    if not os.path.isfile(SCRIPT_PATH):
        raise HTTPException(status_code=500, detail="ping_sweep.sh not found")

    with tempfile.TemporaryDirectory() as tmpdir:
        targets_path = os.path.join(tmpdir, "targets.txt")
        results_path = os.path.join(tmpdir, "results.json")

        with open(targets_path, "w", encoding="utf-8") as handle:
            handle.write("\n".join(targets) + "\n")

        result = subprocess.run(
            [SCRIPT_PATH, "--json"],
            cwd=tmpdir,
            capture_output=True,
            text=True,
            check=False,
        )

        if result.returncode != 0:
            message = result.stderr.strip() or "ping_sweep.sh failed"
            raise HTTPException(status_code=500, detail=message)

        if not os.path.isfile(results_path):
            raise HTTPException(status_code=500, detail="results.json not produced")

        try:
            with open(results_path, "r", encoding="utf-8") as handle:
                results = json.load(handle)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=500, detail=f"Invalid JSON output: {exc}")

    checked = len(results)
    reachable = sum(1 for row in results if _loss_is_ok(row.get("packet_loss_percent", "")))
    failed = checked - reachable

    return {
        "results": results,
        "summary": {
            "checked": checked,
            "reachable": reachable,
            "failed": failed,
        },
    }


@app.get("/api/run/stream")
def run_sweep_stream(targets: str = Query(..., description="Targets separated by newlines")):
    raw_targets = targets.splitlines()
    clean_targets = _clean_targets(raw_targets)

    if not os.path.isfile(SCRIPT_PATH):
        raise HTTPException(status_code=500, detail="ping_sweep.sh not found")

    def event_stream():
        run_id = uuid4().hex
        with tempfile.TemporaryDirectory() as tmpdir:
            targets_path = os.path.join(tmpdir, "targets.txt")

            with open(targets_path, "w", encoding="utf-8") as handle:
                handle.write("\n".join(clean_targets) + "\n")

            process = subprocess.Popen(
                ["bash", SCRIPT_PATH, "--targets", targets_path, "--stream"],
                cwd=tmpdir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
            RUN_PROCESSES[run_id] = process
            RUN_CANCELLED[run_id] = False

            summary_seen = False
            error_emitted = False

            try:
                assert process.stdout is not None
                for line in process.stdout:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        payload = json.loads(line)
                    except json.JSONDecodeError as exc:
                        process.kill()
                        message = f"Invalid JSON line: {exc}"
                        yield _sse("error", json.dumps({"message": message, "run_id": run_id}))
                        error_emitted = True
                        return

                    msg_type = payload.get("type")
                    if msg_type == "progress":
                        payload["run_id"] = run_id
                        yield _sse("progress", json.dumps(payload))
                    elif msg_type == "result":
                        yield _sse("result", json.dumps(payload))
                    elif msg_type == "summary":
                        summary_seen = True
                        yield _sse("done", json.dumps(payload))
                    else:
                        process.kill()
                        yield _sse("error", json.dumps({"message": "Unexpected payload type", "run_id": run_id}))
                        error_emitted = True
                        return
            finally:
                process.wait()
                stderr = ""
                if process.stderr is not None:
                    stderr = process.stderr.read().strip()

                if run_id in RUN_PROCESSES:
                    RUN_PROCESSES.pop(run_id, None)
                    cancelled = RUN_CANCELLED.pop(run_id, False)
                else:
                    cancelled = False

                if error_emitted:
                    return
                if cancelled:
                    yield _sse("error", json.dumps({"message": "Cancelled", "run_id": run_id}))
                    return
                if process.returncode != 0:
                    message = stderr or "ping_sweep.sh failed"
                    yield _sse("error", json.dumps({"message": message, "run_id": run_id}))
                elif not summary_seen:
                    yield _sse("error", json.dumps({"message": "Missing summary line", "run_id": run_id}))

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.post("/api/run/cancel")
def cancel_run(payload: CancelRequest):
    process = RUN_PROCESSES.get(payload.run_id)
    if process is None:
        raise HTTPException(status_code=404, detail="Run ID not found")

    RUN_CANCELLED[payload.run_id] = True
    try:
        process.terminate()
    except OSError:
        pass

    return {"status": "cancelling", "run_id": payload.run_id}
