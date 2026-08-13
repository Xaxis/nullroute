## What this changes

<!-- What behaviour is different after this merges, and why. -->

## Spec ids

<!-- Which spec(s) this implements or modifies, e.g. core.entropy.combiner.
     If this adds an exported symbol to packages/core, it needs spec coverage
     or `make verify` will fail. -->

## Invariants

<!-- Does this touch an invariant in docs/THREAT-MODEL.md? If it changes one,
     say so explicitly. A silent invariant change defeats the point of having
     them. -->

- [ ] No invariant changed
- [ ] An invariant changed, and it is described above

## Checklist

- [ ] `make check` passes locally
- [ ] New exported symbols in `packages/core` are covered by a spec
- [ ] Every new invariant names a test that exists and passes
- [ ] Comments explain why, and security-relevant code names its spec id
- [ ] No em dashes (`make prose` enforces this)

## Dependencies

- [ ] This does not change `package-lock.json`
- [ ] This changes `package-lock.json`, and the reasoning is below

<!-- A lockfile change needs explicit human sign-off. Dependency confusion and
     typosquatting look exactly like an innocuous lockfile diff, and someone
     reading it is the only defence that works. For a new dependency, state:
     what it does that we cannot do ourselves, its transitive tree and byte
     count, who audits it, whether it has install scripts, and what happens if
     it is abandoned. -->

## Security

<!-- If this touches key material, signing, parsing of untrusted input, or the
     verification system, say what an attacker gains if you got it wrong. -->
