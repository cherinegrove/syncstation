import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Users, Plus, Copy, Trash2, Loader2, Link2, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface GroupLink {
  id: string;
  token: string;
  name: string;
  member_ids: string[];
  mode: "all" | "any";
  created_at: string;
}

interface KnownUser {
  id: string;
  email: string;
}

const PUBLISHED_URL = "https://app.vribble.ai";

export function GroupLinksManager({ currentUserId }: { currentUserId: string }) {
  const [groupLinks, setGroupLinks] = useState<GroupLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { toast } = useToast();

  // Form state
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"all" | "any">("all");
  const [knownUsers, setKnownUsers] = useState<KnownUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    loadGroupLinks();
    loadKnownUsers();
  }, []);

  const loadGroupLinks = async () => {
    const { data } = await (supabase as any)
      .from("group_availability_links")
      .select("*")
      .order("created_at", { ascending: false });
    setGroupLinks((data as GroupLink[]) || []);
    setLoading(false);
  };

  const loadKnownUsers = async () => {
    // Load users from accepted invitations (we know their IDs from invitations table)
    const { data: invitations } = await supabase
      .from("invitations")
      .select("email")
      .eq("status", "accepted");

    // Also load all profiles to match emails → user IDs
    // We can get IDs by cross-referencing with auth metadata via profiles
    // The simplest approach: fetch all profiles by token and map via email from invitations
    // Since we only have profile IDs without emails in the profiles table, we'll
    // load profiles for users we can identify — current user + invited users by looking
    // at all accepted invitations from all inviters. We use the service role isn't available
    // client-side, so we load from the invitations the creator invited.
    
    // Fetch invitations sent by anyone that are accepted (via profiles we can see)
    const { data: allInvitations } = await supabase
      .from("invitations")
      .select("email, inviter_id");

    // Build a list of known users: current user + people current user invited
    const users: KnownUser[] = [];
    const seen = new Set<string>();

    // Add self
    const { data: { user } } = await supabase.auth.getUser();
    if (user && !seen.has(user.id)) {
      users.push({ id: user.id, email: user.email || "You" });
      seen.add(user.id);
    }

    // We can't get other users' IDs client-side without an edge function
    // So we'll call a lightweight edge function to list users in the instance
    try {
      const { data: session } = await supabase.auth.getSession();
      if (session.session) {
        const { data, error } = await supabase.functions.invoke("list-users");
        if (!error && data?.users) {
          for (const u of data.users) {
            if (!seen.has(u.id)) {
              users.push({ id: u.id, email: u.email });
              seen.add(u.id);
            }
          }
        }
      }
    } catch (_) {}

    setKnownUsers(users);
    // Pre-select current user
    setSelectedIds(user ? [user.id] : []);
  };

  const toggleMember = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    if (selectedIds.length < 2) {
      toast({ title: "Select at least 2 members", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const { error } = await (supabase as any)
        .from("group_availability_links")
        .insert({
          creator_id: currentUserId,
          name: name.trim(),
          member_ids: selectedIds,
          mode,
        });
      if (error) throw error;
      toast({ title: "Group link created!", description: `"${name}" is ready to share.` });
      setName("");
      setMode("all");
      setSelectedIds(knownUsers.length > 0 ? [currentUserId] : []);
      setDialogOpen(false);
      loadGroupLinks();
    } catch (err: any) {
      toast({ title: "Failed to create", description: err.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (groupLink: GroupLink) => {
    const url = `${PUBLISHED_URL}/group-availability/${groupLink.token}`;
    await navigator.clipboard.writeText(url);
    setCopiedId(groupLink.id);
    toast({ title: "Link copied!", description: "Group availability link copied to clipboard" });
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (id: string) => {
    const { error } = await (supabase as any)
      .from("group_availability_links")
      .delete()
      .eq("id", id);
    if (error) {
      toast({ title: "Failed to delete", variant: "destructive" });
    } else {
      setGroupLinks(prev => prev.filter(g => g.id !== id));
      toast({ title: "Group link deleted" });
    }
  };

  if (loading) {
    return (
      <Card className="glass">
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              Group Availability Links
            </CardTitle>
            <CardDescription className="mt-1">
              Share a combined availability link for your team
            </CardDescription>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 border-primary/30 hover:bg-primary/10">
                <Plus className="w-4 h-4" />
                New Group Link
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-primary" />
                  Create Group Availability Link
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label>Group Name</Label>
                  <Input
                    placeholder="e.g. Sales Team, Design Sync..."
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Availability Mode</Label>
                  <div className="flex rounded-lg border border-border/50 overflow-hidden text-sm">
                    <button
                      onClick={() => setMode("all")}
                      className={`flex-1 px-4 py-2 transition-colors ${mode === "all" ? "bg-primary/20 text-primary font-medium" : "text-muted-foreground hover:bg-secondary/50"}`}
                    >
                      All must be free
                    </button>
                    <button
                      onClick={() => setMode("any")}
                      className={`flex-1 px-4 py-2 transition-colors ${mode === "any" ? "bg-primary/20 text-primary font-medium" : "text-muted-foreground hover:bg-secondary/50"}`}
                    >
                      Any can meet
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {mode === "all"
                      ? "Only show slots where every selected member is free"
                      : "Show slots when at least one member is available"}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Select Members ({selectedIds.length} selected)</Label>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {knownUsers.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-2">
                        No other users found. Invite teammates first.
                      </p>
                    ) : (
                      knownUsers.map(u => (
                        <button
                          key={u.id}
                          onClick={() => toggleMember(u.id)}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors text-left ${
                            selectedIds.includes(u.id)
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border/40 hover:bg-secondary/40 text-foreground"
                          }`}
                        >
                          <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                            {u.email.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-sm truncate">{u.email}</span>
                          {selectedIds.includes(u.id) && <Check className="w-4 h-4 ml-auto shrink-0" />}
                        </button>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                  <Button onClick={handleCreate} disabled={creating}>
                    {creating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Link2 className="w-4 h-4 mr-2" />}
                    Create Link
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {groupLinks.length === 0 ? (
          <div className="text-center py-10 space-y-3">
            <div className="w-14 h-14 rounded-full bg-secondary/50 flex items-center justify-center mx-auto">
              <Users className="w-7 h-7 text-muted-foreground" />
            </div>
            <div>
              <p className="text-foreground font-medium mb-1">No group links yet</p>
              <p className="text-sm text-muted-foreground">
                Create a link to share combined availability with clients
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {groupLinks.map(gl => (
              <div key={gl.id} className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm text-foreground truncate">{gl.name}</span>
                    <Badge className={`text-xs shrink-0 ${gl.mode === "all" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-green-500/20 text-green-400 border-green-500/30"}`}>
                      {gl.mode === "all" ? "All free" : "Any free"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {gl.member_ids.length} member{gl.member_ids.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(gl)}
                    className="gap-1.5 text-xs h-8"
                  >
                    {copiedId === gl.id ? (
                      <Check className="w-3 h-3 text-primary" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    Copy Link
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(gl.id)}
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
