export function cn(...parts: Array<string | false | null | undefined | 0>) {
  return parts.filter(Boolean).join(' ');
}
