import { builtInSecretProviderDefinitions } from "@moonfold/secret-provider-definitions/registry";
import * as OnePasswordDriver from "@moonfold/secret-provider-onepassword/server/driver";

/** In the shared registry's order. */
export const BUILT_IN_SECRET_PROVIDER_DRIVER_LIST = [OnePasswordDriver.driver] as const;

export const secretProviderDefinitions = builtInSecretProviderDefinitions;
