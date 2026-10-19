# Deployment

[← Back to the README](../README.md)

The production output is the static `dist/` directory. GitHub Pages deployment is
prepared for **https://piano.pollos.us/**: the Pages workflow validates and deploys
pushes to `main`, and Cloudflare supplies the subdomain’s DNS record. See
[the GitHub Pages setup](github-pages.md) for the one-time repository settings,
exact DNS record, HTTPS and verification steps. **Deployment is pending**; these
changes do not enable Pages or update DNS on their own.

The build reads the two Supabase values from the repository's GitHub Actions
variables; see [Supabase setup](accounts.md#supabase-setup).

The separate checks workflow still uploads `dist/` and `.openai/hosting.json` as a
`cadence-static` artifact. That manifest remains available for ChatGPT Sites;
the earlier Sites registration attempt returned `Project owner is not linked to
an account`, with no deployed URL.

## Verification

See [the verification record](verification.md) for checks run, limitations, and
the local hardware acceptance procedure.

Local Chrome verification confirmed automatic connection to the available USB MIDI
input after refresh, fullscreen autoplay, score seeking and the bear-paw guide.
This does not establish end-to-end physical-key timing or published-origin MIDI
compatibility. See the verification document for that distinction.
