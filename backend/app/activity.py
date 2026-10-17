"""When did a person last use the API? (Render health pings do not count.)"""
import time

_last = time.monotonic()


def touch() -> None:
    global _last
    _last = time.monotonic()


def idle_s() -> float:
    return time.monotonic() - _last
