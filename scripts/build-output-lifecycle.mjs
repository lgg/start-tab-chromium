import { assertSafeBuildOutputFilesystem } from "./build-output-path.mjs";
import { prepareGeneratedOutputs } from "./static-asset-output.mjs";

function requiredFunction(name, value) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
  return value;
}

function optionalFunction(name, value) {
  if (value === undefined) return async () => {};
  return requiredFunction(name, value);
}

/**
 * Own the complete generated-output lifecycle for one esbuild context.
 *
 * Every build attempt starts by invalidating the previous generated extension.
 * Compilation errors therefore leave no stale bundle or copied asset behind.
 * Production builds keep esbuild outputs in memory and write them here only
 * after successful compilation and finalization-input validation. Any bundle
 * or static finalization failure removes every partially generated output.
 */
export function createBuildOutputLifecyclePlugin({
  root,
  temporaryRoot,
  outdir,
  blockerOnly = false,
  assertProductionGraph,
  validateFinalizationInputs,
  writeBundleOutputs,
  copyStaticAssets,
  profile,
  log = console.log,
}) {
  const assertGraph = requiredFunction("assertProductionGraph", assertProductionGraph);
  const validateInputs = optionalFunction("validateFinalizationInputs", validateFinalizationInputs);
  const writeBundles = optionalFunction("writeBundleOutputs", writeBundleOutputs);
  const copyStatic = requiredFunction("copyStaticAssets", copyStaticAssets);
  const writeLog = requiredFunction("log", log);

  async function invalidateGeneratedOutputs() {
    await prepareGeneratedOutputs(root, temporaryRoot, outdir, blockerOnly);
  }

  return {
    name: "manage-extension-build-output-lifecycle",
    setup(build) {
      build.onStart(async () => {
        await invalidateGeneratedOutputs();
      });

      build.onEnd(async (result) => {
        if (result.errors.length > 0) return;

        try {
          assertGraph(result.metafile);
          // Validate static inputs before the first generated write. The static
          // copier revalidates them again before/at each concrete operation.
          await validateInputs();
          // Compilation can take long enough for an otherwise-safe output path
          // to be replaced after onStart. Production bundles are kept in memory
          // by esbuild and only written after this fresh filesystem check.
          await assertSafeBuildOutputFilesystem(root, temporaryRoot, outdir);
          await writeBundles(result.outputFiles);
          await copyStatic();
          writeLog(`Built ${profile} extension at ${outdir}`);
        } catch (error) {
          try {
            await invalidateGeneratedOutputs();
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Build finalization failed and generated-output cleanup also failed",
            );
          }
          throw error;
        }
      });
    },
  };
}
