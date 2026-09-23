# Releasing Mnemoverse Memory

The extension is published to two stores from one GitHub Actions workflow,
[`.github/workflows/publish.yml`](../.github/workflows/publish.yml):

| Store | ID | Page |
| --- | --- | --- |
| VS Code Marketplace | `Mnemoverse.mnemoverse-vscode` | https://marketplace.visualstudio.com/items?itemName=Mnemoverse.mnemoverse-vscode |
| Open VSX | `mnemoverse/mnemoverse-vscode` | https://open-vsx.org/extension/mnemoverse/mnemoverse-vscode |

Pushing a release tag starts the workflow. Nobody publishes from a laptop:
`package.json` has no `publish` script on purpose.

> **Deadline: 2026-12-01.** On that date Azure DevOps global PATs stop working,
> and `VSCE_PAT` is one. Until the [owner checklist](#owner-checklist-marketplace-publishing-without-a-pat-before-2026-12-01)
> below is done, every release after that date will fail on the Marketplace
> (Open VSX and the GitHub release still go out).

## Versions and tags

| Tag | Meaning | `package.json` version |
| --- | --- | --- |
| `vX.Y.Z` | stable release | `X.Y.Z` |
| `vX.Y.Z-pre` | pre-release, packaged with `--pre-release` | `X.Y.Z` (no suffix) |

- `package.json` always holds plain `X.Y.Z`. The Marketplace rejects semver
  pre-release suffixes; "pre-release" is a flag on the upload.
- **Each store accepts a version number once.** A version is either a
  pre-release or a stable release, never both. To promote pre-release code to
  stable, bump the version; the build fails if `vX.Y.Z` is tagged when
  `vX.Y.Z-pre` exists, or the other way round.
- Convention (Microsoft's recommendation, warned about but not enforced):
  **odd minor = pre-release** (0.3.x, 0.5.x), **even minor = stable**
  (0.4.x, 0.6.x). The two lines then never compete for version numbers: a
  stable patch never collides with a number the pre-release line already
  used, and pre-release users (who always get the highest version) move to
  stable only when a higher stable version ships.
- Users receive a pre-release only after choosing **Switch to Pre-Release
  Version** on the extension page. Once they have, they also get any later
  stable release with a higher version.

## Cut a stable release

Use Node 24 (`nvm use` reads `.nvmrc`). npm 11 keeps the lockfile clean; npm 10
rewrites parts of it.

1. Start from current main:
   ```sh
   git switch -c release/v0.4.0 origin/main
   ```
2. Bump the version in `package.json` and both version fields of
   `package-lock.json`:
   ```sh
   npm version 0.4.0 --no-git-tag-version
   ```
3. In `CHANGELOG.md`, turn `## [Unreleased]` into `## [0.4.0] — YYYY-MM-DD`
   (or add that heading). A release build fails without the exact heading.
4. Run the same gates CI runs:
   ```sh
   npm ci --ignore-scripts && npm run check:version && npm run compile && npm test && npm run check:package && npx --no vsce package
   ```
5. Commit (`release: v0.4.0 — <one line>`), push, open a PR. Merge when CI
   (`ci / Build, test, package`) is green.
6. Tag the merge commit on main and push the tag:
   ```sh
   git fetch origin
   git log -1 --oneline origin/main     # confirm this is the release commit
   git tag -a v0.4.0 origin/main -m "v0.4.0"
   git push origin v0.4.0
   ```
7. Watch **Actions → publish**. Each store job runs in its own environment
   (`openvsx`, `marketplace`). If an environment has required reviewers,
   approve that store's job there. Rejecting one stops only that store; the
   other store and the GitHub release still go ahead. To stop the release as a
   whole, reject both, or cancel the run while the store jobs are waiting.
8. Check both store pages show 0.4.0 (the Marketplace can take a few minutes)
   and that the GitHub release has the `.vsix` attached.

## Cut a pre-release

Same steps with an odd minor and a `-pre` tag:

```sh
npm version 0.3.0 --no-git-tag-version
# CHANGELOG: ## [0.3.0] — YYYY-MM-DD (pre-release)
# PR, merge, then:
git tag -a v0.3.0-pre origin/main -m "v0.3.0-pre"
git push origin v0.3.0-pre
```

The build packages with `vsce package --pre-release`, which sets the
pre-release flag in the `.vsix` manifest, and checks that the flag is there.
The Marketplace upload also passes `--pre-release` (vsce refuses a package
that was not built as a pre-release). Open VSX reads the flag from the
package; `ovsx publish` ignores `--pre-release` for a prepackaged `.vsix`, so
the workflow does not pass it. The GitHub release is marked as a pre-release.

## What the workflow does

| Job | Needs | Does | Permissions |
| --- | --- | --- | --- |
| `build` | | Resolves the tag (push ref or the `tag` input), requires `vX.Y.Z` / `vX.Y.Z-pre`, checks out the tag with full history, requires the tagged commit to be on `origin/main`, runs `scripts/check-version.mjs --tag` (tag = package.json = lockfile, exact CHANGELOG heading, no duplicate flavour of the version), `npm ci --ignore-scripts`, compile, test, `check:package` (what `vsce ls` would ship), `vsce package` once. If the tag already has a GitHub release with the `.vsix`, uses that file instead, after checking it has the same contents as the new package. Uploads the `vsix` artifact and records its SHA-256. | `contents: read` |
| `openvsx` | build | In environment `openvsx`. `ovsx publish <vsix> --skip-duplicate` with the token in the `OVSX_PAT` environment variable, using the ovsx version locked in `package-lock.json`. The pre-release flag comes from the package. | `contents: read` |
| `marketplace` | build | In environment `marketplace`. With `vars.AZURE_CLIENT_ID` set: `azure/login` (OIDC), then `vsce publish --packagePath <vsix> --azure-credential --skip-duplicate` (+ `--pre-release`). Without it: the same with the token in the `VSCE_PAT` environment variable instead of `--azure-credential`, plus a deadline warning. | `contents: read`, `id-token: write` |
| `release` | all three | Runs if `build` succeeded and at least one store job succeeded. Creates or updates the GitHub release with the `.vsix`, its SHA-256, links to both stores and, per store, whether this run uploaded the file or the store already had the version; writes the same to the job summary. | `contents: write` |

`openvsx` and `marketplace` do not depend on each other: one store failing
never blocks the other. Both publish the same `.vsix` file from `build`, and
both check out the commit `build` verified (by SHA, not the tag name again),
so the `ovsx` and `vsce` that handle the store credentials come from the
lockfile `build` checked.

`vsce package` is not byte-reproducible: packaging the same commit twice gives
two different SHA-256 values. That is why `build` publishes the `.vsix`
already attached to the tag's GitHub release when there is one. Without that, a
repeat run would upload new bytes to one store while the other store and the
release kept the old ones.

CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs the same
gates on every PR and push to main and uploads the `.vsix` as an artifact, so
a reviewer can install the exact build (**Extensions → … → Install from
VSIX…**).

## When something fails

- **`build` failed.** Nothing was published by this run. Fix it on main through
  a PR. If this was the tag's first run, no store has the version yet, so you
  may move the tag:
  `git tag -d v0.4.0 && git push origin :refs/tags/v0.4.0`, then tag the fixed
  commit. Never move a tag once any store has the version (check both store
  pages, and whether the tag has a GitHub release); bump instead.
- **One store failed** (for example an expired token). Fix the cause (rotate the
  secret, finish the Entra setup), then open the run and click **Re-run failed
  jobs**. Only the failed store job and the `release` job run again; the store
  job that succeeded is not repeated. They use the run's `vsix` artifact, so
  the failed store gets the same bytes as the other one, and `release`
  rewrites the notes with both results. Artifacts are kept 30 days. A re-run
  uses the workflow file of the original run, so a fix to `publish.yml` itself
  needs a fresh run (next item).
- **Both stores failed.** The `release` job is skipped. Fix and use **Re-run
  failed jobs** the same way.
- **Start a fresh run for an existing tag.** **Actions → publish → Run
  workflow**, `tag` = the tag. The workflow file comes from the branch you run
  it from (normally main); everything else comes from the tag. This works for
  tags created after this pipeline landed; older tags lack `.nvmrc` and
  `scripts/check-version.mjs`. `build` packages again, which gives new bytes.
  If the tag's GitHub release already has the `.vsix`, `build` checks that file
  has the same contents as the new package and publishes it instead, so both
  stores and the release keep one SHA-256. If the contents differ, `build`
  fails: a store may already serve the old file. Find out why before you delete
  the asset from the release to force a fresh build. **Re-run all jobs**
  behaves the same way.
- **`--skip-duplicate`.** Both publish commands use it. It matters in two cases:
  a store job that failed after the store had already accepted the upload, and
  a fresh run for a tag that a store already has. The store then reports
  success without uploading. The store job records that, and the release notes
  show "already had X.Y.Z; not uploaded again" for that store instead of
  "published". If no release existed to reuse a `.vsix` from, the notes also
  say that the store's copy may not be byte-identical to the attached file.

## Secrets and variables

A job can read repository secrets and variables, plus those of the
environment it runs in; a value set on an environment wins over a repository
value of the same name. So each secret belongs either at repository level
(**Settings → Secrets and variables → Actions**) or on the environment of the
job that uses it (**Settings → Environments → *name***), never on the other
store's environment. `OVSX_PAT` set only on `marketplace` is empty in the
`openvsx` job, and every Open VSX publish fails with "The OVSX_PAT secret is
not set".

| Name | Kind | Used by | Notes |
| --- | --- | --- | --- |
| `OVSX_PAT` | secret: `openvsx` environment (recommended) or repository | `openvsx` | Open VSX access token (open-vsx.org → Settings → Access Tokens) for a member of namespace `mnemoverse`. **Not** on the `marketplace` environment. |
| `VSCE_PAT` | secret: `marketplace` environment or repository | `marketplace` (fallback), `marketplace-auth-check` | Azure DevOps PAT, organization "All accessible organizations", scope Marketplace → Manage. **Stops working 2026-12-01.** Delete after the Entra switch. |
| `AZURE_CLIENT_ID` | variable: repository or `marketplace` environment | `marketplace`, `marketplace-auth-check` | Client ID of the user-assigned managed identity. Setting it switches the Marketplace job from the PAT to Entra ID. |
| `AZURE_TENANT_ID` | variable | same | Entra tenant (directory) ID of that identity. |

Client and tenant IDs are identifiers, not secrets, so they are variables.

## Owner checklist: Marketplace publishing without a PAT (before 2026-12-01)

The replacement for the PAT is Microsoft Entra ID: a user-assigned managed
identity that trusts this repository's GitHub Actions through a federated
credential and is a member of publisher Mnemoverse. `vsce publish
--azure-credential` then uses the Azure CLI session that `azure/login` opens.
Microsoft documents the Marketplace side for Azure Pipelines; the GitHub
Actions form used here is the one `github/vscode-codeql` publishes with.
Everything on the workflow side is already in place; these steps need account
access. Aim to finish by mid-November.

1. **Azure subscription** in the Mnemoverse Entra tenant. A managed identity is
   an Azure resource, so it needs one. Pay-as-you-go sign-up asks for a card;
   the identity itself has no charge.
2. **User-assigned managed identity** (portal: *Managed Identities → Create*),
   for example:
   ```sh
   az group create -n rg-mnemoverse-release -l westeurope
   az identity create -g rg-mnemoverse-release -n id-mnemoverse-vscode-publish
   ```
   Note its **Client ID** and **Tenant ID**. It needs no Azure role
   assignment. Use a managed identity, not an app registration; a third-party
   report says app registrations are rejected by the Marketplace.
3. **Federated credential** on that identity:
   - issuer `https://token.actions.githubusercontent.com`
   - subject `repo:mnemoverse/mnemoverse-vscode:environment:marketplace`
   - audience `api://AzureADTokenExchange`
   ```sh
   az identity federated-credential create \
     -g rg-mnemoverse-release --identity-name id-mnemoverse-vscode-publish \
     --name github-mnemoverse-vscode-marketplace \
     --issuer https://token.actions.githubusercontent.com \
     --subject repo:mnemoverse/mnemoverse-vscode:environment:marketplace \
     --audiences api://AzureADTokenExchange
   ```
   (Portal: identity → *Federated credentials → Add → GitHub Actions*, entity
   type **Environment**, environment `marketplace`.) The subject must match
   exactly; renaming the environment breaks sign-in.
4. **GitHub environment `marketplace`** (*Settings → Environments*). The workflow
   creates it on first use if missing, but set it up now:
   - *Deployment branches and tags → Selected*: add tag pattern `v*`, and
     `main`. `main` is needed for runs started with **Run workflow** from main:
     a fresh `publish` run for an existing tag, and `marketplace-auth-check`
     (or start those from a tag).
   - Optional: *Required reviewers* = the release owner. Every Marketplace
     publish then waits for one approval click.
5. **Repository variables** `AZURE_CLIENT_ID` and `AZURE_TENANT_ID` (step 2
   values). From now on the Marketplace job uses Entra ID and ignores
   `VSCE_PAT`.
6. **Get the identity's Marketplace profile id.** Run **Actions →
   marketplace-auth-check → Run workflow**. Its summary prints the profile id
   (read via `az rest .../_apis/profile/profiles/me` while signed in as the
   identity). This is the id the publisher needs, not the client ID. The
   verify step fails on this first run; that is expected.
7. **Add the identity to the publisher**: https://marketplace.visualstudio.com/manage
   → publisher **Mnemoverse** → *Members* → *Add* → paste the profile id →
   role **Contributor**.
8. **Re-run `marketplace-auth-check`.** It should pass. Note that
   `vsce verify-pat` accepts any role, including Reader, so it proves sign-in
   and membership but not publish rights.
9. **Prove a real publish** with the next pre-release (for example
   `v0.3.0-pre`). In the `marketplace` job log, the "Publish (Entra ID)" step
   should run and end with `Published Mnemoverse.mnemoverse-vscode v0.3.0`.
   If it fails, delete the two variables to fall back to `VSCE_PAT` while it
   still works, fix, and re-run the failed job.
10. **Remove the PAT**: delete the `VSCE_PAT` secret, and revoke the token in
    Azure DevOps (*User settings → Personal access tokens → Revoke*).

### Watch: trusted publishing (`vsce publish --oidc`)

`@vscode/vsce` 4.0.0, which this repo uses, contains a hidden `--oidc` option
for GitHub trusted publishing. With it, the Marketplace job would need only
`id-token: write`: no Azure subscription, identity or profile id. As of
2026-09-23 the Marketplace side is not live (its token-exchange endpoint
returns 404, and Microsoft said on 2026-09-14 that it is not complete). Do not
wait for it past about 2026-11-01. If it ships first, the switch is: register
the repository as a trusted publisher on the Marketplace, then in
`publish.yml` replace the `azure/login` step and `--azure-credential` with
`--oidc`.

`ovsx` 1.2 also has a `--trusted-publishing` option for Open VSX. Whether
open-vsx.org accepts it for the `mnemoverse` namespace has not been checked;
`OVSX_PAT` stays in use.

## Repository settings that make the gates real

The workflow refuses tags that are not on main, but a tag push runs the
workflow file from the tagged commit, so a branch could edit the check away.
These settings (owner, *Settings → Rules* and *Environments*) close that:

- **Tag ruleset** for `refs/tags/v*`: restrict creation, update and deletion to
  admins.
- **Branch ruleset** for `main`: require a pull request and the
  `Build, test, package` status check; block force pushes.
- **`marketplace` environment** as in step 4.
- **`openvsx` environment**, set up the same way: *Deployment branches and
  tags → Selected* with tag pattern `v*` and `main`, and optionally *Required
  reviewers*. Add `OVSX_PAT` there as an environment secret, then delete the
  repository secret. Until then `OVSX_PAT` is a repository secret: a run of
  any workflow file from any branch can read it, and no approval or tag policy
  stands in front of Open VSX, the larger store. The `openvsx` job already
  names this environment; GitHub creates it on the first run if it is missing,
  and a repository-level `OVSX_PAT` keeps working meanwhile.
- **Dependabot security updates** on (*Settings → Code security*).
  `.github/dependabot.yml` covers version updates.
