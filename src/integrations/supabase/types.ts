export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      companions: {
        Row: {
          age: number
          base_personality: string
          created_at: string
          ethnicity: string
          gender: string
          id: string
          image_url: string
          name: string
          orientation: string
          short_bio: string
          sort_order: number
          video_url: string | null
        }
        Insert: {
          age: number
          base_personality: string
          created_at?: string
          ethnicity: string
          gender?: string
          id?: string
          image_url: string
          name: string
          orientation?: string
          short_bio: string
          sort_order?: number
          video_url?: string | null
        }
        Update: {
          age?: number
          base_personality?: string
          created_at?: string
          ethnicity?: string
          gender?: string
          id?: string
          image_url?: string
          name?: string
          orientation?: string
          short_bio?: string
          sort_order?: number
          video_url?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          created_at: string
          id: string
          memory: string
          personality_id: string
          relationship_level: number
          relationship_xp: number
          scenario: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          memory?: string
          personality_id: string
          relationship_level?: number
          relationship_xp?: number
          scenario?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          memory?: string
          personality_id?: string
          relationship_level?: number
          relationship_xp?: number
          scenario?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_personality_id_fkey"
            columns: ["personality_id"]
            isOneToOne: false
            referencedRelation: "user_personalities"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_balances: {
        Row: {
          free_messages_remaining: number
          paid_credits: number
          updated_at: string
          user_id: string
        }
        Insert: {
          free_messages_remaining?: number
          paid_credits?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          free_messages_remaining?: number
          paid_credits?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          kind: string
          media_url: string | null
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          kind?: string
          media_url?: string | null
          role: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          kind?: string
          media_url?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age_confirmed: boolean
          authnet_subscription_id: string | null
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          subscription_id: string | null
          subscription_renews_at: string | null
          subscription_status: string | null
          subscription_tier: string | null
          updated_at: string
        }
        Insert: {
          age_confirmed?: boolean
          authnet_subscription_id?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          subscription_id?: string | null
          subscription_renews_at?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          updated_at?: string
        }
        Update: {
          age_confirmed?: boolean
          authnet_subscription_id?: string | null
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          subscription_id?: string | null
          subscription_renews_at?: string | null
          subscription_status?: string | null
          subscription_tier?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      subscription_events: {
        Row: {
          amount_cents: number | null
          authnet_subscription_id: string | null
          authnet_transaction_id: string | null
          created_at: string
          credits_granted: number | null
          event_type: string
          id: string
          raw_payload: Json | null
          user_id: string | null
        }
        Insert: {
          amount_cents?: number | null
          authnet_subscription_id?: string | null
          authnet_transaction_id?: string | null
          created_at?: string
          credits_granted?: number | null
          event_type: string
          id?: string
          raw_payload?: Json | null
          user_id?: string | null
        }
        Update: {
          amount_cents?: number | null
          authnet_subscription_id?: string | null
          authnet_transaction_id?: string | null
          created_at?: string
          credits_granted?: number | null
          event_type?: string
          id?: string
          raw_payload?: Json | null
          user_id?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount_cents: number
          authnet_transaction_id: string | null
          created_at: string
          credits_added: number
          id: string
          pack_name: string
          status: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          authnet_transaction_id?: string | null
          created_at?: string
          credits_added: number
          id?: string
          pack_name: string
          status?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          authnet_transaction_id?: string | null
          created_at?: string
          credits_added?: number
          id?: string
          pack_name?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      user_personalities: {
        Row: {
          boundaries: string | null
          companion_id: string
          created_at: string
          id: string
          identity: string | null
          interests: string | null
          nickname: string
          personality_traits: string | null
          style_backstory: string | null
          tone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          boundaries?: string | null
          companion_id: string
          created_at?: string
          id?: string
          identity?: string | null
          interests?: string | null
          nickname: string
          personality_traits?: string | null
          style_backstory?: string | null
          tone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          boundaries?: string | null
          companion_id?: string
          created_at?: string
          id?: string
          identity?: string | null
          interests?: string | null
          nickname?: string
          personality_traits?: string | null
          style_backstory?: string | null
          tone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_personalities_companion_id_fkey"
            columns: ["companion_id"]
            isOneToOne: false
            referencedRelation: "companions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
