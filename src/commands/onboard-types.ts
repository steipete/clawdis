export type OnboardMode = "local" | "remote";
export type AuthChoice =
  | "oauth"
  | "antigravity"
  | "apiKey"
  | "minimax"
  | "skip";
export type GatewayAuthChoice = "off" | "token" | "password";
export type ResetScope = "config" | "config+creds+sessions" | "full";
export type GatewayBind = "loopback" | "lan" | "tailnet" | "auto";
export type TailscaleMode = "off" | "serve" | "funnel";
export type NodeManagerChoice = "npm" | "pnpm" | "bun";
export type ProviderChoice =
  | "whatsapp"
  | "telegram"
  | "discord"
  | "slack"
  | "signal"
  | "imessage";

export type OnboardOptions = {
  mode?: OnboardMode;
  workspace?: string;
  nonInteractive?: boolean;
  authChoice?: AuthChoice;
  anthropicApiKey?: string;
  gatewayPort?: number;
  gatewayBind?: GatewayBind;
  gatewayAuth?: GatewayAuthChoice;
  gatewayToken?: string;
  gatewayPassword?: string;
  tailscale?: TailscaleMode;
  tailscaleResetOnExit?: boolean;
  installDaemon?: boolean;
  skipSkills?: boolean;
  skipHealth?: boolean;
  nodeManager?: NodeManagerChoice;
  remoteUrl?: string;
  remoteToken?: string;
  json?: boolean;
};
