# Ping Sweep

## Overview
This project reads hosts from `targets.txt`, pings each host, and writes a CSV report to `results.csv`. Optional JSON output can be enabled with `--json`.

## Usage
1. Add one host per line to `targets.txt`.
2. Run the sweep:

```bash
./ping_sweep.sh
```

This prints a readable table to stdout for quick inspection while also writing `results.csv`.

## Options
- `-c <count>` — number of pings per host (default: 3).
- `--json` — write `results.json` alongside the CSV output.
- `-h`, `--help` — show usage.

Examples:

```bash
./ping_sweep.sh -c 5
./ping_sweep.sh --json
./ping_sweep.sh -c 2 --json
```

## Output
Human-friendly table output is intended for interactive use (TTY). It uses color and simple symbols to highlight success or loss; when stdout is not a TTY, it falls back to plain text.
Use `results.csv` and `results.json` for automation and machine parsing.

CSV columns in `results.csv`:

- `host` — target hostname or IP.
- `packet_loss_percent` — packet loss reported by `ping` (e.g., `0%`, `100%`).
- `avg_latency_ms` — average round-trip time in milliseconds, or `NA` if unavailable.

JSON output in `results.json` (when enabled) mirrors the same fields.

To validate JSON output:

```bash
python3 -m json.tool results.json
```

## Web UI
Start the local UI with:

```bash
uvicorn webui.main:app --reload
```

The UI uses the JSON output path. `POST /api/run` expects:

```json
{
  "targets": ["1.1.1.1", "example.com"],
  "json_output": true
}
```

## Sample targets.txt
```
# Example hosts
8.8.8.8
1.1.1.1
localhost
```
