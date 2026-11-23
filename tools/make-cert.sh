#!/usr/bin/env bash
# Erzeugt ein selbstsigniertes Zertifikat fuer den LAN-Zugriff.
#
# Hintergrund: Die Screen-Wake-Lock-API verlangt einen Secure Context. Ueber
# http://<LAN-IP> gibt es den nicht, das Display eines Tablets schlaeft also
# mitten im Flug ein. Ein Zertifikat loest das.
#
# Wichtig: iOS und Android pruefen ausschliesslich subjectAltName, nicht den
# Common Name. Ohne die IP im SAN wird das Zertifikat auch nach manueller
# Bestaetigung abgelehnt.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p certs

# Alle aktiven IPv4-Adressen einsammeln, damit das Zertifikat unabhaengig vom
# gerade genutzten Interface passt.
SAN="DNS:localhost,IP:127.0.0.1"
for i in $(ifconfig -l 2>/dev/null || true); do
  ip=$(ipconfig getifaddr "$i" 2>/dev/null || true)
  [ -n "$ip" ] && SAN="$SAN,IP:$ip"
done
# Linux-Rueckfall
if [ "$SAN" = "DNS:localhost,IP:127.0.0.1" ] && command -v hostname >/dev/null; then
  for ip in $(hostname -I 2>/dev/null || true); do SAN="$SAN,IP:$ip"; done
fi

echo "subjectAltName: $SAN"

# 825 Tage ist die Obergrenze, die iOS fuer manuell vertraute Zertifikate
# akzeptiert -- laengere werden kommentarlos abgelehnt.
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout certs/key.pem -out certs/cert.pem \
  -subj "/CN=dcs-map-server" \
  -addext "subjectAltName=$SAN" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth" 2>/dev/null

chmod 600 certs/key.pem
echo
echo "Zertifikat liegt in certs/. Server neu starten, dann:"
echo "  https://<LAN-IP>:8443"
echo
echo "Beim ersten Aufruf warnt der Browser -- Ausnahme bestaetigen. Danach gilt"
echo "die Seite als Secure Context und Wake Lock funktioniert."
echo
echo "Ohne Warnung geht es mit mkcert (eigene lokale CA, einmal auf dem Geraet"
echo "installieren): brew install mkcert && mkcert -install &&"
echo "  mkcert -key-file certs/key.pem -cert-file certs/cert.pem localhost 127.0.0.1 <LAN-IP>"
