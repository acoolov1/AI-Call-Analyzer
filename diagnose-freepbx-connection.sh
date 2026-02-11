#!/bin/bash

# FreePBX ARI Connection Diagnostics
# This script helps diagnose connection issues with FreePBX ARI

echo "=========================================="
echo "FreePBX ARI Connection Diagnostic Tool"
echo "=========================================="
echo ""

# Get connection details from user
read -p "FreePBX Host/IP: " FREEPBX_HOST
read -p "Port (default 8088): " FREEPBX_PORT
FREEPBX_PORT=${FREEPBX_PORT:-8088}
read -p "Use HTTPS? (y/n, default n): " USE_HTTPS
USE_HTTPS=${USE_HTTPS:-n}
read -p "ARI Username (default connex): " ARI_USERNAME
ARI_USERNAME=${ARI_USERNAME:-connex}
read -sp "ARI Password: " ARI_PASSWORD
echo ""
echo ""

# Determine protocol
if [[ "$USE_HTTPS" == "y" ]]; then
    PROTOCOL="https"
    CURL_OPTS="-k"  # Accept self-signed certs
else
    PROTOCOL="http"
    CURL_OPTS=""
fi

BASE_URL="${PROTOCOL}://${FREEPBX_HOST}:${FREEPBX_PORT}"
ARI_URL="${BASE_URL}/ari"

echo "Testing connection to: $ARI_URL"
echo ""

# Test 1: Basic network connectivity
echo "=========================================="
echo "Test 1: Network Connectivity"
echo "=========================================="
if ping -c 2 -W 2 "$FREEPBX_HOST" &> /dev/null; then
    echo "✓ Host is reachable via ping"
else
    echo "✗ Host is NOT reachable via ping"
    echo "  This could be normal if ICMP is blocked"
fi
echo ""

# Test 2: Port connectivity
echo "=========================================="
echo "Test 2: Port Connectivity"
echo "=========================================="
if timeout 5 bash -c "echo > /dev/tcp/${FREEPBX_HOST}/${FREEPBX_PORT}" 2>/dev/null; then
    echo "✓ Port ${FREEPBX_PORT} is open and accepting connections"
else
    echo "✗ Port ${FREEPBX_PORT} is NOT accessible"
    echo "  Possible causes:"
    echo "  - Firewall blocking the port"
    echo "  - Asterisk HTTP server not listening on this port"
    echo "  - Wrong port number"
    exit 1
fi
echo ""

# Test 3: HTTP server response
echo "=========================================="
echo "Test 3: HTTP Server Response"
echo "=========================================="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" $CURL_OPTS "${BASE_URL}/")
echo "HTTP Status Code: $HTTP_CODE"

if [[ "$HTTP_CODE" == "000" ]]; then
    echo "✗ No HTTP response (connection failed)"
    echo "  The port is open but not responding to HTTP requests"
    exit 1
elif [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "301" || "$HTTP_CODE" == "302" || "$HTTP_CODE" == "404" ]]; then
    echo "✓ HTTP server is responding"
else
    echo "⚠ Unexpected HTTP response code"
fi
echo ""

# Test 4: ARI endpoint accessibility
echo "=========================================="
echo "Test 4: ARI Endpoint - No Auth"
echo "=========================================="
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" $CURL_OPTS "${ARI_URL}/recordings/stored")
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

echo "HTTP Status Code: $HTTP_CODE"

if [[ "$HTTP_CODE" == "401" ]]; then
    echo "✓ ARI endpoint exists (authentication required)"
elif [[ "$HTTP_CODE" == "404" ]]; then
    echo "✗ ARI endpoint NOT FOUND (404)"
    echo "  Possible causes:"
    echo "  - ARI modules not loaded in Asterisk"
    echo "  - Wrong URL path"
    echo ""
    echo "  Fix: On FreePBX server, run:"
    echo "  asterisk -rx 'module load res_ari.so'"
    echo "  asterisk -rx 'module load res_ari_recordings.so'"
    echo "  asterisk -rx 'module show like ari'"
    exit 1
elif [[ "$HTTP_CODE" == "000" ]]; then
    echo "✗ Connection failed"
    exit 1
else
    echo "Response: $BODY" | head -c 200
fi
echo ""

# Test 5: Authentication
echo "=========================================="
echo "Test 5: ARI Authentication"
echo "=========================================="
RESPONSE=$(curl -s -w "\nHTTP_CODE:%{http_code}" $CURL_OPTS \
    -u "${ARI_USERNAME}:${ARI_PASSWORD}" \
    "${ARI_URL}/recordings/stored?limit=1")
HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_CODE:")

echo "HTTP Status Code: $HTTP_CODE"

if [[ "$HTTP_CODE" == "200" ]]; then
    echo "✓ Authentication SUCCESSFUL!"
    echo ""
    echo "Response:"
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
    echo ""
    RECORDING_COUNT=$(echo "$BODY" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len(data))" 2>/dev/null || echo "?")
    echo "Recordings found: $RECORDING_COUNT"
    echo ""
    echo "✓✓✓ CONNECTION TEST PASSED ✓✓✓"
    echo ""
    echo "Your FreePBX ARI connection is working correctly!"
    echo "You can use these settings in your application."
elif [[ "$HTTP_CODE" == "401" ]]; then
    echo "✗ Authentication FAILED (401 Unauthorized)"
    echo "  Credentials are incorrect"
    echo ""
    echo "  Fix: On FreePBX server, check:"
    echo "  cat /etc/asterisk/ari.conf | grep -A5 \"\\[${ARI_USERNAME}\\]\""
    echo ""
    echo "  Make sure the username and password match, then reload:"
    echo "  fwconsole reload"
    exit 1
elif [[ "$HTTP_CODE" == "404" ]]; then
    echo "✗ Endpoint NOT FOUND (404)"
    echo "  ARI recordings module is not loaded"
    echo ""
    echo "  Fix: On FreePBX server, run:"
    echo "  asterisk -rx 'module load res_ari_recordings.so'"
    echo "  asterisk -rx 'module show like ari'"
    exit 1
else
    echo "✗ Unexpected response"
    echo "Response: $BODY"
    exit 1
fi
echo ""

# Test 6: Additional diagnostics
echo "=========================================="
echo "Test 6: FreePBX Server Commands"
echo "=========================================="
echo "If you have SSH access to the FreePBX server, run these commands:"
echo ""
echo "# Check Asterisk HTTP status:"
echo "asterisk -rx 'http show status'"
echo ""
echo "# Expected output should show:"
echo "# Server Enabled and Bound to 0.0.0.0:${FREEPBX_PORT}"
echo ""
echo "# Check ARI modules:"
echo "asterisk -rx 'module show like ari'"
echo ""
echo "# Expected to see these modules as 'Running':"
echo "# res_ari.so"
echo "# res_ari_recordings.so"
echo "# res_ari_channels.so"
echo "# res_ari_bridges.so"
echo ""
echo "# Check ARI configuration:"
echo "cat /etc/asterisk/ari.conf"
echo ""
echo "# Check firewall:"
echo "firewall-cmd --list-ports"
echo "netstat -tulpn | grep ${FREEPBX_PORT}"
echo ""
echo "=========================================="

