"use client";

import {
  ArchiveIcon,
  CheckIcon,
  LaptopIcon,
  Loader2Icon,
  MoonIcon,
  SunIcon,
  Trash2Icon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAui } from "@assistant-ui/react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProfile } from "@/components/profile-provider";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const SETTINGS_HASH = "#settings";
const settingsSections = [
  "General",
  "Personalization",
  "Data Controls",
  "Account",
] as const;
type SettingsSection = (typeof settingsSections)[number];

export function SettingsDialog() {
  const aui = useAui();
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const {
    error: profileError,
    loading: profileLoading,
    name,
    saveName,
  } = useProfile();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SettingsSection>("General");
  const [accountName, setAccountName] = useState("");
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [accountResult, setAccountResult] = useState("");
  const [bulkAction, setBulkAction] = useState<"archive" | "delete" | null>(
    null,
  );
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [bulkResult, setBulkResult] = useState("");
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [accountDeleting, setAccountDeleting] = useState(false);
  const [accountDeleteError, setAccountDeleteError] = useState("");

  useEffect(() => {
    const syncWithHash = () => setOpen(window.location.hash === SETTINGS_HASH);
    syncWithHash();
    window.addEventListener("hashchange", syncWithHash);
    return () => window.removeEventListener("hashchange", syncWithHash);
  }, []);

  useEffect(() => {
    if (open && section === "Account") setAccountName(name ?? "");
  }, [name, open, section]);

  const updateName = async () => {
    setAccountSaving(true);
    setAccountError("");
    setAccountResult("");

    try {
      await saveName(accountName);
      setAccountName(accountName.trim());
      setAccountResult("Name saved.");
    } catch (saveError) {
      setAccountError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save your name.",
      );
    } finally {
      setAccountSaving(false);
    }
  };

  const closeSettings = () => {
    const url = new URL(window.location.href);
    url.hash = "";
    window.history.replaceState(window.history.state, "", url);
    setBulkAction(null);
    setDeleteAccountOpen(false);
    setOpen(false);
  };

  const runBulkThreadAction = async () => {
    if (!bulkAction) return;

    setBulkLoading(true);
    setBulkError("");
    setBulkResult("");

    try {
      const response = await fetch("/api/threads", {
        method: bulkAction === "archive" ? "PATCH" : "DELETE",
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        archivedCount?: number;
        deletedCount?: number;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not update chats.");
      }

      await aui.threads().reload();
      if (pathname.startsWith("/chat/")) {
        await aui.threads().switchToNewThread();
        router.replace("/chat#settings");
      }

      const count =
        bulkAction === "archive"
          ? (data.archivedCount ?? 0)
          : (data.deletedCount ?? 0);
      setBulkResult(
        bulkAction === "archive"
          ? `Archived ${count} chat${count === 1 ? "" : "s"}.`
          : `Deleted ${count} chat${count === 1 ? "" : "s"}.`,
      );
      setBulkAction(null);
    } catch (bulkActionError) {
      setBulkError(
        bulkActionError instanceof Error
          ? bulkActionError.message
          : "Could not update chats.",
      );
    } finally {
      setBulkLoading(false);
    }
  };

  const deleteAccount = async () => {
    setAccountDeleting(true);
    setAccountDeleteError("");

    try {
      const response = await fetch("/api/account", { method: "DELETE" });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not delete your account.");
      }

      await createClient().auth.signOut({ scope: "local" }).catch(() => null);
      window.location.assign("/auth/login");
    } catch (deleteError) {
      setAccountDeleteError(
        deleteError instanceof Error
          ? deleteError.message
          : "Could not delete your account.",
      );
      setAccountDeleting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeSettings();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="sr-only">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage your Talk2BI account and preferences.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-[30rem] flex-col sm:grid sm:grid-cols-[12rem_minmax(0,1fr)]">
          <aside className="border-b bg-muted/20 p-3 sm:border-r sm:border-b-0 sm:p-4">
            <h2 className="mb-3 px-2 text-base font-semibold">Settings</h2>
            <nav
              className="flex gap-1 overflow-x-auto sm:flex-col"
              aria-label="Settings sections"
            >
              {settingsSections.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSection(item)}
                  className={cn(
                    "shrink-0 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted hover:text-foreground",
                    section === item
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {item}
                </button>
              ))}
            </nav>
          </aside>

          <div className="min-h-0 overflow-y-auto p-5 sm:p-6">
            <h2 className="pr-8 text-lg font-semibold">{section}</h2>
            <div className="my-4 h-px bg-border" />

            {section === "General" ? (
              <section className="space-y-3">
                <div className="flex flex-col justify-between gap-4 rounded-lg border p-4 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-sm font-medium">Appearance</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Choose how Talk2BI looks on this device.
                    </p>
                  </div>
                  <div
                    className="flex rounded-lg border bg-muted/20 p-1"
                    role="radiogroup"
                    aria-label="Appearance"
                  >
                    {[
                      { value: "light", label: "Light", icon: SunIcon },
                      { value: "dark", label: "Dark", icon: MoonIcon },
                      { value: "system", label: "System", icon: LaptopIcon },
                    ].map((option) => {
                      const Icon = option.icon;
                      const selected = (theme ?? "system") === option.value;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setTheme(option.value)}
                          className={cn(
                            "relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                            selected
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Icon className="size-3.5" />
                          {option.label}
                          {selected ? (
                            <CheckIcon className="size-3" aria-hidden="true" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            ) : section === "Data Controls" ? (
              <section className="space-y-4">
                {bulkResult ? (
                  <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                    {bulkResult}
                  </p>
                ) : null}
                {bulkError ? (
                  <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {bulkError}
                  </p>
                ) : null}

                <div className="flex flex-col justify-between gap-4 rounded-lg border p-4 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-sm font-medium">Archive all chats</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Move every active chat out of the sidebar without deleting its messages.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="shrink-0"
                    onClick={() => {
                      setBulkAction("archive");
                      setBulkError("");
                      setBulkResult("");
                    }}
                    disabled={bulkLoading}
                  >
                    <ArchiveIcon />
                    Archive all
                  </Button>
                </div>

                <div className="flex flex-col justify-between gap-4 rounded-lg border border-destructive/30 p-4 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-sm font-medium">Delete all chats</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Permanently delete every chat and all of its messages. This cannot be undone.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    className="shrink-0"
                    onClick={() => {
                      setBulkAction("delete");
                      setBulkError("");
                      setBulkResult("");
                    }}
                    disabled={bulkLoading}
                  >
                    <Trash2Icon />
                    Delete all
                  </Button>
                </div>

                {bulkAction ? (
                  <div
                    className={cn(
                      "rounded-lg border p-4",
                      bulkAction === "delete"
                        ? "border-destructive/40 bg-destructive/5"
                        : "bg-muted/20",
                    )}
                    role="alert"
                  >
                    <h3 className="text-sm font-semibold">
                      {bulkAction === "archive"
                        ? "Archive all chats?"
                        : "Permanently delete all chats?"}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {bulkAction === "archive"
                        ? "All active chats will be removed from the sidebar, but their messages will remain stored."
                        : "Every active and archived chat, together with every message, will be permanently removed."}
                    </p>
                    <div className="mt-4 flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setBulkAction(null)}
                        disabled={bulkLoading}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant={
                          bulkAction === "delete" ? "destructive" : "default"
                        }
                        size="sm"
                        onClick={() => void runBulkThreadAction()}
                        disabled={bulkLoading}
                      >
                        {bulkLoading ? (
                          <Loader2Icon className="animate-spin" />
                        ) : bulkAction === "archive" ? (
                          <ArchiveIcon />
                        ) : (
                          <Trash2Icon />
                        )}
                        {bulkAction === "archive"
                          ? "Confirm archive"
                          : "Confirm deletion"}
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="h-px bg-border" />

                <div className="flex flex-col justify-between gap-4 rounded-lg border border-destructive/40 p-4 sm:flex-row sm:items-center">
                  <div>
                    <h3 className="text-sm font-medium">Delete account</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Permanently delete your account, every chat and thread,
                      and your account settings.
                    </p>
                  </div>
                  <Button
                    variant="destructive"
                    className="shrink-0"
                    onClick={() => {
                      setDeleteAccountOpen(true);
                      setAccountDeleteError("");
                    }}
                    disabled={accountDeleting}
                  >
                    <Trash2Icon />
                    Delete account
                  </Button>
                </div>

                {deleteAccountOpen ? (
                  <div
                    className="rounded-lg border border-destructive/50 bg-destructive/5 p-4"
                    role="alert"
                  >
                    <h3 className="text-sm font-semibold">
                      Permanently delete your account?
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      This deletes your account, all active and archived chats,
                      and every message. This cannot be undone.
                    </p>
                    {accountDeleteError ? (
                      <p className="mt-3 text-xs text-destructive">
                        {accountDeleteError}
                      </p>
                    ) : null}
                    <div className="mt-4 flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDeleteAccountOpen(false)}
                        disabled={accountDeleting}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => void deleteAccount()}
                        disabled={accountDeleting}
                      >
                        {accountDeleting ? (
                          <Loader2Icon className="animate-spin" />
                        ) : (
                          <Trash2Icon />
                        )}
                        Confirm account deletion
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            ) : section === "Account" ? (
              <section className="space-y-4">
                <form
                  className="rounded-lg border p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void updateName();
                  }}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                    <div className="min-w-0 flex-1 space-y-2">
                      <label
                        htmlFor="account-name"
                        className="text-sm font-medium"
                      >
                        Name
                      </label>
                      <Input
                        id="account-name"
                        name="name"
                        autoComplete="name"
                        maxLength={80}
                        value={accountName}
                        onChange={(event) => {
                          setAccountName(event.target.value);
                          setAccountError("");
                          setAccountResult("");
                        }}
                        disabled={profileLoading || accountSaving}
                        placeholder={
                          profileLoading ? "Loading..." : "Your name"
                        }
                        aria-describedby="account-name-status"
                      />
                    </div>
                    <Button
                      type="submit"
                      className="shrink-0"
                      disabled={
                        profileLoading ||
                        accountSaving ||
                        !accountName.trim() ||
                        accountName.trim() === (name ?? "")
                      }
                    >
                      {accountSaving ? (
                        <Loader2Icon className="animate-spin" />
                      ) : null}
                      Save
                    </Button>
                  </div>
                  <div id="account-name-status" className="mt-2 min-h-4">
                    {accountError || profileError ? (
                      <p className="text-xs text-destructive">
                        {accountError || profileError}
                      </p>
                    ) : accountResult ? (
                      <p className="text-xs text-emerald-700 dark:text-emerald-300">
                        {accountResult}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        This name appears in the sidebar and new chats.
                      </p>
                    )}
                  </div>
                </form>
              </section>
            ) : (
              <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                More {section.toLowerCase()} settings will be added here.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
