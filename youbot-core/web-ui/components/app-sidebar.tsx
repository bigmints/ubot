"use client";
import { useSidebar } from "@/components/ui/sidebar";

import { useEffect, useState } from "react";

import {
  LayoutDashboard,
  Puzzle,
  Clock,
  Settings,
  Bot,
  Globe,
  FolderOpen,
  Plug,
  Terminal,
  Apple,
  Search,
  Calendar,
  Sparkles,
  type LucideIcon,
  Zap,
  LogOut,
  User,
  Users,
  ChevronsUpDown,
  HelpCircle,
  Inbox,
  LibraryBig,
} from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useFeatures, type Features } from "@/hooks/use-features";


// ── Nav Item Types ──────────────────────────────────────

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Optional: only show this item if the named feature is enabled */
  feature?: keyof Features;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
  /** Only show this group if at least one item passes feature filter */
  hideIfEmpty?: boolean;
  /** Only show in specific modes */
  condition?: (ctx: { mode: string; features: Features; isCloud: boolean; isSaaS: boolean }) => boolean;
}

// ── Extension Point ─────────────────────────────────────

type SidebarPosition = 'after-core' | 'after-agents' | 'after-automation' | 'after-channels' | 'after-capabilities';

interface SidebarExtension {
  position: SidebarPosition;
  groups: NavGroup[];
}

const _extensions: SidebarExtension[] = [];

/**
 * Register additional sidebar nav groups from extensions.
 * Call this at module load time (e.g., in a client-side extension file).
 */
export function registerSidebarExtensions(ext: SidebarExtension): void {
  _extensions.push(ext);
}

// Inject items into an existing named group (e.g., 'Capabilities')
type ExistingGroup = 'Core' | 'Agents' | 'Automation' | 'Channels' | 'Capabilities' | 'Monitor';

const _groupInjections: Map<ExistingGroup, NavItem[]> = new Map();

/**
 * Register additional items to inject into an existing sidebar group.
 * Items will be appended to the group's list and filtered by feature flags.
 */
export function registerSidebarItems(group: ExistingGroup, items: NavItem[]): void {
  const existing = _groupInjections.get(group) || [];
  _groupInjections.set(group, [...existing, ...items]);
}

interface FooterExtension {
  items: NavItem[];
  condition?: (ctx: { isCloud: boolean; isSaaS: boolean }) => boolean;
}

const _footerExtensions: FooterExtension[] = [];

export function registerSidebarFooterExtensions(ext: FooterExtension): void {
  _footerExtensions.push(ext);
}

// ── Core Nav Items ──────────────────────────────────────

const coreItems: NavItem[] = [
  { title: "Overview", href: "/", icon: LayoutDashboard },
  { title: "Conversations", href: "/conversations", icon: Inbox },
  { title: "Contacts", href: "/contacts", icon: Users },
];
const profileItems: NavItem[] = [
  { title: "Agent profile", href: "/concierge", icon: Bot },
  { title: "Collections", href: "/concierge/collections", icon: LibraryBig },
  { title: "User profile", href: "/profile", icon: User },
];
const manageItems: NavItem[] = [
  { title: "Connections", href: "/connections", icon: Plug },
  { title: "Skills", href: "/skills", icon: Puzzle },
  { title: "Automations", href: "/scheduler", icon: Clock, feature: "scheduler" },
  { title: "Settings", href: "/settings", icon: Settings },
];

/** Merge core items with any injected extension items for a group */
function getGroupItems(group: ExistingGroup, coreItems: NavItem[]): NavItem[] {
  const injected = _groupInjections.get(group) || [];
  return [...coreItems, ...injected];
}

// ── Sidebar Component ───────────────────────────────────

export function AppSidebar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  useEffect(() => { setOpenMobile(false); }, [pathname, setOpenMobile]);
  const { features, isSaaS, isCloud, mode } = useFeatures();
  const { authRequired, logout } = useAuth();

  const [appName, setAppName] = useState("Youbot");
  const [username, setUsername] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const displayAppName = appName.trim().toLowerCase() === "youbot" ? "Youbot" : appName;

  useEffect(() => {
    fetch('/api/app/theme')
      .then(r => r.json())
      .then(({ theme }) => {
        if (theme?.appName) setAppName(theme.appName);
        if (theme?.logoUrl) setLogoUrl(theme.logoUrl);
      })
      .catch(() => {});

    // Fetch current user profile
    api<{ username: string }>('/api/auth/profile')
      .then(data => { if (data?.username) setUsername(data.username); })
      .catch(() => {});
  }, []);

  const ctx = { mode, features, isCloud, isSaaS };

  const [dynamicModules, setDynamicModules] = useState<NavItem[]>([]);

  useEffect(() => {
    interface DynamicModule {
      ui?: { title: string; href: string; icon: string; };
    }
    api<{ modules: DynamicModule[] }>('/api/modules')
      .then(data => {
        if (data.modules && Array.isArray(data.modules)) {
          const ICONS: Record<string, LucideIcon> = {
            Sparkles, Bot, Globe, FolderOpen, Plug, Search, Calendar, Apple, Terminal, Zap
          };
          const items: NavItem[] = data.modules
            .filter((m) => m.ui)
            .map((m) => ({
              title: m.ui!.title,
              href: m.ui!.href,
              icon: ICONS[m.ui!.icon] || Plug,
            }));
          setDynamicModules(items);
        }
      })
      .catch(console.error);
  }, []);

  /** Filter items based on feature flags */
  const filterItems = (items: NavItem[]) =>
    items.filter((item) => !item.feature || features[item.feature]);

  const renderItem = (item: NavItem) => (
    <SidebarMenuItem key={item.href}>
      <SidebarMenuButton
        asChild
        isActive={
          item.href === "/"
            ? pathname === "/"
            : item.href === "/concierge"
              ? pathname === "/concierge"
            : pathname.startsWith(item.href)
        }
        tooltip={item.title}
      >
        <Link href={item.href} onClick={() => setOpenMobile(false)}>
          <item.icon />
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  const renderGroup = (group: NavGroup, key: string) => {
    if (group.condition && !group.condition(ctx)) return null;
    const filtered = filterItems(group.items);
    if (group.hideIfEmpty && filtered.length === 0) return null;
    return (
      <SidebarGroup key={key}>
        <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {filtered.map(renderItem)}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  const getExtensions = (position: SidebarPosition) =>
    _extensions
      .filter(e => e.position === position)
      .flatMap(e => e.groups);

  const buildAndManageItems = getGroupItems('Capabilities', [...manageItems, ...dynamicModules]);

  return (
    <Sidebar collapsible="icon" variant="sidebar" className="signature-sidebar">
      <SidebarHeader className="signature-brand">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/">
                <div className="signature-brand-symbol flex size-9 shrink-0 items-center justify-center">
                  {logoUrl ? (
                    <img src={logoUrl} alt={appName} className="size-5 object-contain" />
                  ) : (
                    <BrandMark />
                  )}
                </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="signature-wordmark">{displayAppName}</span>
              </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {renderGroup({label:'Workspace',items:getGroupItems('Core',coreItems)},'workspace')}
        {getExtensions('after-core').map((g, i) => renderGroup(g, `ext-core-${i}`))}
        {renderGroup({label:'Your concierge',items:profileItems},'profiles')}
        {getExtensions('after-agents').map((g, i) => renderGroup(g, `ext-agents-${i}`))}
        {renderGroup({label:'Build & manage',items:buildAndManageItems},'build-manage')}
        {getExtensions('after-capabilities').map((g, i) => renderGroup(g, `ext-cap-${i}`))}
        {getExtensions('after-automation').map((g, i) => renderGroup(g, `ext-auto-${i}`))}
        {getExtensions('after-channels').map((g, i) => renderGroup(g, `ext-chan-${i}`))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {renderItem({ title: "Help & setup", href: "/setup", icon: HelpCircle })}
          {/* Footer extension items */}
          {_footerExtensions
            .filter(e => !e.condition || e.condition({ isCloud, isSaaS }))
            .flatMap(e => e.items)
            .map(renderItem)}

          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  tooltip={username || "Account"}
                >
                  <Avatar className="size-8 rounded-lg">
                    <AvatarFallback className="rounded-lg bg-primary/10 text-primary font-semibold">
                      {(username || "U").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{username || "User"}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      Account settings
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
              >
                <DropdownMenuItem asChild>
                  <Link href="/profile" className="flex items-center gap-2">
                    <User className="size-4" />
                    Profile
                  </Link>
                </DropdownMenuItem>
                {authRequired && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => logout()} className="text-destructive focus:text-destructive">
                      <LogOut className="size-4" />
                      Sign out
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
