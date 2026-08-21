"""Local dev server that always serves fresh files - no browser caching, ever.

Plain `python -m http.server` sends no cache-control headers, so mobile browsers
apply their own heuristic caching and can silently keep serving an old JS file
after an edit. This subclass forces every response to be non-cacheable, so a
plain page refresh always picks up the latest saved code - no hard-refresh /
cache-clear needed on the phone.
"""
import http.server
import socketserver

PORT = 8080


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


if __name__ == '__main__':
    with ReusableTCPServer(('0.0.0.0', PORT), NoCacheHandler) as httpd:
        print(f'Serving (no-cache) on 0.0.0.0:{PORT}')
        httpd.serve_forever()
