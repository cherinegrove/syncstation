import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, Users, Video, RefreshCw, ChevronRight, AlertCircle, Link2, Copy, Check } from "lucide-react";
import { format, isToday, isTomorrow, isThisWeek, startOfDay } from "date-fns";

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  isAllDay: boolean;
  hangoutLink: string | null;
  conferenceUrl: string | null;
  location: string | null;
  attendeeCount: number;
  calendarName: string;
  connectionId: string;
  status: string;
}

interface GroupedEvents {
  label: string;
  date: Date;
  events: CalendarEvent[];
}

function getDayLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  if (isThisWeek(date)) return format(date, "EEEE");
  return format(date, "EEE, MMM d");
}

function getMeetingUrl(event: CalendarEvent): string | null {
  return event.hangoutLink || event.conferenceUrl || null;
}

function getMeetingPlatform(event: CalendarEvent): string | null {
  const url = getMeetingUrl(event);
  if (!url) return null;
  if (url.includes("meet.google.com")) return "Google Meet";
  if (url.includes("zoom.us")) return "Zoom";
  if (url.includes("teams.microsoft.com")) return "Teams";
  if (url.includes("webex.com")) return "Webex";
  return "Video Call";
}

interface CalendarAvailabilityProps {
  hasConnections: boolean;
  onConnectCalendar: () => void;
  availabilityToken?: string | null;
  hideHeader?: boolean;
}

export const CalendarAvailability = ({ hasConnections, onConnectCalendar, availabilityToken, hideHeader }: CalendarAvailabilityProps) => {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [daysAhead, setDaysAhead] = useState(7);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);

  // Always use the published/production URL so the link doesn't show the Lovable preview domain
  const PUBLISHED_URL = "https://app.vribble.ai";
  const shareableUrl = availabilityToken
    ? `${PUBLISHED_URL}/availability/${availabilityToken}`
    : null;

  const handleCopyLink = async () => {
    if (!shareableUrl) return;
    await navigator.clipboard.writeText(shareableUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fetchEvents = async () => {
    if (!hasConnections) return;
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/calendar-availability`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ daysAhead }),
        }
      );

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to fetch events");

      setEvents(data.events || []);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calendar events");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [hasConnections, daysAhead]);

  // Group events by day
  const eventsByDay = new Map<string, { label: string; date: Date; events: CalendarEvent[] }>();
  for (const event of events) {
    const eventDate = startOfDay(new Date(event.start));
    const key = eventDate.toDateString();
    if (!eventsByDay.has(key)) {
      eventsByDay.set(key, { label: getDayLabel(eventDate), date: eventDate, events: [] });
    }
    eventsByDay.get(key)!.events.push(event);
  }
  const sortedGroups = Array.from(eventsByDay.values()).sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );

  if (!hasConnections) {
    return (
      <Card className="glass border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Calendar className="w-5 h-5 text-primary" />
            Upcoming Availability
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-10 space-y-3">
            <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mx-auto">
              <Calendar className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">Connect a calendar to see your upcoming meetings</p>
            <Button size="sm" variant="outline" onClick={onConnectCalendar} className="gap-2 border-primary/30 hover:bg-primary/10">
              <Calendar className="w-4 h-4 text-primary" />
              Connect Calendar
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass border-border/50">
      {!hideHeader && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Calendar className="w-5 h-5 text-primary" />
              Upcoming Availability
            </CardTitle>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-border/50 overflow-hidden text-xs">
                {[3, 7, 14].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDaysAhead(d)}
                    className={`px-2.5 py-1.5 transition-colors ${
                      daysAhead === d
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:bg-secondary/50"
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={fetchEvents}
                disabled={loading}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between">
            {lastRefreshed && (
              <p className="text-xs text-muted-foreground">
                Updated {format(lastRefreshed, "h:mm a")}
              </p>
            )}
            {shareableUrl && (
              <button
                onClick={handleCopyLink}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors ml-auto"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-primary" />
                    <span className="text-primary">Link copied!</span>
                  </>
                ) : (
                  <>
                    <Link2 className="w-3.5 h-3.5" />
                    Share availability link
                  </>
                )}
              </button>
            )}
          </div>
        </CardHeader>
      )}
      {hideHeader && (
        <div className="flex items-center justify-between px-6 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-border/50 overflow-hidden text-xs">
              {[3, 7, 14].map((d) => (
                <button
                  key={d}
                  onClick={() => setDaysAhead(d)}
                  className={`px-2.5 py-1.5 transition-colors ${
                    daysAhead === d
                      ? "bg-primary/20 text-primary"
                      : "text-muted-foreground hover:bg-secondary/50"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={fetchEvents} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <div className="flex items-center gap-3">
            {lastRefreshed && <p className="text-xs text-muted-foreground">Updated {format(lastRefreshed, "h:mm a")}</p>}
            {shareableUrl && (
              <button onClick={handleCopyLink} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors">
                {copied ? <><Check className="w-3.5 h-3.5 text-primary" /><span className="text-primary">Link copied!</span></> : <><Link2 className="w-3.5 h-3.5" />Share availability link</>}
              </button>
            )}
          </div>
        </div>
      )}
      <CardContent>
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 rounded-lg p-3 mb-4">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {loading && !events.length ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 rounded-lg bg-secondary/20 animate-pulse" />
            ))}
          </div>
        ) : sortedGroups.length === 0 ? (
          <div className="text-center py-10 space-y-2">
            <div className="w-12 h-12 rounded-full bg-secondary/50 flex items-center justify-center mx-auto">
              <Clock className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium text-foreground">No upcoming events</p>
            <p className="text-xs text-muted-foreground">Your calendar is clear for the next {daysAhead} days</p>
          </div>
        ) : (
          <div className="space-y-5">
            {sortedGroups.map((group) => (
              <div key={group.date.toDateString()}>
                {/* Day header */}
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-xs font-semibold ${isToday(group.date) ? "text-primary" : "text-muted-foreground"}`}>
                    {group.label}
                  </span>
                  {isToday(group.date) && (
                    <span className="text-xs text-muted-foreground">· {format(new Date(), "MMMM d")}</span>
                  )}
                  <div className="flex-1 h-px bg-border/40" />
                  <span className="text-xs text-muted-foreground">{group.events.length} event{group.events.length !== 1 ? "s" : ""}</span>
                </div>

                <div className="space-y-1.5">
                  {group.events.map((event) => {
                    const meetingUrl = getMeetingUrl(event);
                    const platform = getMeetingPlatform(event);
                    const startTime = event.isAllDay ? null : new Date(event.start);
                    const endTime = event.isAllDay ? null : new Date(event.end);

                    return (
                      <div
                        key={event.id}
                        className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                          meetingUrl
                            ? "border-primary/20 bg-primary/5 hover:border-primary/40"
                            : "border-border/40 bg-secondary/20 hover:border-border/60"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-1 h-10 rounded-full shrink-0 ${meetingUrl ? "bg-primary" : "bg-border"}`} />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{event.title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {event.isAllDay ? (
                                <span className="text-xs text-muted-foreground">All day</span>
                              ) : startTime && endTime ? (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {format(startTime, "h:mm a")} – {format(endTime, "h:mm a")}
                                </span>
                              ) : null}
                              {event.attendeeCount > 0 && (
                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Users className="w-3 h-3" />
                                  {event.attendeeCount}
                                </span>
                              )}
                              {platform && (
                                <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4 font-normal">
                                  <Video className="w-2.5 h-2.5 mr-1" />
                                  {platform}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        {meetingUrl && (
                          <a
                            href={meetingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="shrink-0 ml-2"
                          >
                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-primary/30 hover:bg-primary/10">
                              Join
                              <ChevronRight className="w-3 h-3" />
                            </Button>
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
