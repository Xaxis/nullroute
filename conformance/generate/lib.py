"""Helpers for generating signer-profile vectors. Python stdlib plus sipa's
bech32 reference code (fetched into src/). Nothing here imports nullroute."""
import base64, hashlib, json, sys, urllib.request
from decimal import Decimal

sys.path.insert(0, 'src')  # sipa/bech32 ref/python/segwit_addr.py, fetched by regenerate.sh
import segwit_addr  # noqa: E402

RPC = 'http://127.0.0.1:28443'
AUTH = base64.b64encode(b'u:p').decode()


def rpc(method, *params, wallet=None):
    url = RPC + ('' if wallet is None else '/wallet/' + wallet)
    body = json.dumps({'jsonrpc': '1.0', 'id': 1, 'method': method, 'params': list(params)}).encode()
    req = urllib.request.Request(url, body, {'Authorization': 'Basic ' + AUTH, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as r:
            out = json.loads(r.read(), parse_float=Decimal)
    except urllib.error.HTTPError as e:
        out = json.loads(e.read(), parse_float=Decimal)
    if out.get('error'):
        raise RuntimeError(f"{method}: {out['error']}")
    return out['result']


def rpc_error(method, *params, wallet=None):
    """Return the error message Core gives, or None if the call succeeds."""
    try:
        rpc(method, *params, wallet=wallet)
        return None
    except RuntimeError as e:
        return str(e)


def sats(btc):
    v = Decimal(btc) * 100_000_000
    assert v == v.to_integral_value()
    return int(v)


# --- base58check ----------------------------------------------------------
B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'


def b58decode_check(s):
    n = 0
    for c in s:
        n = n * 58 + B58.index(c)
    raw = n.to_bytes((n.bit_length() + 7) // 8, 'big')
    raw = b'\0' * (len(s) - len(s.lstrip('1'))) + raw
    payload, check = raw[:-4], raw[-4:]
    assert hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4] == check
    return payload


def b58encode_check(payload):
    raw = payload + hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    n = int.from_bytes(raw, 'big')
    out = ''
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    return '1' * (len(raw) - len(raw.lstrip(b'\0'))) + out


def reversion(ext, version_hex):
    payload = b58decode_check(ext)
    return b58encode_check(bytes.fromhex(version_hex) + payload[4:])


# --- PSBT maps (BIP-174 key-value maps, no interpretation) -----------------
def read_compact(b, i):
    x = b[i]
    if x < 0xfd:
        return x, i + 1
    if x == 0xfd:
        return int.from_bytes(b[i + 1:i + 3], 'little'), i + 3
    if x == 0xfe:
        return int.from_bytes(b[i + 1:i + 5], 'little'), i + 5
    return int.from_bytes(b[i + 1:i + 9], 'little'), i + 9


def compact(n):
    if n < 0xfd:
        return bytes([n])
    if n <= 0xffff:
        return b'\xfd' + n.to_bytes(2, 'little')
    if n <= 0xffffffff:
        return b'\xfe' + n.to_bytes(4, 'little')
    return b'\xff' + n.to_bytes(8, 'little')


def read_map(b, i):
    pairs = []
    while True:
        klen, i = read_compact(b, i)
        if klen == 0:
            return pairs, i
        key = b[i:i + klen]
        i += klen
        vlen, i = read_compact(b, i)
        pairs.append([key, b[i:i + vlen]])
        i += vlen


def tx_counts(tx):
    i = 4
    nin, i = read_compact(tx, i)
    for _ in range(nin):
        i += 36
        sl, i = read_compact(tx, i)
        i += sl + 4
    nout, i = read_compact(tx, i)
    return nin, nout


class Psbt:
    def __init__(self, b64):
        b = base64.b64decode(b64)
        assert b[:5] == b'psbt\xff'
        i = 5
        self.glob, i = read_map(b, i)
        tx = [v for k, v in self.glob if k == b'\x00'][0]
        nin, nout = tx_counts(tx)
        self.inputs, self.outputs = [], []
        for _ in range(nin):
            m, i = read_map(b, i)
            self.inputs.append(m)
        for _ in range(nout):
            m, i = read_map(b, i)
            self.outputs.append(m)
        assert i == len(b), 'trailing bytes'

    def b64(self):
        out = b'psbt\xff'
        for m in [self.glob] + self.inputs + self.outputs:
            for k, v in m:
                out += compact(len(k)) + k + compact(len(v)) + v
            out += b'\x00'
        return base64.b64encode(out).decode()

    @staticmethod
    def drop(m, keytype):
        m[:] = [kv for kv in m if kv[0][0] != keytype]

    @staticmethod
    def put(m, key, value):
        Psbt.drop_key(m, key)
        m.append([key, value])
        m.sort(key=lambda kv: kv[0])

    @staticmethod
    def drop_key(m, key):
        m[:] = [kv for kv in m if kv[0] != key]


def mainnet_address(bcrt_addr):
    ver, prog = segwit_addr.decode('bcrt', bcrt_addr)
    assert ver is not None, bcrt_addr
    return segwit_addr.encode('bc', ver, prog)


def path_bytes(fp_hex, path):
    out = bytes.fromhex(fp_hex)
    for step in path.split('/')[1:]:
        hard = step.endswith("'") or step.endswith('h')
        n = int(step.rstrip("'h")) + (0x80000000 if hard else 0)
        out += n.to_bytes(4, 'little')
    return out
