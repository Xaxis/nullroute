"""SeedSigner's own code, called the way its views call it, for seedsigner.mjs.

Reads one JSON request on stdin and writes one JSON result on stdout. The
adapter starts this file once per call with `python3 -I`, with SeedSigner's
`src/` and an embit install directory as the first two arguments, both fetched
at pinned versions by conformance/interop/seedsigner-adapter.sh. An optional
third argument is the `src/` of urtypes, the package SeedSigner's
requirements.txt pins for its QR decoder; the two QR joins need it.

Nothing here decides whether SeedSigner was right. Each function follows the
view it names, line for line where the view does work, and reports what came
out. Where the view's screen makes an input impossible to enter, that is
reported as a refusal and the screen is named.

Paths below are under src/seedsigner/ unless they name embit.
"""
import base64, json, sys, types
from decimal import Decimal

sys.dont_write_bytecode = True
SRC, EMBIT = sys.argv[1], sys.argv[2]
URTYPES = sys.argv[3] if len(sys.argv) > 3 else None
sys.path[0:0] = [SRC, EMBIT] + ([URTYPES] if URTYPES else [])

from embit import bip39  # noqa: E402
from embit.networks import NETWORKS as EMBIT_NETWORKS  # noqa: E402
from embit.psbt import PSBT  # noqa: E402
from seedsigner.helpers import mnemonic_generation  # noqa: E402
from seedsigner.models.psbt_parser import OPCODES, PSBTParser  # noqa: E402
from seedsigner.models.seed import Seed  # noqa: E402
from seedsigner.models.settings_definition import SettingsConstants  # noqa: E402

NETWORKS = {'mainnet': SettingsConstants.MAINNET, 'testnet': SettingsConstants.TESTNET,
            'regtest': SettingsConstants.REGTEST}


def dice_to_seed(rolls):
    """views/tools_views.py, ToolsDiceEntropyEntryView.run (lines 268-284).

    The rolls come from ToolsDiceEntropyEntryScreen, whose keyboard has the
    keys 1 to 6 and which returns after exactly `total_rolls` keys: 50 or 99,
    chosen on ToolsDiceEntropyMnemonicLengthView. Any other string cannot be
    entered, so it is reported as refused, with the reason.
    """
    counts = (mnemonic_generation.DICE__NUM_ROLLS__12WORD, mnemonic_generation.DICE__NUM_ROLLS__24WORD)
    if len(rolls) not in counts:
        return {'verdict': 'refuse', 'reason': f'the entry screen returns after exactly {counts[0]} or {counts[1]} rolls'}
    if any(ch not in '123456' for ch in rolls):
        return {'verdict': 'refuse', 'reason': 'the dice keyboard has only the keys 1 to 6'}
    words = mnemonic_generation.generate_mnemonic_from_dice(rolls)
    mnemonic = ' '.join(words)
    seed = Seed(words)
    return {'verdict': 'accept', 'entropyHex': bip39.mnemonic_to_bytes(mnemonic).hex(), 'mnemonic': mnemonic,
            'seedHex': seed.seed_bytes.hex()}


def sign_psbt(psbt_b64, context):
    """views/psbt_views.py: PSBTOverviewView builds the parser (lines 101-106),
    and PSBTFinalizeView signs, trims and counts (lines 744-757).

    SeedSigner has no override: what it parses, it lets the user sign. Every
    parser exception sends the user to an error view instead, which is a
    refusal here, with the exception named.
    """
    psbt = PSBT.parse(base64.b64decode(psbt_b64))
    seed = Seed(context['mnemonic'].split(), passphrase=context['passphrase'])
    try:
        parser = PSBTParser(psbt, seed=seed, network=NETWORKS[context['network']])
    except Exception as e:  # each class leads to its own error view
        return {'verdict': 'refuse', 'reason': f'{type(e).__name__}: {e}'}
    sig_cnt = PSBTParser.sig_count(psbt)
    psbt.sign_with(parser.root)
    trimmed = PSBTParser.trim(psbt)
    if sig_cnt == PSBTParser.sig_count(trimmed):
        return {'verdict': 'refuse', 'reason': 'PSBTSigningErrorView: signing added no signature'}
    return {'verdict': 'signed', 'psbtBase64': trimmed.to_string()}


def refused(where, e=None):
    return {'verdict': 'refuse', 'reason': where if e is None else f'{where}: {type(e).__name__}: {e}'}


# The controller catches any exception a view raises and shows its System Error
# screen, whose one button is "Back to Main Menu" (controller.py lines 324-328
# and 429-467, views/view.py lines 364-390).
SYSTEM_ERROR = 'System Error screen (controller.py 324-328)'


def shown_sats(sats):
    """The amount a BtcAmount draws, as an exact count of satoshis.

    gui/components.py lines 1143-1189, under the default denomination,
    "Threshold at 0.01" (models/settings_definition.py line 585): 1,000,000
    sats or more is drawn in btc, and a btc text of 12 characters or more is
    cut to two decimals and "..." (lines 1158-1160). An amount the screen does
    not draw exactly is not reported: the bridge stops, and the case fails,
    until someone decides what to map it to.
    """
    if sats >= 1e6 or sats > 1e10:
        decimal_btc = Decimal(sats / 1e8).quantize(Decimal("0.12345678"))
        if str(sats)[-8:] == "0" * 8:
            decimal_btc = decimal_btc.quantize(Decimal("0.1"))
        elif str(sats)[-6:] == "0" * 6:
            decimal_btc = decimal_btc.quantize(Decimal("0.12"))
        text = f"{decimal_btc:,}"
        if len(text) >= 12 or Decimal(text.replace(',', '')) * 10**8 != sats:
            raise SystemExit(f'bridge.py: the screen draws {sats} sats as {text!r} btc, not exactly')
    return str(sats)


def review_psbt(psbt_b64, context):
    """views/psbt_views.py, the review flow from the scanned PSBT to the
    "Approve transaction" button, and the screen that button leads to.

    Reports what the screens draw and nothing else. No screen shows nLockTime,
    nSequence or replaceability, the sighash type, unknown or proprietary
    pairs, or which outputs the PSBT claimed (no file under src/ reads any of
    them), so `locktime`, `replaceable`, `sighash`, `unknownFieldsReported` and
    `claimedOutputs` are never reported.

    SeedSigner has no override, so the verdict is never block-until-override.
    It is refuse wherever the flow ends without a signature: the parser raises
    (each error view offers only "Discard transaction" or "Select a different
    seed"), a view raises (System Error), or "Approve transaction" leads to
    "Signing Failed".
    """
    network = NETWORKS[context['network']]
    embit_network = EMBIT_NETWORKS[SettingsConstants.map_network_to_embit(network)]

    # The scan (models/decode_qr.py, get_psbt, lines 148-156) returns None for a
    # PSBT embit cannot parse, and PSBTSelectSeedView then raises "No
    # transaction currently loaded" (lines 26-28). No review is shown.
    try:
        psbt = PSBT.parse(base64.b64decode(psbt_b64))
    except Exception as e:
        return refused(f'PSBT.parse failed, so the scan yields no PSBT and PSBTSelectSeedView raises: {SYSTEM_ERROR}', e)

    # PSBTOverviewView.__init__ (lines 101-136), with the seed built as the
    # signing path builds it. Each PSBTVerificationError routes to its own view
    # (lines 110-136), and every one of them offers only "Discard transaction"
    # or "Select a different seed" (lines 483-651). Anything else the parser
    # raises, such as its RuntimeError for mixed input types (psbt_parser.py
    # line 337) or embit's PSBTError from psbt.fee() for an input with no UTXO
    # (psbt_parser.py line 631), is not caught there and reaches System Error.
    seed = Seed(context['mnemonic'].split(), passphrase=context['passphrase'])
    try:
        parser = PSBTParser(psbt, seed=seed, network=network)
    except Exception as e:
        return refused('PSBTOverviewView', e)

    if parser.is_multisig:
        # PSBTChangeDetailsView verifies multisig change against a descriptor
        # the user loads mid-flow (lines 418-445). The kit gives no descriptor
        # and this mapping does not cover that branch.
        raise SystemExit('bridge.py: the multisig review is not mapped')

    # PSBTOverviewView.run routes on (lines 184-196). Its first branch, no
    # policy, cannot follow a successful parse: an input always sets one
    # (psbt_parser.py lines 332-334), and a PSBT with no input raises
    # PSBTSeedCannotSignError first (lines 1122-1126).
    review = {'verdict': None}

    # The fee: PSBTMathView (lines 291-300), which every route passes through,
    # draws it in sats at every amount (psbt_screens.py lines 499-516 and
    # 588-598). It is parser.fee_amount, psbt.fee() (psbt_parser.py line 631).
    review['feeSats'] = str(parser.fee_amount)

    # The high fee warning: "(!)" on the fee in the overview and the math
    # screens (psbt_screens.py lines 154-160 and 588-592), and the "High Fee!"
    # screen (lines 189-190 and 242-255), all from parser.is_high_fee.
    review['warnings'] = ['high-fee'] if parser.is_high_fee else []

    # Recipients: PSBTAddressDetailsView (lines 322-366), one screen each, the
    # full address (FormattedAddress with no max_lines wraps it whole,
    # psbt_screens.py lines 643-651, gui/components.py lines 985-1033) and the
    # amount. They are in output order (psbt_parser.py lines 406 and 625-629);
    # every output that is neither OP_RETURN nor change is one. The screens
    # number recipients ("Will Send (#2)", lines 331-333), not outputs: `index`
    # is the output's position, recovered from that order and checked against
    # the address and amount drawn, so the runner can match it. It is the one
    # value here no screen shows.
    vout = psbt.tx.vout
    change_at = {c['output_index'] for c in parser.change_data}
    recipient_at = [i for i in range(len(vout))
                    if vout[i].script_pubkey.data[0] != OPCODES.OP_RETURN and i not in change_at]
    if len(recipient_at) != len(parser.destination_addresses):
        raise SystemExit('bridge.py: recipients do not line up with outputs')
    outputs = []
    for k, i in enumerate(recipient_at):
        address, amount = parser.destination_addresses[k], parser.destination_amounts[k]
        if address != vout[i].script_pubkey.address(embit_network) or amount != vout[i].value:
            raise SystemExit(f'bridge.py: recipient {k} is not output {i}')
        outputs.append({'index': i, 'address': address, 'amountSats': shown_sats(amount), 'kind': 'payment'})

    # Change and self-transfers: PSBTChangeDetailsView (lines 380-473), one
    # screen per change_data entry, reached from the last recipient only when
    # change_amount > 0 (line 357), or from PSBTMathView when there is no
    # recipient (lines 305-309).
    if not parser.destination_addresses and not parser.change_data:
        # get_change_data returns None (psbt_parser.py lines 197-199) and line
        # 401 calls .get on it.
        return refused(f'PSBTChangeDetailsView with no change: {SYSTEM_ERROR}')
    for c in parser.change_data if (not parser.destination_addresses or parser.change_amount > 0) else []:
        path = c['verified_derivation_path']
        if not path:
            return refused(f'PSBTChangeDetailsView reads the last element of an empty path (line 406): {SYSTEM_ERROR}')
        outputs.append({
            'index': c['output_index'],
            # Titled "Your Change" on the change branch and "Self-Transfer"
            # otherwise (lines 402 and 408-412), drawn beside "change address
            # #n" or "receive address #n" (psbt_screens.py lines 692-703). A
            # self-transfer is not labelled change, and SeedSigner counts it
            # as a recipient when it judges the fee (psbt_parser.py lines
            # 1199-1225), so it is a payment here.
            'kind': 'change' if PSBTParser.is_change_branch(path) else 'payment',
            # FormattedAddress with max_lines=1 (psbt_screens.py lines
            # 713-716) draws the first 7 and last 7 characters around "..."
            # (gui/components.py lines 951-983), so the full address is not
            # shown.
            'address': None,
            'amountSats': shown_sats(c['amount']),
            # No `changePath`: the full path reaches the screen (line 455) but
            # is not drawn. The screen shows only the branch and the last
            # index, "change address #0" (psbt_screens.py lines 692-703).
        })
    # An OP_RETURN output is shown only as its data (PSBTOpReturnView, lines
    # 693-714, the last one's data only: psbt_parser.py line 609), with no
    # amount, so it is not reported as an output.
    review['outputs'] = sorted(outputs, key=lambda o: o['index'])

    # PSBTFinalizeView (lines 735-757): "Approve transaction" signs, trims and
    # counts. If that added no signature, the next screen is "Signing Failed"
    # (PSBTSigningErrorView, lines 777-799), whose one button selects a
    # different seed; for this seed the flow ends with nothing signed. embit
    # leaves unsigned any input that asks for a sighash other than ALL or
    # DEFAULT (embit/psbt.py lines 969-977), and that is where this happens.
    # The signature is discarded: signPsbt is the operation that returns one.
    try:
        sig_cnt = PSBTParser.sig_count(psbt)
        psbt.sign_with(parser.root)
        added = PSBTParser.sig_count(PSBTParser.trim(psbt)) != sig_cnt
    except Exception as e:
        return {**review, **refused(f'PSBTFinalizeView: {SYSTEM_ERROR}', e)}
    if not added:
        return {**review, **refused('Approve leads to PSBTSigningErrorView: signing added no signature')}
    review['verdict'] = 'allow'
    return review


def scan(frames):
    """A QR scan as the scan screen drives the decoder, then views/scan_views.py
    ScanView.run's handling of the result (lines 57 and 92-95, 163-169).

    The kit hands over each frame as the string the QR holds. pyzbar turns a
    camera image into exactly that and add_image passes it to add_data
    (models/decode_qr.py lines 50-55), so add_data receives the frames here as
    the bytes pyzbar returns. pyzbar needs the native zbar library and nothing
    on this path calls it, so it is replaced by a module that fails if called.

    ScanScreen._run (gui/screens/scan_screens.py lines 236-247) stops at
    COMPLETE or INVALID. Running out of frames before either is incomplete:
    the camera would still be scanning. An exception from the decoder reaches
    System Error. A completed scan that is not a PSBT, or that get_psbt cannot
    return as one, is refused: PSBTSelectSeedView raises on None (lines 26-28).
    Returns (verdict, decoder, reason).
    """
    def unavailable(*args, **kwargs):
        raise RuntimeError('bridge.py: pyzbar is not loaded; frames arrive already decoded')
    pyzbar = types.ModuleType('pyzbar')
    pyzbar.pyzbar = types.ModuleType('pyzbar.pyzbar')
    pyzbar.pyzbar.decode = unavailable
    pyzbar.pyzbar.ZBarSymbol = types.SimpleNamespace(QRCODE=None)
    sys.modules['pyzbar'], sys.modules['pyzbar.pyzbar'] = pyzbar, pyzbar.pyzbar
    from seedsigner.models.decode_qr import DecodeQR, DecodeQRStatus

    # ScanView.__init__ (lines 27-34), with the default wordlist language.
    decoder = DecodeQR(wordlist_language_code=SettingsConstants.WORDLIST_LANGUAGE__ENGLISH)
    try:
        for frame in frames:
            if decoder.add_data(frame.encode('utf-8')) in (DecodeQRStatus.COMPLETE, DecodeQRStatus.INVALID):
                break
        else:
            return 'incomplete', decoder, 'the frames ran out before the decoder completed'
        if not decoder.is_complete:
            return 'refuse', decoder, 'ScanInvalidQRTypeView: Unknown QR Type (scan_views.py 163-167)'
        if not decoder.is_psbt:
            return 'refuse', decoder, f'not a PSBT: {decoder.qr_type}'
        if decoder.get_psbt() is None:
            return 'refuse', decoder, f'get_psbt returned None, and PSBTSelectSeedView raises: {SYSTEM_ERROR}'
    except Exception as e:
        return 'refuse', decoder, f'{SYSTEM_ERROR}: {type(e).__name__}: {e}'
    return 'complete', decoder, None


def ur_join(frames):
    """A UR PSBT: models/decode_qr.py routes a frame to SeedSigner's URDecoder
    (helpers/ur2) only when it begins UR:CRYPTO-PSBT/ (lines 348-349), and
    get_data_psbt unwraps the message with urtypes' PSBT (lines 159-163)."""
    verdict, decoder, reason = scan(frames)
    if verdict != 'complete':
        return {'verdict': verdict, 'reason': reason}
    return {'verdict': 'complete', 'type': decoder.decoder.result_message().type,
            'dataBase64': base64.b64encode(decoder.get_data_psbt()).decode()}


def bbqr_join(frames):
    """A BBQr PSBT: models/decode_qr.py routes a frame to BBQRPsbtQrDecoder
    only when it matches B$[2HZ]P, file type P (lines 366-367), and a frame
    of any other type ends the scan with "QR Fragment Unexpected Type Change"
    (line 104). The decoder never reads the file type (line 770), so the type
    reported is the one the routing admits."""
    verdict, decoder, reason = scan(frames)
    if verdict != 'complete':
        return {'verdict': verdict, 'reason': reason}
    return {'verdict': 'complete', 'fileType': 'P', 'dataBase64': base64.b64encode(decoder.get_data_psbt()).decode()}


request = json.load(sys.stdin)
op = request['op']
if op == 'diceToSeed':
    result = dice_to_seed(request['rolls'])
elif op == 'signPsbt':
    result = sign_psbt(request['psbt'], request['context'])
elif op == 'reviewPsbt':
    result = review_psbt(request['psbt'], request['context'])
elif op in ('urJoin', 'bbqrJoin'):
    if not URTYPES:
        # Not a refusal: without its pinned dependency SeedSigner's decoder
        # cannot be loaded at all, so the case must fail, not pass or skip.
        raise SystemExit('bridge.py: models/decode_qr.py imports urtypes (lines 12-14), which SeedSigner\'s '
                         'requirements.txt pins by hash; set SEEDSIGNER_URTYPES to its src/')
    result = (ur_join if op == 'urJoin' else bbqr_join)(request['frames'])
else:
    raise SystemExit(f'bridge.py: unknown op {op!r}')
json.dump(result, sys.stdout)
