"use client";

import { useEffect, useState, FormEvent } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Profile = {
  full_name: string;
  firm_name: string;
  email: string;
  phone: string;
  address_line: string;
};

const empty: Profile = {
  full_name: "",
  firm_name: "",
  email: "",
  phone: "",
  address_line: "",
};

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profile, setProfile] = useState<Profile>(empty);

  useEffect(() => {
    (async () => {
      try {
        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user;
        if (!user) {
          toast.error("Not signed in");
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from("profiles")
          .select("full_name,firm_name,email,phone,address_line")
          .eq("user_id", user.id)
          .maybeSingle();

        if (error) throw error;

        // If not present, seed from auth user email
        const seeded = {
          ...empty,
          ...(data ?? {}),
          email: (data?.email ?? user.email ?? "").toString(),
        };

        setProfile(seeded);
      } catch (e: any) {
        console.error(e);
        toast.error("Failed to load settings");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);

      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) throw new Error("Not signed in");

      const payload = {
        user_id: user.id,
        full_name: profile.full_name || null,
        firm_name: profile.firm_name || null,
        email: profile.email || null,
        phone: profile.phone || null,
        address_line: profile.address_line || null,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("profiles").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;

      toast.success("Settings saved");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8">Loading…</div>;

  return (
    <div className="p-8 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={onSave}>
            <div>
              <label className="text-sm text-slate-600">Full name</label>
              <input
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={profile.full_name}
                onChange={(e) => setProfile((p) => ({ ...p, full_name: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm text-slate-600">Firm name</label>
              <input
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={profile.firm_name}
                onChange={(e) => setProfile((p) => ({ ...p, firm_name: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm text-slate-600">Email</label>
              <input
                type="email"
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={profile.email}
                onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm text-slate-600">Phone</label>
              <input
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={profile.phone}
                onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-sm text-slate-600">Address line</label>
              <input
                className="w-full border rounded-md px-3 py-2 text-sm"
                value={profile.address_line}
                onChange={(e) => setProfile((p) => ({ ...p, address_line: e.target.value }))}
              />
            </div>

            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
