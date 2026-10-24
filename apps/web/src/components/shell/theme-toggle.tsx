"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { ToggleGroup } from "radix-ui";
import { useState, useTransition } from "react";
import { setThemeAction } from "@/app/actions/preferences";
import { cn } from "@/lib/cn";

const OPTIONS = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemeToggle({ initial }: { initial: string }) {
  const [theme, setTheme] = useState(initial);
  const [, startTransition] = useTransition();
  return (
    <ToggleGroup.Root
      type="single"
      value={theme}
      aria-label="Color theme"
      onValueChange={(value) => {
        if (!value) return;
        setTheme(value);
        document.documentElement.dataset.theme = value;
        startTransition(() => setThemeAction(value));
      }}
      className="inline-flex rounded-full border border-outline p-1"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <ToggleGroup.Item
          key={value}
          value={value}
          className={cn(
            "type-label inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 transition-colors",
            "text-on-surface-variant hover:text-on-surface data-[state=on]:bg-primary-container data-[state=on]:text-on-primary-container",
          )}
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
