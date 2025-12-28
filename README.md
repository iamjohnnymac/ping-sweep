# Ping Sweep

## Overview
This project reads hosts from `targets.txt`, pings each host, and writes a CSV report to `results.csv`. Optional JSON output can be enabled with `--json`.

## Usage
1. Add one host per line to `targets.txt`.
2. Run the sweep:

```bash
./ping_sweep.sh
```

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
CSV columns in `results.csv`:

- `host` — target hostname or IP.
- `packet_loss_percent` — packet loss reported by `ping` (e.g., `0%`, `100%`).
- `avg_latency_ms` — average round-trip time in milliseconds, or `NA` if unavailable.

JSON output in `results.json` (when enabled) mirrors the same fields.

## Sample targets.txt
```
# Example hosts
8.8.8.8
1.1.1.1
localhost
```
