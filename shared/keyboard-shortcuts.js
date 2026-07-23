export const SkipShortcutAction = "skip";
export const RatingShortcutPrefix = "rate-";

const KeyboardShortcutDescriptorValues = [
  ...Array.from({ length: 10 }, (_, index) => BuildRatingDescriptor(index + 1)),
  Object.freeze({ action: SkipShortcutAction, label: "Skip", description: "Mark the active title as not seen or not watched." })
];
export const KeyboardShortcutDescriptors = Object.freeze(KeyboardShortcutDescriptorValues);

const DefaultKeyboardShortcutValues = {
  "rate-1": "1",
  "rate-2": "2",
  "rate-3": "3",
  "rate-4": "4",
  "rate-5": "5",
  "rate-6": "6",
  "rate-7": "7",
  "rate-8": "8",
  "rate-9": "9",
  "rate-10": "0",
  skip: "n"
};
export const DefaultKeyboardShortcuts = Object.freeze(DefaultKeyboardShortcutValues);

export function NormalizeKeyboardShortcuts(value) {
  const result = ValidateKeyboardShortcuts(value);
  return result.ok ? result.value : { ...DefaultKeyboardShortcuts };
}

export function ValidateKeyboardShortcuts(value) {
  if (!IsShortcutObject(value))
    return BuildInvalidResult("Keyboard shortcuts must be an object.");
  const actions = KeyboardShortcutDescriptors.map((descriptor) => descriptor.action);
  if (!HasExactActions(value, actions))
    return BuildInvalidResult("Keyboard shortcuts must assign every rating and Skip.");
  const shortcuts = Object.fromEntries(actions.map((action) => [action, NormalizeShortcutKey(value[action])]));
  if (Object.values(shortcuts).some((key) => !key))
    return BuildInvalidResult("Choose one printable key for every shortcut.");
  if (new Set(Object.values(shortcuts)).size !== actions.length)
    return BuildInvalidResult("Every keyboard shortcut must use a different key.");
  return { ok: true, value: shortcuts };
}

export function NormalizeShortcutKey(value) {
  const key = String(value ?? "");
  if (key.length !== 1 || IsControlCharacter(key))
    return "";
  return /^[A-Z]$/.test(key) ? key.toLowerCase() : key;
}

export function DisplayShortcutKey(value) {
  const key = NormalizeShortcutKey(value);
  if (key === " ")
    return "Space";
  return /^[a-z]$/.test(key) ? key.toUpperCase() : key;
}

export function ReadShortcutAction(shortcuts, key) {
  const normalizedKey = NormalizeShortcutKey(key);
  if (!normalizedKey)
    return "";
  return Object.entries(NormalizeKeyboardShortcuts(shortcuts)).find(([, value]) => value === normalizedKey)?.[0] || "";
}

export function ReadShortcutRating(action) {
  if (!String(action).startsWith(RatingShortcutPrefix))
    return null;
  const rating = Number(String(action).slice(RatingShortcutPrefix.length));
  return Number.isInteger(rating) && rating >= 1 && rating <= 10 ? rating : null;
}

export function SwapKeyboardShortcut(shortcuts, action, key) {
  const current = NormalizeKeyboardShortcuts(shortcuts);
  const normalizedKey = NormalizeShortcutKey(key);
  if (!normalizedKey || !Object.hasOwn(current, action))
    return current;
  const conflict = Object.entries(current).find(([, value]) => value === normalizedKey)?.[0] || "";
  const next = { ...current, [action]: normalizedKey };
  if (conflict && conflict !== action)
    next[conflict] = current[action];
  return next;
}

export function AreKeyboardShortcutsEqual(left, right) {
  const normalizedLeft = NormalizeKeyboardShortcuts(left);
  const normalizedRight = NormalizeKeyboardShortcuts(right);
  return KeyboardShortcutDescriptors.every((descriptor) => normalizedLeft[descriptor.action] === normalizedRight[descriptor.action]);
}

function BuildRatingDescriptor(rating) {
  return Object.freeze({ action: `${RatingShortcutPrefix}${rating}`, label: `Rating ${rating}`, description: `Rate the active title ${rating} out of 10.` });
}

function IsShortcutObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function HasExactActions(value, actions) {
  const keys = Object.keys(value);
  return keys.length === actions.length && actions.every((action) => Object.hasOwn(value, action));
}

function IsControlCharacter(key) {
  return /[\u0000-\u001f\u007f]/.test(key);
}

function BuildInvalidResult(error) {
  return { ok: false, error };
}
