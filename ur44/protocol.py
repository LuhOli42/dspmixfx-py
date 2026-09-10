"""
UR44 DSP mixer control over MIDI SysEx.

Protocol ported from polyrainbow/steinmixer (Apache-2.0):
https://github.com/polyrainbow/steinmixer/blob/main/web/js/devices/UR44.js

steinmixer talks to the device from a browser via Web MIDI; here we use
python-rtmidi/mido instead, so port discovery and the actual byte I/O differ,
but every SysEx message shape below is unchanged from that reverse-engineering
work.

The init handshake (INIT_MESSAGES) has been verified against a real UR44 on
2026-09-09: it replies with the expected 3520-byte init dump. Full parameter
read/write round-tripping through the UI has not been exercised yet.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

import mido

from . import params as ur44params

FX_HEADER = [0xF0, 0x43, 0x10, 0x3E, 0x14, 0x03, 0x08]

INIT_MESSAGES = [
    [0xF0, 0x43, 0x10, 0x3E, 0x14, 0x03, 0x09, 0x01, 0x00, 0xF7],
    [
        0xF0, 0x43, 0x10, 0x3E, 0x14, 0x00, 0x01, 0x45, 0x44, 0x49, 0x54, 0x4F,
        0x52, 0x00, 0x32, 0x2E, 0x32, 0x2E, 0x30, 0x00, 0xF7,
    ],
    [
        0xF0, 0x43, 0x20, 0x3E, 0x14, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x03,
        0xF7,
    ],
    [0xF0, 0x43, 0x30, 0x3E, 0x14, 0x00, 0x07, 0x70, 0x02, 0xF7],
    # select active mix 1 (params 0x24 then 0x23)
    [
        0xF0, 0x43, 0x10, 0x3E, 0x14, 0x01, 0x01, 0x00, 0x00, 0x24, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xF7,
    ],
    [
        0xF0, 0x43, 0x10, 0x3E, 0x14, 0x01, 0x01, 0x00, 0x00, 0x23, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xF7,
    ],
    [0xF0, 0x43, 0x30, 0x3E, 0x14, 0x02, 0x02, 0x32, 0x7F, 0xF7],
]

CLOSE_MESSAGE = [0xF0, 0x43, 0x30, 0x3E, 0x14, 0x02, 0x02, 0x32, 0x00, 0xF7]

KEEPALIVE = [0xF0, 0x43, 0x10, 0x3E, 0x14, 0x00, 0x04, 0x02, 0xF7]


def get_budget_in_use(existing_active_types: list[str]) -> int:
    total = 0
    for t in existing_active_types:
        if t == "channel-strip":
            total += 1
        elif t == "amp":
            total += 2
        elif t == "off":
            continue
        else:
            raise ValueError(f"Unknown FX type: {t}")
    return total


def can_set_fx(fx_type: str, channel_index: int, existing_active_types: list[str]) -> bool:
    budget_in_use = get_budget_in_use(existing_active_types)
    existing_channel_type = existing_active_types[channel_index]

    if fx_type == "channel-strip":
        return budget_in_use < 4 or existing_channel_type != "off"
    if fx_type == "amp":
        amps_in_use = existing_active_types.count("amp")
        return (budget_in_use < 3 and amps_in_use == 0) or existing_channel_type == "amp"
    if fx_type == "off":
        return True
    raise ValueError(f"Unknown FX type: {fx_type}")


@dataclass
class FxState:
    type: str = "off"
    mode: Optional[str] = None
    stack_index: Optional[int] = None


@dataclass
class DeviceState:
    values: dict = field(default_factory=dict)
    fx_state: list[FxState] = field(default_factory=lambda: [FxState() for _ in range(6)])
    channel_strip_settings: list[dict] = field(default_factory=list)
    vu_values: dict = field(default_factory=dict)
    connected: bool = False
    port_name: Optional[str] = None


class DeviceNotFound(Exception):
    pass


class UR44:
    """Owns the MIDI connection and mirrors the mixer's on-device state."""

    def __init__(self, on_change: Optional[Callable[[dict], None]] = None):
        self._out: Optional[mido.ports.BaseOutput] = None
        self._in: Optional[mido.ports.BaseInput] = None
        self._listener_thread: Optional[threading.Thread] = None
        self._stop_listener = threading.Event()
        self._on_change = on_change
        self.state = DeviceState()
        self._lock = threading.Lock()

    # -- connection -------------------------------------------------------

    @staticmethod
    def list_ports() -> list[str]:
        outs = mido.get_output_names()
        ins = mido.get_input_names()
        return sorted({n for n in outs + ins if "UR44" in n})

    @staticmethod
    def _probe_dsp_port(name: str, timeout: float = 1.5) -> bool:
        """
        The UR44 exposes two identically-named MIDI ports: a plain
        passthrough MIDI I/O and the internal DSP mixer control port. Only
        the latter answers the init handshake, so we send it and see who
        replies rather than guessing based on port order/name.
        """
        try:
            out = mido.open_output(name)
            inp = mido.open_input(name)
        except OSError:
            return False
        try:
            for message in INIT_MESSAGES:
                out.send(mido.Message("sysex", data=message[1:-1]))
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if any(True for _ in inp.iter_pending()):
                    return True
                time.sleep(0.05)
            return False
        finally:
            inp.close()
            out.close()

    def connect(self, port_name: Optional[str] = None) -> None:
        if self._out is not None:
            self.disconnect()

        candidates = [n for n in mido.get_output_names() if "UR44" in n]
        if not candidates:
            raise DeviceNotFound("No UR44 MIDI port found")

        if port_name:
            if port_name not in candidates:
                raise DeviceNotFound(f"Port not found: {port_name}")
            chosen = port_name
        elif len(candidates) == 1:
            chosen = candidates[0]
        else:
            chosen = next((c for c in candidates if self._probe_dsp_port(c)), None)
            if chosen is None:
                raise DeviceNotFound(
                    "No UR44 port responded to the init handshake"
                )

        self._out = mido.open_output(chosen)
        self._in = mido.open_input(chosen)
        self.state.port_name = chosen

        self._stop_listener.clear()
        self._listener_thread = threading.Thread(target=self._listen, daemon=True)
        self._listener_thread.start()

        self._send_init_messages()

    def disconnect(self) -> None:
        if self._out is not None:
            try:
                self._send(CLOSE_MESSAGE)
            except Exception:
                pass
        self._stop_listener.set()
        if self._in is not None:
            self._in.close()
            self._in = None
        if self._out is not None:
            self._out.close()
            self._out = None
        self.state.connected = False

    def _send(self, data: list[int]) -> None:
        if self._out is None:
            raise RuntimeError("Not connected")
        self._out.send(mido.Message("sysex", data=data[1:-1]))

    def _send_init_messages(self) -> None:
        for message in INIT_MESSAGES:
            self._send(message)

    def _listen(self) -> None:
        while not self._stop_listener.is_set():
            for msg in self._in.iter_pending():
                if msg.type != "sysex":
                    continue
                full = [0xF0, *msg.data, 0xF7]
                self._handle_message(full)
            self._stop_listener.wait(0.01)

    # -- message parsing ----------------------------------------------------

    def _handle_message(self, message: list[int]) -> None:
        parsed = parse_sysex_message(message)
        kind = parsed["type"]

        if kind == "init":
            with self._lock:
                self.state.values = parsed["values"]
                self.state.fx_state = parsed["fx_state"]
                self.state.channel_strip_settings = parsed["channel_strip_settings"]
                self.state.connected = True
            self._notify({"type": "init"})
        elif kind == "meter-update":
            self.state.vu_values = parsed["values"]
            self._notify({"type": "meter-update", "values": parsed["values"]})
        elif kind == "change-parameter":
            if parsed["param"] == 40:
                name = "PhantomPower01" if parsed["channel"] == 0 else "PhantomPower23"
                self.state.values[name] = parsed["value"]
                self._notify({"type": "change-parameter", "name": name, "value": parsed["value"]})
        # query-parameter / reply-parameter / keepalive / unknown: nothing to mirror yet

    def _notify(self, event: dict) -> None:
        if self._on_change is not None:
            self._on_change(event)

    # -- outgoing commands ----------------------------------------------------

    def _send_change_parameter_value(self, parameter: int, value: int, channel_index: int = 0) -> None:
        p0 = parameter & 0x7F
        p1 = (parameter >> 7) & 0x7F
        v32 = value & 0xFFFFFFFF
        v0 = v32 & 0x7F
        v1 = (v32 >> 7) & 0x7F
        v2 = (v32 >> 14) & 0x7F
        v3 = (v32 >> 21) & 0x7F
        v4 = (v32 >> 28) & 0x7F
        message = [
            0xF0, 0x43, 0x10,
            0x3E, 0x14, 0x01,
            0x01, 0x00, p1,
            p0, 0x00, 0x00,
            channel_index, v4, v3,
            v2, v1, v0,
            0xF7,
        ]
        self._send(message)

    def update_param_value(self, name: str, value: int, stack_index: Optional[int] = None) -> None:
        if self._out is None:
            raise RuntimeError("Not connected")
        param = ur44params.PARAMS.get(name)
        if param is None:
            raise ValueError(f"Invalid param name: {name}")
        if param.read_only:
            raise ValueError(f"{name} is read-only")

        channel_indexes = param.channel_indexes(stack_index)
        if not channel_indexes:
            self._send_change_parameter_value(param.number, value)
            self.state.values[name] = value
            return

        if any(c < 0 or c > 5 for c in channel_indexes) and param.channel != "stack":
            raise ValueError(f"Invalid input index: {param.channel}")

        for channel_index in channel_indexes:
            self._send_change_parameter_value(param.number, value, channel_index)
        self.state.values[name] = value

    def select_active_mix(self, mix: int) -> None:
        for p in (0x23, 0x24):
            self._send_change_parameter_value(p, mix)

    def set_fx(self, channel_index: int, fx_type: str, mode: Optional[str] = None) -> None:
        existing_types = [fx.type for fx in self.state.fx_state]
        if not can_set_fx(fx_type, channel_index, existing_types):
            raise ValueError(f"Cannot add FX due to lack of resources: {fx_type}")

        mode_byte = 0x01 if mode == "monitor" else 0x00

        turn_on_cs = [*FX_HEADER, 0x01, 0x00, 0x00, 0x00, channel_index, mode_byte, 0xF7]
        turn_on_amp = [*FX_HEADER, 0x01, 0x01, 0x00, 0x00, channel_index, mode_byte, 0xF7]
        turn_off_cs = [*FX_HEADER, 0x02, 0x00, 0x00, 0x00, channel_index, 0xF7]
        turn_off_amp = [*FX_HEADER, 0x02, 0x01, 0x00, 0x00, channel_index, 0xF7]

        if fx_type == "off":
            self._send(turn_off_cs)
            self._send(turn_off_amp)
            if self.state.fx_state[channel_index].type == "channel-strip":
                stack_index = self.state.fx_state[channel_index].stack_index
                for fx in self.state.fx_state:
                    if fx.type == "channel-strip" and fx.stack_index > stack_index:
                        fx.stack_index -= 1
            self.state.fx_state[channel_index] = FxState(type="off")

        elif fx_type == "channel-strip":
            self._send(turn_off_amp)
            self._send(turn_on_cs)
            current = self.state.fx_state[channel_index]
            if current.type != "channel-strip":
                for fx in self.state.fx_state:
                    if fx.type == "channel-strip":
                        fx.stack_index += 1
                stack_index = 0
            else:
                stack_index = current.stack_index
            self.state.fx_state[channel_index] = FxState(type=fx_type, mode=mode, stack_index=stack_index)

        elif fx_type == "amp":
            self._send(turn_off_cs)
            self._send(turn_on_amp)
            if self.state.fx_state[channel_index].type == "channel-strip":
                stack_index = self.state.fx_state[channel_index].stack_index
                for fx in self.state.fx_state:
                    if fx.type == "channel-strip" and fx.stack_index > stack_index:
                        fx.stack_index -= 1
            self.state.fx_state[channel_index] = FxState(type=fx_type, mode=mode)

        else:
            raise ValueError(f"Invalid FX type: {fx_type}")


def parse_sysex_message(message: list[int]) -> dict:
    n = len(message)

    if n == 19 and message[:8] == [0xF0, 0x43, 0x10, 0x3E, 0x14, 0x01, 0x01, 0x00]:
        param = message[8] * 128 + message[9]
        channel = message[12]
        v32 = (
            message[13] * (128 ** 4)
            + message[14] * (128 ** 3)
            + message[15] * (128 ** 2)
            + message[16] * 128
            + message[17]
        )
        value = (v32 & 0x7FFFFFFF) - (v32 & 0x80000000)
        return {"type": "change-parameter", "channel": channel, "param": param, "value": value}

    if n == 15 and message[:9] == [0xF0, 0x43, 0x30, 0x3E, 0x14, 0x01, 0x04, 0x02, 0x00]:
        param = message[9] * 128 + message[10]
        channel = message[13]
        return {"type": "query-parameter", "channel": channel, "param": param}

    if n == 20 and message[:9] == [0xF0, 0x43, 0x10, 0x3E, 0x14, 0x01, 0x04, 0x02, 0x00]:
        param = message[9] * 128 + message[10]
        channel = message[13]
        v32 = (
            message[14] * (128 ** 4)
            + message[15] * (128 ** 3)
            + message[16] * (128 ** 2)
            + message[17] * 128
            + message[18]
        )
        value = (v32 & 0x7FFFFFFF) - (v32 & 0x80000000)
        return {"type": "reply-parameter", "channel": channel, "param": param, "value": value}

    if n == 140 and message[:7] == [0xF0, 0x43, 0x10, 0x3E, 0x14, 0x02, 0x02]:
        def pair(a, b):
            return message[a] * 128 + message[b]

        names = ["analog1", "analog2", "analog3", "analog4", "analog5", "analog6", "dawL", "dawR", "masterL", "masterR"]
        offsets = [(8, 9, 11, 12), (14, 15, 17, 18), (20, 21, 23, 24), (26, 27, 29, 30),
                   (32, 33, 35, 36), (38, 39, 41, 42), (44, 45, 47, 48), (50, 51, 53, 54),
                   (56, 57, 59, 60), (62, 63, 65, 66)]
        values = {
            name: {"momentary": pair(a, b), "max": pair(c, d)}
            for name, (a, b, c, d) in zip(names, offsets)
        }
        return {"type": "meter-update", "values": values}

    if message == KEEPALIVE:
        return {"type": "keepalive"}

    if n == 3520:
        values = {}
        for name, p in ur44params.PARAMS.items():
            raw = message[p.init_index]
            if p.min < 0 and raw > 64:
                values[name] = raw - 128
            else:
                values[name] = raw

        def fx_state(cs_ins, cs_mon, amp_ins, amp_mon):
            if cs_ins > 0:
                return FxState(type="channel-strip", mode="insert", stack_index=cs_ins - 1)
            if cs_mon > 0:
                return FxState(type="channel-strip", mode="monitor", stack_index=cs_mon - 1)
            if amp_ins == 1:
                return FxState(type="amp", mode="insert")
            if amp_mon == 1:
                return FxState(type="amp", mode="monitor")
            return FxState(type="off")

        fx_indexes = [
            (971, 978, 985, 992), (972, 979, 986, 993), (974, 980, 987, 994),
            (975, 982, 988, 995), (976, 983, 990, 996), (977, 984, 991, 998),
        ]
        fx = [fx_state(*(message[i] for i in idx)) for idx in fx_indexes]

        return {"type": "init", "values": values, "fx_state": fx, "channel_strip_settings": []}

    return {"type": "unknown", "raw": message}
