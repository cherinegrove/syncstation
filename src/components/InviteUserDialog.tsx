import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, Mail, Loader2, ShieldCheck, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface InviteUserDialogProps {
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

export function InviteUserDialog({ trigger, onSuccess }: InviteUserDialogProps) {
  const [open, setOpen] = useState(false);
  const [emailsInput, setEmailsInput] = useState("");
  const [role, setRole] = useState<"member" | "admin">("member");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const parseEmails = (input: string): string[] => {
    return input
      .split(/[\s,;\n]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@"));
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();

    const emails = parseEmails(emailsInput);
    if (emails.length === 0) {
      toast({ title: "No valid emails", description: "Enter one or more email addresses", variant: "destructive" });
      return;
    }

    setLoading(true);
    const results: { email: string; success: boolean; error?: string }[] = [];

    for (const email of emails) {
      try {
        const { data, error } = await supabase.functions.invoke("send-invitation", {
          body: { email, role },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        results.push({ email, success: true });
      } catch (err: any) {
        results.push({ email, success: false, error: err.message });
      }
    }

    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    if (succeeded.length > 0) {
      toast({
        title: succeeded.length === 1 ? "Invitation sent!" : `${succeeded.length} invitations sent!`,
        description:
          succeeded.length === 1
            ? `Invite sent to ${succeeded[0].email}`
            : succeeded.map((r) => r.email).join(", "),
      });
    }
    if (failed.length > 0) {
      toast({
        title: `${failed.length} invite(s) failed`,
        description: failed.map((r) => `${r.email}: ${r.error}`).join("\n"),
        variant: "destructive",
      });
    }

    if (succeeded.length > 0) {
      setEmailsInput("");
      setRole("member");
      setOpen(false);
      onSuccess?.();
    }

    setLoading(false);
  };

  const emailCount = parseEmails(emailsInput).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-2">
            <UserPlus className="h-4 w-4" />
            Invite Member
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-primary" />
            Invite to vribble.ai
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleInvite} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="emails">Email Addresses</Label>
            <Textarea
              id="emails"
              placeholder={"colleague@example.com\nanother@example.com\nor separate with commas"}
              value={emailsInput}
              onChange={(e) => setEmailsInput(e.target.value)}
              disabled={loading}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              {emailCount > 0
                ? `${emailCount} email${emailCount > 1 ? "s" : ""} detected — separate with commas, spaces, or new lines`
                : "Enter one or more emails, separated by commas or new lines"}
            </p>
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as "member" | "admin")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    <div>
                      <p className="font-medium">Member</p>
                      <p className="text-xs text-muted-foreground">Standard access</p>
                    </div>
                  </div>
                </SelectItem>
                <SelectItem value="admin">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-primary" />
                    <div>
                      <p className="font-medium">Admin</p>
                      <p className="text-xs text-muted-foreground">Can manage team & roles</p>
                    </div>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || emailCount === 0}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 h-4 w-4" />
                  {emailCount > 1 ? `Send ${emailCount} Invites` : "Send Invitation"}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
