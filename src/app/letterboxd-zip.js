const CsvFilePattern = /\.csv$/i;
const ZipFilePattern = /\.zip$/i;

export async function ReadLetterboxdUpload(file) {
  const name = String(file?.name || "");
  if (CsvFilePattern.test(name))
    return [{ name, text: await file.text() }];
  if (!ZipFilePattern.test(name))
    throw new Error("Choose the ZIP downloaded from Letterboxd, or one of its CSV files.");
  const { unzipSync, strFromU8 } = await ImportFflate();
  return ReadLetterboxdArchive(await file.arrayBuffer(), { unzipSync, strFromU8 });
}

export function ReadLetterboxdArchive(buffer, { unzipSync, strFromU8 }) {
  const archive = unzipSync(new Uint8Array(buffer));
  const entries = Object.entries(archive);
  const csvEntries = entries.filter(([entryName]) => CsvFilePattern.test(entryName));
  return csvEntries.map(([entryName, bytes]) => ({ name: entryName, text: strFromU8(bytes) }));
}

export async function BuildLetterboxdDownload(files) {
  if (files.length === 1)
    return { name: files[0].name, content: files[0].content, type: "text/csv;charset=utf-8" };
  const { zipSync, strToU8 } = await ImportFflate();
  return BuildLetterboxdArchive(files, { zipSync, strToU8 });
}

export function BuildLetterboxdArchive(files, { zipSync, strToU8 }) {
  const entries = Object.fromEntries(files.map((file) => [file.name, strToU8(file.content)]));
  return {
    name: "letterboxd-import-files-unzip-me.zip",
    content: zipSync(entries, { level: 6 }),
    type: "application/zip"
  };
}

function ImportFflate() {
  return import("fflate");
}
