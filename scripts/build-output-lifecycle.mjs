import { prepareGeneratedOutputs } from "./static-asset-output.mjs";

function requiredFunction(name, value) {
  if (typeof value !== "function") {
    throw new TypeError(`${name} must be a function`);
  }
  return value;
}

/**
 * Own the complete generated-output lifecycle for one esbuild context.
 *
 * Every build attempt starts by invalidating the previous generated extension.
 * Compilation errors therefore leave no stale bundle or copied asset behind.
 * Successful compilation is finalized by the caller-provided static copy; if
 * finalization fails, every partially generated output is removed again.
 */
export function createBuildOutputLifecyclePlugin({
  root,
  temporaryRoot,
  outdir,
  blockerOnly = false,
  assertProductionGraph,
  copyStaticAssets,
  profile,
  log = console.log,
}) {
  const assertGraph = requiredFunction("assertProductionGraph", assertProductionGraph);
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
