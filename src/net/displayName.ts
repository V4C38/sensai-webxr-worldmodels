const STORAGE_KEY = "sensai-display-name";

export function getOrCreateDisplayName(): string {
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (stored?.trim()) return stored.trim();
  const name = `User-${Math.floor(Math.random() * 1000)}`;
  sessionStorage.setItem(STORAGE_KEY, name);
  return name;
}
