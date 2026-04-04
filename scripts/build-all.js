import { buildPackage, collectPackageJsons } from "@fuman/build";

const packages = await collectPackageJsons(process.cwd());
for (const pkg of packages.filter((p) => !p.root)) {
    await buildPackage({
        workspaceRoot: process.cwd(),
        packageName: pkg.json.name,
    });
}
