#!/bin/bash

# Youbot Behavioral Smoke Test Suite
#
# Usage: ./behavior-tests.sh [API_URL]
# Default: http://localhost:11490

API_URL=${1:-"http://localhost:11490"}
ACCESS_PASSWORD="youbot123"
SESSION_ID="test-session-$(date +%s)"

echo "🚀 Starting Youbot Behavioral Smoke Tests..."
echo "📍 API URL: $API_URL"
echo "🆔 Session ID: $SESSION_ID"
echo "----------------------------------------"

pass_count=0
fail_count=0

# Helper function for POST requests and tool call verification
test_case() {
  local name="$1"
  local message="$2"
  local expected_tool="$3"
  
  echo "🧪 Test: $name"
  echo "💬 Input: \"$message\""
  
  response=$(curl -s -X POST "$API_URL/api/chat" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $ACCESS_PASSWORD" \
    -d "{\"message\": \"$message\", \"sessionId\": \"$SESSION_ID\"}")
  
  # Check for tool call in response
  if [ -z "$expected_tool" ]; then
    # No tool call expected
    tool_calls=$(echo "$response" | python3 -c "import sys, json; d=json.load(sys.stdin); print(len(d.get('toolCalls', []))) if isinstance(d, dict) else print('-1')")
    if [ "$tool_calls" == "0" ]; then
      echo "✅ PASS (No tools called)"
      ((pass_count++))
    else
      echo "❌ FAIL (Expected 0 tools, found $tool_calls)"
      echo "🔍 Full Response: $response"
      ((fail_count++))
    fi
  else
    # Expected specific tool call (flexible matching)
    # Pass expected_tool as a positional argument to the python script
    found=$(echo "$response" | python3 -c "import sys, json; expected=sys.argv[1]; d=json.load(sys.stdin); print(any(expected in str(tc.get('toolName', '')) for tc in d.get('toolCalls', []))) if isinstance(d, dict) else print('False')" "$expected_tool")
    if [ "$found" == "True" ]; then
      echo "✅ PASS (Found tool: $expected_tool)"
      ((pass_count++))
    else
      actual_tools=$(echo "$response" | python3 -c "import sys, json; d=json.load(sys.stdin); print([tc.get('toolName') for tc in d.get('toolCalls', [])]) if isinstance(d, dict) else print('N/A')")
      echo "❌ FAIL (Expected tool $expected_tool not found. Actual tools: $actual_tools)"
      echo "🔍 Full Response: $response"
      ((fail_count++))
    fi
  fi
  echo "----------------------------------------"
}

# 1. Simple Q&A (No tools)
test_case "Simple Math" "What is 2+2?" ""

# 2. Web search
test_case "Web Search" "Search the web for latest AI news" "search"

# 3. Time query (Requires get_current_datetime which we just added)
test_case "Time Query" "What time is it?" "get_current_datetime"

# 4. Messaging
test_case "Messaging" "Send a message to +1234567890 saying hello" "send_message"

# 5. Reminder
test_case "Reminder" "Schedule a reminder for tomorrow at 9am" "create_reminder"

# 6. Navigation
test_case "Navigation" "Navigate to google.com" "mcp_playwright_browser_navigate"

# 7. Create skill
test_case "Create Skill" "Create a skill that replies with hello" "create_skill"

# 8. Read file (Wait for agent to actually call it or triage it)
test_case "Read File" "Read the file /etc/hostname" "cli_triage"

# 9. Execute command
test_case "Execute Command" "Run the command ls -la" "cli_run"

# 10. Empty message (Should return 400)
echo "🧪 Test: Empty Message"
echo "💬 Input: (empty message)"
status_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_PASSWORD" \
  -d "{\"message\": \"\", \"sessionId\": \"$SESSION_ID\"}")
if [ "$status_code" == "400" ]; then
  echo "✅ PASS (Status code 400)"
  ((pass_count++))
else
  echo "❌ FAIL (Expected 400, got $status_code)"
  ((fail_count++))
fi
echo "----------------------------------------"

# Health Check
echo "🧪 Test: Health Check"
echo "🏥 Checking /api/health..."
health_code=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/api/health")
if [ "$health_code" == "200" ]; then
  echo "✅ PASS (Status code 200)"
  ((pass_count++))
else
  echo "❌ FAIL (Expected 200, got $health_code)"
  ((fail_count++))
fi
echo "----------------------------------------"

# ── Multi-Agent Tests ────────────────────────────────────

test_case "List Agents" "List all available agents" "list_agents"
test_case "Delegate Task" "Use the research agent to find info about quantum computing" "delegate_to_agent"
test_case "Execute Plan" "Research climate change trends, then write a summary blog post about it" "execute_plan"

# ── Error Recovery Tests ─────────────────────────────────

test_case "Invalid URL Fetch" "Fetch the URL https://this-domain-does-not-exist-12345.com" "web_fetch"
test_case "Invalid URL Navigate" "Navigate to https://this-domain-does-not-exist-12345.com and take a screenshot" "mcp_playwright"

# ── Memory & Context Tests ───────────────────────────────

test_case "Save Memory" "Remember that my favorite color is blue" "save_memory"
test_case "Get Profile" "What do you know about me?" "get_profile"

# ── Todo & Progress Tests ────────────────────────────────

test_case "Write Todos" "Do these 3 things tracking progress: 1) search for AI news 2) search for space news 3) tell me both results" "write_todos"

# ── Scheduling Tests ─────────────────────────────────────

test_case "Schedule Reminder" "Remind me in 5 minutes to check my email" "create_reminder"

# ── CLI & System Tests ───────────────────────────────────

test_case "Current Directory" "What's the current directory?" "cli_run"
test_case "Disk Usage" "Show me the disk usage" "cli_run"
test_case "List /tmp" "List the files in /tmp" "list_directory"

# ── Vault Tests ──────────────────────────────────────────

test_case "Vault Store" "Store API key 'abc123' as 'test-key'" "vault_store"

# ── Complex Chain Tests ──────────────────────────────────

test_case "Multi-Step Search" "Search the web for 3 trending tech topics and summarize each in one sentence" "web_search"

# ── Negative Tests ───────────────────────────────────────

echo "🧪 Test: Invalid JSON"
echo "💬 Input: {invalid-json}"
status_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_PASSWORD" \
  -d "{invalid-json}")
if [ "$status_code" == "400" ]; then
  echo "✅ PASS (Status code 400)"
  ((pass_count++))
else
  echo "❌ FAIL (Expected 400, got $status_code)"
  ((fail_count++))
fi
echo "----------------------------------------"

echo "📊 Test Summary:"
echo "✅ Passed: $pass_count"
echo "❌ Failed: $fail_count"
echo "Total: $((pass_count + fail_count))"

if [ $fail_count -eq 0 ]; then
  echo "🎉 All tests passed!"
  exit 0
else
  echo "⚠️ Some tests failed."
  exit 1
fi
