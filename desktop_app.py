"""
Native window wrapper around main.py's Flask server, using pywebview so the
mixer UI feels like a desktop app instead of "open your browser".
"""

import os
import threading
from pathlib import Path

import webview

from main import app

HOST = "127.0.0.1"
PORT = 5000
ICON_PATH = Path(__file__).parent / "assets" / "icon-256.png"


def _run_server():
    app.run(host=HOST, port=PORT, threaded=True, use_reloader=False)


def _setup_tray_icon(window):
    """
    System tray icon (KDE's Plasma panel, next to the volume/network icons)
    via AppIndicator3 - only wired up if that GI binding is actually
    available, since it needs libayatana/libappindicator on the system.
    """
    try:
        import gi

        gi.require_version("AppIndicator3", "0.1")
        gi.require_version("Gtk", "3.0")
        from gi.repository import AppIndicator3, Gtk
    except (ImportError, ValueError):
        return

    indicator = AppIndicator3.Indicator.new(
        "ur44-dsp-mixer",
        "ur44-dsp-mixer",
        AppIndicator3.IndicatorCategory.APPLICATION_STATUS,
    )
    indicator.set_status(AppIndicator3.IndicatorStatus.ACTIVE)

    menu = Gtk.Menu()

    show_item = Gtk.MenuItem(label="Mostrar")
    show_item.connect("activate", lambda _: window.show())
    menu.append(show_item)

    hide_item = Gtk.MenuItem(label="Esconder")
    hide_item.connect("activate", lambda _: window.hide())
    menu.append(hide_item)

    menu.append(Gtk.SeparatorMenuItem())

    quit_item = Gtk.MenuItem(label="Sair")
    quit_item.connect("activate", lambda _: os._exit(0))
    menu.append(quit_item)

    menu.show_all()
    indicator.set_menu(menu)

    # keep a reference alive for the lifetime of the app - GC would
    # otherwise tear the indicator down almost immediately
    window._tray_indicator = indicator


def main():
    server_thread = threading.Thread(target=_run_server, daemon=True)
    server_thread.start()

    window = webview.create_window(
        "UR44 DSP Mixer",
        f"http://{HOST}:{PORT}",
        width=1010,
        height=740,
        min_size=(900, 620),
    )
    webview.start(_setup_tray_icon, window, icon=str(ICON_PATH))


if __name__ == "__main__":
    main()
