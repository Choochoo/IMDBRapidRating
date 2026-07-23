const CsvDelimiter = ",";
const CsvQuote = "\"";

export function ParseCsv(text) {
  const state = BuildCsvState();
  for (let index = 0; index < text.length; index++)
    ReadCsvCharacter(state, text[index], text[index + 1], () => index++);
  if (state.value || state.row.length)
    PushCsvRow(state);
  return state.rows;
}

function BuildCsvState() {
  return {
    rows: [],
    row: [],
    value: "",
    quoted: false
  };
}

export function ToCsvRow(values) {
  return values.map(ToCsvValue).join(CsvDelimiter);
}

function ReadCsvCharacter(state, char, next, skipNext) {
  if (state.quoted) {
    ReadQuotedCsvCharacter(state, char, next, skipNext);
    return;
  }
  ReadOpenCsvCharacter(state, char);
}

function ReadQuotedCsvCharacter(state, char, next, skipNext) {
  if (char === CsvQuote && next === CsvQuote) {
    state.value += CsvQuote;
    skipNext();
    return;
  }
  if (char === CsvQuote)
    state.quoted = false;
  else
    state.value += char;
}

function ReadOpenCsvCharacter(state, char) {
  if (char === CsvQuote)
    state.quoted = true;
  else if (char === CsvDelimiter)
    PushCsvValue(state);
  else if (char === "\n")
    PushCsvRow(state);
  else if (char !== "\r")
    state.value += char;
}

function PushCsvValue(state) {
  state.row.push(state.value);
  state.value = "";
}

function PushCsvRow(state) {
  PushCsvValue(state);
  state.rows.push(state.row);
  state.row = [];
}

function ToCsvValue(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `${CsvQuote}${text.replaceAll(CsvQuote, `${CsvQuote}${CsvQuote}`)}${CsvQuote}` : text;
}
