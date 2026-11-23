"""Stand-ins for the MaixPy modules Krux imports, for bridge.py.

Krux runs on MicroPython inside MaixPy, and several modules it imports are
MaixPy's C code or the K210's hardware. Desktop CPython has none of them, so
each is installed here before any Krux module is imported. They follow what
Krux's own test suite installs for the same purpose, tests/conftest.py
`mp_modules` (lines 45-122) and tests/shared_mocks.py, at the same develop
commit, with one rule added: a module whose output could decide a verdict is
either a stdlib equivalent that computes the same thing or one that raises if
it is called, never one that returns made-up values.

Paths below are under Krux's tests/ or src/krux/.
"""
import base64
import json
import os
import sys
import types
import zlib
from unittest import mock


def _raises(what):
    def call(*args, **kwargs):
        raise RuntimeError(f'stubs.py: {what} was called; it is not on any path the bridge maps')
    return call


def _module(name, **attrs):
    m = types.ModuleType(name)
    for k, v in attrs.items():
        setattr(m, k, v)
    sys.modules[name] = m
    return m


# board: MaixPy's per-board configuration. This is the Maix Amigo's, copied from
# shared_mocks.py board_amigo (lines 447-494). The board decides the panel size,
# and through it how many frames a BBQr is split into; nothing else on the
# mapped paths reads it.
AMIGO = {
    'type': 'amigo',
    'lcd': {'height': 320, 'width': 480, 'invert': 0, 'dir': 40, 'lcd_type': 1},
    'sdcard': {'sclk': 11, 'mosi': 10, 'miso': 6, 'cs': 26},
    'board_info': {
        'BOOT_KEY': 23, 'LED_R': 14, 'LED_G': 15, 'LED_B': 17, 'LED_W': 32, 'BACK': 23, 'ENTER': 16,
        'NEXT': 20, 'WIFI_TX': 6, 'WIFI_RX': 7, 'WIFI_EN': 8, 'I2S0_MCLK': 13, 'I2S0_SCLK': 21,
        'I2S0_WS': 18, 'I2S0_IN_D0': 35, 'I2S0_OUT_D2': 34, 'I2C_SDA': 27, 'I2C_SCL': 24,
        'SPI_SCLK': 11, 'SPI_MOSI': 10, 'SPI_MISO': 6, 'SPI_CS': 12,
    },
    'krux': {
        'pins': {'BUTTON_A': 16, 'BUTTON_B': 20, 'BUTTON_C': 23, 'TOUCH_IRQ': 33, 'LED_W': 32,
                 'I2C_SDA': 27, 'I2C_SCL': 24},
        'display': {'touch': True, 'font': [12, 24], 'font_wide': [24, 24]},
    },
}
# In the portrait orientation every page but the camera uses, the Amigo's
# panel is 320 pixels wide (display.py lines 219-223; TOTAL_LINES, line 36,
# counts lines down the 480-pixel side).
AMIGO_PORTRAIT_WIDTH = 320


def _base32_decode(encoded_str):
    """shared_mocks.py base32_decode (lines 367-375)."""
    try:
        len_pad = (8 - len(encoded_str) % 8) % 8
        return base64.b32decode(encoded_str + '=' * len_pad)
    except ValueError as e:
        raise ValueError('Invalid Base32 string: %s' % e)


def _base32_encode(data, add_padding=False):
    """shared_mocks.py base32_encode (lines 378-382)."""
    encoded = base64.b32encode(data).decode('utf-8')
    return encoded if add_padding else encoded.rstrip('=')


class _DeflateIO:
    """shared_mocks.py DeflateIO (lines 92-130): raw deflate with a 1 KiB window,
    BBQr's `Z`, and the 100 KB decompression limit of MaixPy's moddeflate.c.
    The bytes it compresses to need not equal MaixPy's, but the format is the
    same and either decompresses the other's output."""

    MAX_DECOMPRESSED_SIZE = 100 * 1024

    def __init__(self, stream):
        self.stream = stream
        self.data = stream.read()
        self._total_out = 0

    def read(self, size=-1):
        if not hasattr(self, '_decompressed'):
            from io import BytesIO
            self._decompressed = BytesIO(zlib.decompress(self.data, wbits=-10))
        chunk = self._decompressed.read() if size == -1 else self._decompressed.read(size)
        if chunk:
            self._total_out += len(chunk)
            if self._total_out > self.MAX_DECOMPRESSED_SIZE:
                raise ValueError('decompressed data exceeds size limit')
        return chunk

    def write(self, input_data):
        compressor = zlib.compressobj(wbits=-10)
        compressed = compressor.compress(input_data) + compressor.flush()
        self.stream.seek(0)
        self.stream.write(compressed)
        self.stream.truncate()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class UR:
    """uUR.UR, the type psbt.py line 96 tests a scan against. The kit hands the
    review a base64 string, so no instance is ever made."""


def install():
    """Install every stand-in. Call before importing anything from Krux."""
    # Krux's settings store reads /sd/settings.json, then /flash/settings.json
    # (settings.py lines 166-226). Neither may exist here, so every setting is
    # Krux's default.
    for path in ('/sd/settings.json', '/flash/settings.json'):
        if os.path.exists(path):
            raise SystemExit(f'stubs.py: {path} exists, and Krux would read its settings from it')

    # embit picks libsecp256k1 through ctypes when it can load one, from a path
    # relative to its own tree or from the system (embit/util/ctypes_secp256k1.py
    # lines 95-110), and its pure-Python code otherwise
    # (embit/util/secp256k1.py lines 10-76). The device uses MaixPy's C module
    # instead. Blocking the ctypes module makes the backend the pure-Python one
    # on every machine, and keeps any native library out of the process.
    sys.modules['embit.util.ctypes_secp256k1'] = None

    _module('board', config=AMIGO)
    sys.modules['ujson'] = json  # conftest.py line 122
    # Krux's tests install Python's random here (line 60). Nothing on a mapped
    # path may draw randomness (dice mode is deterministic, SP-HW-9, and so is
    # signing), so this one raises instead.
    _module('urandom', **{n: _raises(f'urandom.{n}')
                          for n in ('getrandbits', 'randint', 'randrange', 'choice', 'random', 'seed', 'uniform')})
    # MaixPy's QR encoder, imported by qr.py line 25. Raises, except where
    # bridge.py replaces encode to read a frame's text.
    _module('qrcode', encode=_raises('qrcode.encode'), encode_to_string=_raises('qrcode.encode_to_string'))
    # Krux's UR decoder is a C extension (cUR, through MaixPy), imported by
    # psbt.py line 25 and qr.py line 185. It is not built here, so UR cases are
    # not run; only the type psbt.py tests against is provided.
    _module('uUR', UR=UR, URDecoder=_raises('uUR.URDecoder'), UREncoder=_raises('uUR.UREncoder'),
            Types=types.SimpleNamespace(CRYPTO_PSBT_TYPE='crypto-psbt', psbt_from_cbor=_raises('uUR.Types.psbt_from_cbor'),
                                        psbt_to_cbor=_raises('uUR.Types.psbt_to_cbor')))
    # krux_settings.py reads four mode constants in a class body (conftest.py
    # lines 73-83 give PyCryptodome's); nothing on a mapped path encrypts.
    _module('ucryptolib', MODE_ECB=1, MODE_CBC=2, MODE_CTR=6, MODE_GCM=11, aes=_raises('ucryptolib.aes'))
    _module('base32', decode=_base32_decode, encode=_base32_encode)  # conftest.py lines 104-111
    # conftest.py lines 112-119: Krux's own pure-Python base43, which psbt.py
    # lines 122-126 tries last on a scanned string.
    def base43(name):
        def call(data, *args):
            from krux import baseconv
            return getattr(baseconv, f'pure_python_base_{name}')(data, 43)
        return call
    _module('base43', decode=base43('decode'), encode=base43('encode'))
    _module('deflate', DeflateIO=_DeflateIO)  # conftest.py line 95

    # Hardware: importing the dice page builds Krux's singletons (the display,
    # buttons, watchdog, power manager and camera: display.py line 603,
    # buttons.py line 75, wdt.py line 27, context.py line 54), which reach for
    # these modules at import. As in conftest.py lines 61-84, each is a
    # MagicMock. None of them returns a value the mapped code decides with:
    # the page under test draws and reads through bridge.py's recording
    # context, which has no hardware behind it.
    for name in ('machine', 'sensor', 'lcd', 'Maix', 'fpioa_manager', 'pmu', 'image', 'flash', 'shannon'):
        sys.modules[name] = mock.MagicMock(name=name)
    # MicroPython's millisecond clock, which the touch driver samples when the
    # input singleton starts (input.py line 110, touch.py line 218). As in
    # conftest.py lines 85-88, a constant: nothing mapped depends on time.
    import time
    time.ticks_ms = lambda: 1
    time.sleep_ms = lambda ms: None
