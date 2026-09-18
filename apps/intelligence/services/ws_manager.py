"""
WebSocket Manager — holds active connections keyed by contract_id
and pushes job-progress events from a MongoDB-poll loop.
"""
import asyncio
import logging
from typing import Dict, Set
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WebSocketManager:
    """
    Singleton that tracks active WebSocket connections.

    Each entry in `_connections` maps a contract_id to a set of WebSocket
    objects (multiple browser tabs / clients can watch the same contract).
    """

    def __init__(self):
        # contract_id -> set of active WebSocket connections
        self._connections: Dict[str, Set[WebSocket]] = {}

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    def subscribe(self, contract_id: str, ws: WebSocket) -> None:
        """Register a socket as interested in `contract_id` events."""
        self._connections.setdefault(contract_id, set()).add(ws)
        logger.info(
            f"WS subscribe: contract={contract_id}, "
            f"total_sockets={len(self._connections[contract_id])}"
        )

    def unsubscribe(self, contract_id: str, ws: WebSocket) -> None:
        """Remove a socket subscription. Cleans up empty entries."""
        sockets = self._connections.get(contract_id)
        if sockets:
            sockets.discard(ws)
            if not sockets:
                del self._connections[contract_id]
        logger.info(f"WS unsubscribe: contract={contract_id}")

    # ------------------------------------------------------------------
    # Broadcasting
    # ------------------------------------------------------------------

    async def broadcast(self, contract_id: str, payload: dict) -> None:
        """
        Push `payload` to all sockets watching `contract_id`.
        Silently drops dead connections.
        """
        sockets = self._connections.get(contract_id, set()).copy()
        dead: Set[WebSocket] = set()

        for ws in sockets:
            try:
                await ws.send_json(payload)
            except Exception as exc:
                logger.debug(f"WS send failed (cleaning up): {exc}")
                dead.add(ws)

        # Clean up disconnected sockets
        for ws in dead:
            self.unsubscribe(contract_id, ws)

    def has_subscribers(self, contract_id: str) -> bool:
        return bool(self._connections.get(contract_id))


# Module-level singleton shared by the entire FastAPI process
ws_manager = WebSocketManager()
