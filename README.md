# IMDb Rapid Rater

IMDb Rapid Rater is an account-backed keyboard and touch rating website with distinct Movies and TV Shows sections. Each section has its own shuffled IMDb title queue, ratings history, progress, exclusions, and watchlist; both write ratings back to the connected IMDb account.

Visitors can create their own account from the landing page. Public registration is enabled by default and can be stopped immediately by setting `PUBLIC_REGISTRATION_ENABLED=false`; existing users can still sign in.

This project uses an unsupported IMDb website endpoint for write-back. IMDb does not provide a public user-rating write API or CSV import. The write path can break, can be rate limited, and may violate IMDb terms. Use it only for your own account and titles you actually want to rate.

## What It Does

- Switches the entire product between Movies and TV Shows, with separate URLs, queues, stats, histories, and watchlists.
- Shows three large title cards at a time on desktop or one on mobile.
- Loads real feature-film, TV-series, and TV-miniseries IDs from IMDb's non-commercial datasets. Episodes are intentionally excluded.
- Filters each rating queue by release/premiere year, production country, original language, and an optional Bollywood approximation without marking hidden titles as seen.
- Presents series-native facts in TV mode, including run years, status, seasons, episodes, and episode runtime when TMDB metadata is available.
- Enriches visible cards with poster, synopsis, cast, trailer, title details, and country-specific streaming availability from TMDB when configured.
- Caches normalized metadata, complete fetched TMDB detail payloads, and streaming-provider results in PostgreSQL so repeat views are served locally.
- Imports your IMDb ratings CSV so already-rated titles are removed from the queue.
- Saves that ratings CSV in your account and auto-loads it on future visits.
- Generates movie or whole-series AI recommendations from the active section's minimized ratings profile.
- Saves separate movie and TV “Don’t recommend again” lists and excludes those titles from future picks in the matching section.
- Synchronizes ratings, queue progress, imports, and preferences through PostgreSQL.
- Reconciles IMDb ratings with a Letterboxd export and builds a non-destructive union sync plan.
- Encrypts IMDb connection data and API keys with AES-256-GCM before storing them.
- Writes ratings `1` through `10` back to IMDb when live mode is configured.
- Updates the saved ratings CSV after successful live IMDb writes.
- Maps the `0` key to an IMDb `10/10` rating.
- Exports local progress as CSV or JSON, including live-submit status.

## Requirements

- Node.js 20 or newer.
- PostgreSQL 13 or newer.
- A signed-in IMDb account for required live write-back.
- PowerShell examples below assume Windows.

## Automated Deployment

Pushes to `main` run `.github/workflows/deploy-octopus.yml` on the self-hosted GitHub runner. The workflow validates the Node application, generates `data/movies.json` and `data/shows.json`, packages the application, pushes it to the Octopus built-in feed, and deploys the `IMDBRapidRating` project to Production.

The Octopus project deploys to `C:\inetpub\wwwroot\IMDBRapidRating` and runs the Node server through the `IMDB Rapid Rating Server` startup task on port `5012`. Account data is stored in PostgreSQL, not in the deployment directory.

One-time setup:

```powershell
.\scripts\setup-octopus-project.ps1 `
  -OctopusUrl "https://octopus.example.com" `
  -ApiKey "<Octopus API key>"
```

The GitHub repository must provide the same `OCTOPUS_SERVER_URL` and `OCTOPUS_API_KEY` Actions secrets used by the other Octopus-deployed repositories. Add a `TMDB_BUILD_API_KEY` Actions secret to enrich the generated catalogs with production-country and original-language metadata. The PostgreSQL connection string is not stored in GitHub: the internal self-hosted runner must inherit `POSTGRES_CONNECTION_STRING`, or inherit `IMDB_RAPID_RATER_HOME` pointing to an ACL-protected directory containing `settings.env`. The runner must have internal network access to PostgreSQL. Deployment fails before packaging when enrichment cannot use the database or produces no usable origin metadata.

Configure these Octopus project variables before the first account-backed deployment. Mark the first three as sensitive:

- `RapidRater.PostgresConnectionString`
- `RapidRater.SessionSecret`
- `RapidRater.DataEncryptionKey`
- `RapidRater.AppOrigin`
- `RapidRater.AllowedOrigins` (optional comma-separated origins)

Use a dedicated PostgreSQL database/user with access only to the `imdb_rapid_rater` schema. The deployment writes the runtime values to an ACL-restricted file, installs production dependencies, and applies migrations before starting the scheduled task.

For build-time origin enrichment, configure the self-hosted GitHub Actions runner service locally with either `POSTGRES_CONNECTION_STRING` or `IMDB_RAPID_RATER_HOME`. Restart the runner service after changing its environment. Keeping the settings directory outside the checked-out repository prevents checkout cleanup from deleting it and keeps the internal database credential out of GitHub.

`RapidRater.AppOrigin` is the primary browser origin. Same-origin requests are accepted from the host serving the current request, while additional trusted browser origins can be supplied through `RapidRater.AllowedOrigins`; the deployment writes them to the `APP_ALLOWED_ORIGINS` runtime setting. The repository contains no deployment-specific hostnames or addresses.

An existing IIS reverse-proxy site can be integrated by configuring these optional Octopus project variables:

- `RapidRater.ProxySiteName`
- `RapidRater.ProxyHostName`
- `RapidRater.ProxyDirectory`
- `RapidRater.ProxyUpstreamHost` (defaults to `127.0.0.1`)
- `RapidRater.ProxyHealthAddress` (defaults to `127.0.0.1`)

The first three proxy variables enable the integration. During deployment, the configured IIS directory serves a branded maintenance page while the Node process is stopped and updated. The application's local health check on port 5012 remains the deployment gate. The IIS proxy is checked separately on a best-effort basis, so an unhealthy or unavailable proxy produces a warning without rolling back a healthy application.

The Octopus pre- and post-deployment scripts are stored inline in the deployment process. The GitHub Actions workflow refreshes the process from `scripts/setup-octopus-project.ps1` before creating each release, so deployment-script changes take effect with the next push to `main`.

## Run

Copy `settings.env.example` to `.runtime/settings.env`, provide a dedicated PostgreSQL account, and generate secrets:

```powershell
npm run key:generate
npm run db:migrate
# Optional: administrators can still create an account from the command line.
npm run user:create -- you@example.com
```

```powershell
cd path\to\MovieRatingProject
npm run build:data
npm run build
npm start
```

Open the printed URL:

```text
http://localhost:5012
```

Port `5012` is the default.

## Account Data And Synchronization

Ratings, imported CSV data, recent history, queue order, AI exclusions, and preferences are stored per account in PostgreSQL. Movie and TV state is namespaced so actions in one section never alter the other. The browser stores only an `HttpOnly` session cookie. Signing into the same account on another computer loads the synchronized save.

Each Movies and TV Shows queue is independently server-authoritative. Every rating, not-seen/not-watched choice, watchlist action, and undo includes the expected queue revision and advances only the current section's server-side head. Stale devices reload the canonical queue instead of merging or reshuffling it. Open devices receive media-scoped queue revision events, with focus refresh and polling as fallbacks.

Filters are also independent for Movies and TV Shows. Open **Filters** beside the progress counters to choose a year range or exclude production countries and original languages. **Hide Bollywood** is intentionally labeled as an approximation: it hides Indian productions whose TMDB original language is Hindi. Filtered titles stay untouched and return to the queue when the filter is removed. Titles with no origin metadata remain included by default.

Movie- and TV-pool builds each include a SHA-256 identity. When either pool changes, its remaining order is preserved, unavailable titles are removed, and newly eligible titles are appended deterministically instead of resetting the active choices.

Older browser-local saves are detected after the first sign-in and can be moved into the account once. Successful migration removes the old sensitive browser data.

## Keyboard

- `1` through `9`: rate the active title and submit to IMDb when live mode is ready.
- `0`: rate the active title `10/10`.
- `` ` ``: mark the title as not seen (Movies) or not watched (TV Shows) without submitting an IMDb rating.
- `Backspace` or `Delete`: go back to the previous title in the active section.

## Import Existing IMDb Ratings

1. Sign into IMDb in your browser.
2. Open [IMDb exports](https://www.imdb.com/exports).
3. Download your ratings CSV.
4. In Rapid Rater, click **Import IMDb CSV**.
5. Select the exported CSV.

The app reads `Const` and `Title Type`, then routes movie ratings into Movies and whole-series/miniseries ratings into TV Shows. Episodes are not imported. Imported titles are removed only from the matching queue so you do not rate duplicates.

An IMDb CSV contains ratings only. It does not include titles you marked **not seen** in Rapid Rater. Use the JSON save export described below to transfer those records.

The imported CSV is saved in your account. On future visits from any signed-in computer, Rapid Rater auto-loads it before rating.

Uploading a fresh IMDb CSV resyncs CSV-owned entries. Rapid Rater removes old `imported` records that are no longer in the new CSV, adds or refreshes records that are in the new CSV, and preserves ratings created in the app.

Rating decisions and queue progress are committed together before the IMDb write runs in the background. IMDb success or failure then updates the same synchronized rating record; failed writes do not count as successfully submitted.

If a rating was already submitted to IMDb, `Backspace` or `Delete` removes or restores the IMDb rating before restoring the card locally. If IMDb rejects the reversal, local state is left unchanged so the browser does not drift out of sync.

IMDb does not provide a public CSV upload/import API. If you rate movies directly on IMDb outside this app, export your IMDb ratings CSV again and import the fresh file here.

## Sync IMDb And Letterboxd

Open **Sync Movies** to use the signed-in account's PostgreSQL movie state as the hub between IMDb and Letterboxd. This workflow remains deliberately movie-only and is not shown in TV Shows mode because Letterboxd does not provide an equivalent whole-series sync model.

1. Import the latest IMDb ratings CSV.
2. Import the ZIP downloaded from Letterboxd's data export page. Individual `ratings.csv`, `watched.csv`, `diary.csv`, and `watchlist.csv` files are also accepted.
3. Review matched ratings, missing titles, conflicts, watched-only films, and titles that need an IMDb match.
4. Choose **Send missing ratings to IMDb** to queue Letterboxd-only ratings through the existing IMDb connection.
5. Under **IMDb → Letterboxd**, choose **Download file to upload to Letterboxd**, then upload the generated CSV on Letterboxd. Large collections download as `letterboxd-import-files-unzip-me.zip`; unzip it and upload each CSV inside separately to stay below Letterboxd's 1 MB limit.

Sync mode never deletes from either service and never invents a rating for a watched-only film. Letterboxd's public importer requires the member to review and confirm the generated file; the app does not store a Letterboxd password or session cookie.

## Back Up Or Restore A Save

Use **Back Up Progress** to download `imdb-rapid-rater-save.json`. This backup contains ratings, imported exclusions, not-seen records, AI do-not-recommend choices, recent action history, and queue order. It intentionally excludes the IMDb connection and API keys.

Choose **Restore Progress** and select that file to restore it into the signed-in account. Older `imdb-rapid-rater-export.json` files are also accepted.

## Enable IMDb Write-Back

Rapid Rater blocks the rating interface until IMDb is connected. IMDb does not provide a third-party OAuth or public rating-write API, so the website asks for the signed-in IMDb request-header value. It is encrypted in PostgreSQL and decrypted only on the server immediately before submitting or reversing a rating. It is never returned to the browser after saving.

Do not paste this value into chat, issues, commits, logs, screenshots, or pull requests. Treat it like a temporary password.

### Manual Cookie Copy From Chrome

1. Sign into [IMDb](https://www.imdb.com/).
2. Open Chrome DevTools.
3. Select the **Network** tab.
4. Refresh the IMDb page.
5. Click the main `www.imdb.com` document request.
6. Open **Headers**.
7. In **Request Headers**, find `Cookie:`.
8. Copy the full value after `Cookie:` and paste it into the required **Connect IMDb** prompt.

The prompt closes only after a signed-in value is saved. No server restart is required.

## Dry Run

Use dry run to test the app and local proxy without sending ratings to IMDb:

```powershell
$env:IMDB_DRY_RUN = "true"
npm start
```

Or set this in the server's local settings file:

```env
IMDB_DRY_RUN=true
```

## Enable TMDB Metadata And Streaming Availability

IMDb page metadata is inconsistent for this use case. For reliable posters, synopsis text, cast, trailers, series details, and streaming availability, click **Set TMDB Key** in the app header and paste a TMDB API key. It is encrypted in your account. Get a v3 API key or read access token from [TMDB API Getting Started](https://developer.themoviedb.org/reference/getting-started).

The deployment build preloads stable TMDB title metadata for the generated movie and TV catalogs. It saves the normalized fields used by the app plus the complete details response in PostgreSQL. At runtime, only visible titles that are missing or stale are requested. Movie metadata is refreshed after 30 days; an active TV series is refreshed after 7 days so season and episode counts can change. Ended-series metadata uses the 30-day interval.

After the TMDB title ID is known, Rapid Rater loads the configured country's watch-provider results (currently `US`). Streaming results are stored by country for 12 hours. Fresh results are served directly from PostgreSQL; stale results are shown immediately and refreshed in the background. Provider logos and categories appear below the synopsis on the active poster card. TMDB provides a regional viewing-options page, not direct Netflix/Hulu deep links.

If you add the key after already opening the app, visible metadata is refreshed automatically. The next time another user sees the same title, the shared PostgreSQL cache is reused instead of repeating the TMDB requests.

## Retry Failed IMDb Writes

The header shows **Retry IMDb failures** when ratings failed before IMDb accepted them. That retry does not include local CSV-sync failures where IMDb already saved the rating.

## AI Recommendations

Open **Movie Watchlist** or **TV Watchlist** to generate picks from the active section's saved ratings. TV requests explicitly ask for whole series or miniseries, never individual episodes. This feature sends only these fields to OpenAI:

- Movie or series title
- Release year
- Genres
- Your rating
- Titles and years you marked **Don't recommend again**
- The active year range and origin exclusions

No IMDb cookie, TMDB key, `tt` IDs, submit history, or raw CSV file is sent.

Click **Set OpenAI Key** in the tab and paste an API key. Rapid Rater encrypts it in your account. The browser builds a minimized preference profile and sends it to the authenticated server endpoint. Returned recommendations include title, year, genres, and a structured explanation of why each pick fits.

Recommendations are matched against the active section's catalog (`data/movies.json` or `data/shows.json`) by title and year. When a match is found, the card includes rating buttons; rating one writes through the same IMDb proxy and account sync path. **Don't recommend again** saves that title and year only in the active section.

By default, Rapid Rater calls OpenAI's Models API, filters available GPT text models, sorts them newest first, and selects two places behind the newest eligible model.

Use the model dropdown in the AI Recommendations tab to choose a specific model. Choosing **Auto** returns to lag-based selection. The choice follows your account.

## Generate Movie And TV Data

Rapid Rater does not include dummy title data. Generate both real local queues before first run:

```powershell
npm run build:data
```

The generated `data/movies.json` and `data/shows.json` files are ignored because they are derived from IMDb datasets.

IMDb's public datasets provide title type, year, genre, and rating data, but not production country or original language. To enable the origin filters, enrich both generated catalogs through TMDB after `build:data`:

```powershell
$env:TMDB_BUILD_API_KEY = "<TMDB v3 API key or read access token>"
npm run build:origins
```

The enrichment is resumable. Matched titles are complete when `metadata_checked_at` is populated; previously cached origin-only rows are automatically backfilled, and their known TMDB IDs avoid another IMDb-to-TMDB find request. Newly matched titles save the details response already needed for origin data instead of discarding it. Titles TMDB could not match are also checkpointed so later builds do not repeat them. The ignored `cache/tmdb-title-origins.json` file remains a lightweight local origin checkpoint and is imported when PostgreSQL lacks the record. `TMDB_ORIGIN_CONCURRENCY` can be set from `1` to `24` and defaults to `12`. This build never requests streaming availability for the entire catalog; runtime loads providers only for visible cards.

The script downloads these files into `cache/`:

- `title.basics.tsv.gz`
- `title.ratings.tsv.gz`

Default output:

- One feature-film catalog and one whole-series/miniseries catalog.
- No TV episodes, shorts, videos, or individual seasons.
- Non-adult titles only.
- At least 2,500 IMDb votes for older titles.
- At least 100 IMDb votes for titles dated in the current or previous calendar year.
- No artificial title cap.

Custom generation:

```powershell
node scripts/build-movie-pool.mjs --minVotes=500 --recentMinVotes=50 --recentYears=1 --minYear=1950
```

Use `--limit=25000` only if you intentionally want smaller local movie and TV pools.

Refresh cached IMDb TSV files:

```powershell
node scripts/build-movie-pool.mjs --refresh
```

## File Structure

```text
index.html                 App shell and browser-route markup
vite.config.js             Production frontend build
tsconfig.json              Frontend type-checking foundation
src/styles.css             Ordered stylesheet entrypoint
src/styles/                Foundation, workspace, rater, dialog, and responsive styles
src/app.js                 Browser entrypoint
src/app/rapid-rater-app.js Browser lifecycle and cross-feature coordinator
src/app/features/          Account sync, rendering, rating, recommendation, and transfer features
src/app/feature-methods.js Collision-safe feature composition
src/app/elements.js        DOM element lookup
src/app/state.js           Initial app state builders
src/app/movies.js          Movie and TV title data normalization
src/app/rendering.js       Card and failure rendering
src/app/browser-settings.js One-time legacy browser migration
src/app/settings-workflows.js Browser-local settings workflows
src/app/rating-records.js  Rating, retry, CSV helpers
src/app/stats.js           Rating counters and summaries
src/app/util.js            Shared browser utilities
server/                    Authenticated API, database, and IMDb proxy modules
server/rater-queue-store.mjs Authoritative queue transactions and conflict checks
server/rater-events.mjs    Cross-device queue revision event stream
server/title-metadata-store.mjs PostgreSQL title metadata, origin, and streaming cache
server/streaming-availability.mjs TMDB watch-provider service and 12-hour cache policy
db/migrations/             Versioned PostgreSQL schema migrations
shared/                    Browser/server shared helpers
scripts/server.mjs         Local server entrypoint
scripts/build-movie-pool.mjs  IMDb dataset builder
scripts/enrich-title-origins.mjs Resumable build-time TMDB title metadata and origin enrichment
shared/title-filters.js     Shared normalization and filter rules
data/movies.json           Generated movie queue, ignored
data/shows.json            Generated TV-series queue, ignored
cache/                     Downloaded IMDb TSV cache, ignored
```

## Public Repo Notes

Do not commit:

- `.env.local`
- `cache/`
- `data/movies.json`
- `data/shows.json`
- Exported rating CSV/JSON files

These are covered by `.gitignore`.

## Attribution

Information courtesy of IMDb (https://www.imdb.com). Used with permission.

This product uses the TMDB API but is not endorsed or certified by TMDB.

Streaming availability data is provided by JustWatch through TMDB.
