import fs from "node:fs";
import path from "node:path";

export interface HostPackageRecord {
  id: string;
  version: string;
  title: string;
  enabled: boolean;
  renderStatus: string;
  rootPath: string;
  entryAbsPath: string;
  entryRelative: string;
  exports: Record<string, string>;
  components: string[];
  hash?: string;
}

export class HostRegistryBypass {
  readonly dir: string;

  constructor(sessionDir: string) {
    this.dir = sessionDir;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  registryPath(): string {
    return path.join(this.dir, "registry.json");
  }

  packagesNdjsonPath(): string {
    return path.join(this.dir, "packages.ndjson");
  }

  writeRegistry(packages: HostPackageRecord[]): void {
    const payload = {
      updatedAt: new Date().toISOString(),
      packages,
    };
    fs.writeFileSync(this.registryPath(), JSON.stringify(payload, null, 2), "utf8");
  }

  appendEvent(
    type: "package.registered" | "package.unregistered" | "package.updated",
    body: Record<string, unknown>,
  ): void {
    const line =
      JSON.stringify({
        type,
        ts: new Date().toISOString(),
        ...body,
      }) + "\n";
    fs.appendFileSync(this.packagesNdjsonPath(), line, "utf8");
  }
}
