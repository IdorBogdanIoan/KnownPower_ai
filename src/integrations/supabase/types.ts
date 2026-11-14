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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value?: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          actor: string
          at: string
          id: string
          text: string
        }
        Insert: {
          actor: string
          at?: string
          id?: string
          text: string
        }
        Update: {
          actor?: string
          at?: string
          id?: string
          text?: string
        }
        Relationships: []
      }
      client_documents: {
        Row: {
          data: string | null
          id: string
          imported_at: string
          kind: string
          pod: string | null
          text: string
          text_norm: string
        }
        Insert: {
          data?: string | null
          id: string
          imported_at?: string
          kind: string
          pod?: string | null
          text: string
          text_norm: string
        }
        Update: {
          data?: string | null
          id?: string
          imported_at?: string
          kind?: string
          pod?: string | null
          text?: string
          text_norm?: string
        }
        Relationships: []
      }
      demo_reports: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          payload: Json
          status: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          payload: Json
          status?: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          payload?: Json
          status?: string
        }
        Relationships: []
      }
      field_reports: {
        Row: {
          actor: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          evidence_notes: string | null
          fields: Json
          id: string
          inspected_at: string | null
          lat: number
          lon: number
          osm_geometry: Json | null
          osm_id: string | null
          osm_verdict: string | null
          photo_pole_url: string | null
          photo_sheet_url: string | null
          pole_check: Json | null
          pos_source: string | null
          status: string
          submitted_by: string | null
          submitted_team: string | null
          validated_by: string | null
        }
        Insert: {
          actor: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          evidence_notes?: string | null
          fields?: Json
          id?: string
          inspected_at?: string | null
          lat: number
          lon: number
          osm_geometry?: Json | null
          osm_id?: string | null
          osm_verdict?: string | null
          photo_pole_url?: string | null
          photo_sheet_url?: string | null
          pole_check?: Json | null
          pos_source?: string | null
          status?: string
          submitted_by?: string | null
          submitted_team?: string | null
          validated_by?: string | null
        }
        Update: {
          actor?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          evidence_notes?: string | null
          fields?: Json
          id?: string
          inspected_at?: string | null
          lat?: number
          lon?: number
          osm_geometry?: Json | null
          osm_id?: string | null
          osm_verdict?: string | null
          photo_pole_url?: string | null
          photo_sheet_url?: string | null
          pole_check?: Json | null
          pos_source?: string | null
          status?: string
          submitted_by?: string | null
          submitted_team?: string | null
          validated_by?: string | null
        }
        Relationships: []
      }
      layers: {
        Row: {
          geojson: Json
          name: string
        }
        Insert: {
          geojson: Json
          name: string
        }
        Update: {
          geojson?: Json
          name?: string
        }
        Relationships: []
      }
      line_scores: {
        Row: {
          culoare: string
          geometry: Json
          id: string
          motive: Json
          scor: number
        }
        Insert: {
          culoare: string
          geometry: Json
          id: string
          motive?: Json
          scor: number
        }
        Update: {
          culoare?: string
          geometry?: Json
          id?: string
          motive?: Json
          scor?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          display_name: string
          id: string
          team: string
        }
        Insert: {
          display_name?: string
          id: string
          team?: string
        }
        Update: {
          display_name?: string
          id?: string
          team?: string
        }
        Relationships: []
      }
      proposals: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          geometrie: Json
          id: string
          incredere: number
          motiv: string | null
          obiect: string
          propus: Json
          status: string
          sursa: string | null
          tip: string
          validated_by: string | null
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          geometrie: Json
          id: string
          incredere: number
          motiv?: string | null
          obiect: string
          propus?: Json
          status?: string
          sursa?: string | null
          tip: string
          validated_by?: string | null
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          geometrie?: Json
          id?: string
          incredere?: number
          motiv?: string | null
          obiect?: string
          propus?: Json
          status?: string
          sursa?: string | null
          tip?: string
          validated_by?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      decide_grid_item: {
        Args: {
          decision: string
          item_id: string
          item_kind: string
          operator_name: string
        }
        Returns: undefined
      }
      gridtwin_actor: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      match_client_documents: {
        Args: { address: string }
        Returns: {
          data: string | null
          id: string
          imported_at: string
          kind: string
          pod: string | null
          text: string
          text_norm: string
        }[]
        SetofOptions: {
          from: "*"
          to: "client_documents"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      normalize_client_text: { Args: { value: string }; Returns: string }
      save_client_verification: {
        Args: {
          documents_snapshot: Json
          expected: Json
          line_geometry: Json
          proposal_id: string
          verification: Json
        }
        Returns: undefined
      }
      set_gridtwin_role: {
        Args: {
          new_role: Database["public"]["Enums"]["app_role"]
          target_user: string
        }
        Returns: undefined
      }
      submit_field_report: { Args: { report: Json }; Returns: string }
      submit_osm_inspection: { Args: { report: Json }; Returns: string }
    }
    Enums: {
      app_role: "field_team" | "validation_team" | "admin" | "user"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["field_team", "validation_team", "admin", "user"],
    },
  },
} as const
