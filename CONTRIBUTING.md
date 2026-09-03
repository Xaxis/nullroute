# Contributing to nullroute

This is a device that holds keys controlling real money. The normal engineering
tradeoffs do not apply, and a few of the rules below will feel excessive if you
have not worked on this kind of software before. They are not negotiable, and
the reasoning for each one is given so you can argue with the reasoning rather
than the rule.

---

## The rules everything else follows from

**Never invent cryptography.** Every primitive comes from an audited library
listed in the dependency policy below. If you find yourself writing a modular
arithmetic loop, a hash function, a cipher, or anything that generates
randomness, stop and open an issue instead.

**Never add a dependency without asking.** Every package is attack surface, and
every package goes into the reproducible build manifest. See
[Dependency policy](#dependency-policy).

**Never add network capability.** Not for updates, not for fee estimation, not
for price display, not for fonts. The build fails if any code path in
`packages/` can open a socket to a non-loopback address, and the lint rule that
enforces this is not a suggestion. The one exception is `apps/web`, which is the
public website and never ships to the device. See
[The website is not the device](#the-website-is-not-the-device).

**Never ship a feature whose spec is incomplete.** A module without a passing
`*.spec.yaml` does not merge. This is the distinguishing property of the
project, not paperwork.

**When a requirement conflicts with convenience, the requirement wins.** If a
rule seems wrong, say so in an issue before implementing around it.

---

## Before you start

```bash
git clone git@github.com:Xaxis/nullroute.git
cd nullroute
make install     # npm ci, exact versions from the lockfile
make check       # everything CI runs
```

`make check` must pass on a clean checkout before you change anything. If it
does not, that is a bug and worth an issue on its own.

Run `make` with no arguments to list every target.

---

## The workflow

1. Branch from `main`.
2. Write the spec first, or at least alongside the code. A `*.spec.yaml` that
   was written after the fact tends to describe what the code does rather than
   what it should do, which is worth very little.
3. Every invariant in a spec names at least one test, and that test must exist
   and pass. `make verify` enforces the binding, so you cannot declare an
   invariant and forget to test it.
4. Run `make check` locally. CI runs the same targets, so a local pass and a CI
   pass cannot diverge.
5. Open a pull request. Reference spec ids in the description.

### Commit messages

Write what changed and why, in the imperative, with the reasoning in the body
where it is not obvious. Reference spec ids where applicable.

```
Reject dice sequences shorter than 100 rolls

99 rolls is 255.911 bits, which is short of 256. The earlier bound came from
the project brief and was wrong by 0.089 bits. Small enough not to matter in
practice, large enough that a project about checkable arithmetic should not
round in its own favour.

Spec: core.entropy.dice (INV-ENT-5)
```

No em dashes anywhere: not in commit messages, code comments, documentation, or
UI copy. Use a comma, a colon, parentheses, or two sentences. This is enforced
by `make prose`.

---

## Dependency policy

A new runtime dependency in `packages/` requires an issue, explicit sign-off,
and an entry in the pull request explaining:

- what it does that we cannot reasonably do ourselves
- its full transitive tree and the total added byte count
- who audits it and when it was last audited
- whether it has install scripts (if yes, it is rejected or vendored)
- what happens if it is abandoned

`.npmrc` sets `ignore-scripts=true` globally and `save-exact=true`. Any package
that needs an install script to function does not go on this device. That rule
has already cost us convenient options and it will cost us more.

**Any lockfile change requires human sign-off in review.** A pull request that
touches `package-lock.json` without saying why in the description will be sent
back. Dependency confusion and typosquatting attacks look exactly like an
innocuous lockfile diff, and the only defence that works is someone actually
reading it.

Development dependencies are held to a lower but still real bar: they run on
your machine and in CI, which means they can tamper with a build.

### The pinned stack

Cryptography and Bitcoin logic come from Paul Miller's audited stack, chosen for
a minimal transitive tree:

`@noble/curves`, `@noble/hashes`, `@scure/bip32`, `@scure/bip39`, `@scure/base`,
`@scure/btc-signer`.

`bitcoinjs-lib` is a development dependency only. It is the independent second
implementation that the differential test suite checks us against. It never
ships.

---

## Testing

A change to `packages/core` needs, at minimum:

- unit tests for the behaviour
- a property test where the code has an algebraic property worth stating
  (round-trips, avalanche, canonical ordering)
- official BIP vectors where the module implements a BIP
- a differential test against `bitcoinjs-lib` where the module produces
  something both implementations can compute

A change touching signing additionally needs a reproducibility test: sign the
same input many times, assert byte-identical output.

A change touching a parser additionally needs adversarial corpus entries. Add
them to the corpus rather than only testing the happy path. Malformed input is
the input we actually care about.

### What a test failure means

Failing tests block merge. There is no "flaky, re-run it" culture here. If a
test is genuinely non-deterministic, that is a defect in the test or in the code
and it gets fixed, because non-determinism in this codebase is the exact
property we are trying to rule out.

---

## Code style

TypeScript strict, ESM, no default exports.

**Comments explain why, not what.** A comment restating the code is noise. A
comment explaining that `aux_rand` is fixed to zero to close a covert channel,
and that this is a deliberate trade against fault resistance, is the reason
anyone can review this code at all.

**Security-relevant code names the spec id it implements** in a comment. When
someone changes that code later, they need to know which spec they are about to
falsify.

**Secrets use the `Secret` wrapper, never a raw `Buffer` or `Uint8Array`.** Lint
enforces this. The wrapper exists so that zeroization is explicit and auditable
rather than something everyone remembers to do until one person does not.

**Never silently catch an error in a signing path.** Fail loudly and visibly. A
swallowed exception in this codebase is how a user signs something they did not
review.

---

## The website is not the device

`apps/web` builds nullroute.diy. It is a Next.js site, it obviously uses the
network, and it is fenced off from the device build the same way
`packages/bridge` is:

- nothing in `apps/web` ever ships to the Pi
- `MANIFEST.lock` and the manifest root hash cover `packages/`, `spec/` and
  `provisioning/`, which is what `make print-manifest-roots` prints. This line
  said `packages/` only, so anyone following it computed a root hash matching
  neither the device nor the release.
- the no-network lint rule applies to `packages/`, not to `apps/web`
- `apps/web` must never import from `packages/daemon`

The site renders `docs/` from the repository root, which is deliberate: the
published documentation and the documentation in the repository are the same
files, so the site cannot drift from the device.

If you find yourself wanting to import device code into the website to show
something off, that is the boundary doing its job. Copy the values into
`docs/` or generate a static artifact instead.

### Editing a page changes the CSP

`vercel.json` carries a strict Content-Security-Policy with no `'unsafe-inline'`
anywhere, including for styles. Next inlines a small RSC bootstrap into every
page, so `script-src` enumerates the sha256 hash of each of those blocks.

Those hashes are content-derived, which means **any edit to any page changes
them**. After changing the site, run:

```bash
make web-build
node tools/gen-csp.mjs     # rewrites vercel.json
```

`make web-csp` fails in CI if you forget. That is friction, and it is the price
of not writing `'unsafe-inline'` and moving on. A policy with `'unsafe-inline'`
in `script-src` permits exactly the injection the policy exists to prevent, on
the site that tells people to verify things.

This works only because the hashes are stable across builds, which is only true
because `next.config.mjs` pins `generateBuildId`. Do not remove that pin.

---

## Documentation

`docs/` is the product as much as the code is. A change to behaviour that
contradicts a document is not done until the document is updated.

Prose style: second person, imperative in procedures, sentence case headings,
short paragraphs. Direct and unhyped. Define jargon on first use.

**Do not overclaim.** This applies with particular force to
`docs/THREAT-MODEL.md`. Overstating what the device protects against is a
security bug in a project whose entire value rests on being honest about its
boundaries. If a defence is partial, say which part.

---

## Reporting security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).

---

## Licence

By contributing you agree that your contributions are licensed under the MIT
Licence, the same terms as the rest of the project. See [LICENSE](LICENSE).
