import type { PluginTheme } from "@getpaseo/plugin";

/** Whether the app's theme is dark, from the luminance of its main surface. */
export function isDark(theme: PluginTheme): boolean {
  const hex = /^#?([0-9a-f]{6})$/i.exec(theme.colors.surface0.trim())?.[1];
  if (!hex) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}
