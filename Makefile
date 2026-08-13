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
MANIFEST_ROOTS := packages spec

.PHONY: help install dev build check check-fast verify manifest manifest-check \
        lint type-check test test-report test-vectors test-differential test-repro \
        prose sbom sbom-check repro-check clean web web-build web-lint web-type-check \
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

sbom: ## Emit a CycloneDX SBOM as a build artifact
	@node tools/gen-sbom.mjs

sbom-check: ## The committed SBOM still matches the installed tree
	@node tools/gen-sbom.mjs --check

repro-check: ## Build twice and assert the output is byte-identical
	@node tools/check-reproducible.mjs

# --- tests -------------------------------------------------------------------

test: ## Unit and property tests across all workspaces
	@npx vitest run

# These three land with phase 2. Until there is a BIP surface there are no
# official vectors, no second implementation to disagree with, and no signature
# to reproduce. They are wired here and gated off in CI rather than made to pass
# vacuously, for the same reason `make verify` reports them as not-applicable.

test-vectors: ## Official BIP test vectors from spec/vectors/ (phase 2)
	@npx vitest run --project vectors

test-differential: ## Cross-check against bitcoinjs-lib, an independent implementation (phase 2)
	@npx vitest run --project differential

test-repro: ## Sign the same PSBT repeatedly, assert byte-identical output (phase 2)
	@npx vitest run --project reproducibility

lint: ## ESLint, including the no-network rule that enforces INV-NET-2
	@npx eslint .

type-check: ## TypeScript, no emit, across the whole monorepo
	@npx tsc --build --dry 2>/dev/null || true
	@npx tsc --build

# --- build -------------------------------------------------------------------

build: ## Build every package
	@npx tsc --build

dev: ## Run the daemon and UI locally against a Unix socket
	@npm run dev --workspace @nullroute/daemon

image: ## Build the hardened Raspberry Pi image
	@bash tools/build-image/build.sh

clean: ## Remove build output
	rm -rf packages/*/dist apps/web/.next apps/web/out **/*.tsbuildinfo

# --- the website -------------------------------------------------------------
# nullroute.space. Never ships to the device, never enters MANIFEST.lock.

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

deploy: web-check ## Build, hash, and ship those exact bytes to nullroute.space
	# PREBUILT on purpose. Vercel building the same commit on its own runners
	# emits a different RSC payload than a local build, so the committed CSP
	# hashes would not cover the served scripts. The failure is silent: the page
	# renders and hydration dies with React #412. Deploying prebuilt means what
	# was hashed is what is served.
	@node tools/build-vercel-output.mjs
	@npx vercel deploy --prebuilt --prod
	@$(MAKE) --no-print-directory web-live-check

# --- aggregates --------------------------------------------------------------

check-fast: lint type-check prose test manifest-check ## Everything except the slow suites

check: check-fast build verify repro-check sbom web-check ## Everything CI runs
