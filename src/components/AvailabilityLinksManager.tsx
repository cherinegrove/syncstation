import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Link2, Plus, Trash2, Copy, Check, Settings, Clock, Calendar, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const TIMEZONES = [
  { value: "Pacific/Auckland", label: "Auckland (UTC+12)" },
  { value: "Australia/Sydney", label: "Sydney (UTC+10/11)" },
  { value: "Asia/Tokyo", label: "Tokyo (UTC+9)" },
  { value: "Asia/Singapore", label: "Singapore (UTC+8)" },
  { value: "Asia/Kolkata", label: "Mumbai (UTC+5:30)" },
  { value: "Asia/Dubai", label: "Dubai (UTC+4)" },
  { value: "Europe/Moscow", label: "Moscow (UTC+3)" },
  { value: "Europe/Helsinki", label: "Helsinki (UTC+2/3)" },
  { value: "Europe/Paris", label: "Paris/Berlin (UTC+1/2)" },
  { value: "Europe/London", label: "London (UTC+0/1)" },
  { value: "America/Sao_Paulo", label: "São Paulo (UTC-3)" },
  { value: "America/New_York", label: "New York (UTC-5/4)" },
  { value: "America/Chicago", label: "Chicago (UTC-6/5)" },
  { value: "America/Denver", label: "Denver (UTC-7/6)" },
  { value: "America/Los_Angeles", label: "Los Angeles (UTC-8/7)" },
  { value: "Pacific/Honolulu", label: "Honolulu (UTC-10)" },
];

interface AvailabilityLink {
  id: string;
  name: string;
  token: string;
  settings: Record<string, unknown>;
  created_at: string;
}

interface WorkingDay {
  enabled: boolean;
  start: string;
  end: string;
}

interface LinkSettings {
  timezone?: string;
  notice_period_hours?: number;
  buffer_minutes?: number;
  meeting_durations?: number[];
  working_hours?: Record<string, WorkingDay>;
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

const defaultWorkingHours = (): Record<string, WorkingDay> => ({
  monday: { enabled: true, start: "09:00", end: "17:00" },
  tuesday: { enabled: true, start: "09:00", end: "17:00" },
  wednesday: { enabled: true, start: "09:00", end: "17:00" },
  thursday: { enabled: true, start: "09:00", end: "17:00" },
  friday: { enabled: true, start: "09:00", end: "17:00" },
  saturday: { enabled: false, start: "09:00", end: "17:00" },
  sunday: { enabled: false, start: "09:00", end: "17:00" },
});

export function AvailabilityLinksManager({ userId }: { userId: string }) {
  const [links, setLinks] = useState<AvailabilityLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<AvailabilityLink | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const { toast } = useToast();

  // Form state
  const [name, setName] = useState("");
  const [noticePeriod, setNoticePeriod] = useState(2);
  const [bufferMinutes, setBufferMinutes] = useState(15);
  const [selectedDurations, setSelectedDurations] = useState<number[]>([30, 60]);
  const [workingHours, setWorkingHours] = useState<Record<string, WorkingDay>>(defaultWorkingHours());
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadLinks();
  }, [userId]);

  const loadLinks = async () => {
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from("availability_links")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (!error) setLinks((data as AvailabilityLink[]) || []);
    setLoading(false);
  };

  const openCreateDialog = () => {
    setEditingLink(null);
    setName("");
    setNoticePeriod(2);
    setBufferMinutes(15);
    setSelectedDurations([30, 60]);
    setWorkingHours(defaultWorkingHours());
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York");
    setDialogOpen(true);
  };

  const openEditDialog = (link: AvailabilityLink) => {
    setEditingLink(link);
    const s = link.settings as LinkSettings;
    setName(link.name);
    setNoticePeriod(s.notice_period_hours ?? 2);
    setBufferMinutes(s.buffer_minutes ?? 15);
    setSelectedDurations(s.meeting_durations ?? [30, 60]);
    setWorkingHours((s.working_hours as Record<string, WorkingDay>) ?? defaultWorkingHours());
    setTimezone(s.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"));
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "Name required", description: "Please enter a name for this link", variant: "destructive" });
      return;
    }
    setSaving(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settingsPayload: any = {
      timezone,
      notice_period_hours: noticePeriod,
      buffer_minutes: bufferMinutes,
      meeting_durations: selectedDurations,
      working_hours: workingHours,
    };

    try {
      if (editingLink) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from("availability_links") as any)
          .update({ name: name.trim(), settings: settingsPayload })
          .eq("id", editingLink.id);
        if (error) throw error;
        toast({ title: "Link updated", description: `"${name}" has been updated` });
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase.from("availability_links") as any)
          .insert({ user_id: userId, name: name.trim(), settings: settingsPayload });
        if (error) throw error;
        toast({ title: "Link created", description: `"${name}" is ready to share` });
      }
      setDialogOpen(false);
      loadLinks();
    } catch {
      toast({ title: "Error", description: "Failed to save availability link", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, linkName: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from("availability_links").delete().eq("id", id);
    if (!error) {
      toast({ title: "Link deleted", description: `"${linkName}" has been removed` });
      loadLinks();
    }
  };

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/availability/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
    toast({ title: "Copied!", description: "Availability link copied to clipboard" });
  };

  const toggleDuration = (d: number) => {
    setSelectedDurations((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)
    );
  };

  const updateDay = (day: string, field: keyof WorkingDay, value: boolean | string) => {
    setWorkingHours((prev) => ({
      ...prev,
      [day]: { ...prev[day], [field]: value },
    }));
  };

  const timeOptions = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      timeOptions.push(`${hh}:${mm}`);
    }
  }

  return (
    <Card className="glass">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Link2 className="w-5 h-5 text-primary" />
            Custom Availability Links
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={openCreateDialog}
            className="gap-2 border-primary/30 hover:bg-primary/10"
          >
            <Plus className="w-4 h-4" />
            New Link
          </Button>
        </div>
        <CardDescription>
          Create multiple links with different hours, notice periods, or durations — share the right one with each person
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-6 text-muted-foreground text-sm">Loading…</div>
        ) : links.length === 0 ? (
          <div className="text-center py-8 space-y-3">
            <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mx-auto">
              <Link2 className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No custom links yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {links.map((link) => {
              const s = link.settings as LinkSettings;
              const enabledDays = Object.entries(s.working_hours ?? {}).filter(([, d]) => d.enabled).map(([k]) => k.slice(0, 3));
              return (
                <div
                  key={link.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50 gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm text-foreground">{link.name}</p>
                      {s.notice_period_hours !== undefined && (
                        <Badge variant="secondary" className="text-xs gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {s.notice_period_hours}h notice
                        </Badge>
                      )}
                      {s.meeting_durations && (
                        <Badge variant="secondary" className="text-xs">
                          {s.meeting_durations.join(", ")}min
                        </Badge>
                      )}
                    </div>
                    {enabledDays.length > 0 && (
                      <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                        {enabledDays.join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => openEditDialog(link)}
                    >
                      <Settings className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-primary"
                      onClick={() => copyLink(link.token)}
                    >
                      {copiedToken === link.token ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(link.id, link.name)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingLink ? "Edit Availability Link" : "Create Availability Link"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-2">
            {/* Name */}
            <div className="space-y-2">
              <Label>Link Name</Label>
              <Input
                placeholder="e.g. VIP Clients, After Hours, 30-min only"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Timezone */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-muted-foreground" />
                Timezone
              </Label>
              <Select value={timezone} onValueChange={setTimezone}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-48">
                  {TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                Minimum Notice Period
              </Label>
              <Select value={String(noticePeriod)} onValueChange={(v) => setNoticePeriod(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 4, 6, 12, 24, 48].map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {h === 0 ? "No minimum" : `${h} hour${h > 1 ? "s" : ""}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Buffer */}
            <div className="space-y-2">
              <Label>Buffer Between Meetings</Label>
              <Select value={String(bufferMinutes)} onValueChange={(v) => setBufferMinutes(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[0, 5, 10, 15, 20, 30, 45, 60].map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {m === 0 ? "No buffer" : `${m} minutes`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Meeting durations */}
            <div className="space-y-2">
              <Label>Available Meeting Durations</Label>
              <div className="flex flex-wrap gap-2">
                {DURATION_OPTIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDuration(d)}
                    className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                      selectedDurations.includes(d)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-secondary/50 text-muted-foreground border-border/50 hover:border-primary/50"
                    }`}
                  >
                    {d}m
                  </button>
                ))}
              </div>
            </div>

            {/* Working Hours */}
            <div className="space-y-3">
              <Label className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                Working Hours
              </Label>
              <div className="space-y-2 rounded-lg border border-border/50 p-3 bg-secondary/20">
                {DAYS.map((day) => {
                  const d = workingHours[day] ?? { enabled: false, start: "09:00", end: "17:00" };
                  return (
                    <div key={day} className="flex items-center gap-3">
                      <Switch
                        checked={d.enabled}
                        onCheckedChange={(v) => updateDay(day, "enabled", v)}
                      />
                      <span className={`w-24 text-sm capitalize ${d.enabled ? "text-foreground" : "text-muted-foreground"}`}>
                        {day}
                      </span>
                      {d.enabled ? (
                        <div className="flex items-center gap-2 flex-1">
                          <Select value={d.start} onValueChange={(v) => updateDay(day, "start", v)}>
                            <SelectTrigger className="h-7 text-xs flex-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-48">
                              {timeOptions.map((t) => (
                                <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span className="text-xs text-muted-foreground">to</span>
                          <Select value={d.end} onValueChange={(v) => updateDay(day, "end", v)}>
                            <SelectTrigger className="h-7 text-xs flex-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="max-h-48">
                              {timeOptions.map((t) => (
                                <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic flex-1">Unavailable</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving} className="flex-1">
                {saving ? "Saving…" : editingLink ? "Save Changes" : "Create Link"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
