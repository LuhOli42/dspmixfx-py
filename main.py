"""
dspmixfx-py backend: exposes the UR44 DSP mixer (see ur44/protocol.py) as a
local HTTP + SSE API for the frontend/ web UI.
"""

from __future__ import annotations

import json
import queue
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_from_directory

from ur44 import UR44, DeviceNotFound
from ur44 import params as ur44params

BASE_DIR = Path(__file__).parent
FRONTEND_DIR = BASE_DIR / "frontend"
STATE_FILE = BASE_DIR / "state.json"

app = Flask(__name__, static_folder=None)

_subscribers: list[queue.Queue] = []


def _broadcast(event: dict) -> None:
    dead = []
    for q in _subscribers:
        try:
            q.put_nowait(event)
        except queue.Full:
            dead.append(q)
    for q in dead:
        _subscribers.remove(q)


device = UR44(on_change=_broadcast)


def _load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _save_state(data: dict) -> None:
    STATE_FILE.write_text(json.dumps(data, indent=2))


# -- static frontend --------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)


# -- device connection --------------------------------------------------------

@app.route("/api/ports")
def api_ports():
    return jsonify(UR44.list_ports())


@app.route("/api/connect", methods=["POST"])
def api_connect():
    port_name = (request.get_json(silent=True) or {}).get("port")
    try:
        device.connect(port_name)
    except DeviceNotFound as exc:
        return jsonify({"error": str(exc)}), 404
    return jsonify({"connected": True, "port": device.state.port_name})


@app.route("/api/disconnect", methods=["POST"])
def api_disconnect():
    device.disconnect()
    return jsonify({"connected": False})


@app.route("/api/status")
def api_status():
    return jsonify(
        {
            "connected": device.state.connected,
            "port": device.state.port_name,
            "values": device.state.values,
            "fxState": [
                {"type": fx.type, "mode": fx.mode, "stackIndex": fx.stack_index}
                for fx in device.state.fx_state
            ],
            "inputChannels": ur44params.INPUT_CHANNEL_TITLES,
        }
    )


# -- parameters --------------------------------------------------------

@app.route("/api/params")
def api_params():
    return jsonify(
        {
            name: {
                "number": p.number,
                "channel": p.channel,
                "min": p.min,
                "max": p.max,
                "default": p.default,
                "readOnly": p.read_only,
            }
            for name, p in ur44params.PARAMS.items()
        }
    )


@app.route("/api/params/<name>", methods=["POST"])
def api_set_param(name):
    body = request.get_json(force=True)
    value = body["value"]
    stack_index = body.get("stackIndex")
    try:
        device.update_param_value(name, value, stack_index)
    except (ValueError, RuntimeError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"ok": True})


@app.route("/api/dbfs-table")
def api_dbfs_table():
    return jsonify([None if v == float("-inf") else v for v in ur44params.DBFS_TABLE])


@app.route("/api/mix/<int:mix>", methods=["POST"])
def api_select_mix(mix):
    try:
        device.select_active_mix(mix)
    except RuntimeError as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"ok": True})


@app.route("/api/fx/<int:channel_index>", methods=["POST"])
def api_set_fx(channel_index):
    body = request.get_json(force=True)
    try:
        device.set_fx(channel_index, body["type"], body.get("mode"))
    except (ValueError, RuntimeError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"ok": True})


# -- UI preferences (not device state - the device is the source of truth) --

@app.route("/api/ui-state", methods=["GET"])
def api_get_ui_state():
    return jsonify(_load_state())


@app.route("/api/ui-state", methods=["POST"])
def api_set_ui_state():
    _save_state(request.get_json(force=True))
    return jsonify({"ok": True})


# -- live updates (meters, device-initiated parameter changes) --------------

@app.route("/api/events")
def api_events():
    q: queue.Queue = queue.Queue(maxsize=100)
    _subscribers.append(q)

    def stream():
        try:
            while True:
                event = q.get()
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            if q in _subscribers:
                _subscribers.remove(q)

    return Response(stream(), mimetype="text/event-stream")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, threaded=True)
