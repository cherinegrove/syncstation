import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamMembersTab } from "./team/TeamMembersTab";
import { SentInvitationsTab } from "./team/SentInvitationsTab";

export interface TeamMember {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  role: "admin" | "member";
}

export interface Invitation {
  id: string;
  email: string;
  status: string;
  created_at: string;
  expires_at: string;
}

export function InvitationsManager() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingInvitations, setLoadingInvitations] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setCurrentUserId(session.user.id);
    });
  }, []);

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const { data, error } = await supabase.functions.invoke("list-users");
      if (error) throw error;
      setMembers(data?.users || []);
    } catch (err) {
      console.error("Failed to load members:", err);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  const loadInvitations = useCallback(async () => {
    setLoadingInvitations(true);
    try {
      const { data, error } = await supabase
        .from("invitations")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setInvitations(data || []);
    } catch (err) {
      console.error("Failed to load invitations:", err);
    } finally {
      setLoadingInvitations(false);
    }
  }, []);

  useEffect(() => {
    loadMembers();
    loadInvitations();
  }, [loadMembers, loadInvitations]);

  return (
    <Tabs defaultValue="members">
      <TabsList className="w-full mb-4">
        <TabsTrigger value="members" className="flex-1">
          Team Members {!loadingMembers && `(${members.length})`}
        </TabsTrigger>
        <TabsTrigger value="invitations" className="flex-1">
          Sent Invitations {!loadingInvitations && `(${invitations.length})`}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="members">
        <TeamMembersTab
          members={members}
          loading={loadingMembers}
          currentUserId={currentUserId}
          onRefresh={loadMembers}
        />
      </TabsContent>

      <TabsContent value="invitations">
        <SentInvitationsTab
          invitations={invitations}
          loading={loadingInvitations}
          onRefresh={loadInvitations}
        />
      </TabsContent>
    </Tabs>
  );
}
