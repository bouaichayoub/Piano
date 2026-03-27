#!/usr/bin/env python3
"""
server.py — local HTTPS server for the Piano web app.

HTTPS is required so mobile browsers allow camera access.

Usage:
    cd web/
    python3 server.py

Then open https://<your-local-IP>:8443 on your phone
and accept the self-signed certificate warning.
"""

import http.server
import os
import socket
import ssl
import subprocess
import sys

PORT      = 8443
BASE_DIR  = os.path.dirname(os.path.abspath(__file__))
CERT_FILE = os.path.join(BASE_DIR, "server.crt")
KEY_FILE  = os.path.join(BASE_DIR, "server.key")


def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def generate_cert():
    try:
        subprocess.run(
            [
                "openssl", "req", "-x509", "-newkey", "rsa:2048",
                "-keyout", KEY_FILE, "-out", CERT_FILE,
                "-days", "365", "-nodes",
                "-subj", "/CN=piano-app",
            ],
            check=True, capture_output=True,
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def main():
    if not (os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE)):
        print("Generating self-signed certificate...")
        if not generate_cert():
            print("ERROR: openssl not found. Install it and retry.")
            sys.exit(1)
        print("Certificate created.\n")

    os.chdir(BASE_DIR)

    handler = http.server.SimpleHTTPRequestHandler
    httpd   = http.server.HTTPServer(("0.0.0.0", PORT), handler)

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT_FILE, KEY_FILE)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    ip = get_local_ip()
    print("=" * 50)
    print("  Piano Finger Recognition - Web Server")
    print("=" * 50)
    print(f"\n  Open on your phone (same WiFi network):")
    print(f"\n    https://{ip}:{PORT}\n")
    print("  Accept the certificate warning in your browser.")
    print("  Press Ctrl+C to stop.\n")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")


if __name__ == "__main__":
    main()
