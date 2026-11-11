#!/usr/bin/env bash
# Installs the Network Dashboard agent as a systemd service.
# Usage: sudo ./install.sh <token> [services]   e.g. sudo ./install.sh s3cret pihole-FTL,nginx
set -euo pipefail

TOKEN="${1:?usage: sudo ./install.sh <token> [comma-separated services]}"
SERVICES="${2:-}"
RUN_AS="${SUDO_USER:-$(whoami)}"
DIR=/opt/dashboard-agent

install -d "$DIR"
install -m 755 "$(dirname "$0")/dashboard_agent.py" "$DIR/dashboard_agent.py"

sed -e "s/^User=.*/User=${RUN_AS}/" \
    -e "s/DASHBOARD_AGENT_TOKEN=.*/DASHBOARD_AGENT_TOKEN=${TOKEN}/" \
    -e "s/DASHBOARD_AGENT_SERVICES=.*/DASHBOARD_AGENT_SERVICES=${SERVICES}/" \
    "$(dirname "$0")/dashboard-agent.service" > /etc/systemd/system/dashboard-agent.service
chmod 600 /etc/systemd/system/dashboard-agent.service

systemctl daemon-reload
systemctl enable --now dashboard-agent
echo "Agent running – test with: curl -H 'Authorization: Bearer ${TOKEN}' http://$(hostname).local:61209/stats"
