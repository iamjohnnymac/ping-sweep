#!/bin/sh

set -eu

INPUT_FILE="targets.txt"
OUTPUT_FILE="results.csv"
JSON_FILE="results.json"
COUNT=3
JSON_OUTPUT=0
TIMEOUT_SECONDS=1
USE_COLOR=0

if [ -t 1 ]; then
  USE_COLOR=1
fi

if [ "$USE_COLOR" -eq 1 ]; then
  BOLD="$(printf '\033[1m')"
  RESET="$(printf '\033[0m')"
  GREEN="$(printf '\033[32m')"
  RED="$(printf '\033[31m')"
else
  BOLD=""
  RESET=""
  GREEN=""
  RED=""
fi

CHECK="✓"
CROSS="✗"

print_table_header() {
  printf '%s%-24s %-7s %-10s %s%s\n' "$BOLD" "HOST" "LOSS" "AVG_MS" "ST" "$RESET"
  printf '%-24s %-7s %-10s %s\n' "----" "----" "------" "--"
}

print_table_row() {
  host="$1"
  loss="$2"
  avg="$3"
  symbol="$4"
  color_code="$5"

  printf '%-24s %-7s %-10s %s%s%s\n' "$host" "$loss" "$avg" "$color_code" "$symbol" "$RESET"
}

usage() {
  cat <<'USAGE'
Usage: ./ping_sweep.sh [-c count] [--json]

Options:
  -c <count>  Number of pings per host (default: 3)
  --json      Write results.json alongside results.csv
  -h, --help  Show this help text
USAGE
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    -c)
      shift
      if [ "$#" -eq 0 ]; then
        echo "Missing value for -c" >&2
        exit 1
      fi
      COUNT="$1"
      ;;
    --json)
      JSON_OUTPUT=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
 done

case "$COUNT" in
  ''|*[!0-9]*)
    echo "Invalid ping count: $COUNT" >&2
    exit 1
    ;;
  0)
    echo "Ping count must be greater than 0" >&2
    exit 1
    ;;
 esac

if [ ! -f "$INPUT_FILE" ]; then
  echo "Missing $INPUT_FILE. Create it with one host per line." >&2
  exit 1
fi

echo "host,packet_loss_percent,avg_latency_ms" > "$OUTPUT_FILE"

if [ "$JSON_OUTPUT" -eq 1 ]; then
  printf '[\n' > "$JSON_FILE"
  first_json=1
fi

print_table_header
total_hosts=0
ok_hosts=0
loss_hosts=0

while IFS= read -r host; do
  case "$host" in
    ''|\#*)
      continue
      ;;
  esac

  ping_output=$(ping -c "$COUNT" -q -W "$TIMEOUT_SECONDS" -w "$((COUNT + 2))" "$host" 2>&1 || true)

  loss=$(printf '%s\n' "$ping_output" | awk -F', ' '/packets transmitted/ {print $3}' | awk '{print $1}')
  avg=$(printf '%s\n' "$ping_output" | awk -F'/' '/^rtt|^round-trip/ {print $5}')

  if [ -z "$avg" ]; then
    avg="NA"
  fi
  if [ -z "$loss" ]; then
    loss="100%"
  fi

  echo "$host,$loss,$avg" >> "$OUTPUT_FILE"

  total_hosts=$((total_hosts + 1))
  status="OK"
  color_code="$GREEN"
  case "$loss" in
    0%|0.0%)
      status="OK"
      color_code="$GREEN"
      ;;
    *)
      status="LOSS"
      color_code="$RED"
      ;;
  esac

  case "$status" in
    OK)
      symbol="$CHECK"
      ok_hosts=$((ok_hosts + 1))
      ;;
    *)
      symbol="$CROSS"
      loss_hosts=$((loss_hosts + 1))
      ;;
  esac

  print_table_row "$host" "$loss" "$avg" "$symbol" "$color_code"

  if [ "$JSON_OUTPUT" -eq 1 ]; then
    if [ "$first_json" -eq 1 ]; then
      sep=""
      first_json=0
    else
      sep=",
"
    fi
    printf '%s  {"host":"%s","packet_loss_percent":"%s","avg_latency_ms":"%s"}' \
      "$sep" "$host" "$loss" "$avg" >> "$JSON_FILE"
  fi

done < "$INPUT_FILE"

if [ "$JSON_OUTPUT" -eq 1 ]; then
  printf '\n]\n' >> "$JSON_FILE"
fi

printf '%sSummary:%s %s checked, %s reachable, %s failed\n' "$BOLD" "$RESET" "$total_hosts" "$ok_hosts" "$loss_hosts"

echo "Wrote $OUTPUT_FILE"
if [ "$JSON_OUTPUT" -eq 1 ]; then
  echo "Wrote $JSON_FILE"
fi
