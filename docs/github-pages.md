# GitHub Pages at piano.pollos.us

The deployment target is **https://piano.pollos.us/**, hosted by GitHub Pages
from `chickenPopcorn/pawpal`. Cloudflare manages the DNS for `pollos.us`.
These are prepared deployment changes; the site and DNS have not been published
by this change.

## One-time setup

1. In [the repository’s Pages settings](https://github.com/chickenPopcorn/pawpal/settings/pages),
   set **Build and deployment → Source → GitHub Actions**. The repository is
   currently private, so its account must have a GitHub plan that supports Pages
   for private repositories. The resulting Pages website is public.
2. Set **Custom domain** to **piano.pollos.us** and save it before adding the DNS
   record. With an Actions deployment, GitHub ignores `CNAME` files; the included
   `public/CNAME` records the intended domain but does not configure the service.
3. In Cloudflare, select **pollos.us → DNS → Records → Add record**:

   | Field        | Value                      |
   | ------------ | -------------------------- |
   | Type         | `CNAME`                    |
   | Name         | `piano`                    |
   | Target       | `chickenpopcorn.github.io` |
   | Proxy status | **DNS only** (gray cloud)  |
   | TTL          | Auto                       |

   The target is the GitHub account hostname, without `https://` or `/pawpal/`.
   If a record already exists for `piano`, update that record. No changes to the
   root domain or other subdomains are needed. DNS-only lets GitHub serve HTTPS
   directly without configuring a Cloudflare proxy.

4. Once GitHub’s DNS check and certificate provisioning complete, enable
   **Enforce HTTPS** in Pages settings. Browser MIDI needs HTTPS at this address.

GitHub’s [custom-domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
and Cloudflare’s [subdomain guide](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-subdomain/)
describe these settings.

## Publishing and updates

Once the prepared app and deployment files are reviewed and committed, pushing
them to **main** runs `.github/workflows/pages.yml`. The workflow installs locked
dependencies, regenerates the MIDI downloads, runs the JavaScript and Python
checks, builds `dist/`, validates font URLs and deploys the static artifact. No
personal access token, Cloudflare API key or backend server is required. Later
pushes to `main` update the site automatically.

The workflow can also be started from **Actions → Deploy GitHub Pages → Run
workflow**, selecting **main**. Other branches and pull requests do not deploy.
The workflow’s `github-pages` environment records the deployed URL.

Vite keeps `base: "./"`, and runtime asset links use `import.meta.env.BASE_URL`.
The same build supports the custom domain and the default project URL
`https://chickenpopcorn.github.io/pawpal/` before a custom domain is configured.
Once configured, GitHub redirects the default URL to the custom domain. The app
has no server routes and needs no SPA rewrite rule.

## Verification

Before pushing:

```sh
npm ci
npm run midi:build
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
npm run build
node scripts/check-built-fonts.mjs
npm run preview
```

After deployment, open **https://piano.pollos.us/** in desktop Chrome or Edge and
check that the logo, sheet-music fonts, piano samples and MIDI downloads load.
Try Listen, full screen and the song-navigation controls. Grant MIDI permission
on this new origin and verify the physical piano, including chords and pedal.

Imported songs, settings and progress remain local to each browser origin. Data
saved on `localhost` or `chickenpopcorn.github.io` does not automatically move to
`piano.pollos.us`; export any imported MIDI files you want to bring across.

The sample bank makes the static output roughly **755 MiB** (about 792 MB),
within GitHub Pages’
[1 GB published-site limit](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
Samples load as needed rather than all on page load. Keep the sample credits and
licenses with the site. The public deployment exposes bundled files, including
the built-in music; browser-imported personal songs are not uploaded.
