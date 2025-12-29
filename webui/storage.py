from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from typing import Any, Iterable


class Storage:
    def __init__(self, db_path: str) -> None:
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self._init_db()

    def _init_db(self) -> None:
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS services (
                id INTEGER PRIMARY KEY,
                url TEXT UNIQUE,
                name TEXT NULL,
                created_at TEXT
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sweeps (
                id INTEGER PRIMARY KEY,
                ts TEXT,
                mode TEXT,
                checked INTEGER,
                up INTEGER,
                down INTEGER,
                duration_ms INTEGER
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS last_inputs (
                id INTEGER PRIMARY KEY CHECK(id = 1),
                ts TEXT,
                mode TEXT,
                targets TEXT
            )
            """
        )
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS checks (
                id INTEGER PRIMARY KEY,
                sweep_id INTEGER,
                service_id INTEGER,
                ts TEXT,
                ok INTEGER,
                status TEXT,
                status_code INTEGER NULL,
                latency_ms INTEGER NULL,
                error TEXT NULL
            )
            """
        )
        self._ensure_column("checks", "sweep_id", "INTEGER")
        self.conn.commit()

    def _ensure_column(self, table: str, column: str, column_type: str) -> None:
        cursor = self.conn.execute(f"PRAGMA table_info({table})")
        columns = {row[1] for row in cursor.fetchall()}
        if column not in columns:
            self.conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")

    def get_or_create_service(self, url: str) -> int:
        cursor = self.conn.execute("SELECT id FROM services WHERE url = ?", (url,))
        row = cursor.fetchone()
        if row:
            return int(row["id"])

        created_at = datetime.now(timezone.utc).isoformat()
        cursor = self.conn.execute(
            "INSERT INTO services (url, name, created_at) VALUES (?, ?, ?)",
            (url, None, created_at),
        )
        self.conn.commit()
        return int(cursor.lastrowid)

    def insert_service(self, url: str, name: str | None = None) -> int:
        created_at = datetime.now(timezone.utc).isoformat()
        cursor = self.conn.execute(
            "INSERT OR IGNORE INTO services (url, name, created_at) VALUES (?, ?, ?)",
            (url, name, created_at),
        )
        self.conn.commit()
        if cursor.lastrowid:
            return int(cursor.lastrowid)
        return self.get_or_create_service(url)

    def count_services(self) -> int:
        cursor = self.conn.execute("SELECT COUNT(*) FROM services")
        return int(cursor.fetchone()[0])

    def insert_check(
        self,
        service_id: int,
        sweep_id: int | None,
        ok: bool,
        status: str,
        status_code: int | None,
        latency_ms: int | None,
        error: str | None,
    ) -> None:
        ts = datetime.now(timezone.utc).isoformat()
        self.conn.execute(
            """
            INSERT INTO checks (service_id, sweep_id, ts, ok, status, status_code, latency_ms, error)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                service_id,
                sweep_id,
                ts,
                1 if ok else 0,
                status,
                status_code,
                latency_ms,
                error,
            ),
        )
        self.conn.commit()

    def fetch_history(self, url: str, limit: int) -> Iterable[dict[str, Any]]:
        cursor = self.conn.execute(
            """
            SELECT checks.ts, checks.ok, checks.status, checks.status_code,
                   checks.latency_ms, checks.error
            FROM checks
            JOIN services ON services.id = checks.service_id
            WHERE services.url = ?
            ORDER BY checks.id DESC
            LIMIT ?
            """,
            (url, limit),
        )
        for row in cursor.fetchall():
            yield {
                "ts": row["ts"],
                "ok": bool(row["ok"]),
                "status": row["status"],
                "status_code": row["status_code"],
                "latency_ms": row["latency_ms"],
                "error": row["error"],
            }

    def fetch_services(self, limit: int) -> Iterable[dict[str, Any]]:
        cursor = self.conn.execute(
            """
            SELECT url, name, created_at
            FROM services
            ORDER BY id ASC
            LIMIT ?
            """,
            (limit,),
        )
        for row in cursor.fetchall():
            yield {
                "url": row["url"],
                "name": row["name"],
                "created_at": row["created_at"],
            }

    def fetch_http_overview(self, limit: int) -> list[dict[str, Any]]:
        rows = self.conn.execute(
            """
            WITH ranked AS (
                SELECT checks.id,
                       checks.service_id,
                       checks.ts,
                       checks.status,
                       checks.latency_ms,
                       ROW_NUMBER() OVER (PARTITION BY checks.service_id ORDER BY checks.id DESC) AS rn
                FROM checks
            )
            SELECT ranked.id,
                   ranked.ts,
                   ranked.status,
                   ranked.latency_ms,
                   services.url
            FROM ranked
            JOIN services ON services.id = ranked.service_id
            WHERE ranked.rn <= ?
            ORDER BY services.url ASC, ranked.id ASC
            """,
            (limit,),
        ).fetchall()

        if not rows:
            return []

        service_rows: dict[str, dict[str, Any]] = {}
        for row in rows:
            url = row["url"]
            entry = service_rows.get(url)
            if entry is None:
                entry = {
                    "service": url,
                    "latencies": [],
                    "_latest_id": -1,
                    "_latest_status": None,
                    "_latest_latency_ms": None,
                    "_last_checked_at": None,
                    "_total": 0,
                    "_up": 0,
                    "_error_count": 0,
                    "_latency_sum": 0,
                    "_latency_count": 0,
                }
                service_rows[url] = entry

            latency_ms = row["latency_ms"]
            entry["latencies"].append(latency_ms if latency_ms is not None else None)

            entry["_total"] += 1
            status = row["status"]
            if status == "UP":
                entry["_up"] += 1
            else:
                entry["_error_count"] += 1

            if latency_ms is not None:
                entry["_latency_sum"] += int(latency_ms)
                entry["_latency_count"] += 1

            check_id = int(row["id"])
            if check_id > entry["_latest_id"]:
                entry["_latest_id"] = check_id
                entry["_latest_status"] = status
                entry["_latest_latency_ms"] = latency_ms if latency_ms is not None else None
                entry["_last_checked_at"] = row["ts"]

        results: list[dict[str, Any]] = []
        for entry in service_rows.values():
            total = entry["_total"]
            up = entry["_up"]
            latency_count = entry["_latency_count"]
            avg_latency = None
            if latency_count > 0:
                avg_latency = int(round(entry["_latency_sum"] / latency_count))
            uptime_pct = int(round((up / total) * 100)) if total else 0
            results.append(
                {
                    "service": entry["service"],
                    "latest_status": entry["_latest_status"] or "UNKNOWN",
                    "uptime_pct": uptime_pct,
                    "avg_latency_ms": avg_latency,
                    "latest_latency_ms": entry["_latest_latency_ms"],
                    "last_checked_at": entry["_last_checked_at"],
                    "latencies": entry["latencies"],
                    "_error_count": entry["_error_count"],
                }
            )

        status_rank = {"DOWN": 0, "DEGRADED": 1, "UP": 2}
        results.sort(
            key=lambda item: (
                status_rank.get(item["latest_status"], 3),
                -int(item["_error_count"]),
                -(item["avg_latency_ms"] if item["avg_latency_ms"] is not None else -1),
            )
        )
        for item in results:
            item.pop("_error_count", None)
        return results

    def create_sweep(self, mode: str) -> int:
        ts = datetime.now(timezone.utc).isoformat()
        cursor = self.conn.execute(
            """
            INSERT INTO sweeps (ts, mode, checked, up, down, duration_ms)
            VALUES (?, ?, 0, 0, 0, 0)
            """,
            (ts, mode),
        )
        self.conn.commit()
        return int(cursor.lastrowid)

    def update_sweep(self, sweep_id: int, checked: int, up: int, down: int, duration_ms: int) -> None:
        self.conn.execute(
            """
            UPDATE sweeps
            SET checked = ?, up = ?, down = ?, duration_ms = ?
            WHERE id = ?
            """,
            (checked, up, down, duration_ms, sweep_id),
        )
        self.conn.commit()

    def fetch_sweeps(self, limit: int) -> Iterable[dict[str, Any]]:
        cursor = self.conn.execute(
            """
            SELECT id, ts, mode, checked, up, down, duration_ms
            FROM sweeps
            WHERE mode = 'http'
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        )
        for row in cursor.fetchall():
            yield {
                "id": row["id"],
                "ts": row["ts"],
                "mode": row["mode"],
                "checked": row["checked"],
                "up": row["up"],
                "down": row["down"],
                "duration_ms": row["duration_ms"],
            }

    def fetch_health(self, limit_sweeps: int) -> Iterable[dict[str, Any]]:
        sweep_rows = list(self.conn.execute("SELECT id FROM sweeps WHERE mode = 'http' ORDER BY id DESC LIMIT ?", (limit_sweeps,)))
        sweep_ids = [row[0] for row in sweep_rows]
        if not sweep_ids:
            return []

        placeholders = ",".join("?" for _ in sweep_ids)
        cursor = self.conn.execute(
            f"""
            SELECT services.url AS url,
                   COUNT(*) AS checks,
                   SUM(CASE WHEN checks.status = 'UP' THEN 1 ELSE 0 END) AS up,
                   SUM(CASE WHEN checks.status = 'DOWN' THEN 1 ELSE 0 END) AS down,
                   SUM(CASE WHEN checks.status = 'DEGRADED' THEN 1 ELSE 0 END) AS degraded,
                   AVG(checks.latency_ms) AS avg_latency_ms,
                   MAX(checks.id) AS last_check_id
            FROM checks
            JOIN services ON services.id = checks.service_id
            WHERE checks.sweep_id IN ({placeholders})
            GROUP BY services.url
            ORDER BY services.url ASC
            """,
            sweep_ids,
        )
        rows = cursor.fetchall()
        last_status_map: dict[int, str] = {}
        if rows:
            last_ids = [row["last_check_id"] for row in rows if row["last_check_id"] is not None]
            if last_ids:
                placeholders_ids = ",".join("?" for _ in last_ids)
                last_cursor = self.conn.execute(
                    f"SELECT id, status FROM checks WHERE id IN ({placeholders_ids})",
                    last_ids,
                )
                last_status_map = {row["id"]: row["status"] for row in last_cursor.fetchall()}

        results: list[dict[str, Any]] = []
        for row in rows:
            checks = int(row["checks"])
            up = int(row["up"] or 0)
            down = int(row["down"] or 0)
            degraded = int(row["degraded"] or 0)
            avg_latency = row["avg_latency_ms"]
            uptime_pct = round((up / checks) * 100) if checks else 0
            error_count = down + degraded

            status_rows = list(
                self.conn.execute(
                    f"""
                    SELECT status
                    FROM checks
                    JOIN services ON services.id = checks.service_id
                    WHERE services.url = ? AND checks.sweep_id IN ({placeholders})
                    ORDER BY checks.id DESC
                    LIMIT 10
                    """,
                    (row["url"], *sweep_ids),
                )
            )
            last_statuses = [status_row["status"] for status_row in status_rows][::-1]

            results.append(
                {
                    "url": row["url"],
                    "checks": checks,
                    "up": up,
                    "down": down,
                    "degraded": degraded,
                    "uptime_pct": uptime_pct,
                    "last_status": last_status_map.get(row["last_check_id"], "UNKNOWN"),
                    "avg_latency_ms": round(avg_latency) if avg_latency is not None else None,
                    "last_statuses": last_statuses,
                    "_error_count": error_count,
                }
            )

        status_rank = {"DOWN": 0, "DEGRADED": 1, "UP": 2}
        results.sort(
            key=lambda item: (
                status_rank.get(item["last_status"], 3),
                -int(item["_error_count"]),
                -(item["avg_latency_ms"] if item["avg_latency_ms"] is not None else -1),
            )
        )
        for item in results:
            item.pop("_error_count", None)
        return results

    def set_last_inputs(self, mode: str, targets: str) -> None:
        ts = datetime.now(timezone.utc).isoformat()
        self.conn.execute(
            """
            INSERT INTO last_inputs (id, ts, mode, targets)
            VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, mode = excluded.mode, targets = excluded.targets
            """,
            (ts, mode, targets),
        )
        self.conn.commit()

    def get_last_inputs(self) -> dict[str, Any] | None:
        cursor = self.conn.execute("SELECT ts, mode, targets FROM last_inputs WHERE id = 1")
        row = cursor.fetchone()
        if not row:
            return None
        return {"ts": row["ts"], "mode": row["mode"], "targets": row["targets"]}
