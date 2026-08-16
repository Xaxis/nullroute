# The air gap

This device has no network. Not disabled, not firewalled: the code that would
open a socket is not present, and a lint rule fails the build if anyone adds it.
That is the easy part. The hard part is that a signing device still has to
exchange data with the world, and every byte that crosses the gap is a byte
someone might have chosen.

This document describes how data crosses, what each direction is trusted to do,
and what the gap does not protect you from.

## What crosses, and in which direction

| Direction | What | Carries |
| --- | --- | --- |
| Out | Extended public keys, addresses, output descriptors | Nothing secret |
| Out | Signed transactions | Nothing secret |
| In | Unsigned transactions (PSBT) | Untrusted |
| In | Output descriptors and coordinator setup files | Untrusted |
| In | Addresses to check | Untrusted |

Nothing carrying a private key crosses in either direction. The seed is written
down by you, on paper, once. A backup file can hold an encrypted copy if you ask
for one, and it says so in those words before it writes anything.

## The transports

Two, and you can use either.

**QR codes.** The device draws them on screen and reads them with a camera. This
is the transport that needs no shared hardware, which matters because a USB
stick or an SD card that has been in both machines is a channel in its own right.

**SD card.** Files, written and read as plain text. Slower, needs a card you are
willing to move between machines, and works on a device with no camera.

Neither is more trusted than the other. Both produce bytes that go to the same
parsers and the same review screens.

## How QR transport works

A single QR code holds a few kilobytes at a density a camera can actually read.
An extended public key or an address fits in one. A signed transaction usually
does not.

Anything that fits is shown as a plain code with no wrapper, so any ordinary
scanner reads it. Anything larger is split using **BBQr**, the convention the
Bitcoin air-gap ecosystem already uses, and shown as an animated sequence. Each
frame carries an eight character header:

```
B$ 2 P 07 03 <payload>
^^ ^ ^ ^^ ^^
|  | | |  +-- this frame's number, base36, counting from zero
|  | | +----- how many frames in total
|  | +------- what the payload is (P for a transaction, and so on)
|  +--------- how the payload is encoded (2 for base32)
+------------ the magic
```

Frames can arrive in any order and can be missed and picked up on the next pass.
The scanner shows which frames it is still waiting for, by number, so you can
tell whether to keep waiting or start again.

Three details are deliberate:

**Each frame decodes on its own.** The split happens on the payload bytes, not
on the encoded text, so a receiver can tell you that frame 5 was misread instead
of failing at the end with nothing to say.

**The device never writes compressed frames.** BBQr allows a compressed encoding
and this device reads it, because other wallets write it by default. It does not
produce it, because compressing would put a compressor in the path that produces
signed transactions, and the only thing bought is a few fewer frames.

**Frames from two transfers are never merged.** If a second sequence comes into
shot, or you restart an export while a scan is running, the scanner stops and
says so. Both sequences produce structurally valid frames, and assembling them
together would give you a transaction that parses, looks plausible, and is not
the one either screen was showing.

## What the gap does and does not do

The air gap stops one thing: a remote attacker reaching your keys over a
network. It is very good at that, because there is no network.

It does not stop:

**A malicious transaction.** Everything arriving is chosen by whoever built it.
A PSBT can name any output, any amount, any fee. The gap does not review it and
neither does the transport. That is what the signing screen is for, and it is
why this device shows you the whole transaction and makes you look at it.

**A malicious address on the other screen.** If the machine that built the
transaction is compromised, the address it shows you and the address in the
transaction are both chosen by the attacker. What defeats this is checking the
address on the device, which re-derives it from your seed rather than comparing
two things an attacker controls.

**A compromised device.** If the code on the Pi is not the code you think it is,
nothing about the transport matters. See [Verification](VERIFICATION.md).

**Someone watching the screen.** A QR code is a picture. A camera pointed at the
device sees everything the device shows, which includes your extended public key
and therefore every address you will ever use. It does not include your seed.

**Someone with physical access.** See the
[threat model](THREAT-MODEL.md), which is specific about this and about how
little any of it helps against a determined adversary who has the device and has
you.

## The decoder is the one dependency that reads

Drawing a QR code is written in this repository, covered by `MANIFEST.lock`, and
checked against an independent decoder at every version and error correction
level. If you verified the manifest hash, you verified the code that drew the
square you are photographing.

Reading a QR code from a camera is not written here. It uses `zxing-wasm`, a
long-established decoder, because binarisation under uneven light, perspective
correction and error correction over a partly misread image is a large amount of
subtle work whose failure mode is accepting something other than what was on the
other screen.

That asymmetry is intentional. It is also constrained: the decoder's WebAssembly
is served from the device itself and never fetched from the internet, and the
code refuses to load it from any other origin. Nothing the decoder returns is
trusted. Its output is a candidate payload that goes to the ordinary parser and
the ordinary review screen, and the file type in a BBQr header tells the device
what to try first, never what to accept.

## Using a camera-less device

A build with no camera is supported and loses nothing except convenience. The
device still displays QR codes for anything leaving it. Transactions arrive on
an SD card instead, as base64 text files.

If your threat model includes the camera itself, this is the configuration to
use. See [Provisioning](PROVISIONING.md) for the hardware.
