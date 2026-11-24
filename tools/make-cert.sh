#!/usr/bin/env bash
# Generates a self-signed certificate for LAN access.
#
# Background: the Screen Wake Lock API requires a secure context. There's
# none over http://<LAN-IP>, so a tablet's display falls asleep mid-flight.
# A certificate fixes this.
#
# Important: iOS and Android check subjectAltName exclusively, not the
# Common Name. Without the IP in the SAN, the certificate gets rejected even
# after manual confirmation.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p certs

# Collect every active IPv4 address, so the certificate works regardless of
# which interface is currently in use.
SAN="DNS:localhost,IP:127.0.0.1"
for i in $(ifconfig -l 2>/dev/null || true); do
  ip=$(ipconfig getifaddr "$i" 2>/dev/null || true)
  [ -n "$ip" ] && SAN="$SAN,IP:$ip"
done
# Linux fallback
if [ "$SAN" = "DNS:localhost,IP:127.0.0.1" ] && command -v hostname >/dev/null; then
  for ip in $(hostname -I 2>/dev/null || true); do SAN="$SAN,IP:$ip"; done
fi

echo "subjectAltName: $SAN"

# 825 days is the upper bound iOS accepts for manually trusted certificates
# -- longer ones get rejected without any message.
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout certs/key.pem -out certs/cert.pem \
  -subj "/CN=dcs-map-server" \
  -addext "subjectAltName=$SAN" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" 2>/dev/null

chmod 600 certs/key.pem
echo
echo "Certificate is in certs/. Restart the server, then:"
echo "  https://<LAN-IP>:8443"
echo
echo "The browser will warn on first visit -- accept the exception. After that"
echo "the page counts as a secure context and Wake Lock works."
echo
echo "To avoid the warning, use mkcert (a local CA of your own, install once"
echo "on the device): brew install mkcert && mkcert -install &&"
echo "  mkcert -key-file certs/key.pem -cert-file certs/cert.pem localhost 127.0.0.1 <LAN-IP>"
