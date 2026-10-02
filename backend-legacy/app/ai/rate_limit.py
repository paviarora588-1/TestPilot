from __future__ import annotations

import math
from collections import deque
from threading import Lock
from time import monotonic


class SlidingWindowRateLimiter:
    def __init__(self, max_requests: int, window_seconds: int = 60) -> None:
        self.max_requests = max(0, int(max_requests))
        self.window_seconds = max(1, int(window_seconds))
        self._events: deque[float] = deque()
        self._lock = Lock()

    def acquire(self) -> float:
        if self.max_requests <= 0:
            return 0.0

        now = monotonic()
        cutoff = now - self.window_seconds

        with self._lock:
            while self._events and self._events[0] <= cutoff:
                self._events.popleft()

            if len(self._events) >= self.max_requests:
                retry_after = self.window_seconds - (now - self._events[0])
                return float(max(1, math.ceil(retry_after)))

            self._events.append(now)
            return 0.0
