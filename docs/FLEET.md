# Running several devices

This project is designed for one arrangement above all others: **you are one
signer in a quorum, and the other signers are on other hardware.** The threat
model says so, and it is why the device refuses to be a convenient sole-custody
wallet.

The strongest version of that arrangement, and the one this page is about, is
several nullroute devices holding one multisig wallet between them.

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

Each device holds one key and none of them holds the whole wallet. The setup is
therefore a round of exporting, then a round of registering.

1. **On each device, create or import a wallet.** Give them names you can tell
   apart on sight: `Cosigner A`, `Cosigner B`, `Cosigner C`. Write down each
   mnemonic separately. Three devices means three backups, not one.

2. **On each device, export its multisig key.** This is the BIP-48 account
   xpub, deliberately a different branch from the single-signature one so that
   using a seed both alone and in a quorum does not link the two on chain.

3. **Assemble the descriptor.** Any coordinator that speaks descriptors will do
   this, and so will several that ship their own file formats. The device reads
   Coldcard setup files, BSMS round-two files, Sparrow and Specter JSON, and
   Bitcoin Core `importdescriptors` arrays.

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

This is a practical problem and it deserves stating rather than assuming. Three
identical Raspberry Pis in identical cases, all showing the same wallet name
because they hold the same wallet, is a way to sign with the wrong key or to
carry the wrong device somewhere.

What actually distinguishes them:

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
