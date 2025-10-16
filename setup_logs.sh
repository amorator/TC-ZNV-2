#!/bin/bash
# Setup script for ZNF application with proper log rotation

set -e

echo "Setting up ZNF application with log rotation..."

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo "This script should not be run as root for security reasons"
   exit 1
fi

# Create logs directory with proper permissions
sudo mkdir -p /usr/share/znf/logs
sudo chown www-data:www-data /usr/share/znf/logs
sudo chmod 755 /usr/share/znf/logs

# Install logrotate configuration
echo "Installing logrotate configuration..."
sudo cp /usr/share/znf/logrotate.conf /etc/logrotate.d/znf

# Install systemd service
echo "Installing systemd service..."
sudo cp /usr/share/znf/znf.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable znf.service

# Create PID file directory for gunicorn
sudo mkdir -p /var/run/gunicorn
sudo chown www-data:www-data /var/run/gunicorn

# Test logrotate configuration
echo "Testing logrotate configuration..."
sudo logrotate -d /etc/logrotate.d/znf

echo "Setup complete!"
echo ""
echo "To start the service:"
echo "  sudo systemctl start znf.service"
echo ""
echo "To check logs:"
echo "  sudo journalctl -u znf.service -f"
echo "  tail -f /usr/share/znf/logs/gerror.log"
echo ""
echo "To restart after configuration changes:"
echo "  sudo systemctl restart znf.service"
