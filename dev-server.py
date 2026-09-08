"""Local dev server that always serves fresh files - no browser caching, ever.

Plain `python -m http.server` sends no cache-control headers, so mobile browsers
apply their own heuristic caching and can silently keep serving an old JS file
after an edit. This subclass forces every response to be non-cacheable, so a
plain page refresh always picks up the latest saved code - no hard-refresh /
cache-clear needed on the phone.
"""
import http.server
import os
import re
import socketserver

PORT = 8080


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        self._range_remaining = None
        # Strip conditional request headers so server always sends HTTP 200 with fresh body
        if 'If-Modified-Since' in self.headers:
            del self.headers['If-Modified-Since']
        if 'If-None-Match' in self.headers:
            del self.headers['If-None-Match']
        # Media players can request metadata/the next segment without downloading
        # the whole intro. Ordinary game files keep SimpleHTTPRequestHandler behavior.
        path = self.translate_path(self.path)
        requested = self.headers.get('Range', '')
        if path.lower().endswith('.mp4') and os.path.isfile(path):
            match = re.fullmatch(r'bytes=(\d*)-(\d*)', requested)
            if match and any(match.groups()):
                try:
                    media = open(path, 'rb')
                except OSError:
                    self.send_error(404, 'Video not found')
                    return None
                size = os.fstat(media.fileno()).st_size
                first, last = match.groups()
                start = int(first) if first else max(0, size - int(last))
                end = min(int(last), size - 1) if first and last else size - 1
                if start > end or start >= size:
                    media.close()
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{size}')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return None
                media.seek(start)
                self._range_remaining = end - start + 1
                self.send_response(206)
                self.send_header('Content-Type', 'video/mp4')
                self.send_header('Accept-Ranges', 'bytes')
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                self.send_header('Content-Length', str(self._range_remaining))
                self.end_headers()
                return media
        return super().send_head()

    def copyfile(self, source, outputfile):
        if self._range_remaining is None:
            return super().copyfile(source, outputfile)
        remaining = self._range_remaining
        try:
            while remaining > 0:
                chunk = source.read(min(64 * 1024, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # Skipping the intro cancels an in-flight media request normally.

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
