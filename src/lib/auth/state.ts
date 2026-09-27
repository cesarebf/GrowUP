export type ActionState = { status: "idle" | "success" | "error"; message: string };
export const initialState: ActionState = { status: "idle", message: "" };
export type AuthFormMode = "sign-in" | "sign-up" | "forgot-password" | "resend" | "verify" | "recover";
