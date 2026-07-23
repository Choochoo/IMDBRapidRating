import { ValidateImdbCookie } from "./browser-settings.js";
import { EscapeHtml, FormatCount } from "./util.js";
import { NormalizeStreamingCountry } from "../../shared/streaming-country.js";

export async function SaveImdbConnectionFromDialog(app) {
  const result = ValidateImdbCookie(app.Elements.imdbInput.value);
  if (!result.ok)
    return app.ShowImdbError(result.error);
  app.SetImdbSaving(true);
  let saved;
  try {
    saved = await app.SaveAccountSecret("imdb", result.value);
  } finally {
    app.SetImdbSaving(false);
  }
  await ApplySavedImdbConnection(app, saved);
}

export async function SaveStreamingRegionFromDialog(app) {
  const result = ReadStreamingRegion(app);
  if (!result.ok)
    return app.ShowRegionError(result.error);
  app.SetRegionSaving(true);
  try {
    await app.SaveAccountPreferences({ streamingCountry: result.country });
  } finally {
    app.SetRegionSaving(false);
  }
  ApplySavedStreamingRegion(app, result.country);
}

async function ApplySavedImdbConnection(app, result) {
  await app.RefreshLiveStatus();
  await app.RefreshRemoteState();
  app.HideImdbDialog();
  const queued = Number(result?.resumedJobs) || 0;
  if (queued > 0)
    return app.ShowToast(`IMDb connected. Queued <strong>${FormatCount(queued)}</strong> writes`);
  app.ShowToast("IMDb connected. <strong>Live ready</strong>");
}

function ApplySavedStreamingRegion(app, country) {
  app.HideRegionDialog();
  app.UpdateSettingsButtons();
  app.RefreshVisibleMetadata();
  app.ShowToast(`Viewing region saved: <strong>${EscapeHtml(country)}</strong>`);
}

function ReadStreamingRegion(app) {
  const country = NormalizeStreamingCountry(app.Elements.regionCountry.value);
  if (!country)
    return { ok: false, error: "Enter a two-letter streaming country code, such as US, CA, GB, or AU." };
  return { ok: true, country };
}

