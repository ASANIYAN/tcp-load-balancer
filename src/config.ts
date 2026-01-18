import { z } from "zod";

const BackendSchema = z.object({
  host: z.string().min(1, "Host cannot be empty"),
  port: z.number().int().min(1).max(65535, "Port must be between 1 and 65535"),
  healthy: z.boolean(),
});

const HealthCheckConfigSchema = z.object({
  interval: z
    .number()
    .int()
    .min(1000, "Health check interval must be at least 1000ms"),
  timeout: z
    .number()
    .int()
    .min(500, "Health check timeout must be at least 500ms"),
});

const ShutdownConfigSchema = z.object({
  timeout: z
    .number()
    .int()
    .min(5000, "Shutdown timeout must be at least 5000ms"),
});

const LoadBalancerConfigSchema = z.object({
  proxyPort: z
    .number()
    .int()
    .min(1)
    .max(65535, "Proxy port must be between 1 and 65535"),
  backends: z.array(BackendSchema).min(1, "At least one backend is required"),
  healthCheck: HealthCheckConfigSchema,
  shutdown: ShutdownConfigSchema,
});

// Main config schema that includes everything
const ConfigSchema = z.object({
  proxyPort: z
    .number()
    .int()
    .min(1)
    .max(65535, "Proxy port must be between 1 and 65535"),
  backends: z.array(BackendSchema).min(1, "At least one backend is required"),
  healthCheck: HealthCheckConfigSchema,
  shutdown: ShutdownConfigSchema,
});

const EnvSchema = z.object({
  PROXY_PORT: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 8080)),
  HEALTH_CHECK_INTERVAL: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 5000)),
  HEALTH_CHECK_TIMEOUT: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 3000)),
  SHUTDOWN_TIMEOUT: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 30000)),
});

export type Backend = z.infer<typeof BackendSchema>;
export type HealthCheckConfig = z.infer<typeof HealthCheckConfigSchema>;
export type ShutdownConfig = z.infer<typeof ShutdownConfigSchema>;
export type LoadBalancerConfig = z.infer<typeof LoadBalancerConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type EnvConfig = z.infer<typeof EnvSchema>;

function parseEnv(): EnvConfig {
  const env = EnvSchema.parse(process.env);
  return env;
}

function createConfig(): Config {
  try {
    const env = parseEnv();

    const config = {
      proxyPort: env.PROXY_PORT,
      backends: [
        { host: "127.0.0.1", port: 9090, healthy: true },
        { host: "127.0.0.1", port: 9091, healthy: true },
        { host: "127.0.0.1", port: 9092, healthy: true },
      ],
      healthCheck: {
        interval: env.HEALTH_CHECK_INTERVAL,
        timeout: env.HEALTH_CHECK_TIMEOUT,
      },
      shutdown: {
        timeout: env.SHUTDOWN_TIMEOUT,
      },
    };

    return ConfigSchema.parse(config);
  } catch (error) {
    console.error("Configuration validation failed:");

    if (error instanceof z.ZodError) {
      error.issues.forEach((err) => {
        console.error(`  - ${err.path.join(".")}: ${err.message}`);
      });
    } else {
      console.error(error);
    }

    process.exit(1);
  }
}

const config = createConfig();
export default config;

export {
  ConfigSchema,
  LoadBalancerConfigSchema,
  BackendSchema,
  HealthCheckConfigSchema,
  ShutdownConfigSchema,
  EnvSchema,
  createConfig,
};
