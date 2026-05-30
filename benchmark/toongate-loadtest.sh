#!/bin/bash
# ============================================================
# toongate Load Test Script
# Usage: ./toongate-loadtest.sh <worker-url> [admin-key] [proxy-key]
# Example: ./toongate-loadtest.sh https://toongate.workers.dev my-admin-key my-proxy-key
# ============================================================

WORKER_URL="${1:-http://localhost:8787}"
ADMIN_KEY="${2:-}"
PROXY_KEY="${3:-}"
REQUESTS=100
CONCURRENCY=5
PASS=0
FAIL=0
COMPRESSED=0
TOTAL_SAVED=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'
BOLD='\033[1m'

echo ""
echo -e "${BOLD}╔════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║        toongate Load Test              ║${RESET}"
echo -e "${BOLD}╚════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  Target  : ${CYAN}${WORKER_URL}${RESET}"
echo -e "  Requests: ${REQUESTS} total (${CONCURRENCY} concurrent)"
if [ -n "$PROXY_KEY" ]; then
  echo -e "  Auth    : PROXY_AUTH_KEY set ✓"
fi
echo ""

# ── Payloads ────────────────────────────────────────────────

# 1. RAG chunks (high compression expected ~40%)
RAG_PAYLOAD='{
  "model": "gpt-4o-mini",
  "messages": [{
    "role": "user",
    "content": "Summarize these search results:\n'"$(cat <<'JSON'
[
  {"id":1,"title":"Introduction to TOON Format","score":0.91,"url":"https://toonformat.dev/intro","snippet":"TOON is a compact encoding for uniform arrays of objects, reducing token count by up to 40%."},
  {"id":2,"title":"Cloudflare Workers Overview","score":0.87,"url":"https://workers.cloudflare.com","snippet":"Run code at the edge globally with sub-millisecond cold starts and zero server management."},
  {"id":3,"title":"LLM Token Cost Optimization","score":0.84,"url":"https://example.com/llm-costs","snippet":"Token costs add up fast at scale. Structured data compression is one of the most effective strategies."},
  {"id":4,"title":"RAG Pipeline Best Practices","score":0.79,"url":"https://example.com/rag","snippet":"Retrieval-augmented generation works best when chunks are uniform and well-structured."},
  {"id":5,"title":"Hono Framework for Workers","score":0.76,"url":"https://hono.dev","snippet":"Hono is a lightweight, ultrafast web framework designed for Cloudflare Workers and edge runtimes."}
]
JSON
)"
  }]
}'

# 2. DB rows (high compression expected ~38%)
DB_PAYLOAD='{
  "model": "gpt-4o-mini",
  "messages": [{
    "role": "user",
    "content": "Analyze this user data and identify patterns:\n'"$(cat <<'JSON'
[
  {"user_id":1001,"name":"Alice Chen","plan":"pro","requests_today":842,"tokens_used":124500,"joined":"2024-01-15"},
  {"user_id":1002,"name":"Bob Smith","plan":"free","requests_today":23,"tokens_used":4200,"joined":"2024-03-01"},
  {"user_id":1003,"name":"Carol Lee","plan":"enterprise","requests_today":5241,"tokens_used":892000,"joined":"2023-11-20"},
  {"user_id":1004,"name":"David Kim","plan":"pro","requests_today":312,"tokens_used":48900,"joined":"2024-02-10"},
  {"user_id":1005,"name":"Eve Johnson","plan":"free","requests_today":8,"tokens_used":1100,"joined":"2024-04-05"}
]
JSON
)"
  }]
}'

# 3. Product catalog (high compression expected ~42%)
PRODUCT_PAYLOAD='{
  "model": "gpt-4o-mini",
  "messages": [{
    "role": "user",
    "content": "Which products should I recommend to a developer?\n'"$(cat <<'JSON'
[
  {"sku":"TOOL-001","name":"Claude API Access","category":"AI","price":20.00,"stock":999,"rating":4.9},
  {"sku":"TOOL-002","name":"GitHub Copilot","category":"AI","price":19.00,"stock":999,"rating":4.7},
  {"sku":"TOOL-003","name":"Vercel Pro","category":"Hosting","price":20.00,"stock":999,"rating":4.8},
  {"sku":"TOOL-004","name":"PlanetScale","category":"Database","price":29.00,"stock":999,"rating":4.6},
  {"sku":"TOOL-005","name":"Cloudflare Workers","category":"Edge","price":5.00,"stock":999,"rating":4.9}
]
JSON
)"
  }]
}'

# 4. Plain text (no compression expected — baseline)
TEXT_PAYLOAD='{
  "model": "gpt-4o-mini",
  "messages": [{
    "role": "user",
    "content": "What is the capital of Thailand and what is it known for?"
  }]
}'

PAYLOADS=("$RAG_PAYLOAD" "$DB_PAYLOAD" "$PRODUCT_PAYLOAD" "$TEXT_PAYLOAD")
PAYLOAD_NAMES=("RAG chunks" "DB rows" "Product catalog" "Plain text (baseline)")

# ── Run tests ────────────────────────────────────────────────

echo -e "${BOLD}Running requests...${RESET}"
echo ""

WORK_DIR=$(mktemp -d)

run_request() {
  local idx=$1
  local payload_idx=$(( idx % 4 ))
  local payload="${PAYLOADS[$payload_idx]}"
  local outfile="$WORK_DIR/req_$idx.txt"

  # Build auth header args
  local auth_args=()
  if [ -n "$PROXY_KEY" ]; then
    auth_args+=(-H "Authorization: Bearer $PROXY_KEY")
  fi

  local response
  response=$(curl -s -w "\n%{http_code}" \
    -X POST "$WORKER_URL/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    "${auth_args[@]}" \
    -D "$WORK_DIR/headers_$idx.txt" \
    -d "$payload" \
    --max-time 30 2>/dev/null)

  local http_code
  http_code=$(echo "$response" | tail -1)

  # Parse toongate debug headers
  local compressed tokens_saved
  compressed=$(grep -i "x-toongate-compressed:" "$WORK_DIR/headers_$idx.txt" 2>/dev/null | tr -d '\r' | awk '{print $2}')
  tokens_saved=$(grep -i "x-toongate-tokens-saved:" "$WORK_DIR/headers_$idx.txt" 2>/dev/null | tr -d '\r' | awk '{print $2}')

  echo "${http_code}|${compressed:-false}|${tokens_saved:-0}" > "$outfile"
}

# Run with concurrency (batches of CONCURRENCY)
active=0
for i in $(seq 1 $REQUESTS); do
  run_request $i &
  active=$((active + 1))

  if [ $active -ge $CONCURRENCY ]; then
    wait
    active=0
  fi

  # Progress bar
  pct=$(( i * 100 / REQUESTS ))
  bar=$(printf '%0.s█' $(seq 1 $(( pct / 5 ))))
  printf "\r  [%-20s] %3d%% (%d/%d)" "$bar" "$pct" "$i" "$REQUESTS"
done
wait
echo ""
echo ""

# ── Aggregate results ────────────────────────────────────────

for outfile in "$WORK_DIR"/req_*.txt; do
  [ -f "$outfile" ] || continue
  IFS='|' read -r http_code compressed tokens_saved < "$outfile"

  if [[ "$http_code" == "200" ]]; then
    PASS=$((PASS + 1))
    if [[ "$compressed" == "true" ]]; then
      COMPRESSED=$((COMPRESSED + 1))
      TOTAL_SAVED=$((TOTAL_SAVED + ${tokens_saved:-0}))
    fi
  else
    FAIL=$((FAIL + 1))
  fi
done

# ── Results ──────────────────────────────────────────────────

COMPRESSION_RATE=0
if [ $PASS -gt 0 ]; then
  COMPRESSION_RATE=$(echo "scale=1; $COMPRESSED * 100 / $PASS" | bc 2>/dev/null || echo "N/A")
fi

AVG_SAVED=0
if [ $COMPRESSED -gt 0 ]; then
  AVG_SAVED=$(echo "scale=0; $TOTAL_SAVED / $COMPRESSED" | bc 2>/dev/null || echo "N/A")
fi

# Rough USD estimate (gpt-4o-mini input: $0.15/1M tokens)
USD_SAVED=$(echo "scale=4; $TOTAL_SAVED * 0.00000015" | bc 2>/dev/null || echo "N/A")

echo -e "${BOLD}╔════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║            Results Summary             ║${RESET}"
echo -e "${BOLD}╚════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Requests${RESET}"
echo -e "  ├─ Total sent  : $REQUESTS"
echo -e "  ├─ Success ✅  : ${GREEN}$PASS${RESET}"
echo -e "  └─ Failed  ❌  : ${RED}$FAIL${RESET}"
echo ""
echo -e "  ${BOLD}Compression${RESET}"
echo -e "  ├─ Compressed  : ${GREEN}$COMPRESSED / $PASS${RESET} requests (${COMPRESSION_RATE}%)"
echo -e "  ├─ Tokens saved: ${CYAN}$TOTAL_SAVED${RESET} tokens"
echo -e "  ├─ Avg/request : ${CYAN}$AVG_SAVED${RESET} tokens"
echo -e "  └─ Est. USD    : ${GREEN}\$$USD_SAVED${RESET} (gpt-4o-mini pricing)"
echo ""

# Payload breakdown
echo -e "  ${BOLD}Payload types tested${RESET}"
last_idx=$(( ${#PAYLOAD_NAMES[@]} - 1 ))
for i in "${!PAYLOAD_NAMES[@]}"; do
  if [ $i -eq $last_idx ]; then
    echo -e "  └─ ${PAYLOAD_NAMES[$i]}"
  else
    echo -e "  ├─ ${PAYLOAD_NAMES[$i]}"
  fi
done
echo ""

# ── Savings API check ────────────────────────────────────────

if [ -n "$ADMIN_KEY" ]; then
  echo -e "${BOLD}╔════════════════════════════════════════╗${RESET}"
  echo -e "${BOLD}║         Savings API Summary            ║${RESET}"
  echo -e "${BOLD}╚════════════════════════════════════════╝${RESET}"
  echo ""

  SUMMARY=$(curl -s "$WORKER_URL/savings/summary" \
    -H "X-Toongate-Admin-Key: $ADMIN_KEY" 2>/dev/null)

  if echo "$SUMMARY" | grep -q "total_tokens_saved" 2>/dev/null; then
    echo "$SUMMARY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
o = d.get('overall', d)
print(f'  ├─ All-time requests    : {o.get(\"requests\", \"N/A\")}')
print(f'  ├─ All-time tokens saved: {o.get(\"total_tokens_saved\", \"N/A\")}')
print(f'  └─ All-time USD saved   : \${o.get(\"total_usd_saved\", 0):.4f}')
" 2>/dev/null || echo "$SUMMARY" | head -5
  else
    echo -e "  ${YELLOW}⚠ Could not parse savings API response${RESET}"
    echo "  Raw: $SUMMARY"
  fi
  echo ""
fi

# ── Debug headers check ──────────────────────────────────────

echo -e "${BOLD}╔════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║         Debug Headers (1 sample)       ║${RESET}"
echo -e "${BOLD}╚════════════════════════════════════════╝${RESET}"
echo ""

sample_auth_args=()
if [ -n "$PROXY_KEY" ]; then
  sample_auth_args+=(-H "Authorization: Bearer $PROXY_KEY")
fi

curl -si -X POST "$WORKER_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  "${sample_auth_args[@]}" \
  -d "$RAG_PAYLOAD" \
  --max-time 30 2>/dev/null \
  | grep -i "x-toongate" \
  | tr -d '\r' \
  | while read -r line; do
      echo "  $line"
    done

echo ""

# ── Cleanup ──────────────────────────────────────────────────
rm -rf "$WORK_DIR"

# ── Final verdict ────────────────────────────────────────────

echo -e "${BOLD}╔════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║              Verdict                   ║${RESET}"
echo -e "${BOLD}╚════════════════════════════════════════╝${RESET}"
echo ""

if [ $FAIL -eq 0 ] && [ $COMPRESSED -gt 0 ]; then
  echo -e "  ${GREEN}${BOLD}✅ toongate is working correctly${RESET}"
  echo -e "  Compression is active and saving tokens on real traffic."
  echo ""
  echo -e "  ${BOLD}README badge numbers:${RESET}"
  echo -e "  ${CYAN}\"Saved $TOTAL_SAVED tokens (\$$USD_SAVED) across $PASS requests\"${RESET}"
elif [ $FAIL -eq 0 ] && [ $COMPRESSED -eq 0 ]; then
  echo -e "  ${YELLOW}${BOLD}⚠ Requests succeeded but nothing was compressed${RESET}"
  echo -e "  Check TOON_THRESHOLD setting or payload structure."
elif [ $FAIL -gt 0 ]; then
  echo -e "  ${RED}${BOLD}❌ Some requests failed (${FAIL}/${REQUESTS})${RESET}"
  if [ -n "$PROXY_KEY" ]; then
    echo -e "  Check Worker URL and Cloudflare logs."
  else
    echo -e "  If PROXY_AUTH_KEY is set on the Worker, pass it as the 3rd argument:"
    echo -e "  ${CYAN}./toongate-loadtest.sh $WORKER_URL \$ADMIN_KEY \$PROXY_AUTH_KEY${RESET}"
  fi
fi

echo ""
