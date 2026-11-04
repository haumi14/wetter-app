#!/usr/bin/env python3
"""
Dev-Server für die Wetter-App: statische Dateien + kleiner Proxy.

Der Proxy (Pfad /bsh-api/<datei>) leitet Anfragen an die amtlichen
Gezeitendaten des BSH (https://gezeiten.bsh.de/data/…) weiter, weil die BSH
keinen CORS-Header sendet und der Browser sonst blockiert.

Er läuft auf allen Netzinterfaces – ein Handy im selben WLAN öffnet einfach
die beim Start angezeigte Adresse (http://<Rechner-IP>:8777) und bekommt
dann ebenfalls den Proxy, also auch die amtlichen Tiden.

Start:  python dev-server.py  (Port 8777)
"""
import http.server
import socketserver
import socket
import urllib.request
import sys

PORT = 8777
BSH_DATA = "https://gezeiten.bsh.de/data/"


def lan_adresse():
    """Beste lokale IPv4-Adresse (über einen ungenutzten UDP-Socket)."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("10.255.255.255", 1))
        return sock.getsockname()[0]
    except OSError:
        return None
    finally:
        sock.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    # Korrekte Typen für PWA-Dateien (Windows-Mimetypes kennen das oft nicht)
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
    }

    def do_GET(self):  # noqa: N802 (Namingvorgabe der Basisklasse)
        self._kein_cache = False
        if self.path.startswith("/bsh-api/"):
            datei = self.path[len("/bsh-api/"):].split("?")[0]
            try:
                anfrage = urllib.request.Request(
                    BSH_DATA + datei,
                    headers={"User-Agent": "wetter-app-dev/1.0"},
                )
                with urllib.request.urlopen(anfrage, timeout=20) as antwort:
                    inhalt = antwort.read()
                    self.send_response(antwort.status)
                    self.send_header("Content-Type",
                                     antwort.headers.get("Content-Type", "application/json"))
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.send_header("Cache-Control", "max-age=300")
                    self.end_headers()
                    self.wfile.write(inhalt)
            except Exception as fehler:  # noqa: BLE001
                text = f'{{"error": "{fehler}"}}'.encode()
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(text)
            return
        # Entwickerserver: statische Dateien NIE zwischenspeichern lassen.
        # Sonst zeigen Browser und Modulschalter tagelang alte Skripte an,
        # obwohl die Dateien auf der Festplatte schon neu sind. Der Offline-
        # Vorrat der PWA bleibt trotzdem – der Service Worker legt seine eigene
        # Cache-Kopie an (die Cache-Schnittstelle gilt unabhängig davon).
        self._kein_cache = True
        super().do_GET()

    def end_headers(self):
        if getattr(self, "_kein_cache", False):
            self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    # Windows-Konsolen kennen nicht jedes Zeichen (z. B. Gedankenstriche) –
    # Ausgabe nie am Encoding scheitern lassen.
    try:
        sys.stdout.reconfigure(errors="replace")
    except Exception:  # noqa: BLE001
        pass
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Wetter-App (PWA): http://localhost:{PORT}/  (inkl. BSH-Proxy /bsh-api/)")
        ip = lan_adresse()
        if ip:
            print(f"Handy im selben WLAN: http://{ip}:{PORT}/  -> zum Startbildschirm hinzufuegen")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            sys.exit(0)
