# Testing and releases

Trace ships macOS builds for Apple Silicon and Intel. Application manifests,
the npm lockfile, and Trace's Cargo package/lock entry use the same version. The
sidebar reads the desktop package version rather than a separately maintained
label. Report schema versions are independent and must not be bumped for an app
release.

## Continuous integration

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`, and can be
run manually. It checks matching versions, generated validators, TypeScript,
frontend/report tests, Python contract tests, and the frontend production build.
Native Rust tests run on both Apple Silicon and Intel macOS runners. Dependencies
are installed with `npm ci` and Cargo's `--locked` flag; action references are
pinned to commit SHAs.

For local checks:

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements-test.txt
source .venv/bin/activate
npm ci
npm run check
npm test
npm run test:contract
cargo test --locked --manifest-path apps/trace/src-tauri/Cargo.toml
```

## Cut a release

1. Start a branch from the latest `main`. Run `npm run release:version -- 0.0.2`
   with the intended version. This updates all app manifests and lock entries
   without changing dependency versions. Only stable `MAJOR.MINOR.PATCH` versions
   are supported by this initial release process.
2. Add `docs/releases/v0.0.2.md` with user-facing changes and installation notes.
   Keep the signing limitations accurate. The workflow falls back to
   `docs/releases/TEMPLATE.md` if version-specific notes are absent.
3. Commit, open a pull request, wait for CI, and merge it into `main`.
4. Tag the merged release commit and push the tag:

   ```sh
   git fetch origin
   git tag -a v0.0.2 origin/main -m "Trace 0.0.2"
   git push origin v0.0.2
   ```

The tag triggers `.github/workflows/release.yml`. It requires the tag to match
every version field and the commit to be reachable from `main`. It runs the same
CI suite on the tagged commit, builds DMGs and app ZIPs for both architectures,
checks bundle versions and code signatures, and generates SHA-256 checksums.
Only after both builds succeed does it upload a draft GitHub Release and publish
it. A build failure leaves the release unpublished.

Monitor the **Release** workflow in GitHub Actions. Retry a transient failure
using **Re-run failed jobs**, or dispatch the workflow against the existing tag:

```sh
gh workflow run release.yml --ref v0.0.2
```

Dispatching against a branch is rejected. Reruns can finish a draft, but refuse
to overwrite an already published release. Fix a code/build issue with a new
version and tag; do not move a published tag.

## Signing and distribution

CI currently sets `APPLE_SIGNING_IDENTITY=-`, providing ad-hoc signatures without
Developer ID certificates or notarization. Downloads may require **Open Anyway**
in macOS Privacy & Security after the user verifies the source. The workflow does
not disable Gatekeeper. Apple notarization and automatic updates are not enabled.

To add Developer ID distribution later, provision signing and notarization
secrets following [Tauri's macOS signing guide](https://v2.tauri.app/distribute/sign/macos/),
replace the ad-hoc identity, and update the release notes. No personal signing
credentials are required for the current workflow; only its final publishing
job receives `contents: write` on the built-in GitHub token.
