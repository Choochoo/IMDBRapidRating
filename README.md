# IMDb Rapid Rater

IMDb Rapid Rater is a local keyboard-first movie rating tool. It loads a shuffled queue of real IMDb movie IDs, shows six titles at a time, lets you rate with the number row, and can write ratings back to your IMDb account through a local proxy that uses your own signed-in IMDb cookie.

This project uses an unsupported IMDb website endpoint for write-back. IMDb does not provide a public user-rating write API or CSV import. The write path can break, can be rate limited, and may violate IMDb terms. Use it only for your own account and titles you actually want to rate.

## What It Does

- Shows three large movie cards at a time.
- Loads real movie IDs from IMDb's non-commercial datasets.
- Enriches visible cards with poster and synopsis metadata from TMDB when configured.
- Imports your IMDb ratings CSV so already-rated titles are removed from the queue.
- Saves that ratings CSV locally and auto-loads it on future launches.
- Generates AI movie recommendations from a minimized ratings profile.
- Saves local progress in browser storage.
- Writes ratings `1` through `10` back to IMDb when live mode is configured.
- Updates the saved ratings CSV after successful live IMDb writes.
- Maps the `0` key to an IMDb `10/10` rating.
- Exports local progress as CSV or JSON, including live-submit status.

## Requirements

- Node.js 20 or newer.
- A signed-in IMDb account if you want live write-back.
- PowerShell examples below assume Windows.

## Automated Deployment

Pushes to `main` run `.github/workflows/deploy-octopus.yml` on the self-hosted GitHub runner. The workflow validates the Node application, generates `data/movies.json`, packages the application, pushes it to the Octopus built-in feed, and deploys the `IMDBRapidRating` project to Production.

The Octopus project deploys to `C:\inetpub\wwwroot\IMDBRapidRating`, preserves `.env.local`, `data/imdb-ratings.csv`, and `cache/title-metadata.json`, and runs the Node server through the `IMDB Rapid Rating Server` startup task on port `5199`.

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

## Local User Data

Rapid Rater keeps each person's account-specific data on their own computer, outside the project folder:

- Windows: `%APPDATA%\IMDb Rapid Rater`
- macOS: `~/Library/Application Support/IMDb Rapid Rater`
- Linux: `${XDG_DATA_HOME:-~/.local/share}/imdb-rapid-rater`

The folder contains saved settings, the imported IMDb ratings CSV, and the poster/synopsis metadata cache. Browser queue progress is still stored in that person's browser profile with `localStorage`.

On first run after upgrading, existing repo-local `.env.local`, `data/imdb-ratings.csv`, and `cache/title-metadata.json` files are copied into the user-data folder when the new destination file does not already exist.

Set `IMDB_RAPID_RATER_HOME` before `npm start` if you need to override the user-data folder.

## Keyboard

- `1` through `9`: rate the active title and submit to IMDb when live mode is ready.
- `0`: rate the active title `10/10`.
- `` ` ``: mark the title as not seen.
- `Backspace` or `Delete`: undo the last action.

## Import Existing IMDb Ratings

1. Sign into IMDb in your browser.
2. Open [IMDb exports](https://www.imdb.com/exports).
3. Download your ratings CSV.
4. In Rapid Rater, click **Import IMDb CSV**.
5. Select the exported CSV.

The app reads the `Const` column, stores those IDs as `imported`, and removes them from the active queue so you do not rate duplicates.

The imported CSV is also saved locally as `ratings/imdb-ratings.csv` inside your user-data folder. On future launches, Rapid Rater auto-loads that file before you start rating. When a live IMDb write succeeds from the app, that same CSV is updated so the local duplicate filter stays current with this app's IMDb writes.

Uploading a fresh IMDb CSV resyncs CSV-owned entries. Rapid Rater removes old `imported` records that are no longer in the new CSV, adds or refreshes records that are in the new CSV, and preserves local app records such as `rated` and `notSeen`. That keeps IMDb ratings in sync without making you redo movies you already marked not seen.

Rating actions only update the saved user-data CSV after IMDb confirms the rating write. Failed writes and dry-run writes do not update the saved CSV. If IMDb succeeds but the local CSV update fails, the app shows that as a CSV-sync failure instead of retrying the IMDb write again.

Undo behaves the same way. If a rating was already submitted to IMDb, `Backspace` or `Delete` first removes that IMDb rating, then removes the title from the saved user-data CSV, then restores the card locally. If the title had a previous IMDb-synced rating, undo restores that previous rating instead. If IMDb rejects the undo, local state is left unchanged so the app does not drift out of sync.

IMDb does not provide a public CSV upload/import API. If you rate movies directly on IMDb outside this app, export your IMDb ratings CSV again and import the fresh file here.

## Enable IMDb Write-Back

If `IMDB_COOKIE` is missing, Rapid Rater opens an in-app setup prompt. Paste the full IMDb `Cookie:` request-header value there and click **Save Cookie**. The local server writes it to `settings.env` inside your user-data folder.

You can also set `IMDB_COOKIE` in your shell before starting the server:

```env
IMDB_COOKIE=<paste the full Cookie request-header value here>
IMDB_DRY_RUN=false
```

The optional `Cookie:` prefix is accepted:

```env
IMDB_COOKIE=Cookie: <paste the full Cookie request-header value here>
IMDB_DRY_RUN=false
```

Do not split the cookie into multiple environment variables.

Do not paste your cookie into chat, issues, commits, logs, screenshots, or pull requests. Treat it like a temporary password.

### How To Get The Cookie From Chrome

1. Sign into [IMDb](https://www.imdb.com/).
2. Open Chrome DevTools.
3. Select the **Network** tab.
4. Refresh the IMDb page.
5. Click the main `www.imdb.com` document request.
6. Open **Headers**.
7. In **Request Headers**, find `Cookie:`.
8. Copy the full value after `Cookie:` and paste it into `IMDB_COOKIE`.

After changing shell environment variables, restart the app:

```powershell
npm start
```

The header should change from `Live needs cookie` to `Live ready`. If you use the in-app prompt, the app refreshes live status without requiring a restart.

## Dry Run

Use dry run to test the app and local proxy without sending ratings to IMDb:

```powershell
$env:IMDB_DRY_RUN = "true"
npm start
```

Or set this in `settings.env` inside your user-data folder:

```env
IMDB_DRY_RUN=true
```

## Enable Posters And Synopsis

IMDb page metadata is inconsistent for this use case. For reliable posters and synopsis text, click **Set TMDB Key** in the app header and paste a TMDB API key. The local server writes it to `settings.env` inside your user-data folder.

You can also add it manually:

```env
TMDB_API_KEY=<paste your TMDB API key here>
```

Get a v3 API key or read access token from the credentials section on [TMDB API Getting Started](https://developer.themoviedb.org/reference/getting-started), then restart the app:

```powershell
npm start
```

Rapid Rater looks up each title by its IMDb ID through TMDB, then caches the returned poster and overview in `cache/title-metadata.json` inside your user-data folder. If you added the key after already running the app, old cached entries without a synopsis are refreshed automatically.

## Retry Failed IMDb Writes

The header shows **Retry IMDb failures** when ratings failed before IMDb accepted them. That retry does not include local CSV-sync failures where IMDb already saved the rating.

## AI Recommendations

Open the **AI Recommendations** tab to generate movie picks from your saved IMDb ratings CSV. This feature sends only these fields to OpenAI:

- Movie title
- Release year
- Genres
- Your rating

No IMDb cookie, TMDB key, `tt` IDs, submit history, or raw CSV file is sent.

Click **Set OpenAI Key** in the tab and paste an API key. Rapid Rater saves it locally to `settings.env` inside your user-data folder:

```env
OPENAI_API_KEY=<paste your OpenAI API key here>
OPENAI_MODEL=
OPENAI_MODEL_LAG=2
```

The server reads the saved user-data ratings CSV, joins genres from `data/movies.json` when possible, keeps only the four recommendation fields, and sends an optimized profile to the OpenAI Responses API. The returned recommendations include title, year, genres, and a structured explanation of why the pick fits your rated movies.

Recommendations are matched back to `data/movies.json` by title and year. When a match is found, the card includes rating buttons; rating one writes through the same IMDb proxy and local CSV sync path, then removes that recommendation from the screen.

By default, Rapid Rater calls OpenAI's Models API, filters available GPT text models, sorts them newest first, and selects the model at `OPENAI_MODEL_LAG`. The default lag is `2`, which means two places behind the newest eligible model.

Use the model dropdown in the AI Recommendations tab to choose a specific model. Choosing **Auto** clears `OPENAI_MODEL` and returns to lag-based selection. Choosing a model saves it locally:

```env
OPENAI_MODEL=<selected model id>
```

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
src/app/rating-records.js  Rating, retry, CSV helpers
src/app/stats.js           Rating counters and summaries
src/app/util.js            Shared browser utilities
server/                    Local API and IMDb proxy modules
shared/                    Browser/server shared helpers
scripts/server.mjs         Local server entrypoint
scripts/build-movie-pool.mjs  IMDb dataset builder
data/movies.json           Generated local queue, ignored
cache/                     Downloaded IMDb TSV cache, ignored
```

## Public Repo Notes

Do not commit:

- `.env.local`
- `settings.env`
- `cache/`
- `data/imdb-ratings.csv`
- `data/movies.json`
- Exported rating CSV/JSON files

These are covered by `.gitignore`.

## Attribution

Information courtesy of IMDb (https://www.imdb.com). Used with permission.

This product uses the TMDB API but is not endorsed or certified by TMDB.
