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

Tap **Guide me** on the lock screen, or **Menu** then **Guide me** once a
wallet is open.

The rest of the device is organised by feature, because that is how the code is
shaped. Nobody arrives thinking in features. You arrive with a sentence, and
this screen is a list of those sentences:

- Set up a new wallet
- Restore a wallet I already have
- Sign a transaction
- Receive money
- Set up a wallet across devices
- Protect against this device dying

If no wallet is open, a flow that works on one **opens a wallet as its first
step** rather than refusing to start. Signing needs a key in memory and deriving
an address needs a seed: that is the ordinary state of a cold storage device,
not an obstacle worth reporting to somebody who just asked to sign something.
The step is counted, so the flow says 4 steps instead of 3 and the counter stays
honest.

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
`sha256sum` format. What the device shows and what you computed with `sha256sum
MANIFEST.lock` should agree. A published release hash will make it three;
nothing has been released yet. See
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
model in [Building a device](VERIFICATION.md#building-a-device) is about.

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

**Quorums** lists everything this device cosigns: your position in each, the
checksum to compare with the other devices, and every cosigner by whatever name
you gave it.

A quorum can be **forgotten** from here, confirmed by typing its checksum.
Forgetting loses no money: a registration is not a key. What it costs is that
the device stops recognising that quorum's change as its own, so change coming
back from it reads as a payment to a stranger on the signing screen until you
register the descriptor again. Keep the descriptor if you might want it back.

It ends by saying what the device **cannot** tell you: whether the other
cosigners registered the same descriptor, and whether your coordinator ever
imported it. Both are facts about other machines and this one has no network. An
unfinished quorum receives money exactly like a finished one, so those two are a
list to confirm yourself rather than a status to read.

The sections below cover running several of these together.

### Which quorums this device handles

It **builds** `wsh(sortedmulti(...))`, native segwit, which is what Build a
quorum produces.

It **accepts** a taproot quorum, `tr(NUMS, sortedmulti_a(...))`, from a
coordinator. Registering, deriving addresses, recognising change and signing the
script path all work, and the recovery drill proves it against a real Bitcoin
Core: identical addresses, one signature that does not finalise, two devices
that do.

It does not build taproot quorums itself. If you want one, your coordinator
writes the descriptor and every device registers it.

### Setting up a quorum

The device will walk you through this. From the lock screen tap **Guide me**, or
from the wallet screen open **Menu** and then **Guide me**, and pick "Set up a
wallet across devices". It tells you what you need before
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

### Spending

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

#### What each screen tells you, and why it matters

The reason signature progress is on both the review and the result is that
signing first and signing last are different acts. Signing first produces
something that has to travel; signing last produces something spendable. The
expensive mistake is a device implying you are finished when you are not,
because then you stop carrying the transaction onward and believe the spend
happened.

For that reason a requirement the device cannot read is reported as **unknown
and unmet**, never assumed to be satisfied.

### Knowing which device to walk to next

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

### Receiving to the quorum, not to one device

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

### Back up the descriptor, not just the words

**Your mnemonics are not enough to rebuild a quorum.** Holding all three seed
phrases of a 2-of-3 does not let you reconstruct it: you also need the other
keys, how many must sign, and the script type, and none of that is derivable
from a seed phrase. The descriptor records it, and without the descriptor the
money is behind a wallet nobody can describe.

The device shows it under **Export** on a wallet screen, above the
single-signature descriptor, labelled as the thing to keep. Keep it wherever you
keep the words. It is not a secret: it holds no private key and cannot spend
anything, and a copy in a filing cabinet is worth more than the copy nobody
made.

The single-signature descriptor on the same screen describes a wallet holding
only this device's key. Backing that up does not back the quorum up.

### Telling the devices apart

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

### What the devices do NOT do for each other

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

### Known gaps

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

## Everything else

Reached from **More** on the wallet screen.

| Screen | What it is |
| --- | --- |
| Switch wallet | Open a different wallet on this device. Locks this one first |
| Check this device | The manifest root and the verification checks, after unlocking |
| Prove an address | Sign a message with one of your addresses |
| Check a proof | Verify somebody else's address and signature |
| Backup | Encrypted backup and restore |
| Labels | BIP-329 label files in and out |
| Name or erase this wallet | Rename, recolour, or remove the seed |
| Derive a child seed | BIP-85, which shows key material |

### Backup

**Seedless by default.** A seedless backup carries your network, your label and
your registered quorum descriptors, and no key of any kind. A backup with the
seed is a second copy of the money under one passphrase.

**What a seedless restore actually gives you**, stated precisely because the
difference matters: it hands back the descriptors. It does not give you a
working wallet, because without a seed there is nothing to derive from and
nothing to sign with. What the descriptors are good for on their own is checking
whether an address belongs to your quorum, which needs no key, and re-registering
the quorum once you have restored the seed from your mnemonic.

That last part is the reason to keep one. A 2-of-3 cannot be rebuilt from seed
phrases alone: you also need the other keys, the threshold and the script type,
and the descriptor is where those live.

Both are legitimate and the difference is not obvious from outside, so including
the seed changes the button and says what it means before it happens. A file
that quietly contained a spendable key would look like a settings export and be
a wallet.

Restoring shows what the file claims about itself before asking for a
passphrase, and says that everything shown at that point is unverified.

### Proving an address, and checking a proof

**Proving.** Sign a message with one of your addresses to show somebody it is
yours. Segwit, nested segwit and taproot produce a BIP-322 signature. A legacy
address produces a signmessage signature instead, which is a different scheme
committing to different bytes, and the screen says so where you pick the type.
Almost everything accepts both, including Bitcoin Core.

What leaves is an address, a message and a signature together. A signature
without the address it is about proves nothing.

**Read the message before you sign it.** A signature is a proof that you agreed
to a specific string. If somebody else chose that string, and it means something
elsewhere, you have authorised it. The device shows the message in full and
refuses one containing characters that could make it display differently from
what would be signed.

**Checking.** Paste or scan an address, a message and a signature, and the device
says whether they go together. This needs no key and no wallet open, so it is on
the wallet picker as well as behind an unlocked wallet: checking a stranger's
signature should not cost you the passphrase to your money.

A pass means whoever produced that signature held the key for that address, and
agreed to exactly those bytes. It does not say when they held it, that the
address holds anything, or that the person who handed it to you is the person
who made it. A valid signature is evidence about a key, not about a human.

A failure is usually the message rather than the signature. A trailing space, a
missing line break, or a smart quote where a straight one was signed all produce
one. Compare the message character for character before concluding anything.

Scanning an armoured block, the `-----BEGIN BITCOIN SIGNED MESSAGE-----` format
Electrum writes, fills all three fields at once.

**What is not supported.** The BIP-322 full variant, which is what a multisig
quorum would produce. It is refused by name rather than approximated, because a
proof some verifiers accept and others reject is worse than no proof.

### Dark or light

Under **More**. Dark is what the device ships in and what an unset preference
means; light is tuned for a bright room rather than produced by inverting the
dark one, because a naive inversion gives you grey text on white and an accent
that vanishes on paper.

The choice is kept beside your wallets, in the same file as the device name,
not inside a wallet. That is deliberate: it has to be readable before you type a
passphrase, or the lock screen would always appear in the default and then
flicker to your choice after unlocking.

Like the device name, it is not verified and it decides nothing. Somebody
holding the card can change which colours the panel uses and learn nothing by
it.

### Locking itself

After ten minutes with nobody touching the screen, the device closes the wallet
and forgets the seed. A countdown appears in the header a minute before, and any
touch anywhere clears it.

Nothing is lost but the screen you were on. A transaction you had loaded has to
be scanned again, and a wallet you were browsing has to be unlocked again. No
key, no registration and no name goes with it.

This protects you against leaving the device, and against nothing else. Somebody
standing at it simply touches the screen. Somebody who takes an unlocked device
has whatever was in memory. The window is not adjustable, because a setting that
turns a lock off is a setting worth attacking.

### Labels

A BIP-329 file carries the part of a wallet that no seed recreates: which output
was the rent, which one must never be spent. Read one here and the notes in it
appear in two places, beside the matching address in the address list, and under
the matching output on the screen you read before signing.

They are notes and nothing else. This device decides an output is its own change
by re-deriving it from your seed, never from a label, so a file claiming an
address belongs to you changes nothing about what the device says. The label is
drawn under the address rather than above it for the same reason: the characters
are what you check, and a familiar word sitting above them would stand in for
reading them.

Labels are held for the session and are not sealed into the wallet. A label file
can hold thousands of entries about transactions this device has never seen, and
none of them decides anything, so the encrypted wallet does not grow to carry
them. Read the file again after a reboot.

### Checking your backup

After the words are shown, the device asks for three of them back, by position,
before it hides them. Read them off the paper you just wrote. If you have to
remember one rather than read it, you do not have a backup yet.

**A tick box is not a backup**, which is what this replaced. Somebody who
mistyped a word, skipped one, or wrote them out of order believed they had one
and found out with the device already gone.

Getting one wrong returns you to the list and says so. Nothing is lost: the
words are still on screen and nothing has been confirmed. Write them out again
and check them against the screen before trying again.

The device chooses the positions, so writing down only the first three words
does not get you past it. What the check catches is carelessness, which is what
loses most coins. It cannot catch a wrong word at a position it did not ask
about, and it cannot tell paper from a photograph.

### Changing the passphrase

Under **Name or erase this wallet**. It needs the passphrase it has now, and
the new one typed twice.

All three sit on one row, and the on-screen keyboard fills whichever one you
tapped last. The field being filled is outlined, because there is no cursor on
this device to tell you. One keyboard rather than three, because the panel is
480px tall and the keyboard is most of what is left after the header and the
button row.

**This changes what unlocks the file, not what derives your addresses.** The
seed inside is untouched, so every address, every xpub and every descriptor
stays exactly what it was, and your mnemonic still recovers them. A BIP-39
passphrase is a different thing: that one feeds the seed itself, and nothing on
this device can change it. Confusing the two is the one way to leave this screen
badly wrong, so the screen's subtitle says it and the full version is below the
keyboard.

Write the new one down before you tap. Nothing on this device can recover it,
and a passphrase nobody remembers makes a wallet exactly as unreachable as one
nobody stole. Your mnemonic still restores the seed, and it does not restore the
quorums registered here or the names you gave the other cosigners.

A wrong old passphrase changes nothing and does not count toward the ten
attempts that erase the wallet. That counter is there to slow somebody guessing
at a locked device, and you have already opened this one.

### Erasing a wallet

Requires typing the wallet's name on the on-screen keyboard. A confirmation
that is a second tap is not a confirmation on a panel this size: the button
lands where the previous screen's button was, and muscle memory does the rest.

What you type appears in place of the keyboard's usual row of dots, so you can
compare it against the name in the header. Capitals and extra spaces are
ignored: what the device is asking is whether you know which wallet this is, and
the shift key on a touchscreen is not part of that question.

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

See [what the air gap does and does not
do](THREAT-MODEL.md#what-the-air-gap-does-and-does-not-do) for what it stops.

### The two transports

Two, and you can use either.

**QR codes.** The device draws them on screen and reads them with a camera. This
is the transport that needs no shared hardware, which matters because a USB
stick or an SD card that has been in both machines is a channel in its own right.

**SD card.** Files, written and read as plain text. Slower, needs a card you are
willing to move between machines, and works on a device with no camera.

Neither is more trusted than the other. Both produce bytes that go to the same
parsers and the same review screens.

A build with no camera loses nothing except convenience: the device still
displays codes for anything leaving it, and transactions arrive on an SD card as
base64 text. If your threat model includes the camera itself, that is the
configuration to use.

### Codes too large for one frame

A single QR code holds a few kilobytes at a density a camera can read. An
extended public key or an address fits in one. A signed transaction usually does
not, and is split using **BBQr**, the convention the Bitcoin air-gap ecosystem
already uses, and shown as an animated sequence.

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

### The decoder is the one dependency that reads

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

### When something else reads a code wrong

The section above is about this device reading. The other direction is a camera
reading a code off this panel into software on a machine that has a network, and
the question is what happens if that read is wrong. A wrong read that produces
something plausible is the one that costs money.

There is no checksum printed under the codes, and that is deliberate. A digest
this device invented would be a convention no coordinator implements, so it
would sit under the code looking like a check while being one only between two
nullroutes. What follows is what the receiving software already does, which is
different for each payload:

| Code | What a misread does |
| --- | --- |
| Encrypted backup | AES-256-GCM. A wrong byte fails the tag and restore refuses, rather than restoring something plausible |
| Signed transaction | Fails to parse in the coordinator. One that somehow parsed still has to be broadcast, and the transaction it names was reviewed here first |
| Cosigner bundle | Produces a descriptor this device holds no key in, and registration refuses that rather than making a wallet that receives and never spends (INV-MULTI-6) |
| Address | The characters are on screen beside the code, grouped in fours, under the warning telling you to compare them against the payer's screen |
| Descriptor | Carries its own BIP-380 checksum, and the software reading it shows that checksum. The one case where the comparison is standard rather than ours |
| Message proof | A corrupted signature fails verification, which is what the proof is for |
| Labels | BIP-329 is one JSON document per line, so a corrupted read stops parsing. A label also decides nothing |

`make qr-readback` keeps that set closed: a new code on a new screen has to say
what makes a misread loud before it ships, and an entry that no screen renders
any more is removed rather than left making the list look longer than it is.

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
