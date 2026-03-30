import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Clock, Save, Loader2, CalendarCheck, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const DAYS = [
  { key: "monday",    label: "Monday" },
  { key: "tuesday",   label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday",  label: "Thursday" },
  { key: "friday",    label: "Friday" },
  { key: "saturday",  label: "Saturday" },
  { key: "sunday",    label: "Sunday" },
] as const;

type DayKey = typeof DAYS[number]["key"];

const TIME_OPTIONS: string[] = [];
for (let h = 0; h < 24; h++) {
  for (const m of [0, 30]) {
    TIME_OPTIONS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
}

function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Common timezone list with friendly labels
const TIMEZONES = [
  { value: "Pacific/Auckland",       label: "Auckland (NZST, UTC+12)" },
  { value: "Australia/Sydney",       label: "Sydney (AEST, UTC+10/11)" },
  { value: "Australia/Brisbane",     label: "Brisbane (AEST, UTC+10)" },
  { value: "Australia/Adelaide",     label: "Adelaide (ACST, UTC+9:30)" },
  { value: "Australia/Perth",        label: "Perth (AWST, UTC+8)" },
  { value: "Asia/Tokyo",             label: "Tokyo (JST, UTC+9)" },
  { value: "Asia/Singapore",         label: "Singapore (SGT, UTC+8)" },
  { value: "Asia/Hong_Kong",         label: "Hong Kong (HKT, UTC+8)" },
  { value: "Asia/Shanghai",          label: "Beijing/Shanghai (CST, UTC+8)" },
  { value: "Asia/Kolkata",           label: "Mumbai/New Delhi (IST, UTC+5:30)" },
  { value: "Asia/Dubai",             label: "Dubai (GST, UTC+4)" },
  { value: "Europe/Moscow",          label: "Moscow (MSK, UTC+3)" },
  { value: "Africa/Nairobi",         label: "Nairobi (EAT, UTC+3)" },
  { value: "Africa/Johannesburg",    label: "Johannesburg (SAST, UTC+2)" },
  { value: "Europe/Helsinki",        label: "Helsinki (EET, UTC+2/3)" },
  { value: "Europe/Paris",           label: "Paris/Berlin/Rome (CET, UTC+1/2)" },
  { value: "Europe/London",          label: "London (GMT/BST, UTC+0/1)" },
  { value: "Atlantic/Reykjavik",     label: "Reykjavik (GMT, UTC+0)" },
  { value: "America/Sao_Paulo",      label: "São Paulo (BRT, UTC-3)" },
  { value: "America/Argentina/Buenos_Aires", label: "Buenos Aires (ART, UTC-3)" },
  { value: "America/Halifax",        label: "Halifax (AST, UTC-4)" },
  { value: "America/New_York",       label: "New York (ET, UTC-5/4)" },
  { value: "America/Chicago",        label: "Chicago (CT, UTC-6/5)" },
  { value: "America/Denver",         label: "Denver (MT, UTC-7/6)" },
  { value: "America/Los_Angeles",    label: "Los Angeles (PT, UTC-8/7)" },
  { value: "America/Anchorage",      label: "Anchorage (AKT, UTC-9/8)" },
  { value: "Pacific/Honolulu",       label: "Honolulu (HST, UTC-10)" },
];

interface DaySettings {
  enabled: boolean;
  start: string;
  end: string;
}

interface AvailabilitySettingsData {
  working_hours: Record<DayKey, DaySettings>;
  meeting_durations: number[];
  notice_period_hours: number;
  buffer_minutes: number;
  timezone: string;
}

const DEFAULT_SETTINGS: AvailabilitySettingsData = {
  working_hours: {
    monday:    { enabled: true,  start: "09:00", end: "17:00" },
    tuesday:   { enabled: true,  start: "09:00", end: "17:00" },
    wednesday: { enabled: true,  start: "09:00", end: "17:00" },
    thursday:  { enabled: true,  start: "09:00", end: "17:00" },
    friday:    { enabled: true,  start: "09:00", end: "17:00" },
    saturday:  { enabled: false, start: "09:00", end: "17:00" },
    sunday:    { enabled: false, start: "09:00", end: "17:00" },
  },
  meeting_durations: [30, 60],
  notice_period_hours: 2,
  buffer_minutes: 15,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
};

const DURATION_OPTIONS = [15, 30, 45, 60];
const NOTICE_OPTIONS = [
  { value: 1,  label: "1 hour" },
  { value: 2,  label: "2 hours" },
  { value: 4,  label: "4 hours" },
  { value: 8,  label: "8 hours" },
  { value: 24, label: "1 day" },
  { value: 48, label: "2 days" },
];
const BUFFER_OPTIONS = [
  { value: 0,  label: "No buffer" },
  { value: 5,  label: "5 min" },
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
];

interface Props {
  userId: string;
}

export function AvailabilitySettings({ userId }: Props) {
  const [settings, setSettings] = useState<AvailabilitySettingsData>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("profiles")
        .select("availability_settings")
        .eq("id", userId)
        .single();

      if (data?.availability_settings) {
        const loaded = data.availability_settings as unknown as AvailabilitySettingsData;
        // Ensure timezone exists for older records
        if (!loaded.timezone) {
          loaded.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        }
        setSettings(loaded);
      }
      setLoading(false);
    };
    load();
  }, [userId]);

  const updateDay = (day: DayKey, field: keyof DaySettings, value: boolean | string) => {
    setSettings((prev) => ({
      ...prev,
      working_hours: {
        ...prev.working_hours,
        [day]: { ...prev.working_hours[day], [field]: value },
      },
    }));
  };

  const toggleDuration = (d: number) => {
    setSettings((prev) => {
      const exists = prev.meeting_durations.includes(d);
      const next = exists
        ? prev.meeting_durations.filter((x) => x !== d)
        : [...prev.meeting_durations, d].sort((a, b) => a - b);
      if (next.length === 0) return prev;
      return { ...prev, meeting_durations: next };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ availability_settings: settings as unknown as import("@/integrations/supabase/types").Json })
        .eq("id", userId);

      if (error) throw error;
      toast({ title: "Availability settings saved" });
    } catch {
      toast({ title: "Failed to save settings", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card className="glass border-border/50">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass border-border/50">
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2">
          <CalendarCheck className="w-5 h-5 text-primary" />
          Availability Settings
        </CardTitle>
        <CardDescription>
          Set your working hours and meeting preferences for your public availability link
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Timezone */}
        <div>
          <p className="text-sm font-medium text-foreground mb-1 flex items-center gap-1.5">
            <Globe className="w-4 h-4 text-muted-foreground" />
            Timezone
          </p>
          <p className="text-xs text-muted-foreground mb-2">Your working hours are in this timezone</p>
          <Select
            value={settings.timezone}
            onValueChange={(v) => setSettings((p) => ({ ...p, timezone: v }))}
          >
            <SelectTrigger className="bg-background/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Working Hours */}
        <div>
          <p className="text-sm font-medium text-foreground mb-3 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-muted-foreground" />
            Working Hours
          </p>
          <div className="space-y-2">
            {DAYS.map(({ key, label }) => {
              const day = settings.working_hours[key];
              return (
                <div
                  key={key}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border transition-colors ${
                    day.enabled ? "border-border/50 bg-secondary/20" : "border-border/20 bg-secondary/5 opacity-60"
                  }`}
                >
                  <Switch
                    checked={day.enabled}
                    onCheckedChange={(v) => updateDay(key, "enabled", v)}
                    className="shrink-0"
                  />
                  <span className="text-sm w-24 shrink-0 text-foreground">{label}</span>
                  <div className="flex items-center gap-2 flex-1">
                    <Select
                      value={day.start}
                      onValueChange={(v) => updateDay(key, "start", v)}
                      disabled={!day.enabled}
                    >
                      <SelectTrigger className="h-8 text-xs bg-background/50 flex-1">
                        <SelectValue>{formatTime(day.start)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {TIME_OPTIONS.map((t) => (
                          <SelectItem key={t} value={t}>{formatTime(t)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground shrink-0">to</span>
                    <Select
                      value={day.end}
                      onValueChange={(v) => updateDay(key, "end", v)}
                      disabled={!day.enabled}
                    >
                      <SelectTrigger className="h-8 text-xs bg-background/50 flex-1">
                        <SelectValue>{formatTime(day.end)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {TIME_OPTIONS.map((t) => (
                          <SelectItem key={t} value={t}>{formatTime(t)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Meeting Durations */}
        <div>
          <p className="text-sm font-medium text-foreground mb-2">Meeting Durations</p>
          <p className="text-xs text-muted-foreground mb-3">Which slot lengths to offer on your availability page</p>
          <div className="flex gap-2 flex-wrap">
            {DURATION_OPTIONS.map((d) => {
              const active = settings.meeting_durations.includes(d);
              return (
                <button
                  key={d}
                  onClick={() => toggleDuration(d)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    active
                      ? "bg-primary/20 border-primary/50 text-primary"
                      : "border-border/40 text-muted-foreground hover:border-border/60 hover:bg-secondary/30"
                  }`}
                >
                  {d} min
                </button>
              );
            })}
          </div>
        </div>

        {/* Notice Period & Buffer */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-medium text-foreground mb-1">Notice Period</p>
            <p className="text-xs text-muted-foreground mb-2">Minimum time before a booking</p>
            <Select
              value={String(settings.notice_period_hours)}
              onValueChange={(v) => setSettings((p) => ({ ...p, notice_period_hours: Number(v) }))}
            >
              <SelectTrigger className="bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NOTICE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground mb-1">Buffer Between Meetings</p>
            <p className="text-xs text-muted-foreground mb-2">Gap required between slots</p>
            <Select
              value={String(settings.buffer_minutes)}
              onValueChange={(v) => setSettings((p) => ({ ...p, buffer_minutes: Number(v) }))}
            >
              <SelectTrigger className="bg-background/50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUFFER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Availability Settings
        </Button>
      </CardContent>
    </Card>
  );
}
