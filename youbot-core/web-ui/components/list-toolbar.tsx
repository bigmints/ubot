"use client";

import { Loader2, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ListToolbarOption {
  value: string;
  label: string;
}

export interface ListToolbarSelect {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: ListToolbarOption[];
}

export type ListToolbarLayout = "inline" | "stacked";

export function ListToolbar({
  searchLabel,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  searching = false,
  filters = [],
  sort,
  resultLabel,
  active = false,
  onReset,
  layout = "inline",
  className,
}: {
  searchLabel: string;
  searchPlaceholder: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searching?: boolean;
  filters?: ListToolbarSelect[];
  sort?: ListToolbarSelect;
  resultLabel?: string;
  active?: boolean;
  onReset?: () => void;
  layout?: ListToolbarLayout;
  className?: string;
}) {
  const controls = sort ? [...filters, sort] : filters;

  return (
    <div className={cn("list-toolbar border-b p-3", className)}>
      <div className="list-toolbar__layout" data-layout={layout}>
        <div className="list-toolbar__search relative">
          {searching ? (
            <Loader2 className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : (
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          )}

          <Input
            aria-label={searchLabel}
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 min-h-9 pl-9 text-sm"
          />
        </div>

        {controls.length > 0 && (
          <div
            className={cn(
              "list-toolbar__controls grid gap-2",
              controls.length > 1 && "grid-cols-2",
              controls.length === 3 && "[&>label:last-child]:col-span-2",
            )}
          >
            {controls.map((control) => (
              <label key={control.label} className="list-toolbar__control min-w-0">
                <span className="sr-only">{control.label}</span>
                <select
                  aria-label={control.label}
                  value={control.value}
                  onChange={(event) => control.onValueChange(event.target.value)}
                  className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {control.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}

        {(resultLabel || (active && onReset)) && (
          <div className="list-toolbar__summary flex min-h-7 items-center justify-between gap-2 px-1">
            <span className="truncate text-[11px] text-muted-foreground">{resultLabel}</span>
            {active && onReset && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 min-h-7 px-2 text-[11px]"
                onClick={onReset}
              >
                <X className="size-3" />
                Clear
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
