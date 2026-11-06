import {
  MOONFOLD_PROJECT_FILE_NAME,
  type EnvironmentId,
  type MoonfoldProjectFile,
  type MoonfoldProjectFileScript,
} from "@moonfold/contracts";
import { parseMoonfoldProjectFile } from "@moonfold/shared/moonfoldProjectFile";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<MoonfoldProjectFileScript> = [];

export interface MoonfoldProjectFileState {
  status: "loading" | "missing" | "invalid" | "valid";
  file: MoonfoldProjectFile | null;
  scripts: ReadonlyArray<MoonfoldProjectFileScript>;
}

export function useMoonfoldProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): MoonfoldProjectFileState {
  const query = useProjectFileQuery(
    environmentId,
    cwd ?? "",
    MOONFOLD_PROJECT_FILE_NAME,
    cwd !== null,
  );
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  if (contents === null) {
    return {
      status: isPending ? "loading" : "missing",
      file: null,
      scripts: NO_SCRIPTS,
    } as const;
  }
  const file = parseMoonfoldProjectFile(contents);
  if (file === null) {
    return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
  }
  return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
}

export function useMoonfoldProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<MoonfoldProjectFileScript> {
  return useMoonfoldProjectFileState(environmentId, cwd).scripts;
}
