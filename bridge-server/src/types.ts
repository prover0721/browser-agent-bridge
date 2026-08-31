// types.ts - Bridge Server Types

export interface BridgeCommandRequest {
  id: string;
  method: string;
  params?: Record<string, any>;
}

export interface BridgeCommandResponse {
  id: string;
  result?: any;
  error?: string | null;
}

export interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timer: NodeJS.Timeout;
}
