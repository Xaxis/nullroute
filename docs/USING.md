# Using the device

What each screen is for, what it refuses, and why.

The device is a fixed 800x480 touchscreen with no cursor, no keyboard and no
page scrolling. Every screen is laid out to fit that panel, and a check fails
the build when one does not.

## The shape of every screen

Three parts, always in the same places:

| Part | Holds |
| --- | --- |
| Header | Where you are, and which wallet is open |
| Body | What you are being asked to read |
| Action bar | The way out, and the primary action |

The action bar never scrolls away. The primary action is never focused by
default, so a stray tap cannot carry you past a screen you have not read.

## Guided flows

**Guide me** is on the lock screen, and under **Menu** once a wallet is open:

- Set up a new wallet
- Restore a wallet I already have
- Sign a transaction
- Receive money
- Set up a wallet across devices
- Protect against this device dying

Choosing a goal first shows what it needs, such as a die, somewhere to write 24
words, or every other cosigner in the room. If a flow works on a wallet and none
is open, opening one becomes its first, counted, step.

The header shows `Step 2 of 5` and the step's name: a count, not a progress
bar, because steps differ in size. Walking off the path stops the counter.
**Every flow can be skipped**: each step is its own screen and stays directly
reachable.

### What a flow will not do

A flow ends by telling you what it did **not** finish. For multisig, registering
a quorum here does nothing until every other cosigner registers the same
descriptor, character for character, and the coordinator imports the bundle.

## The lock screen

It shows the **manifest root hash**, a SHA-256 over every source file in
`sha256sum` format, which should match what you computed with
`sha256sum MANIFEST.lock`. A published release hash will be a third to compare;
nothing has been released yet. See [VERIFICATION.md](VERIFICATION.md).

**If verification fails, the wallet will not load.** The refusal comes first,
above the hash, naming the failed check and the file, and unlock is disabled.
Only a status this screen recognises counts as a pass; anything else fails. A
check with nothing to check here is not applicable: it does not block, is not
counted as passed, and is named in the verdict. A device that reports no checks,
or none that passed, has verified nothing and is refused.

**What the hash does not prove.** The software you are looking at reports these
values. They catch an accident or a crude substitution, not an attacker who
replaced the code that draws them: see the tier model in
[Building a device](VERIFICATION.md#building-a-device).

After unlocking, they are under **More** then **Check this device**. Check
before signing something large, after the device has been out of your sight, or
when asked to prove it is the device you built.

## Making a wallet

Three ways to get a seed, and they are not equivalent. The setup screen says
which is which.

### Dice

100 rolls of a six-sided die; 99 would be 255.911 bits, short of 256. The bit
count is **truncated, never rounded**, so it never claims more entropy than you
provided. One digit a hundred times is accepted, with a comment; the device does
not discard your rolls. [ENTROPY.md](ENTROPY.md) has the encoding and a worked
example to reproduce with `sha256sum` on any machine.

**The device will roll for you** if asked, one at a time or the rest at once,
from its own generator with the bias removed. The arithmetic stays checkable but
those rolls do not, since you did not watch them land; the screen counts them.
Only rolling by hand avoids trusting the device.

### Letting the device choose

No dice: what every other hardware wallet does by default. It is unverifiable,
because a correct generator and a backdoored one both hand you 24 words. The
device checks that its generator is present, is not returning a constant, and
that the kernel pool is seeded. That catches a broken generator, not a
predictable one, and the screen says so. Nothing is generated until you tick
that you understand the result cannot be reproduced or checked by hand.

### Writing the words down

Shown once. You cannot continue until you tick that you wrote them down.
**The words are the wallet.** The paper, not this device, recovers the money.

### The passphrase

Protects the copy of the seed stored on this device. It is asked for twice,
because a wallet sealed under a typo cannot be opened. You may skip it; the screen says that a wallet held
only in memory is gone at the next reboot.

**Ten wrong attempts in a row erase the wallet from the device.** That stops
someone guessing at a device they picked up, not someone who copied the card
first. Against them, the passphrase is the real protection.

## Several wallets on one device

**Every word on the picker before you enter a passphrase is unverified.** Names,
colours and networks come from a file beside each sealed blob, which anyone who
has held the card could edit. A line that does not scroll away says the device
cannot know a wallet's name until it opens it. If a wallet opens under a
different name from the one you tapped, the device tells you.

**No fingerprint is shown on the picker**, since there it would be unverified.

### After unlocking

A separate screen shows the fingerprint of what actually loaded, before the
wallet. **A mistyped BIP-39 passphrase produces a valid, different, empty wallet
with no error anywhere**, and this fingerprint is the only place it shows.

## Receiving

One address at a time, large, chunked in fours, with its derivation path.

**Read the address off this screen, not off the machine you paste it into.** The
air gap protects the key, not the address on its way to the payer. Software that
swaps a copied address is the ordinary way this money is lost, and every screen
involved looks correct.

The button says **Another**, never "next unused": with no network the device
cannot know which addresses were paid. **Check this address is really mine**
re-derives it from the device's keys. That proves the address on this screen is
yours, and nothing about any other screen.

## Signing a transaction

The review shows where the money goes, which outputs leave the wallet and which
are change, the fee in three forms, and a multisig transaction's signatures so
far.

**A blocking warning refuses the signature**, with the reason beside the button.
Signing past one takes an explicit tick for that signature alone, which is not
remembered.

Signatures are deterministic: RFC 6979 for ECDSA, BIP-340 with `aux_rand` fixed
to 32 zero bytes for Schnorr. Anyone with the seed can recompute the identical
bytes and confirm nothing was hidden in them.

After signing, the screen says **where it goes next**: the next cosigner, or
whatever will broadcast a complete transaction. Nothing is broadcast here; the
device has no network.

## Multisig

Hand this device's key to the coordinator, then agree to the quorum that comes
back.

**Agreeing is the dangerous part.** A descriptor with your key quietly swapped
out makes a wallet that accepts deposits and can never be spent from, and every
later screen looks normal. The device refuses a descriptor it holds no key in.
Other cosigners' fingerprints are labelled unverified: they are four bytes
chosen by whoever wrote the descriptor.

- **Quorum addresses** is read across devices. Two devices showing the same
  address at the same index is the cheap proof they registered the same
  descriptor. If they differ, do not send anything.
- **Quorums** lists each quorum this device cosigns, with your position, the
  checksum to compare across devices, and each cosigner by the name you gave it.

**Forgetting** a quorum there means typing its checksum. It loses no money, since
a registration is not a key, but that quorum's change then reads as a payment to
a stranger on the signing screen until you register the descriptor again, so
keep it. Forgetting lasts for the session only and asks for no passphrase, so a
quorum saved with the wallet returns at the next unlock, as the list says.

It ends by saying what the device **cannot** tell you: whether the other
cosigners registered the same descriptor, and whether your coordinator imported
it. An unfinished quorum receives money like a finished one, so confirm both
yourself.

### Which quorums this device handles

- It **builds** `wsh(sortedmulti(...))`, native segwit, which is what Build a
  quorum produces.
- It **accepts** a taproot quorum, `tr(NUMS, sortedmulti_a(...))`, from a
  coordinator. Registering, deriving addresses, recognising change and signing
  the script path all work, and the recovery drill proves it against a real
  Bitcoin Core: identical addresses, one signature that does not finalise, two
  devices that do.
- It does not build taproot quorums: your coordinator writes that descriptor and
  every device registers it.

### Setting up a quorum

**Guide me** walks you through this as "Set up a wallet across devices" and ends
by listing what it has not finished. The procedure:

1. **On each device, create or import a wallet.** Name them to tell apart on
   sight: `Cosigner A`, `Cosigner B`, `Cosigner C`. Write each mnemonic down
   separately: three devices, three backups.
2. **On each device, export its multisig key**, the BIP-48 account xpub. It is a
   different branch from the single-signature one, so using a seed alone and in
   a quorum does not link the two on chain.
3. **Assemble the descriptor.** Building is not registering: the result still
   goes through the review in step 4.
   - **On a device**, with no other computer: Multisig, then **I have the other
     keys, build it here**. Collect the other keys by camera or paste and choose
     the threshold; the device adds its own. Order does not matter: the same
     keys give a byte-identical descriptor, so the checksum in step 5 differs
     only when the KEYS differ.
   - **With a coordinator**: any software that speaks descriptors. The device
     also reads Coldcard setup files (including Electrum's, with a Derivation
     line per cosigner), BSMS round-two files, Specter Desktop JSON (which
     Sparrow also writes), Bitcoin Core's `listdescriptors` output and
     `importdescriptors` arrays, and one-descriptor-per-line files such as
     Jade's and Keystone's exports and Sparrow's Output Descriptor export. All
     but Sparrow's descriptor export are tested against real files from the
     other program, kept in [spec/interop](../spec/interop/README.md). Caravan
     and Electrum wallet files are refused: neither holds a descriptor. Choose
     this when other cosigners are other vendors' hardware, or you want a
     watching wallet anyway.
4. **Register the descriptor on every device.** People skip this step. It is how
   a device knows which outputs are change: without it, an attacker's address in
   the change position is indistinguishable from money coming back to you. A
   quorum this device holds no key in is refused.

   With a saved wallet open, tap **Agree to it** after the review and type the
   wallet's passphrase. The quorum is sealed into the wallet file and survives
   locking. A wrong passphrase is refused, registers nothing, and does not count
   toward the attempts that erase the wallet. An unsaved wallet has nowhere to
   store the quorum, so it lasts until the device locks; the review says so, and
   the finished screen says which happened.
5. **Compare the checksum on all three screens**: the eight characters after the
   `#`, covering the whole descriptor. If they differ, one device has a
   different wallet, and the addresses will differ in ways nothing else on
   screen reveals.

### Spending

A PSBT walks from device to device; they never need to be in one room.

1. A coordinator builds an unsigned PSBT.
2. Device A reviews and signs. It shows the signatures present and needed, and
   whether **its** signature was the last; for a 2-of-3 it says the transaction
   is not finished.
3. The partly-signed PSBT goes to device B, by QR.
4. **Device B's review shows one signature already present**, so you know before
   signing whether you are the last cosigner.
5. Device B signs, adding to A's signature rather than replacing it. The screen
   says the transaction is complete and offers the finished raw transaction as
   well as the PSBT.
6. Broadcast it with whatever you use for that.

A third signature is unnecessary but harmless: the transaction stays valid, and
the device says so.

#### What each screen tells you, and why it matters

Believing you are finished when you are not is the costly mistake, so a
requirement the device cannot read is reported as **unknown and unmet**, never
assumed satisfied.

### Knowing which device to walk to next

After signing, the device names the cosigners still needed, by the names you
gave them. It traces each signature to a master fingerprint through the
transaction's derivation records and matches it against your registered
descriptor.

**A fingerprint is four bytes and is not proof.** It is the start of a public key
hash, written by whoever assembled the descriptor, and two keys can collide in
it: enough to tell three devices apart, not to identify a key. This device's own
position comes from re-deriving its key, and is proof.

The names decide nothing: completion is decided by counting signatures against
the script's threshold. An untraceable signature is reported separately, not
counted. That is expected for a taproot key-path signature, which names no key;
anywhere else, ask who made it. A device that has not registered the quorum says
it cannot tell, rather than showing an empty list.

### Receiving to the quorum, not to one device

**With a registered quorum, "what is my address" has two answers, and they are
not interchangeable.** The quorum's address needs your threshold of devices to
spend; this device's own address needs only this device. Both are ordinary
bech32 strings and look alike.

So Receive asks which you want, defaulting to the quorum. You can pick this
device alone; the screen then says one key, not the quorum, would protect the
money. The quorums offered are the open wallet's own, read each time a wallet
opens, and until that list is read Receive shows no address. Money sent to the
single-signature address is not lost (this device can spend it, and your
mnemonic recovers it), but one key protects it instead of two.

**Check the address against the thing that produced it.** A quorum address is
re-derived from the registered descriptor. It does not derive from one device's
keys, so checking it that way answers no about a correct address.

### Back up the descriptor, not just the words

**Your mnemonics are not enough to rebuild a quorum.** Even with all three seed
phrases of a 2-of-3, you also need the other keys, how many must sign, and the
script type, which no seed phrase records. The descriptor does.

It is under **Export** on a wallet screen, labelled as the thing to keep, above
the single-signature descriptor, which covers only this device's key and does
not back up the quorum. Keep it with the words. It is not a secret: it holds no
private key and cannot spend.

### Telling the devices apart

Three devices in one 2-of-3 hold *different seeds* for the same funds, but
before unlock they show only the wallet name and colour you chose, which may be
the same on all three. What distinguishes them:

- **A device name**, set from the wallet picker or **More** then **Name this
  device**. It is in the header of every screen, the lock screen included, so you
  see it before any passphrase. It is **not verified and never will be**: it
  sits in a plain file beside the wallets, editable by anyone holding the card,
  and nothing decides anything from it. It is not a "profile": each wallet stays
  sealed under its own passphrase.
- **The cosigner number** on the wallet screen once a quorum is registered:
  `2 of 3, you are cosigner 2`. It is recomputed from the seed each time, not
  stored; a device that cannot place itself in a registered quorum says so. It
  works only inside a quorum: a device with no registrations is anonymous, and
  one in two quorums has two positions.
- **The wallet name you chose**, which is per-device and should differ:
  `Cosigner A`, not `Family Vault` on all three.
- **The fingerprint** after unlock, derived from the loaded keys: the one value
  that editing a file cannot fake.
- **A physical label on the case.** The device cannot help here; a sticker can.

**Name the other cosigners too**, with the **Name it** button beside each key on
the quorum review screen: "the attic Pi", "Dad's Coldcard". A name confirmed with
the wallet's passphrase is sealed with the wallet; without it, the name is held
for the session only and gone at the next lock. The screen says which. Names are yours, never checked, and say nothing about who
controls a key. This device gets no nickname: re-deriving its key identifies it.
Names are sealed rather than kept beside the file, because a plaintext list
would tell someone holding the card who your cosigners are.

### What the devices do NOT do for each other

- **They do not attest to each other.** Device A cannot tell you device B runs
  verified code. Each shows its own manifest root hash at unlock; comparing them
  is up to you. There is no protocol for this and no plan for one.
- **They do not share a passphrase or a store.** Each encrypts its own wallet
  under its own passphrase, so one compromised passphrase does not expose the
  others, at the intended cost of three passphrases to remember.
- **They do not agree on labels.** Labels are per-device until you move a
  BIP-329 file between them. Nothing synchronises.
- **They do not know how many cosigners are on nullroute.** The descriptor names
  keys, not devices.

### Known gaps

- **Multi-wallet PSBTs are not supported.** One PSBT is signed against one open
  wallet; inputs from two wallets on one device is phase 7.
- **Batch signing is not supported.** Signing several individually reviewed
  PSBTs in one go is phase 7.
- **PSBT version 2 is refused.** The device reads version 0 (BIP-174) only and
  says so when handed version 2 (BIP-370). Export it again as version 0.
- **Taproot multisig can be registered and its addresses derived, but a message
  cannot be signed for any multisig address.** That needs BIP-322's full
  variant, which the device refuses by name; single-key addresses, taproot
  included, sign messages. See `docs/THREAT-MODEL.md` for the
  full list of what is and is not built.
- **A BSMS file's first address is checked, and a wrong one refuses the file.**
  This device derives the first address from the first path restriction and
  refuses the file, naming both, if it differs from the one the coordinator
  wrote (BIP-129). The import screen then shows the address as this device's
  own: confirm with the other signers that every device shows the same one. A
  file with no first address is read; confirm instead the first receive address
  shown once the quorum is registered.
- **A descriptor is read exactly as written.** Sparrow reads `multi()` as
  `sortedmulti()`, and an extended key with no `/0/*` after it as a whole
  account. This device does neither, so an old Specter export relying on either
  derives different addresses here than in Sparrow. Compare a first address on
  both before sending to a quorum.
- **There is no device-to-device transport.** Everything goes through a
  coordinator, a card you carry, or a camera: a deliberate consequence of the
  air gap.

## Everything else

Reached from **More** on the wallet screen.

| Screen | What it is |
| --- | --- |
| Switch wallet | Open another wallet on this device. Locks this one first, so a wrong passphrase leaves no wallet open |
| Check this device | The manifest root and the verification checks, after unlocking |
| Prove an address | Sign a message with one of your addresses |
| Check a proof | Verify somebody else's address and signature |
| Backup | Encrypted backup and restore |
| Labels | BIP-329 label files in and out |
| Name or erase this wallet | Rename, recolour, or remove the seed |
| Derive a child seed | BIP-85, which shows key material |

### Backup

**Seedless by default.** A seedless backup carries your network, your label and
your registered quorum descriptors, and no key. A backup with the seed is a
second copy of the money under one passphrase; choosing it changes the button
and says what it means first.

**A seedless restore gives you descriptors, not a working wallet**: with no
seed, nothing can be derived or signed. The descriptors let you check whether an
address belongs to your quorum, and re-register the quorum after restoring the
seed from your mnemonic.

Restoring shows what the file claims before asking for a passphrase, and says
all of it is unverified at that point.

### Proving an address, and checking a proof

**Proving** signs a message with one of your addresses to show it is yours.

- Segwit, nested segwit and taproot produce a BIP-322 signature starting with
  `smp`, the variant prefix BIP-322 1.0.0 requires. An older verifier may want
  it removed first.
- A legacy address produces a signmessage signature, a different scheme over
  different bytes. The screen says so where you pick the type.
- Bitcoin Core checks only signmessage: its BIP-322 pull request
  (bitcoin/bitcoin#24058) was closed without being merged.

The address, message and signature leave together; a signature without its
address proves nothing.

**Read the message before you sign it.** If somebody else chose the string and
it means something elsewhere, you have authorised it. The device shows it in
full and refuses one with characters that could display differently from what
would be signed.

**Checking** takes an address, a message and a signature, pasted or scanned, and
says whether they go together. It needs no key or open wallet, so it is on the
wallet picker too. Scanning an armoured block (the
`-----BEGIN BITCOIN SIGNED MESSAGE-----` format Electrum writes) fills all three
fields.

A pass means whoever made the signature held the key for that address and agreed
to exactly those bytes. It does not say when, that the address holds anything,
or that the person who handed it to you made it. A failure is usually the
message: a trailing space, a missing line break, or a smart quote where a
straight one was signed. Compare it character for character.

**What is not supported.** The BIP-322 full variant, which a multisig quorum
would produce. It is refused by name rather than approximated.

### Dark or light

Under **More**. Dark is the default. The choice is stored beside your wallets
with the device name, so the lock screen can use it before a passphrase. Like
the device name it is unverified and decides nothing.

### Locking itself

After ten minutes untouched, the device closes the wallet and forgets the seed.
A countdown appears in the header a minute before; any touch clears it.

You lose the screen you were on: rescan a loaded transaction and unlock again.
No key and nothing saved with the wallet is lost. A registration, removal or
cosigner name held for this session only is, as the screen that made it said,
and so are labels loaded from a file, which are never saved.

It protects against leaving the device, nothing else: someone at it just touches
the screen, and someone who takes it unlocked has whatever was in memory. The
window is not adjustable.

### Labels

A BIP-329 file carries what no seed recreates: which output was the rent, which
must never be spent. Its notes appear beside matching addresses in the address
list and under matching outputs on the signing review.

They are only notes. The device decides change by re-deriving from your seed,
never from a label, so a label claiming an address is yours changes nothing it
says. Labels are held for the session, not sealed into the wallet: read the file
again after a reboot.

### Checking your backup

Before hiding the words, the device asks for three back, by position. Read them
off your paper; if you have to remember one, you do not have a backup yet. A
wrong answer returns you to the list and says so, with nothing lost or
confirmed: write the words out again, check them against the screen, and retry.

The device picks the positions, so writing only the first three does not get you
past it. It catches carelessness, but not a wrong word at a position it did not
ask about, and it cannot tell paper from a photograph.

### Changing the passphrase

Under **Name or erase this wallet**: the current passphrase, then the new one
twice. The on-screen keyboard fills the outlined field, whichever you tapped
last.

**This changes what unlocks the file, not what derives your addresses.** Every
address, xpub and descriptor stays the same, and your mnemonic still recovers
them. A BIP-39 passphrase is different: it feeds the seed, and nothing on this
device can change it.

Write the new one down first: nothing on this device can recover it, and your
mnemonic restores the seed but not the quorums registered here or your cosigner
names. A wrong old passphrase changes nothing and does not count toward the ten
attempts that erase the wallet.

### Erasing a wallet

Type the wallet's name on the on-screen keyboard; a second tap is not enough.
What you type shows in place of the keyboard's row of dots, to compare with the
name in the header. Capitals and extra spaces are ignored.

Renaming requires the passphrase, because the name is sealed in the ciphertext.
**A wrong passphrase there costs nothing** and does not count toward the
attempts that erase the wallet.

### Child seeds

BIP-85 derives further wallets from this one, on the second screen that
deliberately shows key material. The path is shown with the words: a child
written down without its path cannot be rederived.

**A child is not independent of its parent.** Anyone with this device's mnemonic
can derive it and every other child. For a genuinely separate wallet, roll dice.
Nothing is written to the device; to keep a child here, import it like any other
mnemonic.

## Getting things on and off

The camera is the main way in. All four screens that take a file can scan it: a
transaction, a quorum descriptor or coordinator setup file, an encrypted backup,
and a label file. The camera names what it is being pointed at, so you can see
when you are holding up the wrong card.

Everything the device produces is shown as a QR code and, under a disclosure, as
text to copy onto a card. Large payloads split across several codes
automatically. See
[what the air gap does and does not do](THREAT-MODEL.md#what-the-air-gap-does-and-does-not-do)
for what it stops.

### The two transports

**QR codes, and only QR codes today.** The device reads them with a USB (UVC)
webcam; a Raspberry Pi camera module on the CSI connector has no driver in the
pinned kernel. No camera has read a code on a Pi yet.

**SD card: planned, not built.** Nothing in the image mounts removable media
(see `provisioning/HARDENING.md`), so no screen can read a card yet. Until then,
a device with no camera can show codes for what leaves it but cannot receive a
transaction.

### Codes too large for one frame

A single QR code at the density this device draws holds a few hundred bytes:
enough for an xpub or an address, usually not a signed transaction. That is shown as an
animated sequence in one of two formats:

| Format | Read by | On this device |
| --- | --- | --- |
| **BBQr** | Sparrow, Coldcard, Nunchuk | The default for a signed PSBT |
| **UR** (`crypto-psbt`) | SeedSigner, Jade, Keystone, Sparrow | Pick **UR** under the code |

The scanner reads either without being told which. Both use QR alphanumeric
mode under the same density cap.

**UR is written as `crypto-psbt`, not `psbt`**, because SeedSigner and Jade read
only `crypto-psbt`. The scanner accepts both. Later UR frames mix several pieces,
so a missed frame can be recovered from the ones after it; progress counts
pieces known, not frames seen. UR carries a checksum of the whole transaction,
so two UR transfers are always told apart.

**BBQr** frames can arrive in any order, and a missed one is picked up on the
next pass. The scanner lists by number the frames it still needs.

- **Each frame decodes on its own**, so a misread frame is named instead of the
  transfer failing at the end.
- **The device never writes compressed frames.** It reads them, because BBQr
  requires a receiver to, but writing them would put a compressor in the path
  that produces signed transactions.
- **Frames from two transfers are not merged when their headers differ**: a
  second sequence with a different frame count, file type or encoding stops the
  scanner. BBQr has no transfer id and no whole-payload checksum, so identical
  headers cannot be told apart. For a PSBT or transaction, a full set that does
  not join into exactly one is refused and the count restarts. That checks the
  result is well formed, not that it came from one screen, so show one sequence
  at a time. The review screen is the backstop: it shows what was assembled.

### The decoder is the one dependency that reads

The code that draws QR codes is in this repository, covered by `MANIFEST.lock`,
and checked against an independent decoder at every version and error correction
level, so verifying the manifest hash verifies it.

Reading uses `zxing-wasm`, a long-established decoder. Its WebAssembly is served
from the device itself, never the internet, and the code refuses to load it from
any other origin. Nothing it returns is trusted: the output is a candidate for
the ordinary parser and review screen, and a BBQr header's file type tells the
device what to try first, never what to accept.

### When something else reads a code wrong

Here a camera reads this panel into software on a networked machine. No
checksum is printed under the codes, on purpose: no coordinator would check one
this device invented. What catches a misread is what the receiving software
already does:

| Code | What a misread does |
| --- | --- |
| Encrypted backup | AES-256-GCM: a wrong byte fails the tag and restore refuses |
| Signed transaction | Fails to parse in the coordinator. One that somehow parsed still has to be broadcast, and the transaction it names was reviewed here first |
| Cosigner bundle | Produces a descriptor this device holds no key in, which registration refuses (INV-MULTI-6) |
| Address | The characters are on screen beside the code, grouped in fours, under a warning to compare them against the payer's screen |
| Descriptor | Carries its own BIP-380 checksum, which the reading software shows |
| Message proof | A corrupted signature fails verification |
| Labels | BIP-329 is one JSON document per line, so a corrupted read stops parsing. A label also decides nothing |

`make qr-readback` keeps that set closed: each new code must say what makes a
misread loud before it ships, and entries no screen renders are removed.

## What the device refuses

Collected in one place, because the refusals are the design:

- To start, unless a passing verification report describes the `MANIFEST.lock` it
  is running with (INV-BUILD-1). It compares that one hash; the file contents are
  checked by `make verify` and, on a device, by dm-verity.
- To store a wallet whose mnemonic you have not confirmed you wrote down.
- To register a multisig quorum it holds no key in.
- To sign past a blocking warning without an explicit tick.
- To sign a message that would display differently from what is signed.
- To read a label that could render as text it does not contain.
- To claim it knows which addresses have been used.
- To show a fingerprint it has not verified as though it had.
