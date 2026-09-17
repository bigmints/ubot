import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";

export function StandardPage({
  title,
  description,
  actions,
  width = "wide",
  className,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  width?: "narrow" | "wide" | "full";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("standard-page", `standard-page--${width}`, className)}>
      {actions && <PageHeader title={title} description={description} actions={actions} />}
      {children}
    </div>
  );
}

export function WorkspacePage({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("workspace-page", className)}>
      {actions && (
        <PageHeader title={title} description={description || ""} actions={actions} />
      )}
      {children}
    </div>
  );
}

export function WorkspaceColumns({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("workspace-columns", className)} {...props} />;
}

export function WorkspaceRail({ className, ...props }: ComponentProps<"aside">) {
  return <aside className={cn("workspace-rail", className)} {...props} />;
}

export function WorkspaceCanvas({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("workspace-canvas", className)} {...props} />;
}

export function WorkspaceAssistantPanel({
  open,
  className,
  ...props
}: ComponentProps<"aside"> & { open: boolean }) {
  return (
    <aside
      data-open={open ? "true" : "false"}
      className={cn("workspace-assistant-panel", className)}
      {...props}
    />
  );
}
