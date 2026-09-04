# nullroute: one entry point for everything.
#
# Every target here is also run by CI, so what a contributor runs locally and
# what the build runs cannot drift apart. That is asserted by `make ci-parity`
# rather than remembered: this comment was here from the start and was not
# true, and eighteen checks ran on workstations and nowhere else.
#
#   make          list targets
#   make check    everything CI runs
#   make verify   the spec verification system, the heart of the project

SHELL := /bin/bash
.DEFAULT_GOAL := help

# The manifest covers what ships to the device. apps/web is the public website
# and is deliberately excluded: see docs/VERIFICATION.md.
MANIFEST_ROOTS := packages spec provisioning

.PHONY: help install dev build check check-fast verify manifest manifest-check \
	contrast ui-roles \
	qr-readback \
	manifest-recipe print-manifest-roots \
        lint ui-classes type-check test test-report test-vectors test-differential test-repro \
        test-recovery-drill \
        prose links profiles sbom sbom-check repro-check clean dev-daemon build-app web web-build web-lint web-type-check \
        screens screen-fit ui-constants dev-check verify-image docs-reachable no-dead-ends \
        image-env image-shell image-system image-repro journeys \
        web-isolation web-csp web-responsive web-site-links web-dice-demo web-check web-live-check deploy image

help: ## List available targets
	@grep -hE '^[a-z][a-z-]*:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies exactly as the lockfile pins them
	# ci, never install. `npm install` may resolve a different tree than the
	# lockfile intends, which breaks the reproducibility claim the manifest
	# root hash rests on.
	npm ci

# --- verification ------------------------------------------------------------
# Each of these is a claim the repository makes about itself.

verify: build test-report ## The five checks from docs/VERIFICATION.md, emits verification-report.json
	@node packages/verify/dist/cli.js

test-report: ## Run the suite and emit the machine-readable report verify consumes
	# verify asserts the status of each individual test rather than trusting the
	# exit code. `it.skip` leaves vitest at exit 0 with success:true, so an
	# exit-code check would certify invariants that never ran.
	@npx vitest run --reporter=json --outputFile=test-report.json > /dev/null

print-manifest-roots: ## The directories MANIFEST.lock covers (for check-manifest-recipe)
	@echo '$(MANIFEST_ROOTS)'

manifest: ## Regenerate MANIFEST.lock from the tracked sources
	# Plain `sha256sum` output format, sorted under LC_ALL=C, so a third party
	# can check it with coreutils rather than with our tool. The root hash is
	# then just `sha256sum MANIFEST.lock`. See docs/VERIFICATION.md.
	#
	# `git ls-files`, not `find` with a list of extensions. The extension list
	# covered .ts/.tsx/.yaml/.json and so left eighteen tracked files unhashed,
	# including packages/ui/index.html (which carries the device CSP), the
	# stylesheet that lays out every screen, all five provisioning verifiers,
	# the digest-pinned Dockerfile, the two patches that pin the verity salt
	# and the ext4 hash seed, and both systemd units. An allowlist of
	# extensions fails open: a file type nobody thought of is silently outside
	# the hash a user compares before entering their PIN. Tracked-or-not is the
	# property that matters, and it is what this target's description has
	# always claimed to use.
	@git ls-files -z $(MANIFEST_ROOTS) \
	  | LC_ALL=C sort -z | xargs -0 shasum -a 256 > MANIFEST.lock
	@printf 'root hash: '; shasum -a 256 MANIFEST.lock | cut -d' ' -f1
	# docs/VERIFICATION.md prints this hash in a transcript a reader is told to
	# reproduce. Updating it here means it is never a thing someone remembered
	# to do, which is how it came to be four commits out of date.
	@node tools/checks/check-manifest-recipe.mjs --write

manifest-recipe: ## The commands docs/VERIFICATION.md tells you to run print what it says
	# A document is not executable, so the page teaching a stranger how to
	# recompute the root hash had drifted from the tool in four ways at once,
	# including printing a command that omitted a third of the manifest. This
	# runs every transcript in that section.
	@node tools/checks/check-manifest-recipe.mjs

manifest-check: ## Every source under the manifest roots is tracked, and matches MANIFEST.lock
	# BOTH HALVES, because the second one is where the hole was.
	#
	# `shasum -c` answers "does every file the manifest lists still hash to what
	# it says". It cannot answer "does the manifest list every file", and the
	# manifest is built from `git ls-files`, so a source file that has never been
	# staged is outside it and every check in this repository passes. That is not
	# hypothetical: packages/ui/src/components/Refusal.tsx sat untracked through a
	# full green run, imported by nineteen screens, contributing nothing to the
	# root hash a user compares before entering their PIN.
	#
	# An omission is worse than a mismatch. A mismatch is loud; an omission looks
	# exactly like a file that is fine.
	@untracked=$$(git ls-files --others --exclude-standard -- $(MANIFEST_ROOTS)); \
	  if [ -n "$$untracked" ]; then \
	    echo 'UNTRACKED SOURCES UNDER THE MANIFEST ROOTS'; \
	    echo "$$untracked" | sed 's/^/  /'; \
	    echo; \
	    echo '  MANIFEST.lock is built from `git ls-files`, so these are outside the'; \
	    echo '  root hash while being part of the build. Stage them and rerun'; \
	    echo '  `make manifest`, or add them to .gitignore if they are not sources.'; \
	    exit 1; \
	  fi
	@shasum -a 256 -c MANIFEST.lock --status \
	  && printf 'manifest OK, root hash: ' \
	  && shasum -a 256 MANIFEST.lock | cut -d' ' -f1 \
	  || { echo 'MANIFEST MISMATCH'; shasum -a 256 -c MANIFEST.lock | grep -v ': OK$$'; exit 1; }

prose: ## No em dashes, no emoji, no overclaiming markers in docs and UI copy
	@node tools/checks/check-prose.mjs

links: ## Every internal link resolves, and every anchor exists on its target
	@node tools/checks/check-links.mjs

invariant-claims: ## The threat model and the specs agree on which invariants hold
	# A row in the threat model's invariant table is a claim about what this
	# device protects. One with no spec behind it is a promise nothing keeps,
	# which this project calls a security bug rather than a documentation chore.
	@node tools/checks/check-invariant-claims.mjs

device-ui: ## The device frontend actually boots under its own CSP. Drives a real browser.
	# check-device-csp reads the policy and judges it, which cannot catch a
	# policy so strict the application never starts. That failure is silent
	# everywhere else: the build succeeds, jsdom tests pass, the panel is black.
	@npm run build:app --workspace @nullroute/ui >/dev/null
	@node tools/checks/check-device-ui.mjs

qr-readback: ## Every code leaving this device fails loudly when it is misread
	# A camera reads a code off this panel into software on a networked machine.
	# If that read is wrong, a plausible-looking result is the failure that costs
	# money. The answer is per payload rather than general, which is why it was
	# never written down: seven codes, seven reasons a misread cannot pass. This
	# keeps the set closed rather than checking the mechanisms, which live in the
	# receiving software and in invariants of this one.
	@node tools/checks/check-qr-readback.mjs

device-csp: ## The device frontend really has the policy INV-NET-3 claims
	# The threat model claimed this policy while packages/ui/index.html carried
	# none: the only CSP in the repo was the website's, and the website is not
	# the device.
	@node tools/checks/check-device-csp.mjs

profiles: ## Hardening profiles validate, and every assertion is falsifiable
	# Enforces the rules a JSON Schema cannot: every assertion carries a
	# verifier, every assertion states what it does NOT cover, and no assertion
	# claims to check at build time a fact only observable on a running device.
	@node tools/checks/check-profiles.mjs
	# A build recipe nothing in CI executes is the same shape of problem: it
	# reads as a working build and checks nothing. This does not check that a
	# recipe works, which it cannot, only that it and the profile declaring it
	# agree and that it says plainly it has never been run.
	@node tools/checks/check-backends.mjs

sbom: ## Emit a CycloneDX SBOM as a build artifact
	@node tools/gen-sbom.mjs

sbom-check: ## The SBOM on disk still matches the installed tree
	@node tools/gen-sbom.mjs --check

repro-check: ## Build twice and assert the output is byte-identical
	@node tools/checks/check-reproducible.mjs

# --- tests -------------------------------------------------------------------

test: ## Unit and property tests across all workspaces
	@npx vitest run

test-vectors: ## Official BIP test vectors from spec/vectors/
	@npx vitest run --project core -t 'official vectors'

test-differential: ## Cross-check against bitcoinjs-lib, an independent implementation
	@npx vitest run --project core -t 'differential'

# Lands with PSBT signing. There is no signature to reproduce until then, and a
# target that passed with nothing to examine would report assurance the project
# has not earned.
test-repro: ## Sign the same PSBT 100 times and cross-check the bytes against libsecp256k1
	# INV-SIG-1 and INV-SIG-2. A hundred signings of one transaction must yield
	# one distinct result, and that result must equal what an independent
	# implementation produces. Self-consistency alone proves nothing: a
	# backdoored nonce is perfectly self-consistent. The second half is the half
	# that means something.
	@npx vitest run --project core \
	  -t "produces-byte-identical-signatures|agrees-byte-for-byte-on-a-p2wpkh-signature"

test-recovery-drill: build ## INV-INTEROP-1. Recover a wallet in Bitcoin Core alone. Needs regtest bitcoind.
	# The most important test here, and the only one that proves this project
	# is ABANDONABLE: Core derives the addresses, Core builds the spend, Core
	# finalises and broadcasts. nullroute contributes a signature and nothing
	# else. Not part of `make check`, because it needs a bitcoind that most
	# machines do not have, and it exits non-zero rather than skipping when
	# there is none: a vacuous pass on this claim means somebody's funds are
	# unrecoverable and nothing said so.
	@node tools/recovery-drill.mjs

lint: ## ESLint, including the no-network rule that enforces INV-NET-2
	@npx eslint .

format: ## Apply .prettierrc to everything .prettierignore does not exclude
	@npx prettier --write . --log-level warn
	@echo 'format: applied'

ci-parity: ## Every target `make check` runs is also run by .github/workflows/ci.yml
	# The header of this file has always claimed this and it was not true: CI
	# ran a hand-curated list and eighteen targets were absent from it,
	# including the threat-model honesty gate, the device CSP, and every
	# visual guarantee about the panel. Both comments read as though they
	# covered each other, and only one direction was ever true.
	@node tools/checks/check-ci-parity.mjs

format-check: ## The same, asserted rather than applied
	# WHY THIS IS IN `check` AT ALL. .prettierrc and .prettierignore have been
	# in this repository since the beginning and nothing ever ran them: 142
	# files disagreed with the configuration the project declares, which makes
	# the configuration decoration. That is out of character here, where every
	# other convention is machine-checked rather than remembered, and it is the
	# same failure shape as a lint rule with no test.
	#
	# It also had a cost. ScanScreen's props destructuring had been left half
	# on one line with a blank entry in the middle of it, which is what a
	# botched edit looks like, and it survived because nothing was looking.
	@npx prettier --check . --log-level warn \
	  || { echo; echo '  Run `make format`. The configuration is .prettierrc, and it is'; \
	       echo '  enforced rather than suggested: see the comment on this target.'; exit 1; }
	@echo 'format-check: every file matches .prettierrc'

ui-classes: ## Every nr- class the device UI uses has a rule in styles.css
	# The lock screen once shipped entirely unstyled: it used an nr-lock__*
	# naming scheme that was never written into the stylesheet. Types, lint and
	# every unit test passed, because a className is just a string and the tests
	# assert on data-testid. Nothing else in the toolchain checks that a class
	# name refers to something.
	@node tools/checks/check-ui-classes.mjs

type-check: ## TypeScript, no emit, across the whole monorepo
	@npx tsc --build tsconfig.build.json --force

# --- build -------------------------------------------------------------------

build: ## Build every package
	# The solution file is named explicitly. A bare `tsc --build` resolves
	# tsconfig.json, which is the lint/IDE config with noEmit and composite off,
	# so it silently emits NOTHING and exits 0. On a workstation that looks fine
	# because dist/ is already there from an earlier build; on a clean checkout
	# the next step cannot find the CLI it just "built". CI caught this.
	@npx tsc --build tsconfig.build.json

# `manifest` before `verify`, on the dev targets only. The daemon refuses to
# start against a stale manifest, which is right on a device and pure friction
# in an edit-run loop: every source change would otherwise need a hand-run
# `make manifest` before the app would launch. Regenerating here does NOT weaken
# the guarantee, because `make manifest-check` in `check` and in CI is what
# asserts the COMMITTED manifest matches the tree, and that is the claim a user
# actually verifies against a release.
dev: build manifest verify ## Run the whole device locally: daemon plus UI at 127.0.0.1:5180
	@bash tools/dev.sh

restart: ## Stop everything and start the local device clean. FRESH=1 also erases local wallets
	# One step instead of two. `make dev` REFUSES to start on top of a previous
	# run, which is right for a script that might be stepping on something you
	# meant to keep, and tedious when you are restarting all afternoon. This is
	# the other half: stop, then start.
	#
	# It does NOT deploy anything. `make deploy` publishes the website to
	# nullroute.diy and has nothing to do with running the device locally.
	#
	# Wallets survive unless you say FRESH=1, which names the directory and
	# counts what it is about to erase.
	@bash tools/dev-restart.sh

dev-daemon: build manifest verify ## Just the daemon, on a Unix socket in /tmp
	@NULLROUTE_SOCKET=$${NULLROUTE_SOCKET:-/tmp/nullrouted.sock} \
	  node --jitless packages/daemon/dist/main.js

build-app: ## Production build of the device UI
	@npm run build:app --workspace @nullroute/ui

# --- the image build host ----------------------------------------------------
# The recipe in provisioning/backends/ needs mmdebstrap, veritysetup and
# genimage, and its README said for months that this repository is developed on
# macOS and therefore cannot run them. A pinned Linux container is a Linux
# machine, and a better one than a borrowed VM: a stranger reproduces it from a
# digest rather than from a description of somebody's laptop.
#
# arm64 on purpose. The target is a Raspberry Pi 5 and cross-building a rootfs
# is a different exercise with different failure modes; on Apple silicon this
# runs natively.
IMAGE_ENV := nullroute-build:local

image-env: ## Build the pinned Linux host the image is built on
	@docker build --platform linux/arm64 -t $(IMAGE_ENV) \
		-f provisioning/build/Dockerfile provisioning/build
	@echo
	@docker run --rm --platform linux/arm64 $(IMAGE_ENV) sh -c '\
		echo "  mmdebstrap  $$(mmdebstrap --version)"; \
		echo "  genimage    $$(genimage --version)"; \
		echo "  veritysetup $$(veritysetup --version)"'
	@echo
	@echo '  Build half only. This kernel has no dm-verity target, so'
	@echo '  "veritysetup format" computes a root hash here and "veritysetup open"'
	@echo '  does not work. Nothing in this container can show that a device boots'
	@echo '  with an immutable root. provisioning/README.md says which assertions'
	@echo '  that leaves uncounted.'

image-shell: image-env ## A shell in the build host, with the repository mounted
	# --privileged for loop devices, which mmdebstrap and genimage both need.
	# SOURCE_DATE_EPOCH from the repository's own last commit, so two builds of
	# one commit produce the same bytes rather than two different timestamps.
	@docker run --rm -it --privileged --platform linux/arm64 \
		-v "$(CURDIR)":/work \
		-e SOURCE_DATE_EPOCH="$$(git log -1 --format=%ct)" \
		$(IMAGE_ENV) bash

# The pinned identifiers, derived once on the host by the same module the
# verifiers use. See provisioning/build/identifiers.mjs for why they are not
# computed in the container.
#
# Through a file rather than repeated -e flags: one of the values is the kernel
# command line, which contains spaces, and a shell that word-splits it hands
# docker seven broken arguments instead of one variable.
IMAGE_ENVFILE := out/build.env

$(IMAGE_ENVFILE):
	@mkdir -p out
	@node provisioning/build/identifiers.mjs > $@

image-system: image-env $(IMAGE_ENVFILE) ## Build the system partition and print its verity root hash
	@docker run --rm --privileged --platform linux/arm64 \
		-v "$(CURDIR)":/work \
		-e SOURCE_DATE_EPOCH="$$(git log -1 --format=%ct)" \
		-e NULLROUTE_EXPORT_ROOTFS="$${NULLROUTE_EXPORT_ROOTFS:-0}" \
		--env-file $(IMAGE_ENVFILE) \
		$(IMAGE_ENV) /work/provisioning/build/build-system.sh /work/out/system

image-repro: image-env $(IMAGE_ENVFILE) ## Build the card TWICE and run the reproducibility verifier
	# THE ASSERTION THIS WHOLE DIRECTORY EXISTS FOR. A dm-verity root hash that
	# changes between builds of one commit is a number nobody can compare
	# against anything, which makes the lock screen's central claim decorative.
	#
	# Two builds from scratch, not one build hashed twice: the question is
	# whether the pipeline is deterministic, and a second hash of the same bytes
	# cannot answer it.
	#
	# Judged by provisioning/checks/, not by a cmp in this file. The whole
	# design rests on the unchanged verifiers deciding, and a Makefile that
	# graded its own output would be the backend influencing its own verdict.
	@docker run --rm --privileged --platform linux/arm64 \
		-v "$(CURDIR)":/work \
		-e SOURCE_DATE_EPOCH="$$(git log -1 --format=%ct)" \
		--env-file $(IMAGE_ENVFILE) \
		$(IMAGE_ENV) sh -c '\
			NULLROUTE_WORK=/build-a /work/provisioning/build/build-system.sh /work/out/repro-a >/dev/null && \
			NULLROUTE_WORK=/build-b /work/provisioning/build/build-system.sh /work/out/repro-b >/dev/null'
	@echo "  build A  $$(cat out/repro-a/root-hash)"
	@echo "  build B  $$(cat out/repro-b/root-hash)"
	@echo
	@$(MAKE) --no-print-directory verify-image \
		IMAGE=out/repro-a/nullroute.img COMPARE=out/repro-b/nullroute.img

image: ## Build the hardened Raspberry Pi image. NOT IMPLEMENTED YET.
	# Fails on purpose, and says so, rather than calling a script that is not
	# there. This target used to run tools/build-image/build.sh, which was never
	# written, so `make image` produced a bash "no such file" that reads as a
	# broken checkout rather than as a feature in design.
	#
	# The documentation is honest that the build system is being designed. The
	# Makefile was not, and the Makefile is what somebody actually runs.
	@echo 'make image: the image build system is not implemented yet.'
	@echo
	@echo '  The hardware, the hardening controls and the constraints are settled'
	@echo '  and written up in docs/VERIFICATION.md. The build system that turns'
	@echo '  them into a flashable image is still being designed, and this target'
	@echo '  exists so that is a sentence rather than a missing file.'
	@echo
	@echo '  What DOES exist is the CONTRACT that build has to satisfy, which is'
	@echo '  the half that had to come first: a backend is supported when the'
	@echo '  unchanged verifiers pass against its output, and verifiers written'
	@echo '  afterwards would be written to agree with whatever it produced.'
	@echo
	@echo '    make profiles       what is asserted, and how much of it is checkable'
	@echo '    make fixture-image  the image verifiers running, including a failure'
	@echo '    make verify-image   point them at a real artifact, when there is one'
	@echo
	@echo '  What else works today: make check, make verify, and make dev to run'
	@echo '  the daemon and the frontend on this machine.'
	@exit 1

verify-image: ## Check a built artifact against the provisioning profiles. ROOT=<dir> and/or IMAGE=<file>, REQUIRE=<ids>
	# ROOT answers what is in the FILES: packages, paths, unit directives, the
	# kernel command line. IMAGE answers what is in the BYTES between and
	# underneath filesystems: the partition table, the verity superblock,
	# filesystem identifiers. Neither can answer the other's questions.
	#
	# Neither is mounted. Mounting needs root, and a verification tool that
	# must run privileged is one people run less often.
	#
	# COMPARE is a second image, for the reproducibility assertion. One image
	# cannot demonstrate that two builds agree, and without it that assertion
	# reports could-not-run rather than passing.
	#
	# An assertion whose verifiers are unwritten prints as "not checked" and is
	# never counted as satisfied. The gap is the status of this work.
	#
	# REQUIRE=INV-PROV-18,INV-PROV-19 names assertions that must come back
	# CHECKED here, not merely not-failing. Reporting could-not-run and exiting
	# zero is this tool's correct behaviour and makes it useless as a gate on its
	# own: a job that exists to check unit exposure goes green on a machine
	# without systemd-analyze, having checked nothing. Whoever runs it knows what
	# their machine was supposed to see, so they say so.
	@test -n "$(ROOT)$(IMAGE)" || { \
	  echo 'make verify-image: pass ROOT=<directory>, IMAGE=<file>, or both.'; \
	  echo; \
	  echo '  There is no image build system yet, so there is nothing real on'; \
	  echo '  this machine to point it at. To see the image verifiers run:'; \
	  echo; \
	  echo '    make fixture-image'; \
	  exit 2; \
	}
	@node tools/verify-image.mjs \
	  $(if $(ROOT),--root "$(ROOT)") \
	  $(if $(IMAGE),--image "$(IMAGE)") \
	  $(if $(COMPARE),--compare "$(COMPARE)") \
	  $(if $(RELEASE),--release "$(RELEASE)") \
	  $(if $(REQUIRE),--require-checked "$(REQUIRE)")

fixture-image: ## Write a synthetic image and run the image verifiers against it
	# Not a build. It writes the superblocks and the partition table at the
	# offsets the published formats put them at, with this release's pinned
	# identifiers, so the verifiers have something to run against before a
	# backend exists. Flashing it produces a card that does nothing.
	#
	# It builds the image TWICE and then a third time with a drifting verity
	# salt, because a verifier nobody has watched fail is a verifier nobody
	# knows works. The third run is expected to fail and says so.
	@mkdir -p .fixture
	@node tools/make-fixture-image.mjs .fixture/a.img
	@node tools/make-fixture-image.mjs .fixture/b.img
	@node tools/verify-image.mjs --image .fixture/a.img --compare .fixture/b.img
	@echo
	@echo 'And now the upstream defect this exists to catch, on purpose:'
	@node tools/make-fixture-image.mjs .fixture/drift.img --drift
	@node tools/verify-image.mjs --image .fixture/drift.img --profile nullroute.os.verity \
	  && { echo 'fixture-image: the drifting salt was NOT caught, which is a bug in the verifier.'; exit 1; } \
	  || echo 'fixture-image: caught, which is the point.'

no-dead-ends: ## No screen traps the user with no way out
	# The device has no back button, no window to close and no keyboard. A
	# screen that renders no exit is a power cycle. SetupScreen shipped that
	# way: "add a wallet", change your mind, and you were stuck.
	@node tools/checks/check-no-dead-ends.mjs
	# A call that changed the device and nothing re-read it. This shipped:
	# wallets.unlock did not refresh, so status.hasWallet stayed false all
	# session and the idle lock never armed. Every test passed.
	@node tools/checks/check-status-refresh.mjs
	# A call type that promises a field the daemon never sends. call() casts
	# parsed JSON and checks nothing, so the compiler will not catch it: the
	# value is undefined at runtime and typed as present.
	@node tools/checks/check-ipc-types.mjs

docs-reachable: ## Every document is registered on the site and linked from the README
	# A document nobody can find is not a published document. This happened
	# twice with the same two files: they built, the sitemap listed them, and
	# the only route in was to type the URL.
	@node tools/checks/check-docs-reachable.mjs

make-targets: ## Every script the Makefile invokes actually exists
	@node tools/checks/check-make-targets.mjs

ipc-reachable: ## Every IPC method the daemon implements is reachable from the UI
	# A feature nobody can reach is not a shipped feature. This has happened
	# twice: the multi-wallet picker, and then message signing, BIP-85 and
	# labels. Both times every test passed, because every test called the
	# daemon directly.
	@node tools/checks/check-ipc-reachable.mjs

header-rule: ## The header offers one exit or none, never one and a half
	# Collapsing three header states into one fixed the look and opened a hole:
	# the identity chip beside the menu is ALSO an exit, since it opens the
	# wallet picker. A screen that withholds the menu and offers a tappable
	# wallet name two inches away has withheld nothing, and the screens that
	# withhold it are the seed words and the transaction review.
	@node tools/checks/check-header-rule.mjs

screens: ## Build the screen gallery, a layout harness that never ships to the device
	# TYPECHECKED FIRST. vite builds this with esbuild, which strips types
	# without reading them, and the gallery is not in tsconfig.build.json
	# because it never ships. So a fixture could pass a component anything and
	# three visual guards would go on measuring it: the PSBT fixture spent
	# months rendering a `fee-high` warning, which is not a kind this device
	# emits, on the screen those guards exist to check.
	#
	# A fixture is a claim about what the device can show. An unchecked one is
	# a claim about nothing.
	@npx tsc -p tools/screens/tsconfig.json --noEmit
	@npx vite build --config tools/screens/vite.config.ts

journeys: build-app ## Every guided journey completes, in the real app against a real daemon
	# BUILD FIRST, DECLARED RATHER THAN LUCKY. This serves packages/ui/dist-app,
	# so without the dependency it walks whatever was built last. In a full `make
	# check` that happened to be fresh, because device-ui builds the app inline
	# and runs earlier; on its own it silently drove a stale frontend. That cost
	# real time: a stylesheet change looked like it was not rendering in the real
	# app when it had simply never been built into it.
	# The check that would have caught the device shipping unable to create a
	# wallet. Unit tests run in jsdom, which has no daemon and computes no
	# layout; check-screen-fit measures hand-written fixtures; check-device-ui
	# drives the real frontend and stops at the lock screen because there is
	# nothing behind it. This is the missing half.
	#
	# Its own store directory and its own socket, both temporary, so it never
	# touches wallets on the machine it runs on.
	@node tools/checks/check-journeys.mjs

ui-roles: screens ## Guidance is an info box, not whichever prose style came to hand
	# Three roles, on purpose: a banner means something is wrong, an info box says
	# what the screen is for, a hint is micro-copy beside one control. Before the
	# info box existed there were only the other two, so seventeen paragraphs of
	# screen-level guidance were written as whichever came to hand.
	@node tools/checks/check-ui-roles.mjs

contrast: screens ## No text on the panel is below WCAG AA, in either theme
	# The whole interface is somebody reading characters off a 7 inch panel and
	# acting on them: seed words copied in order, an address compared against a
	# payer's screen, a manifest root compared against a release. In whatever
	# light the room has. Dim text here is the failure mode, not a preference.
	#
	# Measured against what composites under the text rather than read off the
	# tokens, because most of these sit on a translucent mix over a card.
	@node tools/checks/check-contrast.mjs

screen-fit: screens ## Every device screen fits 800x480. Drives a real browser.
	# The panel is fixed hardware: no scrollbar, no window to resize. A control
	# that does not fit is a control that does not exist. jsdom computes no box
	# model, so nothing in the test suite can see this, and check-device-ui
	# reaches only the lock screen because there is no daemon behind it.
	@node tools/checks/check-screen-fit.mjs

dev-check: ## `make dev` still renders a styled application. Drives a real browser.
	# The dev server served the whole device UI with no stylesheet for as long
	# as index.html carried a strict CSP: vite dev injects CSS inline and
	# style-src 'self' blocks it. Every other CSP check reads the production
	# build, where Vite emits an external stylesheet the policy allows.
	@node tools/checks/check-dev-server.mjs

ui-constants: build-app ## Values the frontend restates agree with the daemon that enforces them
	# Same reason as journeys: this reads the built stylesheet, so it has to be
	# built. It was relying on somebody having run build-app first.
	# The UI may not import from packages/daemon, so a few lists exist twice.
	# A colour on one side and not the other is a swatch that produces an
	# error when tapped, and nothing else in the suite looks at both.
	@node tools/checks/check-ui-constants.mjs

clean: ## Remove build output
	rm -rf packages/*/dist apps/web/.next apps/web/out **/*.tsbuildinfo

# --- the website -------------------------------------------------------------
# nullroute.diy. Never ships to the device, never enters MANIFEST.lock.

web: verification-report.json ## Run the website locally
	@npm run dev --workspace @nullroute/web

# The home page renders the real figures from the last verification run, so the
# site cannot build without a report. The report is generated, never committed
# (committing it would let a stale pass ship), which means a clean checkout has
# to produce one before the site will build at all. Declaring it as a file
# prerequisite rather than calling `verify` unconditionally keeps `make web`
# from re-running the whole suite on every save.
verification-report.json:
	@$(MAKE) --no-print-directory verify

web-build: verification-report.json ## Production build of the website
	# Always from clean. Turbopack's incremental cache in .next changes the
	# emitted chunk filenames, which changes the inline RSC payload, which
	# changes the sha256 hashes the CSP pins. A warm build and a cold build of
	# identical source therefore produce different hashes. Removing the cache
	# makes the output a function of the source alone, which is what
	# `make web-csp` needs in order to mean anything.
	@rm -rf apps/web/.next apps/web/out
	@npm run build --workspace @nullroute/web

web-lint: ## ESLint the website workspace
	@npm run lint --workspace @nullroute/web

web-type-check: ## TypeScript for the website
	@npm run type-check --workspace @nullroute/web

web-isolation: ## The site loads nothing off-origin and emits no inline styles
	@node tools/checks/check-web-isolation.mjs

web-csp: ## vercel.json's CSP still matches the built inline script hashes
	@node tools/gen-csp.mjs --check

web-responsive: ## No page scrolls sideways, phone to desktop. Drives a real browser.
	@node tools/checks/check-responsive.mjs

web-site-links: ## Every link in the BUILT site resolves, routes and anchors both
	@node tools/checks/check-site-links.mjs

web-dice-demo: ## The site's dice demo hashes to the digest docs/ENTROPY.md publishes
	@node tools/checks/check-dice-demo.mjs

web-check: web-lint web-type-check web-build web-isolation web-csp web-responsive web-site-links web-dice-demo ## Every website check

web-live-check: ## Load the DEPLOYED site in a real browser and assert nothing is broken
	# The one check that caught a broken CSP. Every other check passed while
	# hydration was dead: 200s, correct HTML, perfect screenshots, React #412 in
	# the console and nowhere else.
	@node tools/checks/check-web-live.mjs

deploy: web-check ## Build, hash, and ship those exact bytes to nullroute.diy
	# PREBUILT on purpose. Vercel building the same commit on its own runners
	# emits a different RSC payload than a local build, so the committed CSP
	# hashes would not cover the served scripts. The failure is silent: the page
	# renders and hydration dies with React #412. Deploying prebuilt means what
	# was hashed is what is served.
	@node tools/build-vercel-output.mjs
	@npx vercel deploy --prebuilt --prod
	@$(MAKE) --no-print-directory web-live-check

# --- aggregates --------------------------------------------------------------

check-fast: lint format-check ci-parity ui-classes ui-constants no-dead-ends header-rule type-check prose links docs-reachable profiles invariant-claims make-targets ipc-reachable device-csp qr-readback test manifest-check manifest-recipe ## Everything except the slow suites

check: check-fast build verify test-vectors test-differential repro-check sbom device-ui screen-fit contrast ui-roles journeys dev-check web-check ## Everything CI runs
