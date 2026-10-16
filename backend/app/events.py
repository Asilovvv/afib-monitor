"""In-process event broker for live updates (Server-Sent Events) to doctors' dashboards."""
import asyncio
import json
from collections import defaultdict


class Broker:
    def __init__(self):
        self.loop: asyncio.AbstractEventLoop | None = None
        self.subs: dict[int, set[asyncio.Queue]] = defaultdict(set)

    def subscribe(self, doctor_id: int) -> asyncio.Queue:
        if self.loop is None:
            self.loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self.subs[doctor_id].add(q)
        return q

    def unsubscribe(self, doctor_id: int, q: asyncio.Queue):
        self.subs[doctor_id].discard(q)

    def publish(self, doctor_id: int | None, event: str, data: dict):
        """Thread-safe: may be called from sync request handlers running in the thread pool."""
        if doctor_id is None or self.loop is None or not self.subs.get(doctor_id):
            return
        msg = f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"

        def push():
            for q in list(self.subs.get(doctor_id, ())):
                if not q.full():
                    q.put_nowait(msg)
        self.loop.call_soon_threadsafe(push)


broker = Broker()
