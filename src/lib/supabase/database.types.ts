// Maintained contract for checked-in migrations; baseline compared with hosted
// generated types on 2026-09-29. Role management is local only; compare with
// hosted types after separately authorized rollout. Internal functions with
// revoked client EXECUTE are deliberately absent from this application contract.
import type { CommunityRole, JoinPolicy, Visibility } from "../communities/validation.ts";
import type { CancellationReason, PendingRequest, RequesterMutation, ReviewerMutation, RequestReceipt, RequestStatus } from "../communities/request-validation.ts";
import type { InvitationAdmission, InvitationHistory, InvitationPreview, InvitationReceipt } from "../communities/invitation-validation.ts";
import type { CommunityMember, ManagedRole, NameResult, RemovalResult, RoleResult } from "../communities/member-validation.ts";

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type CommunityRow = {
  id: string; owner_user_id: string; owner_role: "owner"; name: string; slug: string;
  description: string; visibility: Visibility; join_policy: JoinPolicy;
  created_at: string; updated_at: string;
};
type MembershipRow = {
  membership_id: string; management_display_name: string | null;
  community_id: string; user_id: string; role: CommunityRole; created_at: string; updated_at: string;
};
type MembershipRequestRow = {
  id: string; community_id: string; requester_user_id: string; requester_display_name: string;
  status: RequestStatus; created_at: string; resolved_at: string | null;
  resolved_by_user_id: string | null; cancellation_reason: CancellationReason | null;
};
type RequestLocator = { p_community_id: string; p_request_id: string };
type MemberLocator = { p_community_id: string; p_membership_id: string };
type ManagementEventRow = {
  id: string; community_id: string; actor_user_id: string; target_user_id: string;
  target_membership_id: string; old_role: ManagedRole; new_role: ManagedRole | null; occurred_at: string;
};
type InvitationRow = {
  id: string; community_id: string; token_hash: string; created_by_user_id: string; created_at: string; expires_at: string;
  accepted_at: string | null; accepted_by_user_id: string | null; revoked_at: string | null; revoked_by_user_id: string | null;
};

export type Database = {
  public: {
    Tables: {
      community_member_management_events: {
        Row: ManagementEventRow;
        Insert: Omit<ManagementEventRow, "id" | "new_role" | "occurred_at"> & Partial<Pick<ManagementEventRow, "id" | "new_role" | "occurred_at">>;
        Update: Partial<ManagementEventRow>;
        Relationships: [{ foreignKeyName: "community_member_management_events_community_id_fkey"; columns: ["community_id"]; isOneToOne: false; referencedRelation: "communities"; referencedColumns: ["id"] }];
      };
      community_invitations: {
        Row: InvitationRow;
        Insert: Pick<InvitationRow, "community_id" | "token_hash" | "created_by_user_id" | "created_at" | "expires_at"> & Partial<InvitationRow>;
        Update: Partial<InvitationRow>;
        Relationships: [{ foreignKeyName: "community_invitations_community_id_fkey"; columns: ["community_id"]; isOneToOne: false; referencedRelation: "communities"; referencedColumns: ["id"] }];
      };
      community_membership_requests: {
        Row: MembershipRequestRow;
        Insert: Pick<MembershipRequestRow, "community_id" | "requester_user_id" | "requester_display_name"> & Partial<Omit<MembershipRequestRow, "community_id" | "requester_user_id" | "requester_display_name">>;
        Update: Partial<MembershipRequestRow>;
        Relationships: [{
          foreignKeyName: "community_membership_requests_community_id_fkey";
          columns: ["community_id"];
          isOneToOne: false;
          referencedRelation: "communities";
          referencedColumns: ["id"];
        }];
      };
      communities: {
        Row: CommunityRow;
        Insert: Pick<CommunityRow, "owner_user_id" | "name" | "slug" | "visibility" | "join_policy"> & Partial<Pick<CommunityRow, "id" | "description" | "created_at" | "updated_at">>;
        Update: Partial<Omit<CommunityRow, "owner_role">>;
        Relationships: [{
          foreignKeyName: "communities_owner_membership_fk";
          columns: ["id", "owner_user_id", "owner_role"];
          isOneToOne: false;
          referencedRelation: "community_memberships";
          referencedColumns: ["community_id", "user_id", "role"];
        }];
      };
      community_memberships: {
        Row: MembershipRow;
        Insert: Pick<MembershipRow, "community_id" | "user_id" | "role"> & Partial<Pick<MembershipRow, "created_at" | "updated_at" | "membership_id" | "management_display_name">>;
        Update: Partial<MembershipRow>;
        Relationships: [{
          foreignKeyName: "community_memberships_community_id_fkey";
          columns: ["community_id"];
          isOneToOne: false;
          referencedRelation: "communities";
          referencedColumns: ["id"];
        }];
      };
      private_profiles: {
        Row: { user_id: string; display_name: string | null; created_at: string };
        Insert: { user_id: string; display_name?: string | null; created_at?: string };
        Update: { display_name?: string | null };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      list_community_members: { Args: { p_community_id: string; p_after_created_at?: string | null; p_after_membership_id?: string | null; p_limit?: number }; Returns: CommunityMember[] };
      set_community_member_role: { Args: MemberLocator & { p_role: ManagedRole }; Returns: RoleResult[] };
      remove_community_member: { Args: MemberLocator; Returns: RemovalResult[] };
      set_my_community_management_name: { Args: MemberLocator & { p_name: string | null }; Returns: NameResult[] };
      create_community_invitation: { Args: { p_community_id: string; p_token_hash: string }; Returns: InvitationReceipt[] };
      list_community_invitations: { Args: { p_community_id: string; p_before_created_at?: string | null; p_before_id?: string | null; p_limit?: number }; Returns: InvitationHistory[] };
      revoke_community_invitation: { Args: { p_community_id: string; p_invitation_id: string }; Returns: InvitationHistory[] };
      get_community_invitation_preview: { Args: { p_token: string }; Returns: InvitationPreview[] };
      accept_community_invitation: { Args: { p_token: string }; Returns: InvitationAdmission[] };
      request_community_membership: { Args: { p_community_id: string; p_display_name: string }; Returns: RequesterMutation[] };
      withdraw_community_membership_request: { Args: RequestLocator; Returns: RequesterMutation[] };
      approve_community_membership_request: { Args: RequestLocator; Returns: ReviewerMutation[] };
      reject_community_membership_request: { Args: RequestLocator; Returns: ReviewerMutation[] };
      get_my_community_membership_requests: {
        Args: { p_community_id?: string | null; p_before_created_at?: string | null; p_before_id?: string | null; p_limit?: number };
        Returns: RequestReceipt[];
      };
      list_community_membership_requests: {
        Args: { p_community_id: string; p_after_created_at?: string | null; p_after_id?: string | null; p_limit?: number };
        Returns: PendingRequest[];
      };
      update_community_settings: { Args: { p_community_id: string; p_settings: Json }; Returns: string };
      join_community: { Args: { p_community_id: string }; Returns: string };
      leave_community: { Args: { p_community_id: string }; Returns: undefined };
      create_community: {
        Args: { p_name: string; p_slug: string; p_description: string; p_visibility: Visibility; p_join_policy: JoinPolicy };
        Returns: string;
      };
      get_community_landing: {
        Args: { p_slug: string };
        Returns: (Pick<CommunityRow, "id" | "name" | "slug" | "description" | "visibility" | "join_policy"> & { viewer_role: CommunityRole | null })[];
      };
      is_private_profile_owner: { Args: { profile_user_id: string }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
