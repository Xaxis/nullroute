# nullroute: one entry point for everything.
#
# Every target here is also run by CI, so what a contributor runs locally and
# what the build runs cannot drift apart. If you add a check, add it to `check`
# and to .github/workflows/ci.yml in the same commit.
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
        lint type-check test test-report test-vectors test-differential test-repro \
        prose links profiles sbom sbom-check repro-check clean dev-daemon build-app web web-build web-lint web-type-check \
        web-isolation web-csp web-responsive web-check web-live-check deploy image

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

verify: build test-report ## The six checks from docs/VERIFICATION.md, emits verification-report.json
	@node packages/verify/dist/cli.js

test-report: ## Run the suite and emit the machine-readable report verify consumes
	# verify asserts the status of each individual test rather than trusting the
	# exit code. `it.skip` leaves vitest at exit 0 with success:true, so an
	# exit-code check would certify invariants that never ran.
	@npx vitest run --reporter=json --outputFile=test-report.json > /dev/null

manifest: ## Regenerate MANIFEST.lock from the tracked sources
	# Plain `sha256sum` output format, sorted under LC_ALL=C, so a third party
	# can check it with coreutils rather than with our tool. The root hash is
	# then just `sha256sum MANIFEST.lock`. See docs/VERIFICATION.md.
	@find $(MANIFEST_ROOTS) -type f \
	  \( -name '*.ts' -o -name '*.tsx' -o -name '*.yaml' -o -name '*.json' \) \
	  -not -path '*/node_modules/*' -not -path '*/dist/*' -print0 \
	  | LC_ALL=C sort -z | xargs -0 shasum -a 256 > MANIFEST.lock
	@printf 'root hash: '; shasum -a 256 MANIFEST.lock | cut -d' ' -f1

manifest-check: ## Every tracked source still matches MANIFEST.lock
	@shasum -a 256 -c MANIFEST.lock --status \
	  && printf 'manifest OK, root hash: ' \
	  && shasum -a 256 MANIFEST.lock | cut -d' ' -f1 \
	  || { echo 'MANIFEST MISMATCH'; shasum -a 256 -c MANIFEST.lock | grep -v ': OK$$'; exit 1; }

prose: ## No em dashes, no emoji, no overclaiming markers in docs and UI copy
	@node tools/check-prose.mjs

links: ## Every internal link resolves, and every anchor exists on its target
	@node tools/check-links.mjs

profiles: ## Hardening profiles validate, and every assertion is falsifiable
	# Enforces the rules a JSON Schema cannot: every assertion carries a
	# verifier, every assertion states what it does NOT cover, and no assertion
	# claims to check at build time a fact only observable on a running device.
	@node tools/check-profiles.mjs

sbom: ## Emit a CycloneDX SBOM as a build artifact
	@node tools/gen-sbom.mjs

sbom-check: ## The committed SBOM still matches the installed tree
	@node tools/gen-sbom.mjs --check

repro-check: ## Build twice and assert the output is byte-identical
	@node tools/check-reproducible.mjs

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

lint: ## ESLint, including the no-network rule that enforces INV-NET-2
	@npx eslint .

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

dev-daemon: build manifest verify ## Just the daemon, on a Unix socket in /tmp
	@NULLROUTE_SOCKET=$${NULLROUTE_SOCKET:-/tmp/nullrouted.sock} \
	  node --jitless packages/daemon/dist/main.js

build-app: ## Production build of the device UI
	@npm run build:app --workspace @nullroute/ui

image: ## Build the hardened Raspberry Pi image
	@bash tools/build-image/build.sh

clean: ## Remove build output
	rm -rf packages/*/dist apps/web/.next apps/web/out **/*.tsbuildinfo

# --- the website -------------------------------------------------------------
# nullroute.diy. Never ships to the device, never enters MANIFEST.lock.

web: ## Run the website locally
	@npm run dev --workspace @nullroute/web

web-build: ## Production build of the website
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
	@node tools/check-web-isolation.mjs

web-csp: ## vercel.json's CSP still matches the built inline script hashes
	@node tools/gen-csp.mjs --check

web-responsive: ## No page scrolls sideways at 320px or 390px. Drives a real browser.
	@node tools/check-responsive.mjs

web-check: web-lint web-type-check web-build web-isolation web-csp web-responsive ## Every website check

web-live-check: ## Load the DEPLOYED site in a real browser and assert nothing is broken
	# The one check that caught a broken CSP. Every other check passed while
	# hydration was dead: 200s, correct HTML, perfect screenshots, React #412 in
	# the console and nowhere else.
	@node tools/check-web-live.mjs

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

check-fast: lint type-check prose links profiles test manifest-check ## Everything except the slow suites

check: check-fast build verify test-vectors test-differential repro-check sbom web-check ## Everything CI runs
