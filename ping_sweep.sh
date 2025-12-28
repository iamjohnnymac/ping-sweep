#!/bin/sh

set -eu

TARGETS_FILE="targets.txt"
OUTPUT_FILE="results.csv"
JSON_FILE="results.json"
COUNT=3
JSON_OUTPUT=0
STREAM=0
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

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

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
Usage: ./ping_sweep.sh [-c count] [--json] [--stream] [--targets file]

Options:
  -c <count>  Number of pings per host (default: 3)
  --json      Write results.json alongside results.csv
  --stream    Emit JSON Lines results to stdout
  --targets   Read targets from a custom file
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
    --stream)
      STREAM=1
      ;;
    --targets)
      shift
      if [ "$#" -eq 0 ]; then
        echo "Missing value for --targets" >&2
        exit 1
      fi
      TARGETS_FILE="$1"
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

if [ ! -f "$TARGETS_FILE" ]; then
  echo "Missing $TARGETS_FILE. Create it with one host per line." >&2
  exit 1
fi

echo "host,packet_loss_percent,avg_latency_ms" > "$OUTPUT_FILE"

if [ "$JSON_OUTPUT" -eq 1 ]; then
  printf '[\n' > "$JSON_FILE"
  first_json=1
fi

if [ "$STREAM" -eq 0 ]; then
  print_table_header
fi
total_hosts=0
ok_hosts=0
loss_hosts=0
start_seconds=$(date +%s)
total_targets=$(awk 'NF && $0 !~ /^#/' "$TARGETS_FILE" | wc -l | tr -d ' ')
index=0

while IFS= read -r host; do
  case "$host" in
    ''|\#*)
      continue
      ;;
  esac

  index=$((index + 1))
  if [ "$STREAM" -eq 1 ]; then
    json_host=$(json_escape "$host")
    printf '{"type":"progress","current":"%s","index":%s,"total":%s}\n' \
      "$json_host" "$index" "$total_targets"
  fi

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
  loss_num=$(printf '%s' "$loss" | tr -d '%' | awk '{printf "%d", $1 + 0}')
  status="LOSS"
  if [ "$loss_num" -eq 0 ]; then
    status="OK"
  fi
  if [ "$status" = "OK" ]; then
    color_code="$GREEN"
  else
    color_code="$RED"
  fi

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

  if [ "$STREAM" -eq 0 ]; then
    print_table_row "$host" "$loss" "$avg" "$symbol" "$color_code"
  else
    if [ "$avg" = "NA" ]; then
      avg_json="null"
    else
      avg_json="$avg"
    fi
    json_host=$(json_escape "$host")
    printf '{"type":"result","host":"%s","loss":%s,"avg_ms":%s,"status":"%s"}\n' \
      "$json_host" "$loss_num" "$avg_json" "$status"
  fi

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

done < "$TARGETS_FILE"

if [ "$JSON_OUTPUT" -eq 1 ]; then
  printf '\n]\n' >> "$JSON_FILE"
fi

end_seconds=$(date +%s)
duration_ms=$(( (end_seconds - start_seconds) * 1000 ))

if [ "$STREAM" -eq 0 ]; then
  printf '%sSummary:%s %s checked, %s reachable, %s failed\n' "$BOLD" "$RESET" "$total_hosts" "$ok_hosts" "$loss_hosts"
else
  printf '{"type":"summary","checked":%s,"reachable":%s,"failed":%s,"duration_ms":%s}\n' \
    "$total_hosts" "$ok_hosts" "$loss_hosts" "$duration_ms"
fi

if [ "$STREAM" -eq 0 ]; then
  echo "Wrote $OUTPUT_FILE"
  if [ "$JSON_OUTPUT" -eq 1 ]; then
    echo "Wrote $JSON_FILE"
  fi
fi
