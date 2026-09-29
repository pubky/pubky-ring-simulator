# Documentation

Never state the simulator's current Pubky SDK version in README.md. Keep dependency versions in
package.json and package-lock.json. Older SDK versions may be named when documenting compatibility tests.

# Testing

Keep tests focused on this project's behavior and dependency integration. Tests of a dependency's
own behavior belong in that dependency's repository.
