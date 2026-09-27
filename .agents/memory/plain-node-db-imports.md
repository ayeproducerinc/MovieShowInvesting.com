---
name: Plain Node and DB package imports
description: Why ad hoc Node ESM scripts do not import the database workspace package directly.
---

Plain Node ESM resolves the database workspace package to TypeScript source whose directory imports are not accepted by Node's native module resolver. The API artifact also does not directly declare the database driver's package, even though the database package does.

**Why:** Direct package imports failed before an isolated database verification script could run, despite the application itself building and serving correctly. Package-scoped driver resolution worked without changing application dependencies.

**How to apply:** For one-off Node scripts in this workspace, use the package that declares the required dependency or an appropriate TypeScript runner. Do not infer that a package is directly importable in plain Node just because the bundled server can use it.