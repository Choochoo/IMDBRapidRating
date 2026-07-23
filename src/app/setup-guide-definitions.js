const ExternalActionKind = "external";
const LocalActionKind = "local";
const ImdbHomeUrl = "https://www.imdb.com/";
const ImdbExportsUrl = "https://www.imdb.com/exports/";
const OpenAiKeysUrl = "https://platform.openai.com/api-keys";
const LetterboxdDataUrl = "https://letterboxd.com/settings/data/";
const LetterboxdImportUrl = "https://letterboxd.com/import/";
const AccountEmailRedaction = "Account email";
const AccountIdentifiersRedaction = "Account identifiers";
const AccountNameRedaction = "Account name";
const ApiKeyFieldRedaction = "API key field";
const CookieValueRedaction = "Cookie value";
const ExportIdentifiersRedaction = "Export identifiers";
const MemberNameRedaction = "Member name";
const OpenImdbConnectionLabel = "Open IMDb connection";
const OpenImdbExportsLabel = "Open IMDb exports";
const OpenLetterboxdImportLabel = "Open Letterboxd import";
const OpenSyncMoviesLabel = "Open Sync Movies";
const PersonallyIdentifyingTitlesRedaction = "Personally identifying titles";
const PersonallyIdentifyingWatchHistoryRedaction = "Personally identifying watch history";
const PrivateListNamesRedaction = "Private list names";
const ProfileImageRedaction = "Profile image";
const ProjectNameRedaction = "Project name";
const SignedInEmailRedaction = "Signed-in email";

const SetupGuideFlowIdDefinitions = {
  connectImdb: "connect-imdb",
  connectOpenAi: "connect-openai",
  importImdbRatings: "import-imdb-ratings",
  importLetterboxd: "import-letterboxd",
  rapidRaterToLetterboxd: "rapid-rater-to-letterboxd",
  letterboxdToImdb: "letterboxd-to-imdb"
};

const SetupGuideActionIdDefinitions = {
  openImdbHome: "open-imdb-home",
  openImdbExports: "open-imdb-exports",
  openOpenAiKeys: "open-openai-api-keys",
  openLetterboxdData: "open-letterboxd-data",
  openLetterboxdImport: "open-letterboxd-import",
  openImdbConnection: "open-imdb-connection",
  openAiSettings: "open-ai-settings",
  chooseImdbCsv: "choose-imdb-csv",
  chooseLetterboxdExport: "choose-letterboxd-export",
  openMovieSync: "open-movie-sync",
  downloadLetterboxdFile: "download-letterboxd-file",
  queueLetterboxdToImdb: "queue-letterboxd-to-imdb"
};

export const SetupGuideFlowIds = DeepFreeze(SetupGuideFlowIdDefinitions);
export const SetupGuideActionIds = DeepFreeze(SetupGuideActionIdDefinitions);

const SetupGuideFlowDefinitions = [
  {
    id: SetupGuideFlowIds.connectImdb,
    title: "Connect IMDb",
    summary: "Connect once so ratings made here can also reach IMDb.",
    steps: [
      {
        id: "sign-in-imdb",
        title: "Sign in to IMDb",
        body: "Open IMDb and sign in with the account that should receive your ratings.",
        imageSrc: "/src/assets/setup/connect-imdb/01-sign-in-imdb.webp",
        imageAlt: "IMDb home page with a signed-in account",
        capture: "IMDb home page in desktop Chrome showing a disposable test account signed in.",
        redact: [AccountNameRedaction, "Account avatar", "Personal recommendations"],
        action: { id: SetupGuideActionIds.openImdbHome, label: "Open IMDb", kind: ExternalActionKind, href: ImdbHomeUrl }
      },
      {
        id: "open-network-tools",
        title: "Open Network tools",
        body: "Press F12, choose Network, then refresh IMDb so the request list fills in.",
        imageSrc: "/src/assets/setup/connect-imdb/02-open-network-tools.webp",
        imageAlt: "Chrome DevTools open to the Network tab beside IMDb",
        capture: "IMDb in desktop Chrome with DevTools docked and the Network tab selected after a refresh.",
        redact: [AccountNameRedaction, "Personal page content"]
      },
      {
        id: "select-document-request",
        title: "Choose the IMDb request",
        body: "Select the main www.imdb.com document request, then open its Headers panel.",
        imageSrc: "/src/assets/setup/connect-imdb/03-select-document-request.webp",
        imageAlt: "IMDb document request selected in Chrome Network tools",
        capture: "Chrome Network request list with the main www.imdb.com document row selected and Headers visible.",
        redact: ["Request identifiers containing account data", AccountNameRedaction]
      },
      {
        id: "copy-cookie-header",
        title: "Copy the Cookie value",
        body: "Under Request Headers, copy the complete value beside Cookie. Treat it like a temporary password.",
        imageSrc: "/src/assets/setup/connect-imdb/04-copy-cookie-header.webp",
        imageAlt: "Cookie request header location in Chrome DevTools",
        capture: "Request Headers section with the Cookie row highlighted and its value covered by a solid redaction.",
        redact: ["Complete Cookie header value", "Account email or name", AccountIdentifiersRedaction]
      },
      {
        id: "save-imdb-connection",
        title: "Save the connection",
        body: "Paste the value into Rapid Rater and choose Connect IMDb. The saved value is encrypted and never shown again.",
        imageSrc: "/src/assets/setup/connect-imdb/05-save-imdb-connection.webp",
        imageAlt: "Connect IMDb form in Rapid Rater",
        capture: "Rapid Rater IMDb connection form with a safe fake value or a fully covered cookie field.",
        redact: ["Cookie field", SignedInEmailRedaction],
        action: { id: SetupGuideActionIds.openImdbConnection, label: OpenImdbConnectionLabel, kind: LocalActionKind }
      }
    ]
  },
  {
    id: SetupGuideFlowIds.connectOpenAi,
    title: "Connect OpenAI",
    summary: "Use OpenAI here, or the matching key and URL from another OpenAI-compatible provider.",
    steps: [
      {
        id: "create-openai-key",
        title: "Create an API key",
        body: "Open the OpenAI API keys page, sign in, and choose Create new secret key.",
        imageSrc: "/src/assets/setup/connect-openai/01-create-openai-key.webp",
        imageAlt: "Create new secret key control on the OpenAI API keys page",
        capture: "OpenAI API keys page in desktop Chrome with Create new secret key clearly visible.",
        redact: ["Organization name", ProjectNameRedaction, AccountEmailRedaction, "Existing key names"],
        action: { id: SetupGuideActionIds.openOpenAiKeys, label: "Open OpenAI API keys", kind: ExternalActionKind, href: OpenAiKeysUrl }
      },
      {
        id: "copy-openai-key",
        title: "Copy it now",
        body: "Copy the new key when it appears. OpenAI only shows the complete value once.",
        imageSrc: "/src/assets/setup/connect-openai/02-copy-openai-key.webp",
        imageAlt: "New OpenAI API key dialog with its copy control",
        capture: "New secret key dialog with the copy control visible and the complete key covered by a solid redaction.",
        redact: ["Complete API key", "Key name", ProjectNameRedaction, AccountEmailRedaction]
      },
      {
        id: "find-openai-models",
        title: "Find available models",
        body: "In AI settings, enter https://api.openai.com/v1, paste the key, then choose Find models.",
        imageSrc: "/src/assets/setup/connect-openai/03-find-openai-models.webp",
        imageAlt: "Rapid Rater AI settings ready to find OpenAI models",
        capture: "Rapid Rater AI settings with the OpenAI base URL filled in and Find models highlighted.",
        redact: [ApiKeyFieldRedaction, SignedInEmailRedaction],
        action: { id: SetupGuideActionIds.openAiSettings, label: "Open AI settings", kind: LocalActionKind }
      },
      {
        id: "test-and-save-openai",
        title: "Test and save",
        body: "Choose a model from the returned list, then select Test and save.",
        imageSrc: "/src/assets/setup/connect-openai/04-test-and-save-openai.webp",
        imageAlt: "OpenAI model selected in Rapid Rater AI settings",
        capture: "Rapid Rater AI settings with a model selected and the Test and save button enabled.",
        redact: [ApiKeyFieldRedaction, SignedInEmailRedaction]
      }
    ]
  },
  {
    id: SetupGuideFlowIds.importImdbRatings,
    title: "Import IMDb ratings",
    summary: "Bring in ratings you already made so Rapid Rater skips repeats and gives you better picks.",
    steps: [
      {
        id: SetupGuideActionIds.openImdbExports,
        title: OpenImdbExportsLabel,
        body: "Sign in to IMDb and open its exports page.",
        imageSrc: "/src/assets/setup/import-imdb-ratings/01-open-imdb-exports.webp",
        imageAlt: "IMDb exports page for a signed-in account",
        capture: "IMDb exports page in desktop Chrome using a disposable account with ratings.",
        redact: [AccountNameRedaction, AccountIdentifiersRedaction, PrivateListNamesRedaction],
        action: { id: SetupGuideActionIds.openImdbExports, label: OpenImdbExportsLabel, kind: ExternalActionKind, href: ImdbExportsUrl }
      },
      {
        id: "download-imdb-ratings",
        title: "Download your ratings",
        body: "Find Your ratings, choose Export, and wait for the CSV download to finish.",
        imageSrc: "/src/assets/setup/import-imdb-ratings/02-download-imdb-ratings.webp",
        imageAlt: "Export control for Your ratings on IMDb",
        capture: "IMDb exports page with the Your ratings row and its Export control clearly highlighted.",
        redact: [AccountNameRedaction, ExportIdentifiersRedaction, PrivateListNamesRedaction]
      },
      {
        id: SetupGuideActionIds.chooseImdbCsv,
        title: "Choose the CSV",
        body: "In Rapid Rater, choose Import IMDb CSV and select the ratings file you downloaded.",
        imageSrc: "/src/assets/setup/import-imdb-ratings/03-choose-imdb-csv.webp",
        imageAlt: "Import IMDb CSV control in Rapid Rater",
        capture: "Rapid Rater import area with Import IMDb CSV highlighted before the system file picker opens.",
        redact: [SignedInEmailRedaction],
        action: { id: SetupGuideActionIds.chooseImdbCsv, label: "Choose IMDb CSV", kind: LocalActionKind }
      },
      {
        id: "confirm-imdb-import",
        title: "You are ready",
        body: "Rapid Rater removes imported titles from your queue and uses the history for stronger recommendations.",
        imageSrc: "/src/assets/setup/import-imdb-ratings/04-confirm-imdb-import.webp",
        imageAlt: "Successful IMDb ratings import summary in Rapid Rater",
        capture: "Rapid Rater immediately after a successful IMDb CSV import, showing the movie and TV totals.",
        redact: [SignedInEmailRedaction, "Personally identifying rating history"]
      }
    ]
  },
  {
    id: SetupGuideFlowIds.importLetterboxd,
    title: "Import Letterboxd",
    summary: "Compare your Letterboxd history with Rapid Rater without sharing a Letterboxd password.",
    steps: [
      {
        id: SetupGuideActionIds.openLetterboxdData,
        title: "Open your data settings",
        body: "Sign in to Letterboxd and open its data settings page.",
        imageSrc: "/src/assets/setup/import-letterboxd/01-open-letterboxd-data.webp",
        imageAlt: "Letterboxd data settings page",
        capture: "Letterboxd data settings page in desktop Chrome using a disposable test account.",
        redact: [MemberNameRedaction, ProfileImageRedaction, AccountEmailRedaction],
        action: { id: SetupGuideActionIds.openLetterboxdData, label: "Open Letterboxd data settings", kind: ExternalActionKind, href: LetterboxdDataUrl }
      },
      {
        id: "download-letterboxd-export",
        title: "Download your export",
        body: "Choose Export your data and save the ZIP file when Letterboxd finishes preparing it.",
        imageSrc: "/src/assets/setup/import-letterboxd/02-download-letterboxd-export.webp",
        imageAlt: "Export your data control in Letterboxd settings",
        capture: "Letterboxd data settings with the Export your data control and ready download clearly visible.",
        redact: [MemberNameRedaction, ExportIdentifiersRedaction, AccountEmailRedaction]
      },
      {
        id: SetupGuideActionIds.chooseLetterboxdExport,
        title: "Choose the ZIP",
        body: "In Sync Movies, choose Import Letterboxd and select the ZIP you downloaded.",
        imageSrc: "/src/assets/setup/import-letterboxd/03-choose-letterboxd-export.webp",
        imageAlt: "Import Letterboxd control in Rapid Rater Sync Movies",
        capture: "Rapid Rater Sync Movies page with Import Letterboxd highlighted before the system file picker opens.",
        redact: [SignedInEmailRedaction],
        action: { id: SetupGuideActionIds.chooseLetterboxdExport, label: "Choose Letterboxd export", kind: LocalActionKind }
      },
      {
        id: "review-letterboxd-import",
        title: "Review the comparison",
        body: "Rapid Rater shows matches, missing ratings, conflicts, and titles that still need an IMDb match.",
        imageSrc: "/src/assets/setup/import-letterboxd/04-review-letterboxd-import.webp",
        imageAlt: "Letterboxd comparison summary in Rapid Rater",
        capture: "Rapid Rater Sync Movies after import, with non-sensitive example counts and review sections visible.",
        redact: [SignedInEmailRedaction, PersonallyIdentifyingWatchHistoryRedaction],
        action: { id: SetupGuideActionIds.openMovieSync, label: OpenSyncMoviesLabel, kind: LocalActionKind }
      }
    ]
  },
  {
    id: SetupGuideFlowIds.rapidRaterToLetterboxd,
    title: "Send Rapid Rater ratings to Letterboxd",
    summary: "Create a Letterboxd-ready file, then review it on Letterboxd before anything changes.",
    steps: [
      {
        id: "refresh-sync-sources",
        title: "Start with fresh exports",
        body: "Import your latest IMDb ratings CSV and Letterboxd ZIP so the comparison is current.",
        imageSrc: "/src/assets/setup/rapid-rater-to-letterboxd/01-refresh-sync-sources.webp",
        imageAlt: "Current IMDb and Letterboxd import status in Rapid Rater",
        capture: "Rapid Rater Sync Movies showing both source imports complete with safe example totals.",
        redact: [SignedInEmailRedaction, PersonallyIdentifyingWatchHistoryRedaction],
        action: { id: SetupGuideActionIds.openMovieSync, label: OpenSyncMoviesLabel, kind: LocalActionKind }
      },
      {
        id: SetupGuideActionIds.downloadLetterboxdFile,
        title: "Download the import file",
        body: "Under Rapid Rater to Letterboxd, choose Download file to upload to Letterboxd.",
        imageSrc: "/src/assets/setup/rapid-rater-to-letterboxd/02-download-letterboxd-file.webp",
        imageAlt: "Download file to upload to Letterboxd control",
        capture: "Rapid Rater to Letterboxd sync section with the download control highlighted and a safe count.",
        redact: [SignedInEmailRedaction, PersonallyIdentifyingTitlesRedaction],
        action: { id: SetupGuideActionIds.downloadLetterboxdFile, label: "Download Letterboxd file", kind: LocalActionKind }
      },
      {
        id: SetupGuideActionIds.openLetterboxdImport,
        title: OpenLetterboxdImportLabel,
        body: "Open Letterboxd's importer after the Rapid Rater download finishes.",
        imageSrc: "/src/assets/setup/rapid-rater-to-letterboxd/03-open-letterboxd-import.webp",
        imageAlt: "Letterboxd import page",
        capture: "Letterboxd import page before a file is chosen, using a disposable test account.",
        redact: [MemberNameRedaction, ProfileImageRedaction],
        action: { id: SetupGuideActionIds.openLetterboxdImport, label: OpenLetterboxdImportLabel, kind: ExternalActionKind, href: LetterboxdImportUrl }
      },
      {
        id: "upload-letterboxd-file",
        title: "Upload the file",
        body: "Choose the downloaded CSV. If you received a ZIP, unzip it and upload each CSV one at a time.",
        imageSrc: "/src/assets/setup/rapid-rater-to-letterboxd/04-upload-letterboxd-file.webp",
        imageAlt: "CSV file selected in the Letterboxd importer",
        capture: "Letterboxd importer after a sanitized generated CSV is selected and before final confirmation.",
        redact: [MemberNameRedaction, "Local file path", PersonallyIdentifyingTitlesRedaction]
      },
      {
        id: "confirm-letterboxd-import",
        title: "Review and confirm",
        body: "Check Letterboxd's preview, fix any matches it flags, then confirm the import.",
        imageSrc: "/src/assets/setup/rapid-rater-to-letterboxd/05-confirm-letterboxd-import.webp",
        imageAlt: "Letterboxd import review and confirmation screen",
        capture: "Letterboxd import preview with safe sample films and the final confirmation control visible.",
        redact: [MemberNameRedaction, PersonallyIdentifyingTitlesRedaction, "Import identifiers"]
      }
    ]
  },
  {
    id: SetupGuideFlowIds.letterboxdToImdb,
    title: "Send Letterboxd ratings to IMDb",
    summary: "Queue ratings missing from IMDb through your existing encrypted IMDb connection.",
    steps: [
      {
        id: "import-current-snapshots",
        title: "Import both fresh exports",
        body: "Import the latest IMDb ratings CSV and Letterboxd ZIP before comparing them.",
        imageSrc: "/src/assets/setup/letterboxd-to-imdb/01-import-current-snapshots.webp",
        imageAlt: "IMDb and Letterboxd snapshots imported in Rapid Rater",
        capture: "Rapid Rater Sync Movies with current IMDb and Letterboxd sources and safe example totals.",
        redact: [SignedInEmailRedaction, PersonallyIdentifyingWatchHistoryRedaction],
        action: { id: SetupGuideActionIds.openMovieSync, label: OpenSyncMoviesLabel, kind: LocalActionKind }
      },
      {
        id: "review-imdb-actions",
        title: "Review what will be sent",
        body: "Open Review matches and problems. Conflicts and unmatched films are never sent automatically.",
        imageSrc: "/src/assets/setup/letterboxd-to-imdb/02-review-imdb-actions.webp",
        imageAlt: "Letterboxd to IMDb review in Rapid Rater",
        capture: "Rapid Rater expanded review showing safe sample matches, a conflict, and an unmatched title.",
        redact: [SignedInEmailRedaction, PersonallyIdentifyingTitlesRedaction]
      },
      {
        id: "check-imdb-connection",
        title: "Check the IMDb connection",
        body: "Connect IMDb first if the status says it is required.",
        imageSrc: "/src/assets/setup/letterboxd-to-imdb/03-check-imdb-connection.webp",
        imageAlt: "IMDb connection status in Rapid Rater",
        capture: "Rapid Rater connection status and IMDb connection control, with no cookie visible.",
        redact: [SignedInEmailRedaction, CookieValueRedaction],
        action: { id: SetupGuideActionIds.openImdbConnection, label: OpenImdbConnectionLabel, kind: LocalActionKind }
      },
      {
        id: "queue-letterboxd-ratings",
        title: "Send the missing ratings",
        body: "Choose Send missing ratings to IMDb. Rapid Rater queues them and shows delivery progress.",
        imageSrc: "/src/assets/setup/letterboxd-to-imdb/04-queue-letterboxd-ratings.webp",
        imageAlt: "Send missing ratings to IMDb control and queue status",
        capture: "Letterboxd to IMDb section with the send control, safe example count, and delivery status visible.",
        redact: [SignedInEmailRedaction, PersonallyIdentifyingTitlesRedaction, CookieValueRedaction],
        action: { id: SetupGuideActionIds.queueLetterboxdToImdb, label: "Send missing ratings to IMDb", kind: LocalActionKind }
      }
    ]
  }
];

export const SetupGuideFlows = DeepFreeze(SetupGuideFlowDefinitions);

export function FindSetupGuideFlow(flowId) {
  return SetupGuideFlows.find((flow) => flow.id === flowId) || null;
}

export function FindSetupGuideStep(flow, stepId) {
  if (!flow)
    return null;
  return flow.steps.find((step) => step.id === stepId) || null;
}

function DeepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  Object.values(value).forEach(DeepFreeze);
  return Object.freeze(value);
}
