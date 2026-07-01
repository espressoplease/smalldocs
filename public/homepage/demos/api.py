"""
A tiny HTTP handler that puts the token-bucket limiter in front of an endpoint.

One bucket per client IP. Every request spends a token; when a client's bucket
runs dry it gets a 429 with a Retry-After header telling it when to come back.
"""

from http.server import BaseHTTPRequestHandler
from rate_limiter import TokenBucket

# One bucket per client: 10-request burst, refilling at 5 per second.
_buckets: dict[str, TokenBucket] = {}


def bucket_for(client_ip: str) -> TokenBucket:
    # First time we see a client, hand it a full bucket.
    if client_ip not in _buckets:
        _buckets[client_ip] = TokenBucket(capacity=10, refill_per_sec=5)
    return _buckets[client_ip]


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        client = self.client_address[0]
        bucket = bucket_for(client)

        # Spend one token for this request. take() returns False when the
        # client has run out, which is our signal to throttle it.
        if not bucket.take():
            wait = bucket.retry_after()
            self.log_message("throttled %s, retry in %.0fs", client, wait)
            self.send_response(429)
            self.send_header("Retry-After", f"{wait:.0f}")
            self.end_headers()
            self.wfile.write(b"rate limited\n")
            return

        # A token was available, so this request is allowed through. Build the
        # normal response and send it back.
        body = b"ok\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
