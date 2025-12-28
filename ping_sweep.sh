#!/bin/sh

set -eu

INPUT_FILE="targets.txt"
OUTPUT_FILE="results.csv"
JSON_FILE="results.json"
COUNT=3
JSON_OUTPUT=0
TIMEOUT_SECONDS=1

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

  if [ "$JSON_OUTPUT" -eq 1 ]; then
    if [ "$first_json" -eq 1 ]; then
      sep=""
      first_json=0
    else
      sep=",\n"
    fi
    printf '%s  {"host":"%s","packet_loss_percent":"%s","avg_latency_ms":"%s"}' \
      "$sep" "$host" "$loss" "$avg" >> "$JSON_FILE"
  fi

done < "$INPUT_FILE"

if [ "$JSON_OUTPUT" -eq 1 ]; then
  printf '\n]\n' >> "$JSON_FILE"
fi

echo "Wrote $OUTPUT_FILE"
if [ "$JSON_OUTPUT" -eq 1 ]; then
  echo "Wrote $JSON_FILE"
fi
