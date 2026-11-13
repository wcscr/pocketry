/**
 * Simplification and smoothing that preserve concavity.
 *
 * The implementation is dependency-free and lives with the other shared ring
 * maths, where the outline finishing passes can use it too. Client code keeps
 * importing it from here.
 */
export * from "@shared/geometry/simplify";
