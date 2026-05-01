import { execFileSync } from "node:child_process";
import {
  access,
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const buildDir = join(repoRoot, "build");
const archiveDir = join(repoRoot, "archive");
const buildLogPath = join(buildDir, "build-log.md");
const packageJsonPath = join(repoRoot, "package.json");
const packageLockPath = join(repoRoot, "package-lock.json");

const validVersionParts = new Set(["major", "minor", "patch"]);
const requestedVersionPart =
  process.argv
    .slice(2)
    .map((arg) => arg.replace(/^--/, ""))
    .find((arg) => validVersionParts.has(arg)) ??
  process.env.BUILD_VERSION_PART ??
  "patch";

if (!validVersionParts.has(requestedVersionPart)) {
  throw new Error(
    `Unsupported version increment "${requestedVersionPart}". Use major, minor, or patch.`,
  );
}

await main();

async function main() {
  await mkdir(buildDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });

  const packageJsonText = await readFile(packageJsonPath, "utf8");
  const packageLockText = await readOptionalText(packageLockPath);
  const packageJson = JSON.parse(packageJsonText);
  const currentVersion = packageJson.version;
  const nextVersion = incrementVersion(currentVersion, requestedVersionPart);

  const rootArtifactsBeforeBuild = await listFoxeFiles(repoRoot);

  try {
    updatePackageVersion(packageJson, nextVersion);
    await writeJson(packageJsonPath, packageJson);

    if (packageLockText != undefined) {
      const packageLock = JSON.parse(packageLockText);
      updatePackageLockVersion(packageLock, nextVersion);
      await writeJson(packageLockPath, packageLock);
    }

    console.log(`Packaging Foxglove panel ${currentVersion} -> ${nextVersion}`);
    runNpmScript("foxglove:package");
  } catch (error) {
    await writeFile(packageJsonPath, packageJsonText);
    if (packageLockText != undefined) {
      await writeFile(packageLockPath, packageLockText);
    }
    throw error;
  }

  const rootArtifactsAfterBuild = await listFoxeFiles(repoRoot);
  const newArtifact = await findNewArtifact(rootArtifactsBeforeBuild, rootArtifactsAfterBuild);
  const oldBuildArtifacts = await listFoxeFiles(buildDir);
  const staleRootArtifacts = rootArtifactsBeforeBuild.filter((artifact) => artifact !== newArtifact);

  await archiveArtifacts([...oldBuildArtifacts, ...staleRootArtifacts]);

  const latestArtifactPath = join(buildDir, basename(newArtifact));
  await rename(newArtifact, latestArtifactPath);
  await appendBuildLog(nextVersion, basename(latestArtifactPath));

  console.log(`Latest build: ${relative(repoRoot, latestArtifactPath)}`);
  console.log(`Build log: ${relative(repoRoot, buildLogPath)}`);
}

function incrementVersion(version, part) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (match == undefined) {
    throw new Error(`Cannot increment non-standard version "${version}". Expected x.y.z.`);
  }

  let major = Number(match[1]);
  let minor = Number(match[2]);
  let patch = Number(match[3]);

  if (part === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (part === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
}

function updatePackageVersion(packageJson, version) {
  packageJson.version = version;
}

function updatePackageLockVersion(packageLock, version) {
  packageLock.version = version;

  if (packageLock.packages?.[""] != undefined) {
    packageLock.packages[""].version = version;
  }
}

async function readOptionalText(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runNpmScript(scriptName) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(npmCommand, ["run", scriptName], {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
}

async function listFoxeFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".foxe"))
    .map((entry) => join(directory, entry.name))
    .sort();
}

async function findNewArtifact(before, after) {
  const beforeSet = new Set(before);
  const candidates = after.filter((artifact) => !beforeSet.has(artifact));

  if (candidates.length === 0) {
    throw new Error("Foxglove packaging did not create a new .foxe artifact.");
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  const candidatesByTime = await Promise.all(
    candidates.map(async (artifact) => ({
      artifact,
      mtimeMs: (await stat(artifact)).mtimeMs,
    })),
  );

  candidatesByTime.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return candidatesByTime[0].artifact;
}

async function archiveArtifacts(artifacts) {
  for (const artifact of artifacts) {
    const target = await uniqueArchivePath(basename(artifact));
    await rename(artifact, target);
    console.log(`Archived ${relative(repoRoot, artifact)} -> ${relative(repoRoot, target)}`);
  }
}

async function uniqueArchivePath(fileName) {
  const initialTarget = join(archiveDir, fileName);
  if (!(await pathExists(initialTarget))) {
    return initialTarget;
  }

  const extension = extname(fileName);
  const baseName = fileName.slice(0, fileName.length - extension.length);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  let attempt = 1;

  while (true) {
    const suffix = attempt === 1 ? timestamp : `${timestamp}-${attempt}`;
    const target = join(archiveDir, `${baseName}-archived-${suffix}${extension}`);
    if (!(await pathExists(target))) {
      return target;
    }
    attempt += 1;
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function appendBuildLog(version, artifactName) {
  if (!(await pathExists(buildLogPath)) || (await stat(buildLogPath)).size === 0) {
    await writeFile(
      buildLogPath,
      "| Built At | Builder | Version | Artifact |\n| --- | --- | --- | --- |\n",
    );
  }

  await appendFile(
    buildLogPath,
    `| ${new Date().toISOString()} | ${getBuilder()} | ${version} | ${artifactName} |\n`,
  );
}

function getBuilder() {
  return (
    process.env.BUILD_AUTHOR ??
    process.env.GITHUB_ACTOR ??
    readCommandOutput("git", ["config", "user.name"]) ??
    os.userInfo().username ??
    "unknown"
  );
}

function readCommandOutput(command, args) {
  try {
    const output = execFileSync(command, args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return output.length > 0 ? output : undefined;
  } catch {
    return undefined;
  }
}
