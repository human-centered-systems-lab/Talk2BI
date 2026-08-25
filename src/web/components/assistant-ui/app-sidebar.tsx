"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Plus as PlusIcon,
  Settings as SettingsIcon,
  Blocks,
  ClipboardCheckIcon,
  InfoIcon,
  LogOutIcon,
  LaptopIcon,
  MoonIcon,
  SunIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { ThreadList } from "@/components/assistant-ui/thread-list";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useProfile } from "@/components/profile-provider";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { ThreadListPrimitive } from "@assistant-ui/react";

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  /**
   * Optional content rendered below the primary navigation menu and
   * the global Alfred thread list.
   */
  children?: React.ReactNode;
};

export function AppSidebar({ children, ...props }: AppSidebarProps) {
  const pathname = usePathname();
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="aui-sidebar-header px-0.5 py-0.5">
        <div className="aui-sidebar-header-content flex h-12 items-center justify-between">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                asChild
                className="text-foreground hover:bg-transparent hover:text-foreground"
              >
                <a
                  href="https://h-lab.win.kit.edu"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center"
                >
                  <span className="relative block h-6 w-full overflow-hidden leading-none">
                    <span
                      aria-hidden={isCollapsed}
                      className={cn(
                        "absolute inset-0 flex items-center text-xl font-bold tracking-tight transition-opacity duration-150 ease-in-out",
                        isCollapsed
                          ? "pointer-events-none opacity-0"
                          : "opacity-100",
                      )}
                    >
                      Talk2BI
                    </span>
                    <span
                      aria-hidden={!isCollapsed}
                      className={cn(
                        "absolute inset-0 flex items-center justify-center text-sm font-bold tracking-tight transition-opacity duration-150 ease-in-out",
                        isCollapsed
                          ? "opacity-100"
                          : "pointer-events-none opacity-0",
                      )}
                    >
                      T2BI
                    </span>
                  </span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarHeader>

      <SidebarContent className="aui-sidebar-content px-0.5">
        {/* 1) Global "New thread" entry at the very top */}
        <SidebarMenu className="mb-3">
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/chat"} tooltip="New thread" className={cn("py-0", pathname === "/chat" && "bg-muted")}>
              <ThreadListPrimitive.New asChild>
                <Link href="/chat">
                  <PlusIcon className={pathname === "/chat" ? "h-4 w-4 text-primary" : "h-4 w-4 hover:text-primary"} />
                  <span className={pathname === "/chat" ? "text-primary group-data-[collapsible=icon]:hidden" : "group-data-[collapsible=icon]:hidden"}>New Chat</span>
                </Link>
              </ThreadListPrimitive.New>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/graph"} tooltip="Data & Context" className={cn("py-0", pathname === "/graph" && "bg-muted")}>
              <Link href="/graph">
                <Blocks className={pathname === "/graph" ? "h-4 w-4 shrink-0 text-primary" : "h-4 w-4 shrink-0 hover:text-primary"} />
                <span className={pathname === "/graph" ? "text-primary group-data-[collapsible=icon]:hidden" : "group-data-[collapsible=icon]:hidden"}>Data &amp; Context</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/evaluation"} tooltip="Evaluation" className={cn("py-0", pathname === "/evaluation" && "bg-muted")}>
              <Link href="/evaluation">
                <ClipboardCheckIcon className={pathname === "/evaluation" ? "h-4 w-4 shrink-0 text-primary" : "h-4 w-4 shrink-0 hover:text-primary"} />
                <span className={pathname === "/evaluation" ? "text-primary group-data-[collapsible=icon]:hidden" : "group-data-[collapsible=icon]:hidden"}>Evaluation</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* 3) Search + global Alfred thread history – visible on all pages */}
        {!isCollapsed && <ThreadList />}

        {/* Optional per-page sidebar content below the shared thread list */}
        {!isCollapsed && children}
      </SidebarContent>

      <SidebarRail />
      <SidebarFooter className="aui-sidebar-footer px-0.5 py-0.5">
        <SidebarAccountMenu />
      </SidebarFooter>
    </Sidebar>
  );
}

function SidebarAccountMenu() {
  const router = useRouter();
  const { state } = useSidebar();
  const { theme, setTheme } = useTheme();
  const { authenticated, email, name } = useProfile();
  const [aboutOpen, setAboutOpen] = React.useState(false);
  const isCollapsed = state === "collapsed";
  const displayName = name ?? "Account";
  const avatarText = displayName.slice(0, 2).toUpperCase();

  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/auth/login");
  };

  if (!authenticated) return null;

  return (
    <>
      <SidebarMenu className="h-12 justify-center">
        <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={displayName}
              className="relative min-w-0"
            >
              <span className="absolute left-1.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-chart-1 text-[9px] font-semibold leading-none text-white">
                <span className="dark:-translate-y-px">{avatarText}</span>
              </span>
              <span className="ml-6 flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
                <span className="truncate leading-4">{displayName}</span>
                {email ? (
                  <span className="truncate text-[11px] font-normal leading-3.5 text-muted-foreground">
                    {email}
                  </span>
                ) : null}
              </span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align={isCollapsed ? "center" : "start"}
            side="right"
            alignOffset={-8}
            className="w-64"
          >
            <DropdownMenuLabel className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate">{displayName}</span>
              {email ? (
                <span className="truncate text-xs font-normal text-muted-foreground">
                  {email}
                </span>
              ) : null}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
              Appearance
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={theme ?? "system"}
              onValueChange={setTheme}
            >
              <DropdownMenuRadioItem
                value="light"
                className="gap-2"
                onSelect={(event) => event.preventDefault()}
              >
                <SunIcon className="text-muted-foreground" />
                Light
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="dark"
                className="gap-2"
                onSelect={(event) => event.preventDefault()}
              >
                <MoonIcon className="text-muted-foreground" />
                Dark
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                value="system"
                className="gap-2"
                onSelect={(event) => event.preventDefault()}
              >
                <LaptopIcon className="text-muted-foreground" />
                System
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2"
              onSelect={() => {
                window.location.hash = "settings";
              }}
            >
              <SettingsIcon />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2"
              onSelect={() => setAboutOpen(true)}
            >
              <InfoIcon />
              About
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-destructive focus:text-destructive"
              onClick={() => void logout()}
            >
              <LogOutIcon />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>About Talk2BI</DialogTitle>
            <DialogDescription>
              Information about the project and its collaborators.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 px-6 pb-6">
            <section aria-labelledby="collaboration-heading">
              <p
                id="collaboration-heading"
                className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                A collaboration of
              </p>
              <div className="grid gap-3 rounded-lg border bg-white p-5 dark:border-neutral-800 dark:bg-neutral-950 sm:grid-cols-2">
                <a
                  href="https://www.kit.edu"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md px-4 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  aria-label="Karlsruhe Institute of Technology"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="https://www.kit.edu/img/intern/kit_logo_V2_de.svg"
                    alt="KIT – Karlsruhe Institute of Technology"
                    className="max-h-14 w-full max-w-48 object-contain dark:brightness-0 dark:invert"
                  />
                  <span className="text-center text-[11px] text-neutral-600 dark:text-neutral-400">
                    Karlsruhe Institute of Technology
                  </span>
                </a>
                <a
                  href="https://www.enbw.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md px-4 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  aria-label="EnBW Energie Baden-Württemberg AG"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="https://www.enbw.com/media/logos/enbw-logo/enbw-logo-standard-blauorange-srgb_1727080886669.svg"
                    alt="EnBW Energie Baden-Württemberg AG"
                    className="max-h-14 w-full max-w-48 object-contain"
                  />
                  <span className="text-center text-[11px] text-neutral-600 dark:text-neutral-400">
                    EnBW Energie Baden-Württemberg AG
                  </span>
                </a>
                <a
                  href="https://www.kcl.ac.uk"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md px-4 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  aria-label="King's College London"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="https://www.kcl.ac.uk/SiteElements/2017/images/kcl-logo.svg"
                    alt="King's College London"
                    className="max-h-14 w-full max-w-18 object-contain"
                  />
                  <span className="text-center text-[11px] text-neutral-600 dark:text-neutral-400">
                    King&apos;s College London
                  </span>
                </a>
                <a
                  href="https://menschki.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md px-4 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  aria-label="MenschKI!"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="https://menschki.org/media/MenschKI-Logo.webp"
                    alt="MenschKI!"
                    className="max-h-14 w-full max-w-36 object-contain"
                  />
                  <span className="text-center text-[11px] text-neutral-600 dark:text-neutral-400">
                    MenschKI!
                  </span>
                </a>
                <a
                  href="https://theodi.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md px-4 transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  aria-label="Open Data Institute"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="https://data.org/wp-content/uploads/2021/10/logo-ODI.png"
                    alt="Open Data Institute"
                    className="max-h-14 w-full max-w-36 object-contain"
                  />
                  <span className="text-center text-[11px] text-neutral-600 dark:text-neutral-400">
                    Open Data Institute
                  </span>
                </a>
              </div>
            </section>

            <section className="space-y-3 text-sm leading-relaxed text-muted-foreground">
              <p>
                Talk2BI is an open-source data assistant: ask a question in
                plain language and it writes the SQL, runs it against your
                warehouse, and answers in the language you asked in.
              </p>
              <p>
                KIT, EnBW, King&apos;s College London, MenschKI!, and the Open Data
                Institute collaborate under a shared mission to keep
                production-grade data access open — research-first, transparent
                end to end, and owned by the teams who rely on it.
              </p>
              <p>
                Founder: Niklas Wagner —{" "}
                <a
                  href="mailto:niklas.wagner@kit.edu"
                  className="underline-offset-4 hover:underline"
                >
                  niklas.wagner@kit.edu
                </a>
              </p>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
