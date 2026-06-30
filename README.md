# IMDb Rapid Rater

IMDb Rapid Rater is a local keyboard-first movie rating tool. It loads a shuffled queue of real IMDb movie IDs, shows six titles at a time, lets you rate with the number row, and can write ratings back to your IMDb account through a local proxy that uses your own signed-in IMDb cookie.

This project uses an unsupported IMDb website endpoint for write-back. IMDb does not provide a public user-rating write API or CSV import. The write path can break, can be rate limited, and may violate IMDb terms. Use it only for your own account and titles you actually want to rate.

## What It Does

- Shows six movie cards at a time.
- Loads real movie IDs from IMDb's non-commercial datasets.
- Enriches visible cards with poster and synopsis metadata.
- Imports your IMDb ratings CSV so already-rated titles are removed from the queue.
- Saves that ratings CSV locally and auto-loads it on future launches.
- Saves local progress in browser storage.
- Writes ratings `1` through `9` back to IMDb when live mode is configured.
- Updates the saved ratings CSV after successful live IMDb writes.
- Keeps `0` ratings local-only because IMDb ratings are `1` through `10`.
- Exports local progress as CSV or JSON, including live-submit status.

## Requirements

- Node.js 20 or newer.
- A signed-in IMDb account if you want live write-back.
- PowerShell examples below assume Windows.

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

## Keyboard

- `1` through `9`: rate the active title and submit to IMDb when live mode is ready.
- `0`: record a local zero rating only.
- `` ` ``: mark the title as not seen.
- `Backspace` or `Delete`: undo the last local action.

## Import Existing IMDb Ratings

1. Go to IMDb in your browser.
2. Open your profile ratings page.
3. Use IMDb's ratings export option to download the CSV.
4. In Rapid Rater, click **Import IMDb CSV**.
5. Select the exported CSV.

The app reads the `Const` column, stores those IDs as `imported`, and removes them from the active queue so you do not rate duplicates.

The imported CSV is also saved locally as `data/imdb-ratings.csv`. On future launches, Rapid Rater auto-loads that file before you start rating. When a live IMDb write succeeds from the app, that same CSV is updated so the local duplicate filter stays current with this app's IMDb writes.

IMDb does not provide a public CSV upload/import API. If you rate movies directly on IMDb outside this app, export your IMDb ratings CSV again and import the fresh file here.

## Enable IMDb Write-Back

If `IMDB_COOKIE` is missing, Rapid Rater opens an in-app setup prompt. Paste the full IMDb `Cookie:` request-header value there and click **Save Cookie**. The local server writes it to `.env.local` for you.

You can also create `.env.local` manually from the example:

```powershell
Copy-Item .env.local.example .env.local
```

Put one value in `IMDB_COOKIE`:

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

After saving `.env.local`, restart the app:

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

Or set this in `.env.local`:

```env
IMDB_DRY_RUN=true
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
- Up to 12,000 titles.

Custom generation:

```powershell
node scripts/build-movie-pool.mjs --limit=25000 --minVotes=500 --minYear=1950
```

Refresh cached IMDb TSV files:

```powershell
node scripts/build-movie-pool.mjs --refresh
```

## File Structure

```text
index.html                 App shell
src/styles.css             UI styling
src/app.js                 Browser entrypoint
src/app/                   Browser app modules
server/                    Local API and IMDb proxy modules
shared/                    Browser/server shared helpers
scripts/server.mjs         Local server entrypoint
scripts/build-movie-pool.mjs  IMDb dataset builder
data/imdb-ratings.csv      Personal saved ratings CSV, ignored
data/movies.json           Generated local queue, ignored
cache/                     Downloaded TSV and metadata cache, ignored
```

## Public Repo Notes

Do not commit:

- `.env.local`
- `cache/`
- `data/imdb-ratings.csv`
- `data/movies.json`
- Exported rating CSV/JSON files

These are covered by `.gitignore`.

## Attribution

Information courtesy of IMDb (https://www.imdb.com). Used with permission.
