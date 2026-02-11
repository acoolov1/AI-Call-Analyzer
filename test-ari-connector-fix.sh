#!/bin/bash

# ARI Connector Module - Test & Deploy Script
# This script tests the updated module on your FreePBX server

FREEPBX_IP="140.82.47.197"
FREEPBX_PORT="63582"
FREEPBX_PASS="Ff8309hk59w9F95kgje!nwc9h!"
MODULE_PATH="./freepbx-ariconnector-module"

echo "======================================"
echo "ARI Connector Module - Test & Deploy"
echo "======================================"
echo ""

# Check if sshpass is installed
if ! command -v sshpass &> /dev/null; then
    echo "Error: sshpass is not installed"
    echo "Install it with: sudo apt install sshpass"
    exit 1
fi

# Check if module directory exists
if [ ! -d "$MODULE_PATH" ]; then
    echo "Error: Module directory not found: $MODULE_PATH"
    exit 1
fi

echo "Step 1: Backing up current module..."
sshpass -p "$FREEPBX_PASS" ssh -o StrictHostKeyChecking=no -p "$FREEPBX_PORT" root@$FREEPBX_IP \
    "cd /var/www/html/admin/modules && tar -czf /root/ariconnector_backup_$(date +%Y%m%d_%H%M%S).tar.gz ariconnector 2>/dev/null || echo 'No existing module to backup'"

echo ""
echo "Step 2: Uploading updated module files..."
sshpass -p "$FREEPBX_PASS" scp -o StrictHostKeyChecking=no -P "$FREEPBX_PORT" -r "$MODULE_PATH"/* \
    root@$FREEPBX_IP:/var/www/html/admin/modules/ariconnector/

if [ $? -ne 0 ]; then
    echo "Error: Failed to upload files"
    exit 1
fi
echo "✓ Files uploaded successfully"

echo ""
echo "Step 3: Setting permissions..."
sshpass -p "$FREEPBX_PASS" ssh -o StrictHostKeyChecking=no -p "$FREEPBX_PORT" root@$FREEPBX_IP \
    "chown -R asterisk:asterisk /var/www/html/admin/modules/ariconnector && chmod -R 755 /var/www/html/admin/modules/ariconnector"
echo "✓ Permissions set"

echo ""
echo "Step 4: Checking current HTTP bind status..."
sshpass -p "$FREEPBX_PASS" ssh -o StrictHostKeyChecking=no -p "$FREEPBX_PORT" root@$FREEPBX_IP \
    "asterisk -rx 'http show status' | grep -E 'Bound to|bindaddr'"

echo ""
echo "Step 5: Force module reinstall..."
sshpass -p "$FREEPBX_PASS" ssh -o StrictHostKeyChecking=no -p "$FREEPBX_PORT" root@$FREEPBX_IP \
    "fwconsole ma uninstall ariconnector 2>&1 | grep -v Warning"
sleep 2
sshpass -p "$FREEPBX_PASS" ssh -o StrictHostKeyChecking=no -p "$FREEPBX_PORT" root@$FREEPBX_IP \
    "fwconsole ma install ariconnector 2>&1 | grep -E '✓|Created|ERROR|WARNING'"

echo ""
echo "Step 6: Verifying http_custom.conf was created..."
sshpass -p "$FREEPBX_PASS" ssh -o StrictHostKeyChecking=no -p "$FREEPBX_PORT" root@$FREEPBX_IP \
    "if [ -f /etc/asterisk/http_custom.conf ]; then echo '✓ http_custom.conf exists'; cat /etc/asterisk/http_custom.conf; else echo '✗ http_custom.conf NOT FOUND'; fi"

echo ""
echo "Step 7: Restarting Asterisk..."
echo "This may take 30-60 seconds..."
sshpass -p "$FREEPBX_PASS" ssh -o StrictHostKeyChecking=no -p "$FREEPBX_PORT" root@$FREEPBX_IP \
    "fwconsole restart"

echo ""
echo "Waiting for Asterisk to fully restart..."
sleep 10

echo ""
echo "Step 8: Verifying HTTP bind status after restart..."
HTTP_STATUS=$(sshpass -p "$FREEPBX_PASS" ssh -o StrictHostKeyChecking=no -p "$FREEPBX_PORT" root@$FREEPBX_IP \
    "asterisk -rx 'http show status' 2>&1")

echo "$HTTP_STATUS"

if echo "$HTTP_STATUS" | grep -q "0.0.0.0:8088"; then
    echo ""
    echo "✓✓✓ SUCCESS! HTTP server is now bound to 0.0.0.0:8088"
    echo "External connections should now work!"
elif echo "$HTTP_STATUS" | grep -q "127.0.0.1:8088"; then
    echo ""
    echo "✗✗✗ FAILED - HTTP server is still bound to 127.0.0.1:8088"
    echo "Possible issues:"
    echo "  1. http_custom.conf not created properly"
    echo "  2. Asterisk didn't fully restart"
    echo "  3. Another config file is overriding the setting"
else
    echo ""
    echo "⚠ WARNING - Unable to determine bind status"
fi

echo ""
echo "Step 9: Testing ARI endpoint from external connection..."
echo "Attempting connection to http://$FREEPBX_IP:8088/ari/recordings/stored"

HTTP_CODE=$(timeout 5 curl -s -o /dev/null -w "%{http_code}" http://$FREEPBX_IP:8088/ari/recordings/stored 2>&1)

if [ "$HTTP_CODE" == "401" ]; then
    echo "✓ Port 8088 is accessible! (Got 401 Unauthorized - authentication required)"
    echo "This is correct - ARI endpoint is reachable"
elif [ "$HTTP_CODE" == "000" ] || [ -z "$HTTP_CODE" ]; then
    echo "✗ Port 8088 is NOT accessible (Connection refused or timeout)"
    echo "Check firewall: firewall-cmd --list-ports"
else
    echo "Got HTTP code: $HTTP_CODE"
fi

echo ""
echo "======================================"
echo "Deployment Complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo "1. Go to FreePBX GUI: Admin → ARI Connector"
echo "2. Configure ARI username and password"
echo "3. Click 'Apply Configuration'"
echo "4. Test connection from your application"
echo ""
echo "To test manually:"
echo "  curl -u USERNAME:PASSWORD http://$FREEPBX_IP:8088/ari/recordings/stored"
echo ""

