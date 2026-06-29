"""
A token-bucket rate limiter.

The idea: a bucket holds tokens up to some capacity. Tokens refill at a steady
rate. Every request spends one token; if the bucket is empty, the request is
turned away and the caller is told how long to wait. It smooths bursts without
a background timer - the bucket is "refilled" lazily, by looking at the clock
the moment someone asks.
"""

import time
from dataclasses import dataclass, field


@dataclass
class TokenBucket:
    capacity: int            # most tokens the bucket can hold (the burst size)
    refill_per_sec: float    # tokens added per second when not full
    _tokens: float = field(init=False)
    _last: float = field(init=False)

    def __post_init__(self):
        # Start full, so a fresh client gets its whole burst immediately.
        self._tokens = self.capacity
        self._last = time.monotonic()

    def _refill(self):
        # Lazy refill: add only the tokens earned since we last looked, and
        # never overflow the capacity. monotonic() can't go backwards, so the
        # elapsed time is always >= 0 even if the wall clock is adjusted.
        now = time.monotonic()
        earned = (now - self._last) * self.refill_per_sec
        self._tokens = min(self.capacity, self._tokens + earned)
        self._last = now

    def take(self, n: int = 1) -> bool:
        """Spend n tokens if available. Returns True if the request may proceed."""
        self._refill()
        if self._tokens >= n:
            self._tokens -= n        # enough in the bucket - let it through
            return True
        return False                 # caller should back off and retry later

    def retry_after(self, n: int = 1) -> float:
        """Seconds until n tokens are available (0 if they already are)."""
        self._refill()
        if self._tokens >= n:
            return 0.0
        deficit = n - self._tokens
        return deficit / self.refill_per_sec


if __name__ == "__main__":
    # 5 requests of burst, then 2 per second. Hammer it and watch it throttle.
    bucket = TokenBucket(capacity=5, refill_per_sec=2)
    for i in range(8):
        if bucket.take():
            print(f"request {i}: ok")
        else:
            print(f"request {i}: wait {bucket.retry_after():.2f}s")
