export type ConnectionStatus = 'connected' | 'no-credentials' | 'error' | 'checking';

export interface StatusResponse {
  status: ConnectionStatus;
  hasCredentials: boolean;
  krakenConnected: boolean;
  message: string;
  serverTime?: string;
}
