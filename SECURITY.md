# Security policy

## Reporting a vulnerability

**Do not open a public issue for anything that affects key material, signing, or
the verification system.**

Report privately through GitHub's private vulnerability reporting on
[Xaxis/nullroute](https://github.com/Xaxis/nullroute/security/advisories/new).

Please include:

- what an attacker gains, in concrete terms
- the steps to reproduce, ideally as a failing test
- which invariant it breaks, if you can identify one (see `docs/THREAT-MODEL.md`)
- the manifest root hash of the build you tested, if it is a released build

We will acknowledge within 72 hours and aim to have an assessment within seven
days. If a fix requires changing a spec or an invariant, the advisory will say
so, because a silent invariant change would defeat the point of having them.

## What is in scope

Anything that breaks an invariant in `docs/THREAT-MODEL.md`. The ones we care
about most:

- key material leaving the daemon process, in any form, including in an error
  message or a log line
- a signature that is not byte-for-byte reproducible from the seed and the PSBT
- a PSBT that signs without matching a registered descriptor
- an output the signing screen shows as change ("Change, re-derived at ...
  Verified against your seed") that is not provably ours
- any code path that can reach a non-loopback address
- a build that verifies against `MANIFEST.lock` but does not match its sources
- once hidden profiles exist (planned for phase 7, not built), a way to
  distinguish, from outside, how many profiles a store holds, or whether a given
  PIN attempt hit a real slot

## What is out of scope

The [Out of scope](docs/THREAT-MODEL.md#out-of-scope) section of the threat
model is the authoritative list, and it is deliberately long. In particular,
reports that amount to "there is no secure element" or "a physical attacker with
the SD card can attempt an offline PIN attack" are known and documented design
limits, not vulnerabilities.

If you think a documented limitation is understated or misleading, that is worth
reporting. Overclaiming in the threat model is itself a security bug in a
project whose value rests on being honest about its boundaries.

## Supported versions

nullroute is pre-1.0 and only the current release is supported. Until 1.0, treat
every release as experimental and do not put material funds on it.

## Disclosure

We prefer coordinated disclosure. Tell us first, give us a reasonable window to
ship a fix, and we will credit you in the advisory unless you would rather we
did not.

If a vulnerability is being exploited, or if we have not responded within 14
days, publish. A silent vulnerability in a signing device is worse than an
embarrassing one.
