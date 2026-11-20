# Entropy and seed generation

This document specifies exactly how nullroute turns physical dice rolls into a
BIP-39 seed phrase, in enough detail that you can reproduce the result on a
different machine: the entropy with nothing but `sha256sum`, and the words with
any offline BIP-39 tool.

That property is the point. A hardware wallet that generates a seed inside a
black box asks you to trust the box. nullroute asks you to trust arithmetic you
can check yourself.

**Spec:** `packages/core/src/entropy/dice.spec.yaml`, `packages/core/src/entropy/combine.spec.yaml`, `packages/daemon/src/entropy/health.spec.yaml`, `packages/daemon/src/entropy/modes.spec.yaml`

---

## Why this document exists

A device that generates your seed inside a black box is asking you to trust the
box. You cannot inspect it, and a correct generator and a backdoored one look
identical from the outside: both hand you 24 words, and nothing on the screen
distinguishes them. The usual answer to this is a better black box, which is the
same offer with more assurance attached.

That is the wrong answer. The right answer is that you should not have to take
anyone's word for where your key came from. If you roll the dice, and the rule
from the rolls the device shows you to the words it shows you is arithmetic you
can repeat on any computer, then the device cannot lie to you about your seed
without you being able to catch it.

Every mode below is judged against one question: can the user independently
confirm that the seed on screen is the seed the inputs imply?

---

## Modes

| Mode | Sources | Hand-reproducible | Recommended |
| --- | --- | --- | --- |
| A | Dice only, rolled by you | Yes | **Yes, this is the default** |
| A' | Dice, rolled by the device | The arithmetic yes, the rolls no | Only if you will not roll |
| B | Dice plus machine entropy | No | Acceptable |
| C | Machine only | No | Discouraged, refused unless acknowledged |
| D | Import an existing BIP-39 mnemonic | Not applicable | For recovery |

Mode A is the only mode where the device can be caught lying with a pocket
calculator and a laptop. It is the default for that reason.

**Mode A' is not Mode A.** The device will roll for you, one at a time or the
rest in one go, and the digit string it produces hashes exactly as a hand-rolled
one does, so everything downstream stays checkable. What is not checkable is the
string itself: you did not watch those dice land. A device that wanted to hand
you a seed it had already chosen would do it precisely there, and you could not
tell. It exists because rolling 100 dice takes a while and somebody who will
not spend it is better served by an honest option than by picking whichever mode
is quickest. The screen counts how many rolls came from the device and says so.

---

## Mode A: dice only

### How many rolls

A fair six-sided die yields `log2(6)` bits per roll:

```
log2(6) = 2.584962500721156 bits
```

To reach a full 256 bits of entropy you need:

```
256 / 2.584962500721156 = 99.034...  ->  100 rolls
```

**nullroute requires 100 rolls and refuses to proceed with fewer.**

Note that 99 rolls gives 255.911 bits, which is short of 256. Some
documentation (including an earlier draft of this project's own brief) states
that 99 rolls is sufficient. It is not, by 0.089 bits. The shortfall is small
enough to be academically irrelevant and large enough that a project whose whole
claim is checkable arithmetic should not round in its own favour. The device
counts to 100.

The running total shown on screen during collection is `floor(n * log2(6))`,
displayed as "214 of 256 bits" and similar. It is truncated rather than rounded,
so the display never claims more entropy than has been collected.

### The canonical encoding

This is the part that must be exact, because it is the part you reproduce by
hand.

1. Each roll is recorded as a single ASCII digit in `1`-`6`
   (bytes `0x31` through `0x36`).
2. Rolls are concatenated in the order they were entered, with **no separators,
   no whitespace, no line breaks, and no trailing newline**.
3. The result is exactly `N` bytes for `N` rolls.
4. The entropy is `SHA-256` of those bytes, which is exactly 32 bytes.

```
entropy = SHA-256( ascii(roll_1) || ascii(roll_2) || ... || ascii(roll_100) )
```

5. Those 32 bytes are the BIP-39 entropy for a 24-word mnemonic, converted per
   BIP-39 (append the first 8 bits of `SHA-256(entropy)` as a checksum, then
   split the 264 bits into 24 groups of 11 and index the wordlist).

The trailing newline matters. `echo` appends one and `printf` does not. If your
hand check disagrees with the device, this is the first thing to look at.

### Why SHA-256 of the ASCII, and not a base-6 integer

There are two defensible ways to turn dice into bytes:

- Treat the rolls as a base-6 integer and convert that integer to binary.
- Hash the canonical text of the rolls.

nullroute hashes the text. Both are sound, but only the hash is reproducible
with a tool that is already on every machine. `sha256sum` ships with coreutils
on Linux, `shasum -a 256` ships with macOS, and both agree. A base-6 to binary
conversion of a 100-digit number requires you to trust some other piece of
software to do bignum arithmetic, which reintroduces exactly the problem this
design exists to remove.

Hashing costs nothing in entropy terms. With 100 rolls the input carries 258.5
bits, the output is 256 bits wide, and SHA-256 is modelled as a random oracle
here, so the output is full strength. Hashing 258.5 bits into 256 loses nothing
that matters.

The same rule, SHA-256 of the ASCII roll string, is what Coldcard, SeedSigner
(0.8.7) and Krux use when a seed comes from dice alone, according to their
source as cited in the [signer profile](../spec/signer-profile.md), so a user can cross-check
nullroute against an unrelated implementation. Two differences matter. They
accept 99 rolls, so a 99-roll seed from any of them cannot be reproduced here,
where 100 is the minimum; and SeedSigner takes exactly 99, so a 100-roll seed
from nullroute cannot be re-entered there. Coldcard's other path, dice mixed
with its own entropy, hashes differently and is not reproducible here at all.

### Worked example

**Do not use this seed. It is a public demonstration sequence, so anyone can
spend what is sent to it.** It exists so you can confirm your copy of
nullroute computes what it claims to compute.

The 100 rolls, `123456` repeated:

```
1234561234561234561234561234561234561234561234561234561234561234561234561234561234561234561234561234
```

Check the length first:

```console
$ printf '%s' '1234561234561234561234561234561234561234561234561234561234561234561234561234561234561234561234561234' | wc -c
100
```

Now the entropy:

```console
$ printf '%s' '1234561234561234561234561234561234561234561234561234561234561234561234561234561234561234561234561234' | sha256sum
e56403e8522ddeae1b44a1e8148b1ba4d3b4c626ccf20980056eedcc7e0c0f35  -
```

On macOS, use `shasum -a 256` instead of `sha256sum`. The output is identical.

That 32-byte value is the BIP-39 entropy. It produces this 24-word mnemonic:

```
 1. tornado     7. home       13. deputy     19. forum
 2. cactus      8. neither    14. glide      20. swear
 3. wheel       9. trend      15. open       21. side
 4. picture    10. picture    16. oxygen     22. alcohol
 5. target     11. shoulder   17. another    23. devote
 6. finish     12. endless    18. ability    24. random
```

And, with an empty passphrase, this BIP-39 seed:

```
e50a429924dbdf4500fa0cf03cca5b1a5dab1524cf1cd0efe1868eee17837be0
2e061f3eaae7e08aaae894eb0dd14b6f04f793826f246d9b4960aded98ab8011
```

(shown on two lines for width, it is one 64-byte value)

The device shows you the rolls it hashed and the words that resulted, never the
hex in between. If it shows different words for the same 100 rolls, **stop and
do not use it**. Either the device is not running the code it claims to be running,
or you entered a roll wrongly. Check the manifest root hash on the lock screen
against the one you compute from the source before you do anything else. No
release hash has been published yet.

You can confirm the mnemonic step against any offline BIP-39 tool. The entropy
to mnemonic conversion is plain BIP-39 with no nullroute-specific behaviour, and
that is deliberate: see INV-INTEROP-1 in the threat model. Nothing about how the
seed was generated is needed to recover it.

### Pattern warnings

The device warns, loudly and without blocking you, when the roll sequence looks
non-random:

- every roll the same value
- a short repeating cycle (the worked example above trips this)
- 10 or more rolls in a row, each one step up or down from the last
- once there are at least 30 rolls, a chi-squared statistic on the face counts
  above 20.515. The test is one-sided: an unusually even spread never trips it

These are warnings, not rejections. A fair die genuinely can produce a
suspicious-looking sequence, and a device that silently discarded real rolls
would be substituting its own judgement for the user's entropy, which is the
failure mode this whole document exists to prevent. The user is told what looks
wrong and decides.

### What the device does not know

nullroute cannot tell whether your dice are fair, whether you rolled them
properly, or whether someone watched you do it. It only guarantees that the
seed follows from the rolls by a rule you can check.

Roll on a hard surface, use casino-grade dice if you care, and do not do it in
front of a camera.

---

## Mode B: dice plus machine sources

Mode B combines the dice with machine entropy so that a weakness in either one
alone does not sink the result.

Exactly two inputs:

- `dice`: the 32-byte SHA-256 of the roll string, computed exactly as in Mode A
- `urandom`: 32 bytes from Node's `crypto.randomBytes`, which is OpenSSL's
  generator seeded from the kernel

The hardware RNG at `/dev/hwrng` is not an input. The health check below reads
it and throws the bytes away.

The two are combined with the HKDF construction specified in
`packages/core/src/entropy/combine.spec.yaml`:

```
ikm  = concat over sources, in canonical order, of:
         len(source_id) as one byte
         source_id as ASCII
         len(material) as two bytes, big endian
         material
seed = HKDF-Expand(
         HKDF-Extract(salt = "nullroute/entropy/v1", ikm = ikm),
         info = "seed",
         length = 32
       )
```

The length prefixes are not decoration. Without them, two different source sets
could concatenate to the same byte string, and the combiner would map distinct
inputs to the same seed. Sources are ordered canonically by source id so the
combination is deterministic regardless of the order they were collected in.

The security argument is HKDF's extraction property as RFC 5869 models it: the
output keeps full entropy if any single input has it. So a broken or
adversarially chosen machine generator cannot weaken a good dice roll, which is
the reason to offer this mode. The tests check the narrower thing they can: a
stuck source does not reduce the output to that source (INV-ENT-4).

**Mode B is not hand-reproducible.** The device never shows the machine's 32
bytes: it shows the words and the fingerprint, and INV-KEY-1 keeps key material
off the screen otherwise. If you choose it, you have traded away the property
that makes Mode A worth using, in exchange for not depending on your dice alone.

### Machine source health gates

The combiner does not, and cannot, detect a low-entropy source. Before a
machine-only seed (Mode C), the daemon runs `checkEntropyHealth`
(`packages/daemon/src/entropy/health.ts`). Mode B and device-rolled dice (Mode
A') are not gated by it. Mode B does not need it, because the dice carry the
entropy. Mode A' draws from the same generator as Mode C and is not checked;
the screen counts the rolls the device chose.

The three checks:

- reads `/proc/sys/kernel/random/entropy_avail` and fails if the pool is
  clearly not initialised
- opens `/dev/hwrng`, reads two consecutive 32-byte blocks, and fails if they
  are identical or either is all zero, which is what a stuck or absent hardware
  RNG typically returns
- within 60 seconds of boot, fails if the hardware RNG check did not pass

All three must pass, and the hardware RNG check is one of them, so a device
without a working, readable hardware RNG refuses Mode C at any uptime. The boot
age check cannot change the outcome today.

Every path is Linux-only. Where a path is absent or unreadable the check reports
**unknown**, and unknown never counts as healthy: a gate that passed because it
could not find its own evidence would be worse than no gate. So a machine-only
seed cannot be generated on a Mac, or on a Linux machine where `/dev/hwrng` is
readable only by root, which is the default. On the device, a udev rule gives
the node to the daemon's group, read only (INV-PROV-36). It has not yet been
read on a running Pi.

**What the gates do not do.** They catch a stuck generator, an unseeded pool and
a missing hardware RNG. They say nothing about the quality of the numbers. A
generator producing well-formed but predictable output passes all three, and
that is exactly the attack rolling dice makes impossible. The screen says this
beside the results, because three green ticks otherwise read as "the device
checked its randomness", which is not what happened.

---

## Mode C: machine only

Available, and refused unless you say what you are giving up.

This is how most hardware wallets generate a seed by default, and it is the mode
whose failure prompted this project. It is not inherently broken. It is
unverifiable, which is different and, for this project, worse.

Mode C takes one draw of 32 bytes from `crypto.randomBytes` and nothing else.
If you use it you are trusting the kernel's generator (which the kernel may seed
from the hardware RNG) and nullroute's own code. You have no way to check any of
it. The screen says exactly that. Generate stays disabled until you tick a box
saying the seed cannot be checked by hand, and the daemon refuses any request
without that acknowledgement.

The health gates described under Mode B run first, and all of them must pass.

### An honest note about how long this was fiction

Everything about the gates and the confirmation was
written here in the present tense long before any of it was built. A reader
deciding between rolling dice and letting the device choose was told the second
path was gated when it was not. That is the overclaim this project calls a
security bug rather than a documentation chore, and it is recorded rather than
quietly corrected because the same failure is easy to repeat.

---

## Mode D: import an existing mnemonic

Standard BIP-39 import with checksum validation. Use this to recover a wallet or
to bring a seed generated elsewhere onto the device.

The checksum is validated before anything is stored. The import screen moves
straight on to protecting the wallet, and the fingerprint appears after that, in
the wallet screen's subtitle and at unlock. A single wrong word usually fails
the checksum. A wrong word that still checksums produces a completely different
wallet, so check the fingerprint there against the one you recorded.

---

## Passphrases

BIP-39 supports an optional passphrase, sometimes called the 25th word. It is
mixed into the seed derivation, not stored, and not recoverable.

Two things the UI says plainly and this document repeats:

- **A passphrase cannot be recovered.** There is no reset. If you forget it, the
  funds are gone. It is not a password on an account, it is part of the key.
- **A wrong passphrase does not produce an error.** It produces a different,
  perfectly valid, empty wallet. This is the single most common way people lose
  funds with passphrase wallets.

Because of the second point, nullroute shows the wallet fingerprint at unlock
and in the wallet screen's subtitle. The signing review does not show it. If you have used this passphrase before,
the fingerprint will match what you recorded. If it does not match, you typed it
wrong. Write the fingerprint down when you first create a passphrase wallet. Only
import takes a BIP-39 passphrase on the device today: the dice and machine
screens never send one.

---

## What is deliberately not here

**Shamir secret sharing (SLIP-39) is not offered for seed generation.** It
splits a single point of failure into a more complicated single point of
failure, the implementations are less widely reviewed than multisig, and
recovery depends on tooling that may not exist in ten years. Use a multisig
quorum instead: the failure modes are better understood, the recovery path is
plain BIP-39 plus a descriptor, and other vendors' hardware can hold the other
keys.

SLIP-39 *import* is planned for phase 7 and not built, so a Trezor Shamir
backup cannot be moved onto the device today. Generation is not planned.

**The frontend generates no randomness.** Lint bans `crypto.getRandomValues()`
and `Math.random()` there (INV-ENT-7). It does handle the rolls: it collects the
dice keystrokes, holds the roll string, and sends it to the daemon as you type
and at the end, and device-rolled dice come back to it for display. All hashing
and all seed derivation happen in the daemon.

---

## References

- RFC 5869, HMAC-based Extract-and-Expand Key Derivation Function (HKDF)
- BIP-39, Mnemonic code for generating deterministic keys
- BIP-32, Hierarchical Deterministic Wallets
- FIPS 180-4, Secure Hash Standard (SHA-256)
