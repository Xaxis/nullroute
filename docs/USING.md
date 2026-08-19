# Using the device

This page is about the screens: what each one is for, what it refuses, and why.
The other documents answer "is this safe" and "how do I check it". This one
answers "what happens when I press the thing".

The device is a fixed 800x480 touchscreen. There is no cursor, no keyboard and
no way to scroll the page, so every screen is laid out to fit that panel and a
check fails the build when one does not. Text is sized to be read, not to fit.

## The shape of every screen

Three parts, always in the same places:

| Part | Holds |
| --- | --- |
| Header | Where you are, and which wallet is open |
| Body | What you are being asked to read |
| Action bar | The way out, and the primary action |

The action bar is fixed to the bottom and never scrolls away. The primary action
is never focused by default, so a stray tap cannot carry you past a screen you
have not read.

## Guided flows

Tap **Guide me** on the lock screen, or **More** then **Walk me through
something** once a wallet is open.

The rest of the device is organised by feature, because that is how the code is
shaped. Nobody arrives thinking in features. You arrive with a sentence, and
this screen is a list of those sentences:

- Set up a new wallet
- Restore a wallet I already have
- Sign a transaction
- Receive money
- Set up a wallet across several devices
- Protect against this device dying

Choosing one does **not** start it. It first shows what the goal needs, in plain
language, because the expensive failure in all of these is discovering at step
three that you needed a die, somewhere to write 24 words, or every other
cosigner in the room. By then there is a seed on the screen and stopping is not
free.

While a flow is running the header shows `Step 2 of 5` and the name of the step.
It is a count and a name rather than a progress bar, because these steps are not
the same size: rolling 100 dice is ten minutes and setting a passphrase is ten
seconds, so a bar would be a lie about how much is left.

Walking off the path stops the counter rather than describing a position you are
not in.

**Every flow can be skipped.** Each step is a screen that works on its own and
stays directly reachable. A hub that became the only way in would make the
device worse for the second week of owning it.

### What a flow will not do

A flow ends by telling you what it did **not** finish. This matters most for
multisig: registering a quorum on this device does nothing until every other
cosigner registers the same descriptor, character for character, and the
coordinator imports the bundle. A device that dropped you back on the wallet
screen at that moment would be saying, by saying nothing, that the job was done.

## The lock screen

The first thing you see, and the only screen that decides whether the device
will run at all.

It shows the **manifest root hash**: a SHA-256 over every source file, in
`sha256sum` format. Three numbers should agree: what the device shows, what you
computed with `sha256sum MANIFEST.lock`, and what the release published. See
[VERIFICATION.md](VERIFICATION.md).

**If verification fails, the wallet will not load.** The refusal is the first
thing in the body, above the hash, and it names the check that failed and the
file. Unlock is disabled.

A verification check counts as passing only when it reports a status this screen
recognises. Anything else is a failure. That is the opposite of the obvious
reading, and it is deliberate: a status the daemon emits that this screen has
not been told about would otherwise show "Verification passed" in green.

**What the hash does not prove.** These values are reported by the software you
are looking at. They catch an accident or a crude substitution. They do not
catch an attacker who replaced the code that draws them, which is what the tier
model in [PROVISIONING.md](PROVISIONING.md) is about.

The same values stay reachable after unlocking, under **More** then **Check this
device**. Checking is not something you do once at boot: it is what you do
before signing something large, after the device has been out of your sight, or
when somebody asks you to prove the thing in your hand is the thing you built.

## Making a wallet

There are three ways to get a seed, and they are not equivalent. The setup
screen says which is which.

### Dice

100 rolls of a six-sided die, one at a time. Not 99: 99 rolls is 255.911 bits,
which is short of 256, and a project whose whole claim is checkable arithmetic
does not round in its own favour.

The screen shows the bit count as you go, **truncated and never rounded**, so it
never claims more entropy than you have provided. Entering the same digit a
hundred times is accepted and the screen says what it thinks of that: the device
does not discard your rolls, because a device that silently substituted its own
would be the black box this project exists to avoid.

The exact encoding is published in [ENTROPY.md](ENTROPY.md) with a worked
example you can reproduce with `sha256sum` on any machine.

**The device will roll for you** if you ask, one at a time or the rest in one
go, using its own generator with the bias removed. The arithmetic afterwards is
still checkable and the rolls are not, because you did not watch them land. The
screen counts how many it produced and says so. Rolling by hand is the only
version of this that does not require trusting the device.

### Letting the device choose

No dice at all. This is what every other hardware wallet does by default, and it
is the mode whose failure prompted this project: not broken, but unverifiable. A
correct generator and a backdoored one look identical from outside, because both
hand you 24 words.

The device checks that its generator is present, is not returning a constant,
and that the kernel pool is seeded. Those checks catch a broken generator. They
say nothing about a predictable one, and the screen says so rather than letting
three green ticks imply otherwise.

It will not generate anything until you tick that you understand the result
cannot be reproduced or checked by hand.

### Writing the words down

Shown once. The screen will not continue until you tick that you have written
them down, and the tick target is the whole sentence rather than an 18px
checkbox, because that control gates an irreversible step.

**The words are the wallet.** This device is a convenience. That paper is what
recovers the money.

### The passphrase

Protects the copy of the seed stored on this device. Asked for twice when
setting it, because a wallet sealed under a typo is a wallet nobody can open.

Skipping is allowed and the screen says what it costs: a wallet held only in
memory is gone at the next reboot. That is a legitimate choice for a one-off
signing session and a bad surprise otherwise.

**Ten wrong attempts in a row erase the wallet from the device.** That counter
stops somebody guessing at a device they picked up. It does not stop anyone who
copied the card first, so the passphrase is what is really protecting this.

## Several wallets on one device

The picker lists what is on the device. **Every word on it before you enter a
passphrase is unverified**: names, colours and networks are read from a file
beside each sealed blob, and anyone who has held the card could have edited
them.

The device cannot know what a wallet is called until it opens it, so the screen
says so in a line that does not scroll away. If a wallet opens under a different
name to the one you tapped, the device tells you.

**No fingerprint is shown on the picker.** It is the one value here with a
cryptographic ground truth, and a fingerprint nobody has verified displayed
beside a name would invite exactly the trust it has not earned.

### After unlocking

A separate screen, before the wallet, showing the fingerprint of what actually
loaded. This exists because **a mistyped BIP-39 passphrase produces a valid,
different, empty wallet with no error anywhere**, and every screen afterwards
looks normal. The fingerprint is the only place it shows.

## Receiving

One address at a time, in large type, chunked in fours, with its derivation
path. Not a table: on a 7 inch panel the eye slips a row, and a row here is a
different address.

**Read the address off this screen, not off the machine you paste it into.** An
air-gapped signer protects the key and cannot protect the address on its way to
whoever is paying you. Software that swaps an address after it is copied is the
ordinary way this money is lost, and every screen involved looks correct.

The button says **Another**, never "next unused". This device has no network and
cannot know which addresses have been paid to.

**Check this address is really mine** re-derives it from the device's keys. That
proves the address on this screen is yours. It proves nothing about the address
on any other screen.

## Signing a transaction

The reason the device exists.

The review screen shows where the money goes, which outputs leave the wallet,
which are change, the fee in three forms, and how many signatures a multisig
transaction has so far.

**A blocking warning refuses the signature**, and the reason is stated beside
the button rather than further down the screen. Signing past one takes an
explicit tick, which applies to that one signature and is not remembered.

Signatures are deterministic: RFC 6979 for ECDSA, BIP-340 with `aux_rand` fixed
to 32 zero bytes for Schnorr. The same key and transaction always produce
identical bytes, so anyone with the seed can recompute them and confirm nothing
was hidden in the signature. A randomised signature has room in it to leak the
private key a few bits per transaction and the user cannot tell.

After signing, the screen says **where it goes next**, which is not the same
answer twice: an unfinished multisig goes to the next cosigner, and a complete
transaction goes back to whatever will broadcast it. Nothing is broadcast here.
This device has no network.

## Multisig

Two jobs in the order you do them: hand this device's key to the coordinator,
then agree to the quorum that comes back.

**Agreeing is the dangerous part.** A descriptor with your key quietly swapped
out produces a wallet that accepts deposits and can never be spent from, and
every screen after that point looks completely normal. The device refuses a
descriptor it holds no key in.

Fingerprints of the other cosigners are shown and labelled unverified. They are
four bytes chosen by whoever wrote the descriptor.

**Quorum addresses** is the screen several devices read against each other. A
multisig address is derived from every cosigner's key at once, so two devices
agreeing on the address at the same index is the cheap proof that all of them
registered the same descriptor. If they differ, do not send anything.

See [FLEET.md](FLEET.md) for running several of these together.

## Everything else

Reached from **More** on the wallet screen.

| Screen | What it is |
| --- | --- |
| Switch wallet | Open a different wallet on this device. Locks this one first |
| Check this device | The manifest root and the verification checks, after unlocking |
| Prove an address | BIP-322 message signing, for segwit addresses |
| Backup | Encrypted backup and restore |
| Labels | BIP-329 label files in and out |
| Name or erase this wallet | Rename, recolour, or remove the seed |
| Derive a child seed | BIP-85, which shows key material |

### Backup

**Seedless by default.** A seedless backup restores a device that can derive
addresses, recognise its own change and check what belongs to it, and cannot
spend. A backup with the seed is a second copy of the money under one
passphrase.

Both are legitimate and the difference is not obvious from outside, so including
the seed changes the button and says what it means before it happens. A file
that quietly contained a spendable key would look like a settings export and be
a wallet.

Restoring shows what the file claims about itself before asking for a
passphrase, and says that everything shown at that point is unverified.

### Erasing a wallet

Requires typing the wallet's name. A confirmation that is a second tap is not a
confirmation on a panel this size: the button lands where the previous screen's
button was, and muscle memory does the rest.

Renaming requires the passphrase, because the name is sealed inside the
ciphertext. **A wrong passphrase there costs nothing** and does not count
against the attempts that erase the wallet, because choosing a different colour
must never be a way to lose one.

### Child seeds

BIP-85 derives further wallets from this one. It is the second screen on the
device that deliberately shows key material, and the path is displayed with the
words rather than on request, because a child written down without its path
cannot be rederived.

**A child is not independent of its parent.** Anyone holding this device's
mnemonic can derive it and every other child it has ever produced. Giving one to
somebody else does not give them something separate. If you need a wallet that
is genuinely separate, roll dice for it.

Nothing is written to the device. To keep a child here, import it like any other
mnemonic.

## Getting things on and off

The camera is the main way in. Four screens take a file, and every one of them
can scan it rather than have you tap it into an on-screen keyboard: a
transaction, a quorum descriptor or coordinator setup file, an encrypted backup,
and a label file. The camera names what it is being pointed at, so holding up
the wrong card is caught by reading the screen rather than by the reader
appearing broken.

Anything the device produces is shown as a QR code and, underneath a
disclosure, as text you can copy onto a card. Large payloads are split across
several codes automatically.

See [AIR-GAP.md](AIR-GAP.md) for what the gap does and does not stop.

## What the device refuses

Collected in one place, because the refusals are the design:

- To start, if its own code does not match the manifest.
- To store a wallet whose mnemonic you have not confirmed you wrote down.
- To register a multisig quorum it holds no key in.
- To sign past a blocking warning without an explicit tick.
- To sign a message that would display differently from what is signed.
- To read a label that could render as text it does not contain.
- To claim it knows which addresses have been used.
- To show a fingerprint it has not verified as though it had.
