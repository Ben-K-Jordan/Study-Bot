/**
 * The browser and status bar colour for each theme: the shell's surface.
 * The root layout's viewport metadata uses these for first paint (by system
 * theme), and ThemeColorSync follows a manual Light or Dark choice.
 */
export const THEME_COLORS = {
  light: "#f8fafd",
  dark: "#131314",
} as const
