/**
 * Windows only: React Native's C++ code (screens, worklets, reanimated, the app's codegen...) is built
 * with CMake and ninja, which cannot open paths longer than 260 characters. From a deep project folder
 * the build files cross that limit: ninja loops with "build.ninja still dirty after 100 tries", fails to
 * create object folders, or reports "Filename longer than 260 characters".
 *
 * For every Android module with native code (libraries and the app):
 * - its CMake folder (.cxx) moves to a short folder in the user's home (~/.cxx/<project hash>/<module>);
 * - CMAKE_OBJECT_PATH_MAX is set, so CMake replaces over-long object folder names with a short hash.
 *   (Cross-compiling for Android uses Linux's limit of 1000, so CMake never shortens them by itself.)
 *
 * Builds on macOS, Linux and EAS are unchanged.
 */
const { withAppBuildGradle, withProjectBuildGradle } = require('expo/config-plugins');

const MARKER = '// vitasense: short native build folders';
const OBJECT_PATH_MAX = 240;
// The app module's object folders carry an extra prefix (<library>_autolinked_build/CMakeFiles/...), and release
// builds add "RelWithDebInfo" to the path, so it needs a little more room before CMake can hash a long name.
const APP_OBJECT_PATH_MAX = 250;

const ROOT_SNIPPET = `
${MARKER} (plugins/with-short-native-build-paths.js)
if (System.getProperty('os.name').toLowerCase().contains('windows')) {
  def shortCxxRoot = new File(System.getProperty('user.home'), ".cxx/" + Integer.toHexString(rootDir.absolutePath.hashCode()))
  subprojects { sub ->
    sub.plugins.withId('com.android.library') {
      // Libraries are configured after this file, so the DSL can still change.
      if (!sub.state.executed) {
        sub.android.externalNativeBuild.cmake.buildStagingDirectory = new File(shortCxxRoot, sub.name)
        def components = sub.extensions.getByName('androidComponents')
        components.onVariants(components.selector().all()) { variant ->
          variant.externalNativeBuild?.arguments?.add('-DCMAKE_OBJECT_PATH_MAX=${OBJECT_PATH_MAX}')
        }
      }
    }
  }
}
`;

// The app module is configured before the root file's hook runs, so it gets the same settings here.
const APP_SNIPPET = `
${MARKER} (plugins/with-short-native-build-paths.js)
if (System.getProperty('os.name').toLowerCase().contains('windows')) {
  android {
    externalNativeBuild {
      cmake {
        buildStagingDirectory = new File(System.getProperty('user.home'), ".cxx/" + Integer.toHexString(rootDir.absolutePath.hashCode()) + "/app")
      }
    }
    defaultConfig {
      externalNativeBuild {
        cmake {
          arguments "-DCMAKE_OBJECT_PATH_MAX=${APP_OBJECT_PATH_MAX}"
        }
      }
    }
  }
}
`;

function append(contents, snippet) {
  return contents.includes(MARKER) ? contents : contents + snippet;
}

module.exports = function withShortNativeBuildPaths(config) {
  config = withProjectBuildGradle(config, (mod) => {
    if (mod.modResults.language === 'groovy') mod.modResults.contents = append(mod.modResults.contents, ROOT_SNIPPET);
    return mod;
  });
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language === 'groovy') mod.modResults.contents = append(mod.modResults.contents, APP_SNIPPET);
    return mod;
  });
};
