/**
 * UI feature flags only. Provider credentials and Supabase OAuth setup remain
 * exclusively in the existing environment/Supabase configuration.
 */
export const authProviderFeatures = {
  google: import.meta.env.VITE_ENABLE_GOOGLE_AUTH === "true",
  apple: import.meta.env.VITE_ENABLE_APPLE_AUTH === "true",
  facebook: import.meta.env.VITE_ENABLE_FACEBOOK_AUTH === "true",
  x: import.meta.env.VITE_ENABLE_X_AUTH === "true",
} as const;

export type AuthProviderName = keyof typeof authProviderFeatures;
