"""Krux's own code, called the way its pages call it, for krux.mjs.

Reads one JSON request on stdin and writes one JSON result on stdout. The
adapter starts this file once per call with `python3 -I`, with Krux's `src/`
and embit's `src/` as the two arguments, both fetched at pinned commits by
conformance/interop/krux-adapter.sh: Krux at 9180bbc5, the head of its
`develop` branch on 22 November 2026 (release tag v26.09.0 plus 122 commits),
and embit at d38d43a0, the commit Krux's `vendor/embit` submodule names there
(upstream embit's `hardened` branch, tag v0.8.2 plus 87 commits).

Nothing here decides whether Krux was right. Each function follows the page it
names, in the order the page calls Krux's functions, and reports what came out.
Where a page's keypad makes an input impossible to enter, that is reported as a
refusal and the keypad is named.

Krux shows every exception a page raises on one error screen, "Error:" and the
exception's repr, with one button back to the menu (pages/__init__.py lines
835-851, Menu._clicked_item). A refusal here is a flow that ends on that screen,
or on a "No" to a prompt the kit cannot pass, and its reason names the
exception and the line that raised it, so a reader can tell a check Krux makes
on purpose from a crash.

Every "Proceed?" prompt on the signing flow is answered Yes, because that is
what passes it: the prompt opens with Yes selected and one press of the button
that advances every screen accepts it (pages/__init__.py lines 448-533, Yes at
line 474), the answer is not stored, and the flow signs no differently after
it. The warning it follows is reported under `warnings`, and nothing about it
is an override in SP-REV-22's sense, so `options.override` changes nothing.

Signatures come from embit's pure-Python secp256k1 (stubs.py blocks the ctypes
backend). The device signs with MaixPy's C module, which this does not run.

Paths below are under Krux's src/krux/ unless they name embit (src/embit/).
"""
import base64
import json
import linecache
import os
import sys
import traceback

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
KRUX, EMBIT = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])

# stubs.py first, from this directory, before Krux or embit can be imported.
sys.path.insert(0, HERE)
import stubs  # noqa: E402

stubs.install()
sys.path[1:1] = [KRUX, EMBIT]

import embit  # noqa: E402
from embit import bip39  # noqa: E402
from embit.networks import NETWORKS  # noqa: E402
from embit.psbt import PSBT  # noqa: E402
from embit.util import secp256k1  # noqa: E402
from krux import key as krux_key  # noqa: E402
from krux.key import Key, TYPE_SINGLESIG, P2PKH, P2SH_P2WPKH, P2WPKH, P2TR  # noqa: E402

# src/krux has no __init__.py, so the check is on a module inside it.
for module, root in ((embit, EMBIT), (krux_key, KRUX)):
    if not os.path.abspath(module.__file__).startswith(root + os.sep):
        raise SystemExit(f'bridge.py: {module.__name__} loaded from {module.__file__}, not from {root}')
if hasattr(secp256k1, '_secp'):
    raise SystemExit('bridge.py: embit loaded a native libsecp256k1; the measurement is of its pure-Python backend')

NETWORK = {'mainnet': NETWORKS['main'], 'testnet': NETWORKS['test'], 'regtest': NETWORKS['regtest']}
SINGLE_SIG = (P2PKH, P2SH_P2WPKH, P2WPKH, P2TR)
ERROR_SCREEN = 'error screen (pages/__init__.py 835-851)'


def where(e):
    """The file and line an exception was raised at, relative to the tree."""
    frames = traceback.extract_tb(e.__traceback__)
    if not frames:
        return '?'
    f = frames[-1]
    name = os.path.abspath(f.filename)
    for root, label in ((KRUX + os.sep + 'krux' + os.sep, ''), (EMBIT + os.sep + 'embit' + os.sep, 'embit/')):
        if name.startswith(root):
            return f'{label}{name[len(root):]} line {f.lineno}'
    return f'{os.path.basename(name)} line {f.lineno}'


def deliberate(e):
    """True when the line that raised is a `raise` statement: the code meant
    to stop there. False for an exception the interpreter raised on its own,
    such as an AttributeError on None, which is a crash."""
    frames = traceback.extract_tb(e.__traceback__)
    return bool(frames) and linecache.getline(frames[-1].filename, frames[-1].lineno).strip().startswith('raise')


def chain(e):
    while e is not None:
        yield e
        e = e.__context__


def explain(e):
    """The exception as the error screen shows it, and where it came from.

    PSBTSigner turns any failure of validate() into ValueError("Invalid PSBT:
    ...") (psbt.py lines 129-134), so for that one the exception inside is
    named too. When no decoding of the scanned text parses (lines 106-128,
    base64, then base58, then base43), it raises ValueError("invalid PSBT"),
    and the reason names why embit refused the base64 one.
    """
    text = f'{type(e).__name__}: {e} ({where(e)})'
    if str(e) == 'invalid PSBT':
        for inner in chain(e):
            frames = traceback.extract_tb(inner.__traceback__)
            if any(f.filename.endswith(os.path.join('krux', 'psbt.py')) and 'base_decode(psbt_data, 64)' in f.line
                   for f in frames):
                return text + f'; embit refused the base64 bytes with {type(inner).__name__}: {inner} ({where(inner)})'
        return text
    inner = e.__context__
    if inner is not None and str(inner) and str(inner) in str(e):
        kind = 'raised on purpose' if deliberate(inner) else 'not raised on purpose: a crash'
        text += f'; inside it {type(inner).__name__}: {inner} ({where(inner)}, {kind})'
    elif not deliberate(e):
        text += ', not raised on purpose: a crash'
    return text


def refused(why, e=None):
    return {'verdict': 'refuse', 'reason': why if e is None else f'{why}: {explain(e)}'}


# --- the wallet ------------------------------------------------------------------


def load_wallet(psbt, context):
    """The wallet a Krux user loads to sign this PSBT, built as login.py builds
    it (lines 260-301 and 377): Key(mnemonic, TYPE_SINGLESIG, network,
    passphrase, account, script_type), then Wallet(key).

    A Krux wallet holds one single-sig script type and one account at a time:
    Native Segwit by default, any of the four from Customize (krux_settings.py
    lines 145-147, key.py SINGLESIG_SCRIPT_MAP). The kit names a mnemonic, not
    a script type, so this picks the one a user would load for this PSBT:

    1. Each input whose UTXO script re-derives from the mnemonic, at a path one
       of its derivation records names, is owned, and has the script type it
       re-derived as. The record only says where to look; the script decides.
    2. The wallet is the type and account of the first owned input. Where owned
       inputs are of more than one type, no single wallet holds them all, and
       Krux's own check refuses the transaction whichever is loaded (psbt.py
       lines 184-186).
    3. With no owned input, the wallet is the first input's type as Krux reads
       it (get_policy, psbt.py lines 817-837) when that is a single-sig type,
       and Krux's default, Native Segwit, otherwise.
    """
    from embit import script
    from krux.psbt import get_policy
    from krux.wallet import Wallet

    network = NETWORK[context['network']]
    if psbt is None or not psbt.inputs:
        return Wallet(Key(context['mnemonic'], TYPE_SINGLESIG, network, context['passphrase'], 0, P2WPKH))
    root = Key.extract_root(context['mnemonic'], context['passphrase'], network)
    fingerprint = root.child(0).fingerprint  # key.py line 179
    scripts = {
        P2PKH: script.p2pkh, P2SH_P2WPKH: lambda pub: script.p2sh(script.p2wpkh(pub)),
        P2WPKH: script.p2wpkh, P2TR: script.p2tr,
    }
    for inp in psbt.inputs:
        utxo = inp.utxo
        if utxo is None:
            continue
        records = list(inp.bip32_derivations.values()) + [der for _, der in inp.taproot_bip32_derivations.values()]
        for der in records:
            if der.fingerprint != fingerprint:
                continue
            pub = root.derive(der.derivation).key
            for script_type, make in scripts.items():
                if make(pub) == utxo.script_pubkey:
                    purpose = krux_key.SINGLESIG_SCRIPT_PURPOSE[script_type]
                    path = der.derivation
                    account = path[2] - 2**31 if len(path) > 2 and path[0] == purpose + 2**31 else 0
                    return Wallet(Key(context['mnemonic'], TYPE_SINGLESIG, network, context['passphrase'],
                                      account, script_type))
    script_type = P2WPKH
    try:
        first = get_policy(psbt.inputs[0], psbt.inputs[0].utxo.script_pubkey, {})['type']
        if first in SINGLE_SIG:
            script_type = first
    except Exception:  # noqa: BLE001 - no first input or no UTXO: the default stands
        pass
    return Wallet(Key(context['mnemonic'], TYPE_SINGLESIG, network, context['passphrase'], 0, script_type))


# --- review and signing -----------------------------------------------------------


def sats(text):
    """An amount as _btc_render draws it (psbt.py lines 291-294), "₿ 0.10 000
    000": format_btc writes all eight decimals (format.py lines 30-53), so the
    count of satoshis is exact."""
    from krux.settings import THIN_SPACE

    digits = text.replace('₿', '').replace(THIN_SPACE, '').replace(' ', '').strip()
    whole, _, frac = digits.partition('.')
    if len(frac) != 8:
        raise SystemExit(f'bridge.py: {text!r} is not drawn with eight decimals')
    return str(int(whole.replace(',', '')) * 100_000_000 + int(frac))


def open_psbt(psbt_b64, context):
    """Home.sign_psbt up to the review (pages/home_pages/home.py lines 505-560).

    The PSBT arrives as the kit gives it, its base64 text, which is what a
    scan of a single QR or of pMofN parts returns (qr.py lines 235-254,
    qr_capture.py line 218), so the format is FORMAT_NONE and becomes
    FORMAT_PMOFN (home.py line 534). Returns (signer, warnings, None) or
    (None, None, refusal).
    """
    from krux.psbt import PSBTSigner
    from krux.qr import FORMAT_PMOFN

    # Only the choice of wallet reads the PSBT here, before Krux does; a PSBT
    # embit cannot parse leaves Krux's default wallet loaded.
    try:
        psbt = PSBT.parse(base64.b64decode(psbt_b64))
    except Exception:  # noqa: BLE001
        psbt = None
    wallet = load_wallet(psbt, context)
    # _pre_load_psbt_warn (lines 355-371) prompts only for a multisig or
    # miniscript key, and this one is single-sig.
    try:
        signer = PSBTSigner(wallet, psbt_b64, FORMAT_PMOFN)  # line 537
    except Exception as e:  # noqa: BLE001 - every exception reaches the error screen
        return None, None, refused(f'PSBTSigner, home.py line 537, to the {ERROR_SCREEN}', e)

    # _post_load_psbt_warn (lines 373-416): each warning is a "Proceed?".
    warnings = []
    if signer.path_mismatch():
        warnings.append('path-mismatch')
    if wallet.key.fingerprint != b'\x00\x00\x00\x00' and signer.fill_zero_fingerprint():
        warnings.append('fingerprint-unset')
    return signer, warnings, None


def review(signer, warnings):
    """outputs() and the three warnings after it (home.py lines 549-560), then
    the screens _display_transaction_for_review draws (lines 472-503), which
    are the strings outputs() returns.

    Each output gets one screen, "n. Spend:", "n. Self-transfer: 0/i" or "n.
    Change: 1/i", the address in full in groups of four (format.py lines
    76-78) and the amount (psbt.py lines 336-345). The screens number them
    within their kind, spends first, so `index`, the one value here no screen
    shows, is recovered from the order outputs() classified them in, read off
    Krux's own _classify_output as it runs, and checked against the address
    and amount drawn.
    """
    kinds = []
    classify = signer._classify_output  # noqa: SLF001

    def recording(out_policy, out):
        kinds.append(classify(out_policy, out))
        return kinds[-1]

    signer._classify_output = recording  # noqa: SLF001
    messages, fee_percent = signer.outputs()
    signer._classify_output = classify  # noqa: SLF001

    if signer.unverified_input_amounts():  # lines 418-433
        warnings.append('unverified-input-amounts')
    if signer.distant_paths:  # lines 435-452
        warnings.append('distant-address')
    if fee_percent >= 10.0:  # lines 454-470, "High fees!"
        warnings.append('high-fee')

    from krux.psbt import CHANGE, SELF_TRANSFER, SPEND

    # The summary, messages[0]: inputs, spend, self-transfer or change, and
    # "Fee: ₿ 0.00 010 000 (0.1%) ~1.2 sat/vB" (psbt.py lines 302-324).
    fee_line = [line for line in messages[0].split('\n') if line.startswith('Fee:')]
    if len(fee_line) != 1:
        raise SystemExit(f'bridge.py: no fee line in the summary {messages[0]!r}')
    fee = sats(fee_line[0][len('Fee:'):].split('(')[0])

    vout = signer.psbt.tx.vout
    order = {k: [i for i, kind in enumerate(kinds) if kind == k] for k in (SPEND, SELF_TRANSFER, CHANGE)}
    screens = messages[1:]
    outputs = []
    for k, title, label in ((SPEND, 'Spend:', 'payment'), (SELF_TRANSFER, 'Self-transfer:', 'payment'),
                            (CHANGE, 'Change:', 'change')):
        for n, i in enumerate(order[k]):
            head, address, amount = screens.pop(0).split('\n\n')
            number, _, rest = head.partition('. ')
            if int(number) != n + 1 or not rest.startswith(title):
                raise SystemExit(f'bridge.py: screen {head!r} is not {title} #{n + 1}')
            address = address.replace(' ', '')
            if address != vout[i].script_pubkey.address(network=signer.wallet.key.network) or \
                    sats(amount) != str(vout[i].value):
                raise SystemExit(f'bridge.py: screen {head!r} is not output {i}')
            out = {'index': i, 'address': address, 'amountSats': sats(amount), 'kind': label}
            if k == CHANGE:
                # Drawn beside the title as branch/index, "1/0" (psbt.py lines
                # 396-399 and 342), under the loaded account, whose own path
                # is not on this screen.
                out['changePath'] = rest[len(title):].strip()
            outputs.append(out)
    if screens:
        raise SystemExit(f'bridge.py: {len(screens)} screens left over')
    # A self-transfer is an output to the wallet's receive branch (psbt.py
    # lines 285-288). It is not labelled change, and is reported as a payment.
    return {'feeSats': fee, 'outputs': sorted(outputs, key=lambda o: o['index']), 'warnings': warnings}


def review_psbt(psbt_b64, context):
    """Home.sign_psbt from the scan to the sign menu, then its first signing
    choice (home.py lines 505-563 and 250-282).

    Krux has no override, so the verdict is allow or refuse. It is refuse when
    the flow ends on the error screen before the review, and also when "Sign
    to QR code" does, since then no signature can be made; the review fields
    are still reported in that case, because the review was shown. The
    signature is discarded: signPsbt returns one.
    """
    signer, warnings, refusal = open_psbt(psbt_b64, context)
    if refusal:
        return refusal
    try:
        result = review(signer, warnings)
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001 - outputs() has no raise of its own: anything here is a crash
        return refused(f'outputs(), home.py line 549, to the {ERROR_SCREEN}', e)
    try:
        signer.sign()  # _sign_menu, "Sign to QR code", line 281
    except Exception as e:  # noqa: BLE001
        return {**result, **refused(f'"Sign to QR code" (home.py line 281) to the {ERROR_SCREEN}', e)}
    return {**result, 'verdict': 'allow'}


def sign_psbt(psbt_b64, context):
    """The same flow to "Sign to QR code", which signs and trims (signer.sign(),
    psbt.py lines 543-598), and psbt_qr(), which writes the PSBT back in the
    encoding it was read in, here base64 (lines 600-623). The SD card choice
    signs with trim=False (home.py line 302) and keeps every field; this maps
    the QR choice, the air-gapped one."""
    signer, warnings, refusal = open_psbt(psbt_b64, context)
    if refusal:
        return refusal
    try:
        review(signer, warnings)
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        return refused(f'outputs(), home.py line 549, to the {ERROR_SCREEN}', e)
    try:
        signer.sign()
        signed, _ = signer.psbt_qr()
    except Exception as e:  # noqa: BLE001
        return refused(f'"Sign to QR code" (home.py lines 281-282) to the {ERROR_SCREEN}', e)
    return {'verdict': 'signed', 'psbtBase64': signed}


# --- dice ---------------------------------------------------------------------------


class Screen:
    """The context the dice page draws on and reads from. It records what the
    page puts on screen and has no hardware behind it; anything the page asks
    of it that is not here fails the case."""

    def __init__(self):
        self.shown = []
        self.display = self
        self.input = self

    def clear(self):
        pass

    def draw_hcentered_text(self, text, *args, **kwargs):
        self.shown.append(text)
        return 1

    def draw_centered_text(self, text, *args, **kwargs):
        self.shown.append(text)

    def flash_text(self, text, *args, **kwargs):
        self.shown.append(text)

    def reset_ios_state(self):
        pass

    def wait_for_button(self):
        return None


def dice_to_seed(rolls):
    """pages/new_mnemonic/dice_rolls.py DiceEntropy.new_key (lines 227-348),
    reached from Login.new_key_from_dice, "Via D6" (login.py lines 105-116),
    then the words and the seed as login.py lines 112-114 and Key.extract_root
    (key.py lines 210-214) make them.

    The user picks 24 words on choose_len_mnemonic, the length the profile's
    dice mode makes, so the page asks for at least 99 rolls (lines 235-237) and
    keeps 32 bytes of the digest (line 345). The keypad is capture_from_keypad
    with the six faces (lines 266-273, D6_STATES at line 39) and
    go_on_change=True, so each press returns one face, and Go with nothing
    pressed returns "". Rolls go in one per press, then Go. When the page asks
    for another key after that, the user has none to give and leaves with Esc,
    so the page returns nothing and the case is refused with what it flashed.
    Every "Proceed?" and "Proceed anyway?" is answered Yes, and "Generate
    Mnemonic" is chosen on the menu after the rolls (lines 322-331).
    """
    from krux.pages import ESC_KEY
    from krux.pages.new_mnemonic import dice_rolls

    if any(ch not in dice_rolls.D6_STATES for ch in rolls):
        return refused('the dice keypad has only the keys 1 to 6 (dice_rolls.py lines 39 and 266-273)')
    screen = Screen()
    page = dice_rolls.DiceEntropy(screen)
    keys = list(rolls) + ['']
    prompts = []

    def keypad(*args, **kwargs):
        return keys.pop(0) if keys else ESC_KEY

    def prompt(text, *args, **kwargs):
        prompts.append(text)
        return True

    page.choose_len_mnemonic = lambda *args, **kwargs: 24
    page.capture_from_keypad = keypad
    page.prompt = prompt
    page.flash_text = screen.flash_text

    class GenerateMnemonic:
        def __init__(self, ctx, items, *args, **kwargs):
            if items[1][0] != 'Generate Mnemonic':
                raise SystemExit(f'bridge.py: the menu after the rolls is {items!r}')

        def run_loop(self, *args, **kwargs):
            return 1, None

    dice_rolls.Menu = GenerateMnemonic
    entropy = page.new_key()
    if entropy is None:
        flashed = [s for s in screen.shown if s == 'Not enough rolls!']
        return refused(f'new_key returned nothing; it flashed {flashed[:1]} (dice_rolls.py line 287)')
    mnemonic = bip39.mnemonic_from_bytes(entropy)
    # The warnings drawn before "Proceed anyway?" (lines 289-304), which
    # SP-ENT-7 lets the user pass.
    warned = [s for s in screen.shown if 'Poor!' in s or 'Pattern detected!' in s]
    return {'verdict': 'accept', 'entropyHex': entropy.hex(), 'mnemonic': mnemonic,
            'seedHex': bip39.mnemonic_to_seed(mnemonic, '').hex(), 'warnings': warned}


# --- BBQr ---------------------------------------------------------------------------


def bbqr_join(frames):
    """QRCodeCapture.qr_capture_loop (pages/qr_capture.py lines 127-219), the
    one scan loop every Krux page uses: each frame goes to QRPartParser.parse
    (line 200) until is_complete() (line 209), and the result passes through
    qr_str_to_bytes (line 218). An exception from parse leaves the loop and
    reaches the error screen. Running out of frames first is incomplete: the
    camera would still be scanning.

    The file type is the one the first frame names: QRPartParser keeps it
    from detect_format (qr.py lines 169-170 and 414-435) and refuses a later
    frame that names another (lines 196-204). A U or J payload is text
    (bbqr.py lines 140-145), returned here as its UTF-8 bytes.
    """
    from krux.qr import QRPartParser, FORMAT_BBQR
    from krux.pages.qr_capture import qr_str_to_bytes

    parser = QRPartParser()
    try:
        for frame in frames:
            parser.parse(frame)
            if parser.is_complete():
                break
        else:
            return {'verdict': 'incomplete', 'reason': 'the frames ran out before the parser completed'}
        data = qr_str_to_bytes(parser.result())
    except Exception as e:  # noqa: BLE001 - every exception reaches the error screen
        return refused(f'QRPartParser, to the {ERROR_SCREEN}', e)
    if parser.format != FORMAT_BBQR:
        return refused(f'the scan is not BBQr (format {parser.format})')
    if isinstance(data, str):
        data = data.encode('utf-8')
    return {'verdict': 'complete', 'fileType': parser.bbqr.file_type, 'dataBase64': base64.b64encode(data).decode()}


def bbqr_encode(psbt_b64):
    """The frames Krux shows for a PSBT it read as BBQr: psbt_qr() encodes the
    PSBT with encode_bbqr(data, file_type="P") and the default encoding
    (psbt.py lines 607-611, bbqr.py lines 149-177), and display_qr_codes
    splits it with to_qr_codes at the panel's qr_data_width
    (pages/__init__.py lines 301 and 325, qr.py lines 291-315, display.py
    lines 235-245). psbt_qr() is handed the signed PSBT; here encode_bbqr is
    handed the kit's PSBT, so this checks the writer, not signing.

    Each frame's text is the string to_qr_codes passes to MaixPy's
    qrcode.encode, read by replacing that function. The QR symbol is that C
    module's work and is not drawn here, so no frame has `modules`.
    """
    from krux.bbqr import encode_bbqr
    from krux.display import Display
    from krux.qr import FORMAT_BBQR, to_qr_codes

    texts = []
    sys.modules['qrcode'].encode = lambda part: texts.append(part) or part

    class Amigo:
        def width(self):
            return stubs.AMIGO_PORTRAIT_WIDTH

    width = Display.qr_data_width(Amigo())
    code = encode_bbqr(base64.b64decode(psbt_b64), file_type='P')
    frames = to_qr_codes(code, width, FORMAT_BBQR)
    _, total = next(frames)
    for _ in range(total - 1):
        next(frames)
    return {'frames': [{'text': t} for t in texts], 'qrDataWidth': width}


request = json.load(sys.stdin)
op = request['op']
if op == 'diceToSeed':
    result = dice_to_seed(request['rolls'])
elif op == 'reviewPsbt':
    result = review_psbt(request['psbt'], request['context'])
elif op == 'signPsbt':
    result = sign_psbt(request['psbt'], request['context'])
elif op == 'bbqrJoin':
    result = bbqr_join(request['frames'])
elif op == 'bbqrEncodePsbt':
    result = bbqr_encode(request['psbt'])
else:
    raise SystemExit(f'bridge.py: unknown op {op!r}')
json.dump(result, sys.stdout)
