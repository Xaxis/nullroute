# Running several devices

This project is designed for one arrangement above all others: **you are one
signer in a quorum, and the other signers are on other hardware.** The threat
model says so, and it is why the device refuses to be a convenient sole-custody
wallet.

The strongest version of that arrangement, and the one this page is about, is
several nullroute devices holding one multisig wallet between them.


## Receiving to the quorum, not to one device

**A device holding a registered quorum has two different answers to "what is my
address", and they are not interchangeable.** The quorum's address needs your
threshold of devices to spend from. This device's own address needs only this
device, which is exactly what the quorum was set up to prevent.

Both are ordinary bech32 strings and neither looks different from the other.

So Receive asks which one you want, and the quorum is the default. Choosing
this device alone is allowed, says plainly that the money would be protected by
one key rather than by the quorum, and is a thing you have to pick.

Money sent to the single-signature address is not lost: this device can spend
it, and your mnemonic recovers it. It is protected by one key instead of two,
which is the whole difference you built a fleet for.

**Check the address against the thing that produced it.** For a quorum address
the device re-derives it from the registered descriptor, which is a different
question from whether it derives from this device's own keys. A quorum address
does not derive from one device by construction, so asking the wrong question
answers no about something perfectly correct.

## Knowing which device to walk to next

A 2-of-3 signed on one device is not finished, and the screen used to say so
without saying which of the other two to pick up. On a shelf of identical
Raspberry Pis that is the whole difficulty.

After signing, the device names the cosigners still waited on, using the names
you gave them. It works by tracing each signature back to a master fingerprint
through the transaction's own derivation records, and comparing that against the
fingerprints in the descriptor you registered.

**A fingerprint is four bytes and is not proof.** It is the first four bytes of
a hash of a public key, written into the descriptor by whoever assembled it, and
two distinct keys can collide in it. It is good for telling three devices apart
in a room, which is the question being asked, and it is a long way from
cryptographic identification. This device's own position in a quorum is
different: that one is established by re-deriving its key, and it is proof.

Nothing about the names decides anything. Whether a transaction is finished is
decided by counting signatures against the script's own threshold.

A signature that cannot be traced is reported separately rather than added to
the count. A taproot key-path signature names no key at all, so that is expected
there; anywhere else it is worth asking who produced it.

A device that has not registered the quorum says it cannot tell, rather than
showing an empty list that would read as nobody else having to sign.

## Why more than one device

A 2-of-3 across three nullroutes gives you something no single device can:

- **No single device can spend.** Losing one, or having one taken, does not lose
  the money and does not let anybody else move it.
- **Every device is auditable.** You can read all of the code on all of them,
  which is the whole point of this project and is not true of a quorum built
  from three different vendors' firmware.
- **A bug is not automatically fatal.** A flaw in the signing path is still a
  flaw on every device, so this is the weakest of the three benefits. It is
  stated last, and honestly: three identical devices share their bugs.

That last point is the argument for **vendor diversity** instead, and it is a
real argument. A 2-of-3 with one nullroute and two other vendors' devices
survives a nullroute bug; three nullroutes do not. Pick based on which you
believe is more likely to hurt you: a bug in code you can read, or a backdoor in
code you cannot. This project does not pretend that question has an obvious
answer.

## Setting up a quorum

The device will walk you through this. From the lock screen tap **Guide me**, or
from the wallet screen open **More** and then **Walk me through something**, and
pick "Set up a wallet across several devices". It tells you what you need before
it starts, numbers the steps as you go, and at the end lists what it has not
finished, because most of this cannot be finished on one device.

The rest of this section is the same procedure written out, for reading before
you have a device in your hands.

Each device holds one key and none of them holds the whole wallet. The setup is
therefore a round of exporting, then a round of registering.

1. **On each device, create or import a wallet.** Give them names you can tell
   apart on sight: `Cosigner A`, `Cosigner B`, `Cosigner C`. Write down each
   mnemonic separately. Three devices means three backups, not one.

2. **On each device, export its multisig key.** This is the BIP-48 account
   xpub, deliberately a different branch from the single-signature one so that
   using a seed both alone and in a quorum does not link the two on chain.

3. **Assemble the descriptor.** Two ways, and the first needs no other computer.

   **On a device.** Multisig, then **I have the other keys, build it here**.
   Collect each other device's key by camera or paste, choose the threshold, and
   the device builds the descriptor. Its own key is filled in for you. This is
   the option that makes a fleet of air-gapped devices self-sufficient: three
   Pis in a room can agree on a wallet without a fourth machine.

   The order you collect the keys in does not matter. Every device given the
   same keys produces a byte-identical descriptor, so the checksum you compare
   in step 5 differs only when the KEYS differ.

   **With a coordinator.** Any software that speaks descriptors, and several
   that ship their own formats. The device reads Coldcard setup files, BSMS
   round-two files, Sparrow and Specter JSON, and Bitcoin Core
   `importdescriptors` arrays. Still the right choice when the other cosigners
   are other vendors' hardware, or when you want a watching wallet anyway.

   Building is not registering either way. What comes out is a descriptor, and
   it still goes through the review in step 4.

4. **Register the descriptor on every device.** This is the step people skip and
   it is the one that matters. A registered descriptor is how a device knows
   which outputs are change. Without it, an attacker's address in the change
   position is indistinguishable from money coming back to you.

   Registration refuses a quorum this device holds no key in. It will not let you
   register a wallet you cannot sign for, because that produces something you can
   receive into and never spend from.

5. **Compare the checksum on all three screens.** The eight characters after the
   `#` are a checksum over the whole descriptor. If they differ, one device has a
   different wallet, and the addresses will differ in ways nothing else on the
   screen reveals.

## Spending

A PSBT walks from device to device. There is no simultaneous ceremony and
nothing needs the devices to be in the same room.

1. A coordinator builds an unsigned PSBT.
2. Device A reviews it and signs. Its screen says how many signatures are
   present, how many are needed, and whether **its** signature was the last one.
   For a 2-of-3 it will say the transaction is not finished.
3. The partly-signed PSBT goes to device B, by QR or on a card.
4. Device B reviews it. **Its review shows that one signature is already
   present**, so you know before signing whether you are the last cosigner.
5. Device B signs. Its signature is added to device A's, not substituted for it.
   The screen now says the transaction is complete and offers the finished raw
   transaction as well as the PSBT.
6. Broadcast it with whatever you use for that.

The third device is not needed and signing with it anyway is harmless. A 2-of-3
carrying three signatures is still valid, and the device will say so.

### What each screen tells you, and why it matters

The reason signature progress is on both the review and the result is that
signing first and signing last are different acts. Signing first produces
something that has to travel; signing last produces something spendable. The
expensive mistake is a device implying you are finished when you are not,
because then you stop carrying the transaction onward and believe the spend
happened.

For that reason a requirement the device cannot read is reported as **unknown
and unmet**, never assumed to be satisfied.

## What the devices do NOT do for each other

**They do not attest to each other.** Device A cannot tell you device B is
running verified code. Each device shows its own manifest root hash at unlock,
and comparing those is a manual act you have to perform. There is no protocol
here and no plan for one: an attestation exchange between two devices you cannot
independently trust adds ceremony rather than assurance.

**They do not share a passphrase or a store.** Each device encrypts its own
wallet under its own passphrase. Compromising one passphrase does not expose the
others. This means three passphrases to remember, which is a real cost and is
the intended one.

**They do not agree on labels.** Labels are per-device until you move a BIP-329
file between them. Nothing synchronises.

**They do not know how many cosigners are on nullroute.** The descriptor names
keys, not devices. Two of your three keys being on nullroutes and one on another
vendor's device looks identical to the software.

## Telling the devices apart

**Name the other cosigners too.** On the quorum review screen every other key
gets a field: call one "the attic Pi" and another "Dad's Coldcard", and the
quorum stops being a list of extended keys nobody can tell apart. The names are
sealed with the wallet, so they survive a reboot and a rename.

They are yours and are never checked. A name says nothing about who controls
that key: only the key does. The screen labels them as yours for that reason,
and this device is never given a nickname, because it is identified by
re-deriving its key, which is a stronger claim than a label.

They are sealed rather than kept beside the file, and the reason is privacy
rather than integrity. A list mapping extended keys to "Dad's Coldcard" and "the
one at the office", sitting in plaintext next to an encrypted wallet, would tell
somebody holding the card who the cosigners are and roughly where they live.

**Name each device.** From the wallet picker, or **More** then **Name this
device**. The name sits in the header of every screen including the lock screen,
so it answers "which one am I holding" at the moment you pick one up, before any
passphrase.

This matters more than it sounds. Three devices holding one 2-of-3 hold the
*same wallet*, so they show the same wallet name, the same colour and the same
fingerprint. The cosigner position tells them apart only inside a quorum: a
device with no registrations is anonymous, and a device in two quorums has two
positions.

The name is **not verified and never will be**. It lives in a plain file beside
the wallets so it can be read before a passphrase, which is exactly when you
want it, and that means anyone holding the card can edit it. Nothing on the
device decides anything from it. It is a label on the outside of a box.

It is deliberately not a "profile" that owns several wallets. Each wallet is
sealed independently under its own passphrase, so one mistake costs one seed. A
layer that opened several together would trade that away for tidiness.


This is a practical problem and it deserves stating rather than assuming. Three
identical Raspberry Pis in identical cases, all showing the same wallet name
because they hold the same wallet, is a way to sign with the wrong key or to
carry the wrong device somewhere.

What actually distinguishes them:

- **The cosigner number**, shown on the wallet screen once a quorum is
  registered: `2 of 3, you are cosigner 2`. It is recomputed from the seed every
  time rather than stored, so it is a statement about the keys actually loaded
  rather than a label somebody typed. A device that cannot place itself in a
  registered quorum says that instead of showing a number.
- **The wallet name you chose**, which is per-device and should differ. Name them
  by their role in the quorum, not by the wallet: `Cosigner A`, not
  `Family Vault` on all three.
- **The fingerprint**, shown after unlock. It is derived from the keys that just
  loaded and is the one value on the device that cannot be faked by editing a
  file.
- **A physical label on the case.** Not a joke. The device cannot help you here
  and a sticker can.

## Known gaps

Stated because a page about running several devices that only described what
works would be marketing.

- **Multi-wallet PSBTs are not supported.** A single PSBT with inputs from two
  wallets one device holds is phase 7. Today, one PSBT is signed against one
  open wallet.
- **Batch signing is not supported.** Several PSBTs from one card session, each
  individually reviewed, is phase 7.
- **Taproot multisig can be registered and its addresses derived, but message
  signing for taproot is not implemented.** See `docs/THREAT-MODEL.md` for the
  full list of what is and is not built.
- **There is no device-to-device transport.** Everything goes through a
  coordinator or through you carrying a card or pointing a camera. That is a
  deliberate consequence of the air gap, not an oversight.
