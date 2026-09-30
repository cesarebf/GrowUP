// Maintained contract for checked-in migrations; baseline compared with hosted
// generated types on 2026-09-29. The request migration is local only. Regenerate
// and compare after its separately authorized rollout. Internal functions with
// revoked client EXECUTE are deliberately absent from this application contract.
import type { CommunityRole, JoinPolicy, Visibility } from "../communities/validation.ts";
import type { CancellationReason, PendingRequest, RequesterMutation, ReviewerMutation, RequestReceipt, RequestStatus } from "../communities/request-validation.ts";

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type CommunityRow = {
  id: string; owner_user_id: string; owner_role: "owner"; name: string; slug: string;
  description: string; visibility: Visibility; join_policy: JoinPolicy;
  created_at: string; updated_at: string;
};
type MembershipRow = {
  community_id: string; user_id: string; role: CommunityRole; created_at: string; updated_at: string;
};
type MembershipRequestRow = {
  id: string; community_id: string; requester_user_id: string; requester_display_name: string;
  status: RequestStatus; created_at: string; resolved_at: string | null;
  resolved_by_user_id: string | null; cancellation_reason: CancellationReason | null;
};
type RequestLocator = { p_community_id: string; p_request_id: string };

export type Database = {
  public: {
    Tables: {
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
        Insert: Pick<MembershipRow, "community_id" | "user_id" | "role"> & Partial<Pick<MembershipRow, "created_at" | "updated_at">>;
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
