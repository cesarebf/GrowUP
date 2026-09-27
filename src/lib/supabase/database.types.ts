// Minimal contract for the checked-in migration. Regenerate from the project
// with the Supabase CLI after applying migrations; do not add speculative tables.
export type Database = {
  public: {
    Tables: {
      private_profiles: {
        Row: { user_id: string; display_name: string | null; created_at: string };
        Insert: { user_id: string; display_name?: string | null; created_at?: string };
        Update: { display_name?: string | null };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_private_profile_owner: { Args: { profile_user_id: string }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
