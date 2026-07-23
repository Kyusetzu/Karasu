# Signing the Windows installer

The rolling prerelease workflow (`.github/workflows/release.yml`) builds an
NSIS installer on every push to `main`. Today that installer is **unsigned**
— only a `SHA256SUMS.txt` checksum is published alongside it, and Windows
SmartScreen may warn on first run.

## Why SignPath Foundation

Three paths were evaluated for automated, GitHub-Actions-compatible signing:

| Option | Cost | Eligibility | Notes |
| --- | --- | --- | --- |
| **SignPath Foundation** | Free (OSS) | Public OSS project, application + approval | Chosen — no cost, once approved it's fully automated |
| Azure Trusted Signing | ~$9.99/mo | Gated to US/Canada orgs or individuals with 3+ years of verifiable history (public preview) | May simply not be available yet, depending on eligibility |
| Purchased OV/EV certificate | ~$70-400/yr | None | No approval wait, but costs money; OV certs don't get instant SmartScreen reputation |

The release workflow is wired for **SignPath Foundation**. The signing step
is conditional on repo variables being set, so nothing breaks in the
meantime — releases stay unsigned+checksummed exactly as before until it's
configured.

## Setup steps

1. **Apply.** Go to <https://signpath.io/solutions/open-source-community>
   and apply for the free OSS program for `Kyusetzu/Karasu`. This is a
   manual application + approval process — there's a wait, not an instant
   signup.
2. **Once approved**, in the SignPath dashboard:
   - Install the **SignPath GitHub App** on the `Kyusetzu/Karasu` repository.
   - Create a **SignPath Project** for Karasu, and within it a **Signing
     Policy** for the NSIS installer (an Artifact Configuration of type
     `<zip-file>`, since the workflow uploads the installer as a zipped
     GitHub Actions artifact before submitting it — the signed exe comes back
     inside that same zip).
   - Configure the predefined **"GitHub.com" Trusted Build System** in your
     SignPath organization and link it to the Karasu project (needed so
     SignPath trusts builds coming from this repo's Actions runs).
   - Note down the **organization id**, **project slug**, and **signing
     policy slug**.
3. **Configure the repo:**
   - Add `SIGNPATH_API_TOKEN` as a repository **secret** (Settings → Secrets
     and variables → Actions → Secrets) — an API token for a SignPath user
     with submitter permissions.
   - Add `SIGNPATH_ORGANIZATION_ID`, `SIGNPATH_PROJECT_SLUG`, and
     `SIGNPATH_SIGNING_POLICY_SLUG` as repository **variables** (same page,
     the "Variables" tab) — these aren't secret values.
4. **Push to `main`.** The next rolling prerelease build submits the
   installer to SignPath, waits for the signed result, and publishes that
   instead. The release notes automatically stop saying "unsigned" once
   `SIGNPATH_ORGANIZATION_ID` is set.

## Alternatives, if the SignPath application doesn't work out

- **Azure Trusted Signing** — check current eligibility at the [Trusted
  Signing individual developer
  docs](https://learn.microsoft.com/en-us/azure/trusted-signing/); if
  eligible, Tauri's `bundle.windows.signCommand` config can invoke the
  `sign` CLI with `AZURE_TENANT_ID`/`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`
  as repo secrets, signing both the `.exe` and the NSIS installer in one
  build step.
- **Purchased certificate** — buy an OV or EV code-signing certificate (e.g.
  from SSL.com or Certum), export it as a base64-encoded PFX, store it as
  `WINDOWS_CERTIFICATE`/`WINDOWS_CERTIFICATE_PASSWORD` secrets, and import it
  in the workflow before the build step (`Import-PfxCertificate`), then set
  `bundle.windows.certificateThumbprint` in `tauri.conf.json`.
