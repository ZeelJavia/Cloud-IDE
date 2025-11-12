import { useEffect, useState } from "react";
import { ThemeContext } from "./theme-context.jsx";

export function ThemeProvider({
  attribute = "class",
  defaultTheme = "system",
  enableSystem = true,
  disableTransitionOnChange = true,
  children,
}) {
  const [theme, setTheme] = useState(
    () => localStorage.getItem("theme") || defaultTheme
  );

  useEffect(() => {
    const root = document.documentElement;
    const systemDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    const effective =
      theme === "system" && enableSystem
        ? systemDark
          ? "dark"
          : "light"
        : theme;

    if (attribute === "class") {
      root.classList.toggle("dark", effective === "dark");
    }

    if (disableTransitionOnChange) {
      const css = document.createElement("style");
      css.appendChild(document.createTextNode("*{transition:none !important}"));
      document.head.appendChild(css);
      void window.getComputedStyle(document.body);
      document.head.removeChild(css);
    }

    localStorage.setItem("theme", theme);
  }, [theme, attribute, enableSystem, disableTransitionOnChange]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
