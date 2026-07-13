# IMDb Rapid Rater

IMDb Rapid Rater is a browser-first keyboard rating website. It loads a shuffled queue of real IMDb movie IDs, shows three titles at a time, lets you rate with the number row, and writes ratings back to the IMDb account connected in that browser.

This project uses an unsupported IMDb website endpoint for write-back. IMDb does not provide a public user-rating write API or CSV import. The write path can break, can be rate limited, and may violate IMDb terms. Use it only for your own account and titles you actually want to rate.

## What It Does

- Shows three large movie cards at a time.
- Loads real movie IDs from IMDb's non-commercial datasets.
- Enriches visible cards with poster and synopsis metadata from TMDB when configured.
- Imports your IMDb ratings CSV so already-rated titles are removed from the queue.
- Saves that ratings CSV in the current browser and auto-loads it on future visits.
- Generates AI movie recommendations from a minimized ratings profile.
- Saves IMDb connection data, API keys, ratings, queue progress, and imports in browser storage so visitors never share personal state.
- Writes ratings `1` through `10` back to IMDb when live mode is configured.
- Updates the saved ratings CSV after successful live IMDb writes.
- Maps the `0` key to an IMDb `10/10` rating.
- Exports local progress as CSV or JSON, including live-submit status.

## Requirements

- Node.js 20 or newer.
- A signed-in IMDb account for required live write-back.
- PowerShell examples below assume Windows.

## Automated Deployment

Pushes to `main` run `.github/workflows/deploy-octopus.yml` on the self-hosted GitHub runner. The workflow validates the Node application, generates `data/movies.json`, packages the application, pushes it to the Octopus built-in feed, and deploys the `IMDBRapidRating` project to Production.

The Octopus project deploys to `C:\inetpub\wwwroot\IMDBRapidRating` and runs the Node server through the `IMDB Rapid Rating Server` startup task on port `5199`. Personal settings and ratings are not stored in that deployment.

One-time setup:

```powershell
.\scripts\setup-octopus-project.ps1 -ApiKey "<Octopus API key>"
```

The GitHub repository must provide the same `OCTOPUS_SERVER_URL` and `OCTOPUS_API_KEY` Actions secrets used by the other Octopus-deployed repositories.

## Run

```powershell
cd path\to\MovieRatingProject
npm run build:data
npm start
```

Open the printed URL:

```text
http://localhost:5199
```

Port `5199` is the default.

## Browser-Local User Data

All account-specific data is stored in `localStorage` for the current site and browser profile: the IMDb connection, TMDB and OpenAI keys, imported ratings CSV, ratings, history, and queue order. Two people visiting the same deployed URL from different browsers or browser profiles do not see or modify each other's data.

Clearing site data removes that browser's saved state. Use the CSV or JSON export buttons first if you need a backup.

## Keyboard

- `1` through `9`: rate the active title and submit to IMDb when live mode is ready.
- `0`: rate the active title `10/10`.
- `` ` ``: mark the title as not seen without submitting an IMDb rating.
- `Backspace` or `Delete`: undo the last action.

## Import Existing IMDb Ratings

1. Sign into IMDb in your browser.
2. Open [IMDb exports](https://www.imdb.com/exports).
3. Download your ratings CSV.
4. In Rapid Rater, click **Import IMDb CSV**.
5. Select the exported CSV.

The app reads the `Const` column, stores those IDs as `imported`, and removes them from the active queue so you do not rate duplicates.

An IMDb CSV contains ratings only. It does not include titles you marked **not seen** in Rapid Rater. Use the JSON save export described below to transfer those records.

The imported CSV is saved in that browser's site storage. On future visits from the same browser profile, Rapid Rater auto-loads it before rating. Successful IMDb writes update the browser-local copy so duplicate filtering stays current.

Uploading a fresh IMDb CSV resyncs CSV-owned entries. Rapid Rater removes old `imported` records that are no longer in the new CSV, adds or refreshes records that are in the new CSV, and preserves ratings created in the app.

Rating actions update the browser-local ratings data after IMDb confirms the write. Failed writes do not count as successfully submitted.

If a rating was already submitted to IMDb, `Backspace` or `Delete` removes or restores the IMDb rating before restoring the card locally. If IMDb rejects the undo, local state is left unchanged so the browser does not drift out of sync.

IMDb does not provide a public CSV upload/import API. If you rate movies directly on IMDb outside this app, export your IMDb ratings CSV again and import the fresh file here.

## Back Up Or Move A Browser Save

Use **Export JSON** to download `imdb-rapid-rater-save.json`. This backup contains ratings, imported exclusions, not-seen records, recent undo history, and queue order. It intentionally excludes the IMDb connection and API keys.

On another instance or browser, choose **Import save / title JSON** and select that file. Older `imdb-rapid-rater-export.json` files containing an array of rating records are also accepted; their ratings and not-seen records are merged into the current browser save.

## Enable IMDb Write-Back

Rapid Rater blocks the rating interface until IMDb is connected. IMDb does not provide a third-party OAuth or public rating-write API, and browsers do not let one website read another website's signed-in session. The website therefore asks for the signed-in IMDb request-header value and stores it only in that browser's `localStorage`. It is sent to this app's stateless rating proxy only when submitting or undoing a rating; the server does not save it.

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

## Enable Posters And Synopsis

IMDb page metadata is inconsistent for this use case. For reliable posters and synopsis text, click **Set TMDB Key** in the app header and paste a TMDB API key. It is saved only in the current browser. Get a v3 API key or read access token from [TMDB API Getting Started](https://developer.themoviedb.org/reference/getting-started).

Rapid Rater looks up each title by its IMDb ID through TMDB. If you add the key after already opening the app, visible metadata is refreshed automatically.

## Retry Failed IMDb Writes

The header shows **Retry IMDb failures** when ratings failed before IMDb accepted them. That retry does not include local CSV-sync failures where IMDb already saved the rating.

## AI Recommendations

Open the **AI Recommendations** tab to generate movie picks from your saved IMDb ratings CSV. This feature sends only these fields to OpenAI:

- Movie title
- Release year
- Genres
- Your rating

No IMDb cookie, TMDB key, `tt` IDs, submit history, or raw CSV file is sent.

Click **Set OpenAI Key** in the tab and paste an API key. Rapid Rater saves it only in the current browser. The browser builds a minimized preference profile and sends it with the request to the OpenAI proxy. Returned recommendations include title, year, genres, and a structured explanation of why each pick fits.

Recommendations are matched back to `data/movies.json` by title and year. When a match is found, the card includes rating buttons; rating one writes through the same IMDb proxy and local CSV sync path, then removes that recommendation from the screen.

By default, Rapid Rater calls OpenAI's Models API, filters available GPT text models, sorts them newest first, and selects two places behind the newest eligible model.

Use the model dropdown in the AI Recommendations tab to choose a specific model. Choosing **Auto** returns to lag-based selection. The choice is browser-local.

## Generate Movie Data

Rapid Rater does not include dummy movie data. Generate the real local movie queue before first run:

```powershell
npm run build:data
```

The generated `data/movies.json` file is ignored because it is derived from IMDb datasets.

The script downloads these files into `cache/`:

- `title.basics.tsv.gz`
- `title.ratings.tsv.gz`

Default output:

- Feature films only.
- Non-adult titles only.
- At least 2,500 IMDb votes.
- No artificial title cap.

Custom generation:

```powershell
node scripts/build-movie-pool.mjs --minVotes=500 --minYear=1950
```

Use `--limit=25000` only if you intentionally want a smaller local movie pool.

Refresh cached IMDb TSV files:

```powershell
node scripts/build-movie-pool.mjs --refresh
```

## File Structure

```text
index.html                 App shell
src/styles.css             UI styling
src/app.js                 Browser entrypoint
src/app/rapid-rater-app.js Browser app coordinator
src/app/elements.js        DOM element lookup
src/app/state.js           Initial app state builders
src/app/movies.js          Movie data normalization
src/app/rendering.js       Card and failure rendering
src/app/browser-settings.js Browser-local settings storage
src/app/settings-workflows.js Browser-local settings workflows
src/app/rating-records.js  Rating, retry, CSV helpers
src/app/stats.js           Rating counters and summaries
src/app/util.js            Shared browser utilities
server/                    Stateless API and IMDb proxy modules
shared/                    Browser/server shared helpers
scripts/server.mjs         Local server entrypoint
scripts/build-movie-pool.mjs  IMDb dataset builder
data/movies.json           Generated local queue, ignored
cache/                     Downloaded IMDb TSV cache, ignored
```

## Public Repo Notes

Do not commit:

- `.env.local`
- `cache/`
- `data/movies.json`
- Exported rating CSV/JSON files

These are covered by `.gitignore`.

## Attribution

Information courtesy of IMDb (https://www.imdb.com). Used with permission.

This product uses the TMDB API but is not endorsed or certified by TMDB.
