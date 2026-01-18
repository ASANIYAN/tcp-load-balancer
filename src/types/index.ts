export type Backend = {
  host: string;
  port: number;
  healthy: boolean;
};

export type BackendConfig = {
  host: string;
  port: number;
};
