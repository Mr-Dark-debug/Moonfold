import {
  MOONFOLD_PROJECT_FILE_NAME,
  type EnvironmentId,
  type MoonfoldProjectFile,
} from "@moonfold/contracts";
import { parseMoonfoldProjectFile } from "@moonfold/shared/moonfoldProjectFile";
import { executeAtomQuery } from "@moonfold/client-runtime/state/runtime";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

export async function readMoonfoldProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<MoonfoldProjectFile | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    getProjectFileQueryAtom(environmentId, workspaceRoot, MOONFOLD_PROJECT_FILE_NAME),
    { reportDefect: false, reportFailure: false },
  );
  const data = resolveProjectFileQueryData(
    environmentId,
    workspaceRoot,
    MOONFOLD_PROJECT_FILE_NAME,
    result._tag === "Success" ? result.value : null,
  );
  if (data === null || data.exists === false || data.truncated) return null;
  return parseMoonfoldProjectFile(data.contents);
}
