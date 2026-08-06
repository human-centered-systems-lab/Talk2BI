"use client";

import type { User } from "@supabase/supabase-js";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";

type ProfileContextValue = {
  authenticated: boolean;
  email: string | null;
  error: string;
  loading: boolean;
  name: string | null;
  saveName: (name: string) => Promise<void>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const activeLoad = useRef(0);
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState("");

  const loadProfile = useCallback(
    async (user: User | null) => {
      const loadId = ++activeLoad.current;
      setAuthenticated(Boolean(user));
      setEmail(user?.email ?? null);
      setError("");

      if (!user) {
        setName(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error: profileError } = await supabase
        .from("user_settings")
        .select("name")
        .eq("user_id", user.id)
        .maybeSingle();

      if (loadId !== activeLoad.current) return;

      if (profileError) {
        setName(null);
        setError("Could not load your profile.");
      } else {
        setName(data?.name?.trim() || null);
      }
      setLoading(false);
    },
    [supabase],
  );

  useEffect(() => {
    let active = true;

    supabase.auth.getUser().then(({ data }) => {
      if (active) void loadProfile(data.user);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) void loadProfile(session?.user ?? null);
    });

    return () => {
      active = false;
      activeLoad.current += 1;
      subscription.unsubscribe();
    };
  }, [loadProfile, supabase]);

  const saveName = useCallback(
    async (nextName: string) => {
      const normalizedName = nextName.trim();
      if (!normalizedName) throw new Error("Enter a name.");
      if (normalizedName.length > 80) {
        throw new Error("Name must be 80 characters or fewer.");
      }

      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (authError || !user) throw new Error("You are not signed in.");

      const { error: profileError } = await supabase
        .from("user_settings")
        .upsert(
          {
            user_id: user.id,
            name: normalizedName,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );

      if (profileError) throw new Error("Could not save your name.");

      setName(normalizedName);
      setError("");
    },
    [supabase],
  );

  return (
    <ProfileContext.Provider
      value={{ authenticated, email, error, loading, name, saveName }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const profile = useContext(ProfileContext);
  if (!profile) {
    throw new Error("useProfile must be used within a ProfileProvider");
  }
  return profile;
}
