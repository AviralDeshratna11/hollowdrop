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


class ReusableTCPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    # Plain TCPServer handles exactly one request at a time - fine for the JS/CSS/HTML
    # this server was built for, but the FBX character models each pull in 5 large
    # files (a multi-MB mesh plus 4 textures) via Promise.all, all requested together.
    # Single-threaded, those 10 files (two models) queue up and get served ONE AT A
    # TIME regardless of the browser trying to fetch them in parallel - measured over
    # 4 seconds before the second model's very first byte, even on localhost, entirely
    # from this queuing rather than any actual network transfer time. ThreadingMixIn
    # lets the OS-level connection-accept order (which the browser can't fully control
    # anyway) resolve into real concurrent transfers instead of an artificial serial
    # bottleneck this file was itself introducing.
    allow_reuse_address = True
    daemon_threads = True  # worker threads die with the process - no hung threads on Ctrl+C


if __name__ == '__main__':
    with ReusableTCPServer(('0.0.0.0', PORT), NoCacheHandler) as httpd:
        print(f'Serving (no-cache) on 0.0.0.0:{PORT}')
        httpd.serve_forever()
