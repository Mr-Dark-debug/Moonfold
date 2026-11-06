import { makeSecretProviderDefinitionRegistry } from "@moonfold/secret-provider-core/shared/definition";
import * as OnePassword from "@moonfold/secret-provider-onepassword/shared/definition";

export const builtInSecretProviderDefinitions = makeSecretProviderDefinitionRegistry([
  OnePassword.definition,
]);
