"""
Native window wrapper around main.py's Flask server, using pywebview so the
mixer UI feels like a desktop app instead of "open your browser".
"""

import threading

import webview

from main import app

HOST = "127.0.0.1"
PORT = 5000


def _run_server():
    app.run(host=HOST, port=PORT, threaded=True, use_reloader=False)


def main():
    server_thread = threading.Thread(target=_run_server, daemon=True)
    server_thread.start()

    webview.create_window(
        "UR44 DSP Mixer",
        f"http://{HOST}:{PORT}",
        width=1320,
        height=900,
        min_size=(800, 560),
    )
    webview.start()


if __name__ == "__main__":
    main()
